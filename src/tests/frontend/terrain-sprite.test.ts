import { describe, expect, it } from "vitest";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import { terrainThumb } from "frontend/components/match/hud/terrain-sprite";

/**
 * A stand-in for the real atlases: just the frames these cases look up, in the same shape the
 * spritesheet JSON uses. The point is the KEY-BUILDING rule (variant / ownership / aliasing) and the
 * graceful miss — not the actual pixel coordinates.
 */
const sheets = {
  neutral: {
    frames: {
      "plain-normal.png": { frame: { x: 0, y: 0, w: 16, h: 16 } },
      "mountain.png": { frame: { x: 16, y: 0, w: 16, h: 21 } },
      "road-right-left.png": { frame: { x: 32, y: 0, w: 16, h: 16 } },
      "pipeseam-right-left.png": { frame: { x: 48, y: 0, w: 16, h: 16 } },
      "city-0.png": { frame: { x: 64, y: 0, w: 16, h: 22 } },
    },
    meta: { image: "neutral.png", size: { w: 448, h: 75 } },
  },
  "orange-star": {
    frames: { "city-0.png": { frame: { x: 5, y: 7, w: 16, h: 22 } } },
    meta: { image: "orange-star.png", size: { w: 400, h: 100 } },
  },
} as unknown as SpritesheetDataByArmy;

describe("terrainThumb", () => {
  it("builds a variant-suffixed key for terrain that has connections", () => {
    const thumb = terrainThumb(
      sheets,
      { type: "road", variant: "right-left", playerSlot: null },
      undefined,
    );

    expect(thumb).toMatchObject({ url: "/img/spriteSheet/neutral.png", x: 32, y: 0 });
  });

  it("carries the frame rect and the whole atlas size (a CSS background needs both)", () => {
    const thumb = terrainThumb(
      sheets,
      { type: "mountain", variant: null, playerSlot: null },
      undefined,
    );

    // Mountains overhang upward — the frame is taller than a tile, and the caller must honour that
    // rather than assume 16x16.
    expect(thumb).toEqual({
      url: "/img/spriteSheet/neutral.png",
      x: 16,
      y: 0,
      width: 16,
      height: 21,
      sheetWidth: 448,
      sheetHeight: 75,
    });
  });

  it("takes an OWNED property from its owner's sheet, not the neutral one", () => {
    const thumb = terrainThumb(
      sheets,
      { type: "city", variant: null, playerSlot: 0 },
      "orange-star",
    );

    expect(thumb).toMatchObject({ url: "/img/spriteSheet/orange-star.png", x: 5, y: 7 });
  });

  it("takes a NEUTRAL property (slot -1) from the neutral sheet", () => {
    const thumb = terrainThumb(sheets, { type: "city", variant: null, playerSlot: -1 }, undefined);

    expect(thumb).toMatchObject({ url: "/img/spriteSheet/neutral.png", x: 64, y: 0 });
  });

  it("aliases pipeSeam to the atlas's lower-case spelling", () => {
    const thumb = terrainThumb(
      sheets,
      { type: "pipeSeam", variant: "right-left", playerSlot: null },
      undefined,
    );

    expect(thumb).toMatchObject({ x: 48 });
  });

  it("returns undefined for a frame the atlas doesn't have, rather than a broken slice", () => {
    // A neutral HQ has no art (HQs are always owned) — the card falls back to the name alone.
    expect(terrainThumb(sheets, { type: "hq", variant: null, playerSlot: -1 }, undefined)).toBe(
      undefined,
    );
  });
});
