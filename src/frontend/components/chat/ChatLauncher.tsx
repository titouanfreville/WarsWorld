import { CommsEmblem } from "./CommsEmblem";

/**
 * The collapsed trigger for a floating chat — the COMMS emblem plus an unread badge. Two shapes for
 * the two docks: `pill` for the free-floating out-of-game widget (bottom-right), `bar` for the
 * in-game gutter (full-width, sits beside the minimap). Unread makes it pulse with a primary ring so
 * a new message is hard to miss mid-match.
 */
export function ChatLauncher({
  onClick,
  shape,
  unread = 0,
  live = false,
  label = "Comms",
}: {
  onClick: () => void;
  shape: "pill" | "bar";
  unread?: number;
  /** Emerald live-ping on the emblem (an active channel / online presence). */
  live?: boolean;
  label?: string;
}) {
  const hasUnread = unread > 0;
  const pill = shape === "pill";

  return (
    <button
      type="button"
      onClick={onClick}
      title={hasUnread ? `${unread} new message${unread > 1 ? "s" : ""}` : "Open chat"}
      className={`@group @flex @items-center @gap-2.5 @shadow-lg @shadow-black/50 @outline @transition-all @duration-200 ${
        pill ? "@rounded-full @px-4 @py-2.5" : "@w-full @justify-start @rounded-lg @px-3 @py-2"
      } ${
        hasUnread
          ? "@animate-pulse @bg-primary/20 @outline-2 @outline-primary"
          : "@bg-bg-primary/90 @outline-1 @outline-white/10 hover:@bg-bg-secondary/80"
      }`}
    >
      <CommsEmblem size="sm" label={label} live={live || hasUnread} />
      {hasUnread && (
        <span className="@ml-auto @flex @h-5 @min-w-5 @items-center @justify-center @rounded-full @bg-primary @px-1.5 @text-[10px] @font-bold @text-black">
          {unread}
        </span>
      )}
    </button>
  );
}
