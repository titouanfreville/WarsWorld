import { describe, expect, it } from "vitest";
import {
  AvailableSubActions,
  getAvailableSubActions,
} from "server/engine/events/available-sub-actions";
import { addUnit, createTestMatch, recomputeVision, tiles } from "../helpers/scenario";

const roadRow = (n: number) => [Array.from({ length: n }, () => tiles.road())];

/**
 * The Attack menu entry must only appear for a VISIBLE enemy — offering it for a fog-hidden enemy
 * that merely sits in range leaks that enemy's presence. Artillery (vision 1, range [2,3]) is the
 * clean probe: an enemy at distance 2 is attackable-by-geometry but outside the artillery's vision.
 */
describe("availableActions fog gate", () => {
  const buildMatch = (fogOfWar: boolean) => {
    const match = createTestMatch({
      tiles: roadRow(6),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { fogOfWar },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    const artillery = addUnit(p0, "artillery", [0, 0]);
    addUnit(p1, "infantry", [2, 0]); // in artillery range [2,3], outside its vision (1)
    recomputeVision(match);
    return { match, p0, artillery };
  };

  it("does NOT offer Attack on an in-range enemy the team cannot see (fog)", () => {
    const { match, p0, artillery } = buildMatch(true);

    const actions = getAvailableSubActions(match, p0, artillery, [0, 0], false);
    expect(actions.has(AvailableSubActions.Attack)).toBe(false);
  });

  it("offers Attack on the same enemy when it is visible (no fog)", () => {
    const { match, p0, artillery } = buildMatch(false);

    const actions = getAvailableSubActions(match, p0, artillery, [0, 0], false);
    expect(actions.has(AvailableSubActions.Attack)).toBe(true);
  });
});
