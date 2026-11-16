import { ChatComposer } from "frontend/components/chat/ChatComposer";
import { ChatMessageList } from "frontend/components/chat/ChatMessageList";
import { ChatShell } from "frontend/components/chat/ChatShell";
import { useChatAutoscroll } from "frontend/components/chat/useChatAutoscroll";
import UserAvatar from "frontend/components/navbar/UserAvatar";
import { PlayerMention } from "frontend/components/PlayerMention";
import { usePlayers } from "frontend/context/players";
import { parseNotificationPayload } from "frontend/utils/notification-payload";
import { avatarImageProps, type CoAvatar } from "frontend/utils/sprites/avatar";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useMemo, useState } from "react";

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

  // Resolve chosen avatars for everyone shown (friends, recents, the open DM partner), keyed by handle.
  const cardNames = useMemo(() => {
    const names = new Set<string>();
    (friendsList ?? []).forEach((friend) => names.add(friend.name));
    (recentsList ?? []).forEach((player) => names.add(player.name));

    if (activePartner !== null) {
      names.add(activePartner.name);
    }

    return [...names];
  }, [friendsList, recentsList, activePartner]);

  const { data: cards } = trpc.players.cards.useQuery(
    { names: cardNames },
    { enabled: cardNames.length > 0, staleTime: 5 * 60 * 1000 },
  );
  const avatarByName = useMemo(
    () => new Map((cards ?? []).map((card) => [card.name, card.avatar])),
    [cards],
  );
  const avatarOf = (name: string): CoAvatar | null => avatarByName.get(name) ?? null;

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

  const markRead = trpc.social.markConversationRead.useMutation();

  // Dismiss a notification (mark it read so it drops off the unread inbox). The FRIEND_REQUEST
  // notifications auto-clear when you Accept/Decline; FRIEND_ACCEPT ones have no action, so this is
  // the only way to clear them.
  const dismissNotif = trpc.social.markNotificationRead.useMutation({
    onSuccess: () => void refetchNotifications(),
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
  const listRef = useChatAutoscroll<HTMLDivElement>([activeConvHistory?.messages]);

  // Advance the read cursor (and notify the others) once per open / new message — via an explicit
  // mutation, so it doesn't fire on every history refetch the way the old query side effect did.
  const lastMessageId = activeConvHistory?.messages.at(-1)?.id;
  useEffect(() => {
    if (activeConvId !== null && lastMessageId !== undefined) {
      markRead.mutate({ playerId: pId, conversationId: activeConvId });
    }
    // Only re-mark on open / new message; markRead + pId are stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId, lastMessageId]);

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

  const handleSend = (content: string) => {
    if (activeConvId === null) {
      return;
    }

    sendMsg.mutate({ playerId: pId, conversationId: activeConvId, content });
  };

  const inThread = activePartner !== null && activeConvId !== null;

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
                  const payload = parseNotificationPayload(notif.content);
                  return (
                    <div
                      key={notif.id}
                      className="@flex @flex-col @gap-1 @bg-bg-primary @p-2 @rounded @border @border-bg-tertiary/40"
                    >
                      <div className="@flex @items-start @justify-between @gap-2">
                        <span className="@text-[10px] @font-semibold @text-slate-300">
                          {notif.type === "FRIEND_REQUEST"
                            ? `${payload.senderName} requested your friendship.`
                            : `Friend request approved!`}
                        </span>
                        <button
                          onClick={() =>
                            dismissNotif.mutate({ playerId: pId, notificationId: notif.id })
                          }
                          disabled={dismissNotif.isLoading}
                          aria-label="Dismiss notification"
                          title="Dismiss"
                          className="@flex-none @text-slate-500 hover:@text-slate-200 @text-[11px] @leading-none @transition disabled:@opacity-50"
                        >
                          ✕
                        </button>
                      </div>
                      {notif.type === "FRIEND_REQUEST" && (
                        <div className="@flex @gap-1.5 @mt-1">
                          <button
                            onClick={() =>
                              respondRequest.mutate({
                                playerId: pId,
                                senderId: payload.senderId ?? "",
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
                                senderId: payload.senderId ?? "",
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
                        <span className="@relative @flex-none">
                          <UserAvatar
                            name={friend.displayName}
                            size={30}
                            {...avatarImageProps(avatarOf(friend.name))}
                          />
                          <span className="@absolute @-bottom-0.5 @-right-0.5 @h-2 @w-2 @rounded-full @border @border-bg-primary @bg-emerald-500" />
                        </span>
                        <div className="@flex @flex-col @min-w-0">
                          <PlayerMention
                            name={friend.name}
                            label={friend.displayName}
                            hideAvatar
                            className="@text-xs @font-semibold @text-slate-100"
                          />
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
                      <div className="@flex @min-w-0 @items-center @gap-2">
                        <UserAvatar
                          name={player.displayName}
                          size={30}
                          className="@flex-none"
                          {...avatarImageProps(avatarOf(player.name))}
                        />
                        <div className="@flex @flex-col @min-w-0">
                          <PlayerMention
                            name={player.name}
                            label={player.displayName}
                            hideAvatar
                            className="@text-xs @font-semibold @text-slate-100"
                          />
                          <span className="@text-[9px] @text-slate-500 @truncate">
                            @{player.name}
                          </span>
                        </div>
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
          <UserAvatar
            name={currentPlayer.displayName}
            size={28}
            className="@flex-none"
            {...avatarImageProps(currentPlayer.preferences?.avatar ?? null)}
          />
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

      {/* RIGHT CHAT AREA — shared docked chat shell */}
      {inThread ? (
        <ChatShell
          variant="docked"
          title="Comm-Link"
          live
          bodyRef={listRef}
          headerExtra={
            <PlayerMention
              name={activePartner.name}
              label={activePartner.displayName}
              avatar={avatarOf(activePartner.name)}
              size={18}
              className="@max-w-[160px] @text-xs @font-bold @text-slate-100"
            />
          }
          actions={
            <>
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
            </>
          }
          footer={
            <ChatComposer
              onSend={handleSend}
              sending={sendMsg.isLoading}
              placeholder={`Type transmission to ${activePartner.displayName}…`}
              sendLabel="Transmit"
            />
          }
        >
          <ChatMessageList
            messages={activeConvHistory?.messages ?? []}
            currentPlayerId={currentPlayer.id}
            partnerAvatar={avatarOf(activePartner.name)}
            partnerName={activePartner.displayName}
            emptyLabel="Secure link ready. Send a transmission line below."
            renderEditing={(msg) =>
              editingMessageId === msg.id ? (
                <div className="@flex @flex-col @gap-2 @rounded-xl @border @border-primary/50 @bg-bg-secondary @p-2">
                  <input
                    type="text"
                    value={editingContent}
                    onChange={(e) => setEditingContent(e.target.value)}
                    className="@rounded-md @border @border-bg-tertiary @bg-bg-primary @px-2 @py-1 @text-xs @text-slate-100 focus:@border-primary focus:@outline-none"
                  />
                  <div className="@flex @justify-end @gap-1.5">
                    <button
                      onClick={() =>
                        editMsg.mutate({
                          playerId: pId,
                          messageId: msg.id,
                          content: editingContent,
                        })
                      }
                      disabled={editMsg.isLoading}
                      className="@rounded-md @bg-primary @px-2.5 @py-1 @text-[10px] @font-bold @text-black @transition hover:@bg-primary-light disabled:@cursor-not-allowed disabled:@opacity-50"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingMessageId(null)}
                      className="@rounded-md @bg-bg-tertiary @px-2.5 @py-1 @text-[10px] @text-slate-300"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null
            }
            renderActions={(msg, isMe) =>
              isMe ? (
                <div className="@absolute @right-0 @top-[-20px] @hidden @gap-1.5 @rounded-md @border @border-bg-tertiary @bg-bg-secondary @px-1.5 @py-0.5 @text-[9px] group-hover:@flex">
                  <button
                    onClick={() => {
                      setEditingMessageId(msg.id);
                      setEditingContent(msg.content);
                    }}
                    className="@text-slate-400 @transition hover:@text-primary"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteMsg.mutate({ playerId: pId, messageId: msg.id })}
                    disabled={deleteMsg.isLoading}
                    className="@text-slate-400 @transition hover:@text-red-400 disabled:@cursor-not-allowed disabled:@opacity-50"
                  >
                    Delete
                  </button>
                </div>
              ) : null
            }
            renderMeta={(msg, isMe) => {
              const isEdited = msg.editedAt !== null;
              const allOthersRead =
                activeConvHistory?.participants
                  .filter((p) => p.playerId !== msg.senderId)
                  .every(
                    (p) => new Date(p.lastReadAt).getTime() >= new Date(msg.createdAt).getTime(),
                  ) ?? false;

              return (
                <>
                  {isEdited && <span className="@italic">(edited)</span>}
                  {isMe && allOthersRead && (
                    <span className="@font-bold @text-primary">✓✓ Viewed</span>
                  )}
                </>
              );
            }}
          />
        </ChatShell>
      ) : (
        <div className="@flex @h-full @flex-col @items-center @justify-center @gap-3 @rounded-xl @bg-bg-primary/95 @p-6 @text-center @outline @outline-1 @outline-bg-tertiary/40">
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
  );
}
