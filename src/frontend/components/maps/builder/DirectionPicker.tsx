import type { TerrainFacts } from "./builder-types";
import { SpriteThumb, spriteRefFor, type FrameLookup } from "./SpriteThumb";

type Props = {
  lookup: FrameLookup;
  armyBySlot: string[];
  terrain: TerrainFacts | undefined;
  /** The directions currently held. May be a set the art cannot express yet. */
  pending: string[];
  /** The variant those directions resolve to, or null while they resolve to nothing drawable. */
  resolved: string | null;
  onToggle: (direction: string) => void;
  onPick: (variant: string) => void;
  onAuto: () => void;
};

const ARROWS: { direction: string; glyph: string }[] = [
  { direction: "top", glyph: "↑" },
  { direction: "right", glyph: "→" },
  { direction: "bottom", glyph: "↓" },
  { direction: "left", glyph: "←" },
];

/**
 * Which way a road, river or pipe faces.
 *
 * Auto is the default and reads the facing off the tile's neighbours, which is right almost always.
 * The exceptions are the ones that need a person: a stub, an isolated tile, a deliberate dead end.
 * Picking a direction PINS it, and neighbouring strokes then leave it alone.
 *
 * The arrow keys compose: tapping `↑` then `→` builds `top-right`, which is exactly how the
 * variant is named. A half-composed set is shown rather than swallowed, because a keypress that
 * appears to do nothing reads as a broken key.
 */
export function DirectionPicker({
  lookup,
  armyBySlot,
  terrain,
  pending,
  resolved,
  onToggle,
  onPick,
  onAuto,
}: Props) {
  if (terrain === undefined || terrain.variants.length === 0) {
    return null;
  }

  const auto = pending.length === 0;

  return (
    <div>
      <p className="@mb-2 @font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40">
        Direction
      </p>

      <div className="@flex @gap-1">
        <button
          type="button"
          aria-pressed={auto}
          onClick={onAuto}
          className={`@flex-1 @rounded @border @px-2 @py-1 @text-[0.6rem] @uppercase @tracking-wider ${
            auto
              ? "@border-primary @bg-primary/20 @text-white"
              : "@border-white/10 @bg-bg-secondary @text-white/60"
          }`}
        >
          Auto
        </button>

        {ARROWS.map(({ direction, glyph }) => (
          <button
            key={direction}
            type="button"
            aria-label={direction}
            aria-pressed={pending.includes(direction)}
            onClick={() => onToggle(direction)}
            className={`@h-6 @w-6 @rounded @border @text-xs ${
              pending.includes(direction)
                ? "@border-primary @bg-primary/30 @text-white"
                : "@border-white/10 @bg-bg-secondary @text-white/50"
            }`}
          >
            {glyph}
          </button>
        ))}
      </div>

      {/* Same three-row flow as the palettes, so a road's eleven pieces stay a fixed height. */}
      <div className="@mt-1.5 @grid @grid-flow-col @grid-rows-3 @auto-cols-max @gap-1 @overflow-x-auto @pb-1 [scrollbar-width:thin]">
        {terrain.variants.map((variant) => (
          <button
            key={variant}
            type="button"
            title={variant.replace(/-/g, " ")}
            aria-label={variant.replace(/-/g, " ")}
            aria-pressed={resolved === variant}
            onClick={() => onPick(variant)}
            className={`@flex @h-8 @w-8 @shrink-0 @items-center @justify-center @rounded @border ${
              resolved === variant
                ? "@border-primary @bg-primary/20"
                : "@border-white/10 @bg-bg-secondary"
            }`}
          >
            <SpriteThumb
              lookup={lookup}
              sprite={spriteRefFor(lookup, {
                kind: "terrain",
                type: terrain.type,
                variant,
                armyBySlot,
              })}
              size={24}
            />
          </button>
        ))}
      </div>

      <p className="@mt-1.5 @text-[0.7rem] @leading-snug @text-white/40">
        {auto
          ? "Follows whatever the tile touches."
          : resolved === null
            ? `No art for ${pending.join(" + ")} on its own — add another arrow.`
            : `Pinned to ${resolved.replace(/-/g, " + ")}. Neighbours won't rewrite it.`}
      </p>
    </div>
  );
}
