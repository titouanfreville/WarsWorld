import { describe, expect, test } from "vitest";
import {
  floodRegion,
  mirrorImage,
  mirrorVariant,
  resolveVariant,
  type BuilderTile,
  type MapVocabulary,
} from "frontend/components/maps/builder/builder-types";

/**
 * The builder's pure client-side helpers: which squares a fill takes, and where a mirrored stroke
 * lands and which way it faces.
 *
 * These are geometry over a grid, which is the only kind of thing the builder is allowed to work
 * out for itself — every game fact it uses arrives from the server.
 */

const grid = (rows: string[]): BuilderTile[][] =>
  rows.map((row) => [...row].map((character) => ({ type: character === "." ? "plain" : "sea" })));

const sorted = (region: [number, number][]) =>
  [...region].sort((a, b) => a[1] - b[1] || a[0] - b[0]);

describe("floodRegion", () => {
  test("takes the whole contiguous run and stops at a different tile", () => {
    const region = floodRegion(grid(["..#", "..#", "###"]), 0, 0);

    expect(sorted(region)).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  test("does not leak through a diagonal touch", () => {
    // Two pools meeting only at a corner are two pools, which is what a person means by "this one".
    // A checkerboard is the only way to touch diagonally without also touching side-on.
    const region = floodRegion(grid([".#", "#."]), 0, 0);

    expect(sorted(region)).toEqual([[0, 0]]);
  });

  test("reaches round an obstacle rather than through it", () => {
    const region = floodRegion(grid(["....", ".##.", "...."]), 0, 0);

    expect(region).toHaveLength(10);
  });

  test("ignores the variant a tile happens to be drawn with", () => {
    const tiles: BuilderTile[][] = [
      [
        { type: "road", variant: "right-left" },
        { type: "road", variant: "top-right" },
      ],
    ];

    expect(floodRegion(tiles, 0, 0)).toHaveLength(2);
  });

  test("a lone tile is a region of one", () => {
    expect(floodRegion(grid(["#.#"]), 1, 0)).toEqual([[1, 0]]);
  });

  test("an out-of-bounds square selects nothing", () => {
    expect(floodRegion(grid(["..."]), 9, 9)).toEqual([]);
  });

  test("a uniform grid comes back whole", () => {
    expect(floodRegion(grid(["....", "....", "...."]), 2, 1)).toHaveLength(12);
  });
});

describe("mirrorImage", () => {
  test("rotating 180 degrees sends a corner to the opposite corner", () => {
    expect(mirrorImage("rotate180", 0, 0, 5, 5)).toEqual([4, 4]);
  });

  test("flipping horizontally leaves the row alone", () => {
    expect(mirrorImage("flip-horizontal", 1, 2, 5, 5)).toEqual([3, 2]);
  });

  test("flipping vertically leaves the column alone", () => {
    expect(mirrorImage("flip-vertical", 1, 2, 5, 5)).toEqual([1, 2]);
  });

  test("four quarter-turns return to the start", () => {
    let position: [number, number] = [1, 0];

    for (let turn = 0; turn < 4; turn++) {
      position = mirrorImage("rotate90", position[0], position[1], 5, 5);
    }

    expect(position).toEqual([1, 0]);
  });

  test("a quarter-turn and its opposite cancel out", () => {
    const [x, y] = mirrorImage("rotate90", 1, 3, 6, 6);

    expect(mirrorImage("rotate270", x, y, 6, 6)).toEqual([1, 3]);
  });
});

describe("mirrorVariant", () => {
  test("turns a corner to match a 180 degree rotation", () => {
    expect(mirrorVariant("top-right", "rotate180")).toBe("bottom-left");
  });

  test("returns directions in the order the atlas names them", () => {
    expect(mirrorVariant("top-right", "rotate90")).toBe("right-bottom");
  });

  test("swaps only the mirrored axis on a flip", () => {
    expect(mirrorVariant("top-right", "flip-horizontal")).toBe("top-left");
    expect(mirrorVariant("top-right", "flip-vertical")).toBe("right-bottom");
  });

  test("leaves a four-way junction unchanged, since it points every way already", () => {
    expect(mirrorVariant("top-right-bottom-left", "rotate90")).toBe("top-right-bottom-left");
  });

  test("passes a variant that is not a set of directions straight through", () => {
    // `plain` uses `normal`, which has no facing to turn.
    expect(mirrorVariant("normal", "rotate180")).toBe("normal");
  });

  test("has nothing to say about an absent variant", () => {
    expect(mirrorVariant(undefined, "rotate180")).toBeUndefined();
  });
});

describe("resolveVariant only ever names art the tile actually has", () => {
  /**
   * The pipe is the case that matters. Roads and rivers ship every two-, three- and four-way
   * piece; a pipe ships one- and two-way and NOTHING else. Composing a variant from the directions
   * a tile touches therefore produced `top-right-bottom-left` for any pipe with three neighbours —
   * a frame that does not exist, so the tile drew as nothing and a filled area looked like the
   * board had gone black.
   */
  const vocabulary = {
    blankTile: { type: "plain", variant: "normal" },
    terrain: [
      { type: "plain", connectsTo: [], singleAxis: false, variants: ["normal"], defenseStars: 1 },
      {
        type: "pipe",
        connectsTo: ["pipe"],
        singleAxis: false,
        // Exactly what the atlas and the schema carry: no three- or four-way piece.
        variants: [
          "top",
          "right",
          "bottom",
          "left",
          "right-left",
          "top-bottom",
          "top-right",
          "right-bottom",
          "bottom-left",
          "top-left",
        ],
        defenseStars: 0,
      },
      {
        type: "road",
        connectsTo: ["road"],
        singleAxis: false,
        variants: [
          "right-left",
          "top-bottom",
          "top-right",
          "right-bottom",
          "bottom-left",
          "top-left",
          "top-right-bottom",
          "right-bottom-left",
          "top-bottom-left",
          "top-right-left",
          "top-right-bottom-left",
        ],
        defenseStars: 0,
      },
      {
        type: "bridge",
        connectsTo: ["road"],
        singleAxis: true,
        variants: ["right-left", "top-bottom"],
        defenseStars: 0,
      },
    ],
  } as unknown as MapVocabulary;

  const legalFor = (type: string) =>
    vocabulary.terrain.find((tile) => tile.type === type)?.variants ?? [];

  /** A plus of `type` centred on (1,1), so the middle tile touches on all four sides. */
  const plus = (type: string): BuilderTile[][] => [
    [{ type: "plain" }, { type }, { type: "plain" }],
    [{ type }, { type }, { type }],
    [{ type: "plain" }, { type }, { type: "plain" }],
  ];

  test("a pipe surrounded on four sides gets a variant that exists", () => {
    const variant = resolveVariant(plus("pipe"), 1, 1, vocabulary);

    expect(legalFor("pipe")).toContain(variant);
    expect(variant).not.toBe("top-right-bottom-left");
  });

  test("a pipe with three neighbours gets a variant that exists", () => {
    const tiles = plus("pipe");
    tiles[0][1] = { type: "plain" };

    const variant = resolveVariant(tiles, 1, 1, vocabulary);

    expect(legalFor("pipe")).toContain(variant);
  });

  test("every pipe in a filled block resolves to real art", () => {
    // The reported failure: fill an area with pipes, watch the board go black.
    const block: BuilderTile[][] = Array.from({ length: 4 }, () =>
      Array.from({ length: 4 }, () => ({ type: "pipe" })),
    );

    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        expect(legalFor("pipe")).toContain(resolveVariant(block, x, y, vocabulary));
      }
    }
  });

  test("a pipe stub uses its own one-way art rather than an axis", () => {
    const tiles: BuilderTile[][] = [
      [{ type: "plain" }, { type: "pipe" }, { type: "plain" }],
      [{ type: "plain" }, { type: "pipe" }, { type: "plain" }],
    ];

    // The bottom pipe touches only upward, and a pipe HAS a `top` piece for exactly that.
    expect(resolveVariant(tiles, 1, 1, vocabulary)).toBe("top");
  });

  test("a road with four neighbours still gets its four-way piece", () => {
    expect(resolveVariant(plus("road"), 1, 1, vocabulary)).toBe("top-right-bottom-left");
  });

  test("a single-axis tile stays on one of its two axes", () => {
    const variant = resolveVariant(plus("bridge"), 1, 1, vocabulary);

    expect(legalFor("bridge")).toContain(variant);
  });

  test("an isolated connecting tile falls back to a straight run", () => {
    const lone: BuilderTile[][] = [[{ type: "road" }]];

    expect(resolveVariant(lone, 0, 0, vocabulary)).toBe("right-left");
  });
});
