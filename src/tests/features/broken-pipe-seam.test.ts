import { describe, expect, it } from "vitest";
import { buildTurnSnapshot } from "server/engine/previews/turn-snapshot";
import { addUnit, createTestMatch, recomputeVision, tiles } from "../helpers/scenario";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import type { Tile } from "shared/schemas/tile";

/**
 * A destroyed pipe seam (hp < 1) renders as a broken-pipe plain tile, whose orientation comes from
 * the STATIC map tile underneath. Reading it used to re-enter `getTile` at the same position and
 * recurse until the stack blew — which took down every query that touched the tile (turn snapshot,
 * full board view), so the board went unselectable and unbuildable for the rest of the match.
 */
const pipeSeam = (variant: "top-bottom" | "right-left", position: [number, number]): Tile[][] => {
  const grid = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, (): Tile => tiles.plain()),
  );

  grid[position[1]][position[0]] = { type: "pipe", variant } as Tile;

  return grid;
};

const brokenSeamAt = (position: [number, number]): ChangeableTile =>
  ({ type: "pipeSeam", position, hp: 0 }) as unknown as ChangeableTile;

describe("destroyed pipe seam", () => {
  it("resolves to a broken-pipe tile instead of recursing forever", () => {
    const match = createTestMatch({
      tiles: pipeSeam("top-bottom", [2, 2]),
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
      ],
      changeableTiles: [brokenSeamAt([2, 2])],
      turn: 3,
    });

    expect(match.getTile([2, 2])).toEqual({ type: "plain", variant: "broken-pipe-top-bottom" });
  });

  it("takes its orientation from the map tile underneath", () => {
    const match = createTestMatch({
      tiles: pipeSeam("right-left", [1, 3]),
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
      ],
      changeableTiles: [brokenSeamAt([1, 3])],
      turn: 3,
    });

    expect(match.getTile([1, 3])).toEqual({ type: "plain", variant: "broken-pipe-right-left" });
  });

  it("lets the turn snapshot build with a destroyed seam on the board", () => {
    const match = createTestMatch({
      tiles: pipeSeam("top-bottom", [2, 2]),
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
      ],
      changeableTiles: [brokenSeamAt([2, 2])],
      rules: { fogOfWar: true },
      turn: 3,
    });

    const me = match.getPlayerById("p0")!;
    addUnit(me, "infantry", [1, 1]);
    recomputeVision(match);

    const snapshot = buildTurnSnapshot(match, me);

    expect(snapshot.units[0].reachableTiles.length).toBeGreaterThan(0);
    expect(snapshot.production.priceTable.length).toBeGreaterThan(0);
  });
});
