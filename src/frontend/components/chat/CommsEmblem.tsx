/**
 * The unified chat identity — the "COMMS" radar emblem worn by every chat surface (floating docks,
 * out-of-game widget, the End-Game panel, the social hub). It replaces the ad-hoc `📡` emoji that
 * used to brand only the out-of-game chat, so all four surfaces now read as one system.
 *
 * The glyph is an inline SVG: concentric signal arcs sweeping off a broadcast dot. `live` adds an
 * emerald ping over the dot (an open, active channel); drop it for read-only transcripts. Sizes map
 * to the two contexts — `sm` for the collapsed launcher button, `md` for panel headers.
 */
type Size = "sm" | "md";

const GLYPH_PX: Record<Size, number> = { sm: 16, md: 20 };
const WORDMARK_PX: Record<Size, string> = { sm: "@text-[11px]", md: "@text-xs" };

export function CommsEmblem({
  size = "md",
  label = "Comms",
  live = false,
  className = "",
}: {
  size?: Size;
  /** Wordmark next to the glyph. Pass `null` to render the glyph alone. */
  label?: string | null;
  /** Show the emerald live-ping over the broadcast dot (an open channel). */
  live?: boolean;
  className?: string;
}) {
  const px = GLYPH_PX[size];

  return (
    <span className={`@flex @items-center @gap-1.5 @text-primary ${className}`}>
      <span
        className="@relative @flex @flex-none @items-center @justify-center"
        style={{ width: px, height: px }}
      >
        <RadarGlyph px={px} />
        {live && (
          <span className="@absolute @-right-0.5 @-top-0.5 @flex @h-2 @w-2">
            <span className="@absolute @inline-flex @h-full @w-full @animate-ping @rounded-full @bg-emerald-400 @opacity-75" />
            <span className="@relative @inline-flex @h-2 @w-2 @rounded-full @bg-emerald-500" />
          </span>
        )}
      </span>
      {label !== null && (
        <span
          className={`@font-russoOne @font-bold @uppercase @tracking-[0.18em] @text-primary ${WORDMARK_PX[size]}`}
        >
          {label}
        </span>
      )}
    </span>
  );
}

/** Broadcast dot + two signal arcs, drawn in `currentColor` so it inherits the emblem's accent. */
function RadarGlyph({ px }: { px: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={px}
      height={px}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="17" r="2.4" fill="currentColor" stroke="none" />
      <path d="M6.5 12.5a8 8 0 0 1 5 5" opacity="0.85" />
      <path d="M6.5 7.5a13 13 0 0 1 10 10" opacity="0.5" />
    </svg>
  );
}
