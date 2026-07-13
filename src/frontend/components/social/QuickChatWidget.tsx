import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";

export default function QuickChatWidget() {
  const { currentPlayer } = usePlayers();
  const [isOpen, setIsOpen] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activePartner, setActivePartner] = useState<{
    id: string;
    displayName: string;
    name: string;
  } | null>(null);
  const [messageInput, setMessageInput] = useState("");
  const [activeTab, setActiveTab] = useState<"friends" | "recents">("friends");

  const pId = currentPlayer?.id ?? "";

  // Queries
  const { data: friendsList } = trpc.social.getFriendsList.useQuery(
    { playerId: pId },
    { enabled: currentPlayer !== undefined && isOpen },
  );

  const { data: notifications, refetch: refetchNotifications } =
    trpc.social.getNotifications.useQuery(
      { playerId: pId, onlyUnread: true },
      { enabled: currentPlayer !== undefined, refetchInterval: 5000 },
    );

  const { data: recentsList } = trpc.social.getRecentCombatants.useQuery(
    { playerId: pId },
    { enabled: currentPlayer !== undefined && isOpen },
  );

  const { data: activeConvHistory, refetch: refetchConvHistory } =
    trpc.social.getConversationHistory.useQuery(
      { playerId: pId, conversationId: activeConvId ?? "" },
      { enabled: activeConvId !== null && isOpen, refetchInterval: 3000 },
    );

  // Mutations
  const startDM = trpc.social.getOrCreateDMConversation.useMutation({
    onSuccess: (conv) => {
      setActiveConvId(conv.id);
    },
  });

  const sendMsg = trpc.social.sendMessage.useMutation({
    onSuccess: () => {
      setMessageInput("");
      void refetchConvHistory();
    },
  });

  // Subscription
  trpc.social.onSocialEvent.useSubscription(
    { playerId: pId },
    {
      enabled: currentPlayer !== undefined,
      onData: (event) => {
        if (event.type === "MESSAGE_NEW") {
          if (isOpen && event.conversationId === activeConvId) {
            void refetchConvHistory();
          } else {
            void refetchNotifications();
          }
        } else if (event.type === "NOTIFICATION_NEW") {
          void refetchNotifications();
        }
      },
    },
  );

  // Scroll to bottom
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (isOpen) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [activeConvHistory?.messages, isOpen, activeConvId]);

  if (!currentPlayer) {
    return null;
  }

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

  const totalAlerts = notifications?.length ?? 0;

  return (
    <div className="@fixed @bottom-5 @right-5 @z-50 @font-sans">
      {/* COLLAPSED STATE */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="@flex @items-center @gap-2.5 @px-4 @py-2.5 @rounded-full @bg-bg-primary @border-2 @border-primary @text-slate-100 @shadow-lg @shadow-black/60 hover:@bg-bg-secondary hover:@scale-[1.03] @transition-all @duration-200"
        >
          <span className="@relative @flex @h-2.5 @w-2.5">
            <span className="@animate-ping @absolute @inline-flex @h-full @w-full @rounded-full @bg-emerald-400 @opacity-75"></span>
            <span className="@relative @inline-flex @rounded-full @h-2.5 @w-2.5 @bg-emerald-500"></span>
          </span>
          <span className="@text-xs @font-bold @uppercase @tracking-wider @font-russoOne">
            📡 COMMS FEED
          </span>
          {totalAlerts > 0 && (
            <span className="@bg-primary @text-black @text-[10px] @font-bold @h-5 @w-5 @rounded-full @flex @items-center @justify-center">
              {totalAlerts}
            </span>
          )}
        </button>
      )}

      {/* EXPANDED PANEL (Messenger style) */}
      {isOpen && (
        <div className="@w-[340px] @h-[480px] @bg-bg-primary/95 @border @border-bg-tertiary @rounded-xl @shadow-2xl @shadow-black/80 @flex @flex-col @overflow-hidden @animate-slide-up">
          {/* Header */}
          <div className="@px-3.5 @py-3 @bg-bg-secondary/80 @border-b @border-bg-tertiary/60 @flex @items-center @justify-between">
            {activePartner ? (
              <div className="@flex @items-center @gap-2">
                <button
                  onClick={() => {
                    setActivePartner(null);
                    setActiveConvId(null);
                  }}
                  className="@text-slate-400 hover:@text-slate-200 @text-sm @mr-1 @font-bold"
                >
                  ←
                </button>
                <div className="@flex @flex-col">
                  <span className="@text-xs @font-bold @text-slate-100 @truncate @max-w-[160px]">
                    {activePartner.displayName}
                  </span>
                  <span className="@text-[9px] @text-emerald-500 @font-bold">DIRECT CHANNEL</span>
                </div>
              </div>
            ) : (
              <div className="@flex @items-center @gap-2">
                <span className="@text-sm @font-bold @text-primary @font-russoOne">
                  📡 SECURE COMMS
                </span>
              </div>
            )}

            <button
              onClick={() => setIsOpen(false)}
              className="@text-slate-400 hover:@text-slate-200 @text-xs @font-bold @px-2 @py-1 @rounded hover:@bg-bg-tertiary/40"
            >
              Close
            </button>
          </div>

          {/* Main Body */}
          <div className="@flex-1 @overflow-y-auto @p-3 @bg-bg-primary/40">
            {activePartner !== null && activeConvId !== null ? (
              /* Chat Message Feed */
              <div className="@flex @flex-col @gap-2.5 @h-full @justify-between">
                <div className="@flex-1 @overflow-y-auto @flex @flex-col @gap-2.5 @pr-1">
                  {activeConvHistory && activeConvHistory.messages.length > 0 ? (
                    activeConvHistory.messages.map((msg) => {
                      const isMe = msg.senderId === currentPlayer.id;
                      return (
                        <div
                          key={msg.id}
                          className={`@flex @gap-2 @max-w-[85%] ${isMe ? "@ml-auto @justify-end" : ""}`}
                        >
                          <div className="@flex @flex-col">
                            <div
                              className={`@px-3 @py-1.5 @rounded-xl @text-xs @leading-relaxed ${isMe ? "@bg-primary @text-black @font-semibold @rounded-tr-none" : "@bg-bg-secondary @border @border-bg-tertiary/40 @text-slate-100 @rounded-tl-none"}`}
                            >
                              {msg.content}
                            </div>
                            <span
                              className={`@text-[8px] @text-slate-500 @mt-0.5 ${isMe ? "@text-right" : ""}`}
                            >
                              {new Date(msg.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="@h-full @flex @items-center @justify-center @text-[11px] @text-slate-500">
                      Link active. Write message below.
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Input block inside Active Chat */}
                <div className="@flex @gap-1.5 @pt-2 @border-t @border-bg-tertiary/30">
                  <input
                    type="text"
                    placeholder="Type transmission..."
                    value={messageInput}
                    onChange={(e) => setMessageInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                    className="@flex-1 @rounded-lg @bg-bg-secondary @border @border-bg-tertiary/50 @px-2.5 @py-1.5 @text-xs @placeholder-slate-500 focus:@outline-none focus:@border-primary @text-slate-100"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sendMsg.isLoading}
                    className="@px-3 @py-1.5 @rounded-lg @bg-primary hover:@bg-primary-light @text-black @font-bold @text-xs @transition disabled:@opacity-50 disabled:@cursor-not-allowed"
                  >
                    Send
                  </button>
                </div>
              </div>
            ) : (
              /* Contacts List */
              <div className="@flex @flex-col @gap-3">
                {/* Collapsible Alerts */}
                {notifications && notifications.length > 0 && (
                  <div className="@rounded-lg @bg-primary-dark/15 @border @border-primary-dark/30 @p-2">
                    <p className="@text-[9px] @font-bold @uppercase @tracking-wider @text-primary @mb-1.5 flex @items-center">
                      🚨 REQUESTS ({notifications.length})
                    </p>
                    <div className="@flex @flex-col @gap-1.5">
                      {notifications.map((notif) => {
                        const payload = JSON.parse(notif.content) as { senderName?: string };
                        return (
                          <div
                            key={notif.id}
                            className="@text-[10px] @bg-bg-primary @p-1.5 @rounded @border @border-bg-tertiary/30 @flex @items-center @justify-between"
                          >
                            <span className="@truncate @max-w-[120px] @text-slate-300">
                              @{payload.senderName}
                            </span>
                            <Link
                              href="/social"
                              className="@text-primary hover:underline @font-bold @text-[9px]"
                            >
                              Review →
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Tab select */}
                <div className="@flex @border-b @border-bg-tertiary/40 @text-[10px] @font-bold @uppercase @tracking-wider">
                  <button
                    onClick={() => setActiveTab("friends")}
                    className={`@flex-1 @pb-1 @border-b-2 @text-center @transition ${activeTab === "friends" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400"}`}
                  >
                    Friends
                  </button>
                  <button
                    onClick={() => setActiveTab("recents")}
                    className={`@flex-1 @pb-1 @border-b-2 @text-center @transition ${activeTab === "recents" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400"}`}
                  >
                    Recents
                  </button>
                </div>

                {/* Contacts Body */}
                <div className="@flex @flex-col @gap-1">
                  {activeTab === "friends" ? (
                    friendsList && friendsList.length > 0 ? (
                      friendsList.map((friend) => (
                        <div
                          key={friend.id}
                          onClick={() => handleOpenDM(friend)}
                          className="@flex @items-center @gap-2 @px-2 @py-1.5 @rounded-lg @cursor-pointer hover:@bg-bg-secondary/40 @transition @border @border-transparent"
                        >
                          <span className="@h-2 @w-2 @rounded-full @bg-emerald-500 @shadow-[0_0_4px_rgba(16,185,129,0.5)]"></span>
                          <div className="@flex @flex-col @min-w-0">
                            <span className="@text-xs @font-semibold @text-slate-100 @truncate">
                              {friend.displayName}
                            </span>
                            <span className="@text-[9px] @text-slate-500">@{friend.name}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="@text-[10px] @text-slate-500 @text-center @py-4">
                        No friends found.
                      </p>
                    )
                  ) : recentsList && recentsList.length > 0 ? (
                    recentsList.map((player) => (
                      <div
                        key={player.id}
                        onClick={() => handleOpenDM(player)}
                        className="@flex @items-center @gap-2 @px-2 @py-1.5 @rounded-lg @cursor-pointer hover:@bg-bg-secondary/40 @transition"
                      >
                        <span className="@h-2 @w-2 @rounded-full @bg-slate-500"></span>
                        <div className="@flex @flex-col @min-w-0">
                          <span className="@text-xs @font-semibold @text-slate-100 @truncate">
                            {player.displayName}
                          </span>
                          <span className="@text-[9px] @text-slate-500">@{player.name}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="@text-[10px] @text-slate-500 @text-center @py-4">
                      No recent combatants.
                    </p>
                  )}
                </div>

                <div className="@text-center @pt-2 @border-t @border-bg-tertiary/30">
                  <Link
                    href="/social"
                    className="@text-[10px] @text-primary hover:underline @font-bold"
                  >
                    Open Tactical Console Hub →
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
