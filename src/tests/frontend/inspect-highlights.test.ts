import { describe, expect, it } from "vitest";
import {
  inspectHighlights,
  type UnitInspection,
} from "frontend/components/match/inspect-highlights";

// Only the tile-set fields matter to the helper; the rest of the inspection payload is irrelevant
// here, so build a minimal stand-in and cast.
const inspection = (over: Partial<UnitInspection>): UnitInspection =>
  ({
    isOwn: true,
    isIndirect: false,
    reachableTiles: [],
    attackableTiles: [],
    directAttackTiles: [],
    attackTargetTiles: [],
    ...over,
  }) as UnitInspection;

describe("inspectHighlights", () => {
  it("full mode, own unit: blue = movement, red = only the enemy units it can attack", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: true,
        reachableTiles: [
          [0, 0],
          [1, 0],
        ],
        attackableTiles: [
          [2, 0],
          [1, 1],
        ],
        attackTargetTiles: [[2, 0]], // the only tile actually holding an attackable enemy
      }),
      "full",
    );

    expect(result.reachable).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(result.attack).toEqual([[2, 0]]);
  });

  it("full mode, enemy unit: red = danger zone MINUS its movement (no colour overlap)", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: false,
        reachableTiles: [
          [0, 0],
          [1, 0],
        ],
        // Attackable includes a tile that is also reachable ([1,0]) plus fringe tiles beyond movement.
        attackableTiles: [
          [1, 0],
          [2, 0],
          [1, 1],
        ],
      }),
      "full",
    );

    expect(result.reachable).toEqual([
      [0, 0],
      [1, 0],
    ]);
    // [1,0] is dropped (it's in the movement range); only the out-of-movement threat tiles stay red.
    expect(result.attack).toEqual([
      [2, 0],
      [1, 1],
    ]);
  });

  it("full mode, INDIRECT unit: movement only — it can't move and fire in one turn", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: true,
        isIndirect: true,
        reachableTiles: [
          [0, 0],
          [1, 0],
        ],
        // An indirect's move-and-attack sets are meaningless (it fires from a standstill), so they
        // must NOT be painted in full mode even though the BE computes them.
        attackableTiles: [
          [3, 0],
          [4, 0],
        ],
        attackTargetTiles: [[3, 0]],
      }),
      "full",
    );

    expect(result.reachable).toEqual([
      [0, 0],
      [1, 0],
    ]);
    expect(result.attack).toEqual([]);
  });

  it("full mode, indirect ENEMY: movement only too — the danger-zone rule doesn't apply", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: false,
        isIndirect: true,
        reachableTiles: [[0, 0]],
        attackableTiles: [
          [3, 0],
          [4, 0],
        ],
      }),
      "full",
    );

    expect(result.attack).toEqual([]);
  });

  it("direct mode on an indirect: red = its real reach, the in-place range ring", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: false,
        isIndirect: true,
        reachableTiles: [[0, 0]],
        directAttackTiles: [
          [2, 0],
          [3, 0],
        ],
      }),
      "direct",
    );

    expect(result.reachable).toEqual([]);
    expect(result.attack).toEqual([
      [2, 0],
      [3, 0],
    ]);
  });

  it("direct mode: no movement, red = the in-place attack reach only", () => {
    const result = inspectHighlights(
      inspection({
        isOwn: false,
        reachableTiles: [[0, 0]],
        attackableTiles: [[5, 5]],
        directAttackTiles: [
          [1, 0],
          [0, 1],
        ],
      }),
      "direct",
    );

    expect(result.reachable).toEqual([]);
    expect(result.attack).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});
