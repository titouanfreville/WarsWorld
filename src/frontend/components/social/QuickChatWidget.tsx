import { ChatLauncher } from "frontend/components/chat/ChatLauncher";
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
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

/**
 * The out-of-game floating chat (bottom-right, mounted app-wide in the Layout). Collapsed, it's the
 * shared COMMS launcher; open, it's a floating `ChatShell` housing the social DM system — a contacts
 * list (friends / recents) and, once a partner is picked, their live DM thread. Presentation runs
 * through the shared chat kit so it matches the in-game dock, the End-Game panel, and the hub; the
 * data is `trpc.social.*`.
 */
export default function QuickChatWidget() {
  const { currentPlayer } = usePlayers();
  const [isOpen, setIsOpen] = useState(false);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activePartner, setActivePartner] = useState<{
    id: string;
    displayName: string;
    name: string;
  } | null>(null);
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
    // On failure (blocked/muted partner, backend error) clear the partner so the UI doesn't strand
    // on a header with an empty chat body and no feedback.
    onError: () => setActivePartner(null),
  });

  const sendMsg = trpc.social.sendMessage.useMutation({
    onSuccess: () => {
      void refetchConvHistory();
    },
  });

  const markRead = trpc.social.markConversationRead.useMutation();

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

  // Scroll to bottom
  const listRef = useChatAutoscroll<HTMLDivElement>([
    activeConvHistory?.messages,
    isOpen,
    activeConvId,
  ]);

  // Mark the open conversation read once per open / new message (explicit mutation, not a query
  // side effect) so refetches don't spam read-receipts.
  const lastMessageId = activeConvHistory?.messages.at(-1)?.id;
  useEffect(() => {
    if (isOpen && activeConvId !== null && lastMessageId !== undefined) {
      markRead.mutate({ playerId: pId, conversationId: activeConvId });
    }
    // Only re-mark on open / new message; markRead + pId are stable for the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeConvId, lastMessageId]);

  if (!currentPlayer) {
    return null;
  }

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

  const totalAlerts = notifications?.length ?? 0;
  const inThread = activePartner !== null && activeConvId !== null;

  return (
    <div className="@fixed @bottom-5 @right-5 @z-50 @font-sans">
      {!isOpen ? (
        <ChatLauncher
          shape="pill"
          label="Comms"
          live
          unread={totalAlerts}
          onClick={() => setIsOpen(true)}
        />
      ) : (
        <div className="@w-[340px] @h-[480px] @animate-slide-up">
          <ChatShell
            variant="floating"
            title="Comms"
            live
            className="@h-full"
            bodyRef={listRef}
            headerExtra={
              inThread ? (
                <div className="@flex @min-w-0 @items-center @gap-1.5 @border-l @border-white/10 @pl-2">
                  <button
                    onClick={() => {
                      setActivePartner(null);
                      setActiveConvId(null);
                    }}
                    className="@text-slate-400 hover:@text-slate-200 @text-sm @font-bold"
                    aria-label="Back to contacts"
                  >
                    ←
                  </button>
                  <PlayerMention
                    name={activePartner.name}
                    label={activePartner.displayName}
                    avatar={avatarOf(activePartner.name)}
                    size={18}
                    className="@max-w-[150px] @text-xs @font-bold @text-slate-100"
                  />
                </div>
              ) : undefined
            }
            actions={
              <button
                onClick={() => setIsOpen(false)}
                className="@px-1 @text-slate-400 @transition hover:@text-white"
                aria-label="Close chat"
              >
                ✕
              </button>
            }
            footer={
              inThread ? (
                <ChatComposer
                  onSend={handleSend}
                  sending={sendMsg.isLoading}
                  placeholder="Type transmission…"
                />
              ) : (
                <div className="@text-center">
                  <Link
                    href="/social"
                    className="@text-[11px] @font-bold @text-primary hover:@underline"
                  >
                    Open Tactical Console Hub →
                  </Link>
                </div>
              )
            }
          >
            {inThread ? (
              /* DM thread — shared renderer */
              <ChatMessageList
                messages={activeConvHistory?.messages ?? []}
                currentPlayerId={currentPlayer.id}
                partnerAvatar={avatarOf(activePartner.name)}
                partnerName={activePartner.displayName}
                emptyLabel="Link active. Write message below."
              />
            ) : (
              /* Contacts list */
              <div className="@flex @flex-col @gap-3">
                {notifications && notifications.length > 0 && (
                  <div className="@rounded-lg @border @border-primary-dark/30 @bg-primary-dark/15 @p-2">
                    <p className="@mb-1.5 @flex @items-center @text-[9px] @font-bold @uppercase @tracking-wider @text-primary">
                      🚨 REQUESTS ({notifications.length})
                    </p>
                    <div className="@flex @flex-col @gap-1.5">
                      {notifications.map((notif) => {
                        const payload = parseNotificationPayload(notif.content);
                        return (
                          <div
                            key={notif.id}
                            className="@flex @items-center @justify-between @rounded @border @border-bg-tertiary/30 @bg-bg-primary @p-1.5 @text-[10px]"
                          >
                            <span className="@max-w-[120px] @truncate @text-slate-300">
                              @{payload.senderName}
                            </span>
                            <Link
                              href="/social"
                              className="@text-[9px] @font-bold @text-primary hover:@underline"
                            >
                              Review →
                            </Link>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="@flex @border-b @border-bg-tertiary/40 @text-[10px] @font-bold @uppercase @tracking-wider">
                  <button
                    onClick={() => setActiveTab("friends")}
                    className={`@flex-1 @border-b-2 @pb-1 @text-center @transition ${activeTab === "friends" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400"}`}
                  >
                    Friends
                  </button>
                  <button
                    onClick={() => setActiveTab("recents")}
                    className={`@flex-1 @border-b-2 @pb-1 @text-center @transition ${activeTab === "recents" ? "@border-primary @text-primary" : "@border-transparent @text-slate-400"}`}
                  >
                    Recents
                  </button>
                </div>

                <div className="@flex @flex-col @gap-1">
                  {activeTab === "friends" ? (
                    friendsList && friendsList.length > 0 ? (
                      friendsList.map((friend) => (
                        <div
                          key={friend.id}
                          onClick={() => handleOpenDM(friend)}
                          className="@flex @cursor-pointer @items-center @gap-2 @rounded-lg @border @border-transparent @px-2 @py-1.5 @transition hover:@bg-bg-secondary/40"
                        >
                          <span className="@relative @shrink-0">
                            <UserAvatar
                              name={friend.displayName}
                              size={28}
                              {...avatarImageProps(avatarOf(friend.name))}
                            />
                            <span className="@absolute @-bottom-0.5 @-right-0.5 @h-2 @w-2 @rounded-full @border @border-bg-primary @bg-emerald-500" />
                          </span>
                          <div className="@flex @min-w-0 @flex-col">
                            <PlayerMention
                              name={friend.name}
                              label={friend.displayName}
                              hideAvatar
                              className="@text-xs @font-semibold @text-slate-100"
                            />
                            <span className="@text-[9px] @text-slate-500">@{friend.name}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="@py-4 @text-center @text-[10px] @text-slate-500">
                        No friends found.
                      </p>
                    )
                  ) : recentsList && recentsList.length > 0 ? (
                    recentsList.map((player) => (
                      <div
                        key={player.id}
                        onClick={() => handleOpenDM(player)}
                        className="@flex @cursor-pointer @items-center @gap-2 @rounded-lg @px-2 @py-1.5 @transition hover:@bg-bg-secondary/40"
                      >
                        <UserAvatar
                          name={player.displayName}
                          size={28}
                          className="@shrink-0"
                          {...avatarImageProps(avatarOf(player.name))}
                        />
                        <div className="@flex @min-w-0 @flex-col">
                          <PlayerMention
                            name={player.name}
                            label={player.displayName}
                            hideAvatar
                            className="@text-xs @font-semibold @text-slate-100"
                          />
                          <span className="@text-[9px] @text-slate-500">@{player.name}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="@py-4 @text-center @text-[10px] @text-slate-500">
                      No recent combatants.
                    </p>
                  )}
                </div>
              </div>
            )}
          </ChatShell>
        </div>
      )}
    </div>
  );
}
