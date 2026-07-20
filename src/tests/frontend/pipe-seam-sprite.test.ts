import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pipeSeamFrameName } from "frontend/components/match/hud/terrain-sprite";

/**
 * The board resolved a pipe seam to a frame the atlas doesn't contain — twice, for two different
 * reasons (camelCase `pipeSeam-*` vs the atlas's lowercase `pipeseam-*`, then a variant-less
 * `pipeseam` because the live tile carries only HP). Each time the tile rendered as an empty sprite:
 * a black hole on the board. Types can't catch that, because a missing texture is just `undefined`.
 *
 * So this asserts against the REAL atlas: every name the board can produce for a seam must exist as
 * a frame, in clear weather and in each weather variant the board suffixes on.
 */
const atlas = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/img/spriteSheet/neutral.json"), "utf-8"),
) as { frames: Record<string, unknown> };

const has = (frame: string): boolean => `${frame}.png` in atlas.frames;

describe("pipe seam tile art", () => {
  it("names an intact seam by the map tile's axis", () => {
    expect(pipeSeamFrameName(99, "top-bottom")).toBe("pipeseam-top-bottom");
    expect(pipeSeamFrameName(1, "right-left")).toBe("pipeseam-right-left");
  });

  it("names a destroyed seam as broken-pipe ground, like the engine's getTile does", () => {
    expect(pipeSeamFrameName(0, "top-bottom")).toBe("plain-broken-pipe-top-bottom");
    expect(pipeSeamFrameName(0, "right-left")).toBe("plain-broken-pipe-right-left");
  });

  it("falls back to a real frame when the map tile has no variant", () => {
    expect(has(pipeSeamFrameName(50, null))).toBe(true);
    expect(has(pipeSeamFrameName(0, null))).toBe(true);
  });

  it("only ever names frames the atlas actually has", () => {
    const missing: string[] = [];

    for (const variant of ["top-bottom", "right-left", "normal", null]) {
      for (const hp of [100, 50, 1, 0]) {
        const base = pipeSeamFrameName(hp, variant);

        // The board appends a weather suffix when the atlas has one, so those must resolve too.
        for (const frame of [base, `${base}-snow`, `${base}-rain`]) {
          if (!has(frame)) {
            missing.push(frame);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
