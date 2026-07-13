import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useState, useRef } from "react";

export default function SocialPanel() {
  const { currentPlayer } = usePlayers();

  // Active States
  const [activeTab, setActiveTab] = useState<"friends" | "recents">("friends");
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activePartner, setActivePartner] = useState<{
    id: string;
    displayName: string;
    name: string;
  } | null>(null);

  // Forms & Edit States
  const [searchQuery, setSearchQuery] = useState("");
  const [messageInput, setMessageInput] = useState("");
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");

  const pId = currentPlayer?.id ?? "";

  // Queries & Mutations
  const { data: friendsList, refetch: refetchFriends } = trpc.social.getFriendsList.useQuery(
    { playerId: pId },
    { enabled: currentPlayer !== undefined },
  );

  const { data: notifications, refetch: refetchNotifications } =
    trpc.social.getNotifications.useQuery(
      { playerId: pId, onlyUnread: true },
      { enabled: currentPlayer !== undefined, refetchInterval: 5000 },
    );

  const { data: recentsList } = trpc.social.getRecentCombatants.useQuery(
    { playerId: pId },
    { enabled: currentPlayer !== undefined },
  );

  const { data: activeConvHistory, refetch: refetchConvHistory } =
    trpc.social.getConversationHistory.useQuery(
      { playerId: pId, conversationId: activeConvId ?? "" },
      { enabled: activeConvId !== null, refetchInterval: 3000 },
    );

  // Social actions
  const sendRequest = trpc.social.sendFriendRequest.useMutation({
    onSuccess: () => {
      setSearchQuery("");
      alert("Friend request sent successfully!");
      void refetchNotifications();
    },
    onError: (err) => alert(err.message),
  });

  const respondRequest = trpc.social.respondToFriendRequest.useMutation({
    onSuccess: () => {
      void refetchFriends();
      void refetchNotifications();
    },
    onError: (err) => alert(err.message),
  });

  const startDM = trpc.social.getOrCreateDMConversation.useMutation({
    onSuccess: (conv) => {
      setActiveConvId(conv.id);
    },
    onError: (err) => alert(err.message),
  });

  const sendMsg = trpc.social.sendMessage.useMutation({
    onSuccess: () => {
      setMessageInput("");
      void refetchConvHistory();
    },
  });

  const editMsg = trpc.social.editMessage.useMutation({
    onSuccess: () => {
      setEditingMessageId(null);
      void refetchConvHistory();
    },
  });

  const deleteMsg = trpc.social.deleteMessage.useMutation({
    onSuccess: () => {
      void refetchConvHistory();
    },
  });

  const blockPlayer = trpc.social.blockPlayer.useMutation({
    onSuccess: () => {
      alert("Player blocked.");
      void refetchFriends();
    },
  });

  const mutePlayer = trpc.social.mutePlayer.useMutation({
    onSuccess: () => {
      alert("Player muted.");
    },
  });

  // Real-time Event Subscription
  trpc.social.onSocialEvent.useSubscription(
    { playerId: pId },
    {
      enabled: currentPlayer !== undefined,
      onData: (event) => {
        if (event.type === "MESSAGE_NEW" && event.conversationId === activeConvId) {
          void refetchConvHistory();
        } else if (event.type === "MESSAGE_EDIT" || event.type === "MESSAGE_DELETE") {
          void refetchConvHistory();
        } else if (event.type === "NOTIFICATION_NEW") {
          void refetchNotifications();
          void refetchFriends();
        }
      },
    },
  );

  // Auto Scroll to Chat bottom
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeConvHistory?.messages]);

  if (!currentPlayer) {
    return (
      <div className="@rounded-xl @bg-bg-primary/70 @p-8 @text-center @text-slate-400 @outline @outline-1 @outline-bg-tertiary">
        Please log in to access your tactical transmission systems.
      </div>
    );
  }

  // Handle DM start
  const handleOpenDM = (friend: { id: string; displayName: string; name: string }) => {
    setActivePartner(friend);
    startDM.mutate({ playerId: pId, targetPlayerName: friend.name });
  };

  const handleSendMessage = () => {
    if (messageInput.trim() === "" || activeConvId === null) {
      return;
    }

    sendMsg.mutate({ playerId: pId, conversationId: activeConvId, content: messageInput });
  };

  return (
    <div className="@grid @grid-cols-1 laptop:@grid-cols-[280px_1fr] @gap-4 @w-full @h-[650px] @overflow-hidden">
      {/* LEFT SIDEBAR: Contacts & Controls */}
      <div className="@flex @flex-col @justify-between @rounded-xl @bg-bg-primary/90 @p-4 @outline @outline-1 @outline-bg-tertiary @h-full @min-w-0">
        <div className="@flex @flex-col @gap-4 @overflow-y-auto">
          {/* Notifications Inbox */}
          {notifications && notifications.length > 0 && (
            <div className="@rounded-lg @bg-primary-dark/20 @border @border-primary-dark/40 @p-2.5">
              <p className="@text-[10px] @font-bold @uppercase @tracking-wider @text-primary @mb-1.5 flex @items-center">
                <span className="@mr-1">🚨</span> Alerts & Invites ({notifications.length})
              </p>
              <div className="@flex @flex-col @gap-2">
                {notifications.map((notif) => {
                  const payload = JSON.parse(notif.content) as {
                    senderName?: string;
                    senderId: string;
                  };
                  return (
                    <div
                      key={notif.id}
                      className="@flex @flex-col @gap-1 @bg-bg-primary @p-2 @rounded @border @border-bg-tertiary/40"
                    >
                      <span className="@text-[10px] @font-semibold @text-slate-300">
                        {notif.type === "FRIEND_REQUEST"
                          ? `${payload.senderName} requested your friendship.`
                          : `Friend request approved!`}
                      </span>
                      {notif.type === "FRIEND_REQUEST" && (
                        <div className="@flex @gap-1.5 @mt-1">
                          <button
                            onClick={() =>
                              respondRequest.mutate({
                                playerId: pId,
                                senderId: payload.senderId,
                                accept: true,
                              })
                            }
                            disabled={respondRequest.isLoading}
                            className="@flex-1 @py-1 @rounded @bg-primary @text-black @font-bold @text-[9px] hover:@bg-primary-light @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() =>
                              respondRequest.mutate({
                                playerId: pId,
                                senderId: payload.senderId,
                                accept: false,
                              })
                            }
                            disabled={respondRequest.isLoading}
                            className="@flex-1 @py-1 @rounded @bg-bg-secondary @text-slate-300 @text-[9px] hover:@bg-bg-tertiary @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                          >
                            Decline
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Add Friend Row */}
          <div>
            <p className="@text-[10px] @font-bold @uppercase @tracking-wider @text-slate-400 @mb-1.5">
              Request Friend
            </p>
            <div className="@flex @gap-1.5">
              <input
                type="text"
                placeholder="Unique name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="@flex-1 @rounded-lg @bg-bg-secondary @border @border-bg-tertiary/50 @px-2.5 @py-1.5 @text-xs @text-slate-100 placeholder-slate-500 focus:@outline-none focus:@border-primary"
              />
              <button
                onClick={() => sendRequest.mutate({ playerId: pId, targetPlayerName: searchQuery })}
                disabled={sendRequest.isLoading || searchQuery.trim() === ""}
                className="@px-3 @rounded-lg @bg-primary @text-black @font-bold @text-xs hover:@bg-primary-light @transition active:@scale-95 disabled:@opacity-50 disabled:@cursor-not-allowed"
              >
                Send
              </button>
            </div>
          </div>

          {/* Navigation Tab toggler */}
          <div className="@flex @border-b @border-bg-tertiary/50 @text-[11px] @font-bold @uppercase @tracking-wider">
            <button
              onClick={() => setActiveTab("friends")}
              className={`@flex-1 @pb-1.5 @border-b-2 @text-center @transition ${activeTab === "friends" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400 hover:@text-slate-200"}`}
            >
              Friends List
            </button>
            <button
              onClick={() => setActiveTab("recents")}
              className={`@flex-1 @pb-1.5 @border-b-2 @text-center @transition ${activeTab === "recents" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400 hover:@text-slate-200"}`}
            >
              Recents
            </button>
          </div>

          {/* Contact Lists */}
          <div className="@flex-1">
            {activeTab === "friends" ? (
              <div className="@flex @flex-col @gap-1">
                {friendsList && friendsList.length > 0 ? (
                  friendsList.map((friend) => (
                    <div
                      key={friend.id}
                      onClick={() => handleOpenDM(friend)}
                      className={`@flex @items-center @justify-between @px-2.5 @py-2 @rounded-lg @cursor-pointer @transition @border ${activePartner?.id === friend.id ? "@bg-bg-secondary @border-bg-tertiary" : "@border-transparent hover:@bg-bg-secondary/40"}`}
                    >
                      <div className="@flex @items-center @gap-2 @min-w-0">
                        <span className="@h-2 @w-2 @rounded-full @bg-emerald-500 @shadow-[0_0_6px_rgba(16,185,129,0.5)] @flex-none"></span>
                        <div className="@flex @flex-col @min-w-0">
                          <span className="@text-xs @font-semibold @text-slate-100 @truncate">
                            {friend.displayName}
                          </span>
                          <span className="@text-[10px] @text-slate-500 @truncate">
                            @{friend.name}
                          </span>
                        </div>
                      </div>
                      <span className="@text-[8px] @font-bold @bg-bg-tertiary/30 @border @border-bg-tertiary/60 @px-1.5 @py-0.5 @rounded @text-slate-400">
                        ONLINE
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="@text-xs @text-slate-500 @text-center @py-6">
                    Your friends list is currently empty.
                  </p>
                )}
              </div>
            ) : (
              <div className="@flex @flex-col @gap-1">
                {recentsList && recentsList.length > 0 ? (
                  recentsList.map((player) => (
                    <div
                      key={player.id}
                      className="@flex @items-center @justify-between @px-2.5 @py-2 @rounded-lg hover:@bg-bg-secondary/30"
                    >
                      <div className="@flex @flex-col @min-w-0">
                        <span className="@text-xs @font-semibold @text-slate-100 @truncate">
                          {player.displayName}
                        </span>
                        <span className="@text-[9px] @text-slate-500 @truncate">
                          @{player.name}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          sendRequest.mutate({ playerId: pId, targetPlayerName: player.name })
                        }
                        disabled={sendRequest.isLoading}
                        className="@px-2 @py-0.5 @rounded @bg-primary/10 @border @border-primary/20 @text-primary hover:@bg-primary hover:@text-black @text-[10px] @font-bold @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                      >
                        + Add
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="@text-xs @text-slate-500 @text-center @py-6">
                    No recent match opponents found.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Identity block */}
        <div className="@pt-3 @border-t @border-bg-tertiary/40 @flex @items-center @gap-3">
          <div className="@h-7 @w-7 @rounded-full @bg-primary @text-black @font-bold @flex @items-center @justify-center @text-xs">
            {currentPlayer.displayName[0].toUpperCase()}
          </div>
          <div className="@min-w-0">
            <p className="@text-xs @font-bold @text-slate-100 @truncate">
              {currentPlayer.displayName}
            </p>
            <p className="@text-[9px] @text-emerald-500 @font-bold @uppercase @tracking-wider">
              Active Secure Node
            </p>
          </div>
        </div>
      </div>

      {/* RIGHT CHAT AREA */}
      <div className="@flex @flex-col @justify-between @rounded-xl @bg-bg-primary/95 @border @border-bg-tertiary/30 @h-full @overflow-hidden">
        {activePartner !== null && activeConvId !== null ? (
          <>
            {/* Header */}
            <div className="@px-4 @py-3 @border-b @border-bg-tertiary/40 @flex @items-center @justify-between @bg-bg-secondary/40">
              <div className="@flex @items-center @gap-3 @min-w-0">
                <span className="@h-2 @w-2 @rounded-full @bg-emerald-500 @shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                <div className="@min-w-0">
                  <p className="@text-sm @font-bold @text-slate-100 @truncate">
                    {activePartner.displayName}
                  </p>
                  <p className="@text-[10px] @text-slate-400">Direct Secure Comm-Link</p>
                </div>
              </div>
              <div className="@flex @gap-2">
                <button
                  onClick={() =>
                    mutePlayer.mutate({ playerId: pId, targetPlayerId: activePartner.id })
                  }
                  className="@text-[10px] @px-2.5 @py-1 @rounded-md @border @border-bg-tertiary @text-slate-300 hover:@bg-bg-secondary @transition"
                >
                  🔇 Mute
                </button>
                <button
                  onClick={() =>
                    blockPlayer.mutate({ playerId: pId, targetPlayerId: activePartner.id })
                  }
                  className="@text-[10px] @px-2.5 @py-1 @rounded-md @border @border-red-900/30 @text-red-400 hover:@bg-red-950/20 @transition"
                >
                  🚫 Block
                </button>
              </div>
            </div>

            {/* Conversation Messages */}
            <div className="@flex-1 @p-4 @overflow-y-auto @flex @flex-col @gap-3">
              {activeConvHistory && activeConvHistory.messages.length > 0 ? (
                activeConvHistory.messages.map((msg) => {
                  const isMe = msg.senderId === currentPlayer.id;
                  const isEdited = msg.editedAt !== null;

                  // Viewed receipt calculation
                  const allOthersRead = activeConvHistory.participants
                    .filter((p) => p.playerId !== msg.senderId)
                    .every(
                      (p) => new Date(p.lastReadAt).getTime() >= new Date(msg.createdAt).getTime(),
                    );

                  return (
                    <div
                      key={msg.id}
                      className={`@flex @gap-3.5 @max-w-[80%] ${isMe ? "@ml-auto @justify-end" : ""}`}
                    >
                      {!isMe && (
                        <div className="@h-7 @w-7 @rounded-full @bg-bg-tertiary @text-slate-100 @flex @items-center @justify-center @text-[11px] @font-bold @flex-none">
                          {activePartner.displayName[0].toUpperCase()}
                        </div>
                      )}
                      <div className="@flex @flex-col @gap-1">
                        {editingMessageId === msg.id ? (
                          <div className="@bg-bg-secondary @p-2 @rounded-xl @border @border-primary/50 @flex @flex-col @gap-2">
                            <input
                              type="text"
                              value={editingContent}
                              onChange={(e) => setEditingContent(e.target.value)}
                              className="@bg-bg-primary @border @border-bg-tertiary @rounded-md @px-2 @py-1 @text-xs @text-slate-100 focus:@outline-none focus:@border-primary"
                            />
                            <div className="@flex @gap-1.5 @justify-end">
                              <button
                                onClick={() =>
                                  editMsg.mutate({
                                    playerId: pId,
                                    messageId: msg.id,
                                    content: editingContent,
                                  })
                                }
                                disabled={editMsg.isLoading}
                                className="@px-2.5 @py-1 @bg-primary @text-black @rounded-md @text-[10px] @font-bold hover:@bg-primary-light @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditingMessageId(null)}
                                className="@px-2.5 @py-1 @bg-bg-tertiary @text-slate-300 @rounded-md @text-[10px]"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="@relative @group">
                            <div
                              className={`@px-3.5 @py-2 @rounded-xl @shadow-sm @text-xs @leading-relaxed ${isMe ? "@bg-primary @text-black @font-semibold @rounded-tr-none" : "@bg-bg-secondary @border @border-bg-tertiary/40 @text-slate-100 @rounded-tl-none"}`}
                            >
                              {msg.content}
                            </div>

                            {isMe && (
                              <div className="@absolute @right-0 @top-[-20px] @hidden group-hover:@flex @gap-1.5 @bg-bg-secondary @border @border-bg-tertiary @rounded-md @px-1.5 @py-0.5 @text-[9px]">
                                <button
                                  onClick={() => {
                                    setEditingMessageId(msg.id);
                                    setEditingContent(msg.content);
                                  }}
                                  className="@text-slate-400 hover:@text-primary @transition"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() =>
                                    deleteMsg.mutate({ playerId: pId, messageId: msg.id })
                                  }
                                  disabled={deleteMsg.isLoading}
                                  className="@text-slate-400 hover:@text-red-400 @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                                >
                                  Delete
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        <div
                          className={`@flex @items-center @gap-1.5 @text-[9px] @text-slate-500 ${isMe ? "@justify-end" : ""}`}
                        >
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                          {isEdited && <span className="@italic">(edited)</span>}
                          {isMe && allOthersRead && (
                            <span className="@text-primary @font-bold">✓✓ Viewed</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="@h-full @flex @items-center @justify-center @text-xs @text-slate-500 @text-center">
                  Secure link ready. Send a transmission line below.
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <div className="@p-3 @border-t @border-bg-tertiary/40 @bg-bg-secondary/10 @flex @items-center @gap-2.5">
              <input
                type="text"
                placeholder={`Type transmission to ${activePartner.displayName}...`}
                value={messageInput}
                onChange={(e) => setMessageInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                className="@flex-1 @rounded-lg @bg-bg-secondary @border @border-bg-tertiary/50 @px-3.5 @py-2.5 @text-xs @placeholder-slate-500 focus:@outline-none focus:@border-primary @text-slate-100"
              />
              <button
                onClick={handleSendMessage}
                disabled={sendMsg.isLoading}
                className="@h-9 @px-4 @rounded-lg @bg-primary hover:@bg-primary-light @text-black @font-bold @text-xs @shadow-sm @active:scale-95 @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
              >
                Transmit
              </button>
            </div>
          </>
        ) : (
          <div className="@h-full @flex @flex-col @items-center @justify-center @p-6 @text-center @gap-3">
            <span className="@text-4xl @opacity-80">📡</span>
            <div>
              <p className="@text-xs @font-bold @text-slate-300">No Target Active</p>
              <p className="@text-[10px] @text-slate-500 @max-w-[280px] @mt-1 @leading-relaxed">
                Choose a friend from the left dashboard, then click to activate an encrypted
                communication pipeline.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
