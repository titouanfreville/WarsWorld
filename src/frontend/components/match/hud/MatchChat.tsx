"use client";
import { useMatchChat, type ChatChannel } from "frontend/components/match/useMatchChat";
import { useEffect, useRef, useState } from "react";

/**
 * In-match chat dock (bottom-left of the game shell). Collapsed, it's a small button with an unread
 * badge; open, it's a panel with **All** / **Team** channel tabs, the message list, and an input.
 * All data/plumbing lives in `useMatchChat` (built on the shared social conversation system); this is
 * presentation + local open/active-tab state.
 */
type Props = {
  matchId: string;
  playerId: string;
  players: { id: string; name: string }[];
};

export function MatchChat({ matchId, playerId, players }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeChannel, setActiveChannel] = useState<ChatChannel>("all");
  const [draft, setDraft] = useState("");

  const { messages, send, sending, unread, hasTeamChannel } = useMatchChat({
    matchId,
    playerId,
    players,
    isOpen,
    activeChannel,
  });

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = listRef.current;

    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isOpen, activeChannel]);

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

  const submit = () => {
    send(draft);
    setDraft("");
  };

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

  const hasUnread = totalUnread > 0;

  return (
    <div className="@relative @w-80 @max-w-[calc(100vw-2rem)]">
      {/* The panel pops UP above the bar so it never pushes the layout — it overlays the board's
          bottom edge only while you're actively reading/typing. */}
      {isOpen && (
        <div className="@absolute @bottom-full @left-0 @mb-2 @flex @h-72 @w-full @flex-col @overflow-hidden @rounded-lg @bg-bg-primary/95 @shadow-2xl @shadow-black/60 @outline @outline-1 @outline-white/10 @backdrop-blur">
          <header className="@flex @items-center @justify-between @gap-2 @border-b @border-white/10 @px-2 @py-1.5">
            <div className="@flex @items-center @gap-1">
              {tab("all", "All")}
              {hasTeamChannel && tab("team", "Team")}
            </div>
            <button
              type="button"
              aria-label="Close chat"
              className="@px-1 @text-slate-400 @transition hover:@text-white"
              onClick={() => setIsOpen(false)}
            >
              ✕
            </button>
          </header>

          <div ref={listRef} className="@flex-1 @space-y-1 @overflow-y-auto @px-2.5 @py-2 @text-sm">
            {messages.length === 0 ? (
              <p className="@py-0 @text-xs @italic @text-slate-600">No messages yet.</p>
            ) : (
              messages.map((message) => (
                <p key={message.id} className="@py-0 @leading-snug">
                  <span
                    className={`@font-semibold ${
                      message.senderId === playerId ? "@text-primary" : "@text-slate-300"
                    }`}
                  >
                    {message.senderName}:
                  </span>{" "}
                  <span className="@text-slate-100">{message.content}</span>
                </p>
              ))
            )}
          </div>

          <div className="@flex @items-center @gap-2 @border-t @border-white/10 @p-2">
            <input
              className="@w-full @rounded @bg-black/30 @px-2.5 @py-1.5 @text-sm @outline @outline-1 @outline-white/10 placeholder:@text-slate-600"
              value={draft}
              maxLength={500}
              placeholder={`Message ${activeChannel === "all" ? "everyone" : "your team"}…`}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <button
              type="button"
              className="@rounded @bg-primary @px-3 @py-1.5 @font-russoOne @text-[11px] @uppercase @tracking-wide @text-black @transition hover:@brightness-110 disabled:@opacity-40"
              disabled={draft.trim() === "" || sending}
              onClick={submit}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Always-visible chat bar (sits in the gutter beside the minimap); toggles the panel. */}
      <button
        type="button"
        className={`@flex @w-full @items-center @gap-2 @rounded-lg @px-3 @py-2 @font-russoOne @text-xs @uppercase @tracking-wide @shadow-lg @shadow-black/40 @outline @transition ${
          hasUnread && !isOpen
            ? "@animate-pulse @bg-primary/20 @text-white @outline-2 @outline-primary"
            : "@bg-bg-primary/80 @text-slate-200 @outline-1 @outline-white/10 hover:@text-white"
        }`}
        onClick={() => setIsOpen((open) => !open)}
        title={
          isOpen
            ? "Close chat"
            : hasUnread
              ? `${totalUnread} new message${totalUnread > 1 ? "s" : ""}`
              : "Open chat"
        }
      >
        {hasUnread && !isOpen && <span className="@h-2 @w-2 @rounded-full @bg-primary" />}
        Chat
        {hasUnread && !isOpen && (
          <span className="@flex @h-4 @min-w-4 @items-center @justify-center @rounded-full @bg-primary @px-1 @text-[10px] @font-bold @text-black">
            {totalUnread}
          </span>
        )}
        <span className="@ml-auto @text-slate-400">{isOpen ? "▾" : "▴"}</span>
      </button>
    </div>
  );
}
