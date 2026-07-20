import { describe, expect, it } from "vitest";
import { buildPipeSeamDetails } from "server/routers/match/previews";
import { addUnit, createTestMatch, recomputeVision, tiles } from "../helpers/scenario";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import type { Tile } from "shared/schemas/tile";

/**
 * A pipe seam is attackable terrain with its own HP — inspecting it is how you judge whether one
 * more shot breaks it. It has no unit, so the detail preview used to refuse the tile outright
 * ("There's no unit there") and its health was unreadable.
 */
const mapWithSeam = (variant: "top-bottom" | "right-left"): Tile[][] => {
  const grid = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, (): Tile => tiles.plain()),
  );

  grid[2][2] = { type: "pipeSeam", variant, hp: 99 } as Tile;

  return grid;
};

const seamState = (hp: number): ChangeableTile =>
  ({ type: "pipeSeam", position: [2, 2], hp }) as unknown as ChangeableTile;

const matchWithSeam = (hp: number, fogOfWar = false) =>
  createTestMatch({
    tiles: mapWithSeam("top-bottom"),
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true },
      { slot: 1, id: "p1" },
    ],
    changeableTiles: [seamState(hp)],
    rules: { fogOfWar },
    turn: 4,
  });

describe("pipe seam inspection", () => {
  it("reports the seam's health on the unit-detail scale", () => {
    const details = buildPipeSeamDetails(matchWithSeam(55), "p0", [2, 2]);

    expect(details.kind).toBe("terrain");
    expect(details.displayName).toBe("Pipe Seam");
    expect(details.hp).toBe(55);
    // Same 1-10 digit a unit shows, so one health vocabulary covers both.
    expect(details.visualHp).toBe(6);
  });

  it("takes the art variant from the static map tile, which holds it (seam state is hp only)", () => {
    const details = buildPipeSeamDetails(matchWithSeam(99), "p0", [2, 2]);

    expect(details.terrain).toMatchObject({ type: "pipeSeam", variant: "top-bottom" });
  });

  it("refuses a tile with no seam on it", () => {
    expect(() => buildPipeSeamDetails(matchWithSeam(99), "p0", [5, 5])).toThrow();
  });

  /**
   * Seams are readable under fog even with no unit nearby: the engine registers every seam in each
   * team's Vision at construction, exactly like an owned property (see Vision's constructor), so a
   * seam is permanently visible to both sides. The preview defers to that rule rather than holding a
   * second opinion — if seam vision ever stops being universal, the gate in `buildPipeSeamDetails`
   * starts biting and this test is what says so.
   */
  it("stays readable under fog, since the engine gives every team seam vision", () => {
    const match = matchWithSeam(30, true);
    // Deliberately far from the seam — vision of it comes from the seam rule, not from this unit.
    addUnit(match.getPlayerById("p0")!, "infantry", [7, 7]);
    recomputeVision(match);

    expect(match.getPlayerById("p0")?.team.isPositionVisible([2, 2])).toBe(true);
    expect(buildPipeSeamDetails(match, "p0", [2, 2]).hp).toBe(30);
  });
});
