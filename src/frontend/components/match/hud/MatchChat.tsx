"use client";
import { ChatComposer } from "frontend/components/chat/ChatComposer";
import { ChatLauncher } from "frontend/components/chat/ChatLauncher";
import { ChatShell } from "frontend/components/chat/ChatShell";
import { useChatAutoscroll } from "frontend/components/chat/useChatAutoscroll";
import { useMatchChat, type ChatChannel } from "frontend/components/match/useMatchChat";
import { PlayerMention } from "frontend/components/PlayerMention";
import { useEffect, useRef, useState } from "react";

/**
 * In-match chat dock (bottom-left of the game shell). Collapsed, it's the shared COMMS launcher with
 * an unread badge; open, it's a `ChatShell` with **All** / **Team** channel tabs, the message list,
 * and the shared composer. All data/plumbing lives in `useMatchChat` (built on the shared social
 * conversation system); this is presentation + local open/active-tab state.
 */
type Props = {
  matchId: string;
  playerId: string;
  players: { id: string; name: string }[];
  /**
   * Transient system lines (dev/admin tool use). Not chat messages — they aren't persisted (the
   * durable record is the Event log), so they ride in from the board rather than `useMatchChat`.
   */
  systemLines?: { id: number; text: string }[];
};

export function MatchChat({ matchId, playerId, players, systemLines = [] }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("all");

  const { messages, send, sending, unread, hasTeamChannel, avatarForHandle } = useMatchChat({
    matchId,
    playerId,
    players,
    isOpen,
    activeChannel,
  });

  const listRef = useChatAutoscroll<HTMLDivElement>([messages, systemLines, isOpen, activeChannel]);

  // Pop open when a dev/admin tool line lands while collapsed. The whole point of announcing tool use
  // is that the opponent sees it, so a system line forces the panel the same way a new message does.
  // Keyed on the NEWEST line's id (a monotonic counter), not the array length: the buffer caps at 50,
  // so once it's full the length stops changing and a length check would never fire again — but every
  // new line still gets a fresh, larger id.
  const lastSystemId = systemLines[systemLines.length - 1]?.id;
  const prevSystemIdRef = useRef(lastSystemId);

  useEffect(() => {
    if (!isOpen && lastSystemId !== undefined && lastSystemId !== prevSystemIdRef.current) {
      setIsOpen(true);
    }

    prevSystemIdRef.current = lastSystemId;
  }, [lastSystemId, isOpen]);

  const totalUnread = unread.all + unread.team;

  // Pop the panel open when a message lands while it's collapsed, rather than leaving only the badge
  // (which is easy to miss mid-match). Tracks the previous unread total so we react only to a genuine
  // new arrival (a rising count); reopening after a manual close is fine — the next message reopens it.
  // Own outgoing messages don't bump unread, so sending never self-triggers this.
  const prevUnreadRef = useRef(totalUnread);

  useEffect(() => {
    if (!isOpen && totalUnread > prevUnreadRef.current) {
      setIsOpen(true);
    }

    prevUnreadRef.current = totalUnread;
  }, [totalUnread, isOpen]);

  const tab = (channel: ChatChannel, label: string) => {
    const activeTab = channel === activeChannel;

    return (
      <button
        type="button"
        className={`@flex @items-center @gap-1.5 @rounded @px-2.5 @py-1 @font-russoOne @text-[11px] @uppercase @tracking-wide @transition ${
          activeTab ? "@bg-primary @text-black" : "@text-slate-400 hover:@text-white"
        }`}
        onClick={() => setActiveChannel(channel)}
      >
        {label}
        {unread[channel] > 0 && !activeTab && (
          <span className="@flex @h-3.5 @min-w-3.5 @items-center @justify-center @rounded-full @bg-primary @px-1 @text-[9px] @font-bold @text-black">
            {unread[channel]}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="@relative @w-80 @max-w-[calc(100vw-2rem)]">
      {/* The panel pops UP above the bar so it never pushes the layout — it overlays the board's
          bottom edge only while you're actively reading/typing. */}
      {isOpen && (
        <div className="@absolute @bottom-full @left-0 @mb-2 @h-72 @w-full">
          <ChatShell
            variant="floating"
            title="Comms"
            live
            className="@h-full"
            bodyRef={listRef}
            headerExtra={
              <div className="@flex @items-center @gap-1">
                {tab("all", "All")}
                {hasTeamChannel && tab("team", "Team")}
              </div>
            }
            actions={
              <button
                type="button"
                aria-label="Close chat"
                className="@px-1 @text-slate-400 @transition hover:@text-white"
                onClick={() => setIsOpen(false)}
              >
                ✕
              </button>
            }
            footer={
              <ChatComposer
                onSend={send}
                sending={sending}
                placeholder={`Message ${activeChannel === "all" ? "everyone" : "your team"}…`}
              />
            }
          >
            <div className="@space-y-1 @text-sm">
              {messages.length === 0 && systemLines.length === 0 ? (
                <p className="@py-0 @text-xs @italic @text-slate-600">No messages yet.</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className="@flex @items-center @gap-1.5 @py-0 @leading-snug"
                  >
                    <PlayerMention
                      name={message.senderHandle}
                      label={message.senderName}
                      avatar={avatarForHandle(message.senderHandle)}
                      interactive={false}
                      className={`@shrink-0 @font-semibold ${
                        message.senderId === playerId ? "@text-primary" : "@text-slate-300"
                      }`}
                    />
                    <span className="@min-w-0 @text-slate-100">{message.content}</span>
                  </div>
                ))
              )}

              {/* System lines show on BOTH channels — a tool affects the whole game, not one team —
                  so they aren't filtered by `activeChannel`. Amber + a [System] tag sets them apart
                  from real messages. */}
              {systemLines.map((line) => (
                <p
                  key={`sys-${line.id}`}
                  className="@py-0 @leading-snug @text-xs @text-amber-400/90"
                >
                  <span className="@font-semibold">[System]</span> {line.text}
                </p>
              ))}
            </div>
          </ChatShell>
        </div>
      )}

      {/* Always-visible launcher (sits in the gutter beside the minimap); toggles the panel. */}
      {isOpen ? (
        <ChatLauncher shape="bar" label="Comms" live onClick={() => setIsOpen(false)} />
      ) : (
        <ChatLauncher
          shape="bar"
          label="Comms"
          unread={totalUnread}
          onClick={() => setIsOpen(true)}
        />
      )}
    </div>
  );
}
