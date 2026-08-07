import { describe, expect, test } from "vitest";
import type { Tile } from "server/core/schemas/tile";
import { resizeMap, type ResizeAnchor } from "server/maps/resize";

/**
 * Reshaping a map. The interesting direction is downward: growing pads with ground and can lose
 * nothing, while cropping decides the fate of everything outside the new frame.
 */

const blank: Tile = { type: "plain", variant: "normal" };
const marked = (name: string): Tile => ({ type: name }) as Tile;

/** A grid whose every cell is named for its coordinates, so a move is visible in the assertion. */
const namedGrid = (width: number, height: number): Tile[][] =>
  Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => marked(`${x}-${y}`)),
  );

const mapOf = (tiles: Tile[][], units: { position: [number, number] }[] = []) => ({
  tiles,
  predeployedUnits: units,
});

const resize = (
  tiles: Tile[][],
  width: number,
  height: number,
  anchor: ResizeAnchor,
  units: { position: [number, number] }[] = [],
) => resizeMap(mapOf(tiles, units), { width, height, anchor }, blank);

describe("growing", () => {
  test("pads with blank ground and keeps the original at a top-left anchor", () => {
    const result = resize(namedGrid(2, 2), 4, 4, "top-left");

    expect(result.tiles).toHaveLength(4);
    expect(result.tiles[0]).toHaveLength(4);
    expect(result.tiles[0][0]).toEqual(marked("0-0"));
    expect(result.tiles[3][3]).toEqual(blank);
  });

  test("centres the original when anchored to the middle", () => {
    const result = resize(namedGrid(2, 2), 4, 4, "center");

    expect(result.tiles[1][1]).toEqual(marked("0-0"));
    expect(result.tiles[0][0]).toEqual(blank);
  });

  test("pushes the original to the far corner when anchored bottom-right", () => {
    const result = resize(namedGrid(2, 2), 4, 4, "bottom-right");

    expect(result.tiles[3][3]).toEqual(marked("1-1"));
    expect(result.tiles[0][0]).toEqual(blank);
  });

  test("moves units with the ground under them", () => {
    const result = resize(namedGrid(2, 2), 4, 4, "bottom-right", [{ position: [0, 0] }]);

    expect(result.predeployedUnits[0].position).toEqual([2, 2]);
    expect(result.droppedUnits).toBe(0);
  });

  test("never gives two cells the same tile object", () => {
    const result = resize(namedGrid(1, 1), 3, 3, "top-left");

    // Shared references would mean painting one blank cell painted all of them.
    expect(result.tiles[0][1]).not.toBe(result.tiles[0][2]);
  });
});

describe("cropping", () => {
  test("keeps the anchored corner and discards the rest", () => {
    const result = resize(namedGrid(4, 4), 2, 2, "top-left");

    expect(result.tiles[0][0]).toEqual(marked("0-0"));
    expect(result.tiles[1][1]).toEqual(marked("1-1"));
  });

  test("keeps the opposite corner when anchored bottom-right", () => {
    const result = resize(namedGrid(4, 4), 2, 2, "bottom-right");

    expect(result.tiles[0][0]).toEqual(marked("2-2"));
    expect(result.tiles[1][1]).toEqual(marked("3-3"));
  });

  test("drops units that fall outside the new frame, and reports how many", () => {
    const result = resize(namedGrid(4, 4), 2, 2, "top-left", [
      { position: [0, 0] },
      { position: [3, 3] },
      { position: [3, 0] },
    ]);

    expect(result.predeployedUnits).toHaveLength(1);
    expect(result.predeployedUnits[0].position).toEqual([0, 0]);
    expect(result.droppedUnits).toBe(2);
  });

  test("a unit on the very edge of the new frame survives", () => {
    const result = resize(namedGrid(4, 4), 2, 2, "top-left", [{ position: [1, 1] }]);

    expect(result.droppedUnits).toBe(0);
  });
});

describe("shifting within the same frame", () => {
  test("re-anchoring the same size slides the contents and blanks what it leaves", () => {
    const result = resize(namedGrid(3, 3), 3, 3, "center");

    // Same size means no slack, so a centre anchor is a no-op rather than a shift.
    expect(result.tiles[0][0]).toEqual(marked("0-0"));
    expect(result.droppedUnits).toBe(0);
  });
});

describe("mixed axes", () => {
  test("grows one side while cropping the other", () => {
    const result = resize(namedGrid(4, 2), 2, 4, "top-left");

    expect(result.tiles).toHaveLength(4);
    expect(result.tiles[0]).toHaveLength(2);
    expect(result.tiles[0][0]).toEqual(marked("0-0"));
    expect(result.tiles[3][0]).toEqual(blank);
  });
});
