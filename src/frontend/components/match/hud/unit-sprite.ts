import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { Army } from "frontend/utils/sprites";
import type { UnitType } from "frontend/components/match/unit-types";

/**
 * Locates a unit's art inside an army's spritesheet atlas, for DOM surfaces that want the real sprite
 * rather than the type's name (e.g. the dev-tools unit picker). Mirrors `terrainThumb` — same source
 * of truth as the pixi board, rendered as a CSS background because an `<img>` can't slice an atlas.
 *
 * Goes through `animations[unitType]` deliberately: the engine's unit-type strings (`antiAir`) don't
 * match the atlas frame names (`Anti-Air-0.png`), and `animations` is exactly the map that bridges
 * them. `[0]` is the idle frame.
 */
export type UnitThumb = {
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export const unitThumb = (
  sheets: SpritesheetDataByArmy,
  army: Army | undefined,
  unitType: UnitType,
): UnitThumb | undefined => {
  if (army === undefined) {
    return undefined;
  }

  const sheet = sheets[army];

  if (sheet === undefined) {
    return undefined;
  }

  // `animations` is typed values-`undefined` for key-checking only; at runtime it's frame-name arrays.
  const animations = sheet.animations as unknown as Record<string, string[] | undefined>;
  const frameName = animations[unitType]?.[0];

  if (frameName === undefined) {
    return undefined;
  }

  const frame = sheet.frames[frameName]?.frame;
  const image = sheet.meta.image;

  // NB: the full atlas `size` is NOT needed and NOT available — `spritesheetDataSchema` strips
  // `meta.size`, and a `background-position` crop doesn't scale, so it only needs the frame rect
  // and the image URL. Requiring `size` here is what made every unit fall back to its name.
  if (frame === undefined || image === undefined) {
    return undefined;
  }

  return {
    url: `/img/spriteSheet/${image}`,
    x: frame.x,
    y: frame.y,
    width: frame.w,
    height: frame.h,
  };
};
