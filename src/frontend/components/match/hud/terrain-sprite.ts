import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { Army } from "frontend/utils/sprites";

/**
 * Locates a terrain tile's art inside the spritesheet atlases, for DOM overlays that want to show the
 * real tile rather than an approximation of it.
 *
 * The board draws terrain through pixi (see `tileSprite` in `render-from-view`), which can slice an
 * atlas natively; an `<img>` can't. So this returns the frame's rect and the atlas URL, and the caller
 * renders it as a CSS background — same pixels, same source of truth, no second copy of the art.
 *
 * Weather variants are deliberately ignored: the card answers "what terrain is this and what cover
 * does it give", which snow and rain don't change.
 */

/** The tile under a unit, as the `unitDetails` preview reports it. */
export type TerrainInfo = {
  type: string;
  /** Connection variant for road/river/bridge/pipe/plain; null for tiles that have only one look. */
  variant: string | null;
  /** Owner slot for a property (-1 = neutral); null for terrain that can't be owned. */
  playerSlot: number | null;
};

/** Where a tile's art lives: the atlas image plus the sub-rect to show. Sizes are in source pixels. */
export type TerrainThumb = {
  url: string;
  /** Frame rect within the atlas. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Full atlas size — needed to scale a CSS background without distorting the slice. */
  sheetWidth: number;
  sheetHeight: number;
};

/**
 * Engine tile keys the atlas spells differently. The engine names tiles in camelCase (`pipeSeam`)
 * but that one's frames are lowercase (`pipeseam-right-left.png`) — the rest match, so this stays an
 * explicit alias rather than a blanket lower-casing, which would break `unusedSilo.png`.
 *
 * Exported because the pixi board resolves the SAME atlas frames (see `tileSprite` in
 * `render-from-view`): one alias table, or the two renderers disagree about a tile's art — which is
 * exactly how the seam ended up drawing nothing on the board while the detail card found it.
 */
export const FRAME_ALIAS: Record<string, string> = { pipeSeam: "pipeseam" };

/**
 * The atlas frame base name for a pipe seam — the one tile whose art needs BOTH halves of its state.
 *
 * A seam's LIVE state (`changeableTiles`) carries only its HP; the connection variant that picks the
 * art lives on the STATIC map tile underneath. Reading just the live tile yields a variant-less
 * `pipeseam`, which matches no frame — and the tile draws as an empty sprite, a black hole on the board.
 *
 * A seam blown to 0 HP is no longer a seam: it's plain ground with the broken pipe's ends on it,
 * which is exactly what the engine's own `getTile` resolves it to. Mirrored here so the board shows
 * what the engine believes is there.
 */
export const pipeSeamFrameName = (hp: number, mapVariant: string | null): string => {
  // Seams only run along one axis; anything else (or a map tile with no variant) falls back to the
  // horizontal art rather than composing a key the atlas has never heard of.
  const axis = mapVariant === "top-bottom" ? "top-bottom" : "right-left";

  return hp < 1 ? `plain-broken-pipe-${axis}` : `pipeseam-${axis}`;
};

/**
 * The atlas frame key for a tile, mirroring `tileSprite`'s rule:
 * - a property takes `<type>-0.png` (its idle frame) from its OWNER's sheet, or the neutral sheet
 *   when unowned;
 * - everything else takes `<type>[-<variant>].png` from the neutral sheet.
 */
const frameKey = (terrain: TerrainInfo): string => {
  const base = FRAME_ALIAS[terrain.type] ?? terrain.type;

  return terrain.playerSlot !== null
    ? `${base}-0.png`
    : `${base}${terrain.variant === null ? "" : `-${terrain.variant}`}.png`;
};

/**
 * The atlas slice for `terrain`, or undefined when the sheet has no such frame — a missing frame is
 * a legitimate outcome (an unmapped variant, a tile whose art the atlas spells differently), so the
 * caller falls back to the name alone rather than rendering a broken image.
 *
 * `army` is the OWNING army for a property, which the caller resolves from the tile's `playerSlot`.
 */
export const terrainThumb = (
  sheets: SpritesheetDataByArmy,
  terrain: TerrainInfo,
  army: Army | undefined,
): TerrainThumb | undefined => {
  // Owned properties are drawn in their owner's colours; everything else is on the neutral sheet.
  const owned = terrain.playerSlot !== null && terrain.playerSlot !== -1 && army !== undefined;
  const sheet = owned ? sheets[army] : sheets.neutral;

  if (sheet === undefined) {
    return undefined;
  }

  const frame = sheet.frames[frameKey(terrain)]?.frame;
  const image = sheet.meta.image;
  const size = sheet.meta.size;

  if (frame === undefined || image === undefined || size?.w === undefined || size.h === undefined) {
    return undefined;
  }

  return {
    url: `/img/spriteSheet/${image}`,
    x: frame.x,
    y: frame.y,
    width: frame.w,
    height: frame.h,
    sheetWidth: size.w,
    sheetHeight: size.h,
  };
};
