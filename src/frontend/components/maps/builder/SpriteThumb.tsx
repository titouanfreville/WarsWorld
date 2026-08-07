import { FRAME_ALIAS } from "frontend/components/match/hud/terrain-sprite";

/**
 * One composed atlas frame, shown in the DOM.
 *
 * The image itself is prepared by pixi (see `pixi/editor/sprite-thumbnails.ts`) because the army
 * atlases store frames rotated and trimmed, which no amount of CSS background-positioning can undo.
 * By the time a URL reaches this component the frame is a plain picture, so all that is left is
 * fitting it in a box.
 */

export type SpriteRef = { sheet: string; frame: string };

/** Looks a frame up by name; the caller supplies whatever the atlas actually holds. */
export type FrameLookup = {
  url: (ref: SpriteRef) => string | null;
  size: (ref: SpriteRef) => { width: number; height: number } | null;
};

/**
 * Which slice represents a tile, property or unit.
 *
 * Properties and units come from their owner's sheet, terrain from the neutral one. A connecting
 * tile has no plain `road.png` to show, so a representative variant is chosen from the ones the
 * server said are legal — preferring a straight run, which reads best at thumbnail size.
 */
export const spriteRefFor = (
  lookup: FrameLookup,
  options: {
    kind: "terrain" | "property" | "unit";
    type: string;
    slot?: number;
    armyBySlot: string[];
    variants?: string[];
    variant?: string;
  },
): SpriteRef | null => {
  const { kind, type, slot, armyBySlot, variants = [], variant } = options;
  const base = FRAME_ALIAS[type] ?? type;
  const exists = (ref: SpriteRef) => (lookup.url(ref) === null ? null : ref);

  if (kind === "unit" || kind === "property") {
    const army = slot !== undefined && slot >= 0 ? armyBySlot[slot] : undefined;

    return exists({ sheet: army ?? "neutral", frame: `${base}-0.png` });
  }

  if (variant !== undefined) {
    return exists({ sheet: "neutral", frame: `${base}-${variant}.png` });
  }

  const plain = exists({ sheet: "neutral", frame: `${base}.png` });

  if (plain !== null) {
    return plain;
  }

  // Straight runs first: `right-left` reads as a road at 16 pixels, a three-way junction does not.
  for (const candidate of ["right-left", "top-bottom", ...variants]) {
    const found = exists({ sheet: "neutral", frame: `${base}-${candidate}.png` });

    if (found !== null) {
      return found;
    }
  }

  return null;
};

type Props = {
  lookup: FrameLookup;
  sprite: SpriteRef | null;
  /** Box the sprite is fitted into, in CSS pixels. */
  size?: number;
  label?: string;
};

/**
 * Fitted to CONTAIN, never cropped. AW art is 16 wide but up to 31 tall — an HQ is nearly two tiles
 * high — so a square box would cut the top off every property. Tall ones come out narrower and
 * whole, which is the trade worth making in a palette.
 */
export function SpriteThumb({ lookup, sprite, size = 28, label }: Props) {
  const url = sprite === null ? null : lookup.url(sprite);
  const natural = sprite === null ? null : lookup.size(sprite);

  if (url === null || natural === null) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="@inline-block @rounded-sm @bg-white/5"
      />
    );
  }

  const scale = Math.min(size / natural.width, size / natural.height);

  return (
    <img
      src={url}
      alt={label ?? ""}
      width={Math.round(natural.width * scale)}
      height={Math.round(natural.height * scale)}
      style={{ imageRendering: "pixelated" }}
      className="@shrink-0"
    />
  );
}
