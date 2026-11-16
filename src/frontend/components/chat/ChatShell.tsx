import type { ReactNode } from "react";
import { CommsEmblem } from "./CommsEmblem";

/**
 * The shared chat panel chrome, in two layout variants:
 *
 * - `floating` — the overlay panel behind a collapsed launcher (in-game dock, out-of-game widget).
 *   Rounded, blurred, hard shadow; pops over the surrounding UI.
 * - `docked` — an embedded panel that fills its container (the End-Game report cell, the social
 *   hub's conversation column). Flatter, no floating shadow.
 *
 * All four surfaces share the same header (COMMS emblem + title/tabs on the left, actions on the
 * right), a scrolling body (`children`), and an optional footer (the composer). Feeding the domain
 * data — match channels vs social DMs — is the call site's job; this only owns the display.
 */
export function ChatShell({
  variant,
  title,
  live = false,
  headerExtra,
  actions,
  footer,
  bodyRef,
  className = "",
  children,
}: {
  variant: "floating" | "docked";
  /** Wordmark shown next to the emblem. Defaults to "Comms". */
  title?: string;
  /** Show the emerald live-ping on the emblem (an open, writable channel). */
  live?: boolean;
  /** Extra header content beside the emblem — e.g. channel tabs. */
  headerExtra?: ReactNode;
  /** Right-aligned header controls — e.g. a close button. */
  actions?: ReactNode;
  /** Footer region, typically the composer. Omit for read-only transcripts. */
  footer?: ReactNode;
  /** Ref for the scroll body, so the call site can pin it to the latest message. */
  bodyRef?: React.Ref<HTMLDivElement>;
  className?: string;
  children: ReactNode;
}) {
  const floating = variant === "floating";

  return (
    <div
      className={`@flex @flex-col @overflow-hidden @bg-bg-primary/95 @backdrop-blur ${
        floating
          ? "@rounded-xl @shadow-2xl @shadow-black/70 @outline @outline-1 @outline-white/10"
          : "@h-full @rounded-xl @outline @outline-1 @outline-bg-tertiary/40"
      } ${className}`}
    >
      <header className="@flex @flex-none @items-center @justify-between @gap-2 @border-b @border-white/10 @bg-bg-secondary/50 @px-3 @py-2">
        <div className="@flex @min-w-0 @items-center @gap-2.5">
          <CommsEmblem size={floating ? "sm" : "md"} label={title ?? "Comms"} live={live} />
          {headerExtra}
        </div>
        {actions != null && <div className="@flex @flex-none @items-center @gap-1">{actions}</div>}
      </header>

      <div ref={bodyRef} className="@flex-1 @min-h-0 @overflow-y-auto @px-3 @py-2.5">
        {children}
      </div>

      {footer != null && <div className="@flex-none @border-t @border-white/10 @p-2">{footer}</div>}
    </div>
  );
}
