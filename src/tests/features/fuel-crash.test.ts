import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { buildMatchFullView } from "server/engine/previews/match-view";
import {
  addUnit,
  createTestMatch,
  dispatchMainAction,
  property,
  recomputeVision,
  tiles,
} from "../helpers/scenario";

const PASS_TURN: MainAction = { type: "passTurn" };

const roadRow = (length: number) => [Array.from({ length }, () => tiles.road())];

/**
 * Fuel-out crashes, and the report the FE animates them from.
 *
 * Only air and sea units burn fuel at turn start (land units sit at `facility: "base"` and are
 * excluded), so these all fly a battleCopter — 2 fuel per turn — down to empty.
 *
 * Crashed units are removed from the match during the upkeep, so the report can't diff them out of
 * the after-state the way it does repairs and refuels; the positions are collected as they go down.
 * That's the thing worth pinning here.
 */
describe("fuel-out crashes", () => {
  it("reports where the incoming player's units ran out of fuel", () => {
    const match = createTestMatch({
      tiles: roadRow(4),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const p1 = match.getPlayerBySlot(1)!;
    // 2 fuel, and a battleCopter burns exactly 2 per turn — it goes down on this upkeep.
    addUnit(p1, "battleCopter", [1, 0], { stats: { hp: 100, fuel: 2, ammo: 5 } });
    // A second unit so the crash doesn't wipe p1 out entirely (that's the elimination path, below).
    addUnit(p1, "infantry", [3, 0]);

    dispatchMainAction(match, PASS_TURN);

    expect(match.turnStartReport?.crashed).toEqual([[1, 0]]);
    // And it really is gone from the board, not merely reported.
    expect(match.getUnit([1, 0])).toBeUndefined();
  });

  it("does not crash a unit sitting on a friendly airport — it resupplies instead", () => {
    const match = createTestMatch({
      tiles: roadRow(4),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("airport", 1, [1, 0])],
    });
    const p1 = match.getPlayerBySlot(1)!;
    const copter = addUnit(p1, "battleCopter", [1, 0], { stats: { hp: 100, fuel: 2, ammo: 5 } });

    dispatchMainAction(match, PASS_TURN);

    expect(match.turnStartReport?.crashed).toEqual([]);
    expect(match.getUnit([1, 0])).toBeDefined();
    expect(copter.getFuel()).toBeGreaterThan(2); // refuelled by its own airport
    expect(match.turnStartReport?.refuelled).toEqual([[1, 0]]);
  });

  it("reports nothing when everyone has fuel", () => {
    const match = createTestMatch({
      tiles: roadRow(4),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    addUnit(match.getPlayerBySlot(1)!, "battleCopter", [1, 0], {
      stats: { hp: 100, fuel: 50, ammo: 5 },
    });

    dispatchMainAction(match, PASS_TURN);

    expect(match.turnStartReport?.crashed).toEqual([]);
  });

  describe("what each viewer is told", () => {
    it("shows the crash to BOTH players outside fog — a unit going down is public", () => {
      const match = createTestMatch({
        tiles: roadRow(4),
        players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      });
      const p0 = match.getPlayerBySlot(0)!;
      const p1 = match.getPlayerBySlot(1)!;

      addUnit(p1, "battleCopter", [1, 0], { stats: { hp: 100, fuel: 2, ammo: 5 } });
      addUnit(p1, "infantry", [3, 0]);

      dispatchMainAction(match, PASS_TURN);

      // The owner is on turn and sees it in their own upkeep report...
      expect(buildMatchFullView(match, p1.data.id).crashes?.positions).toEqual([[1, 0]]);
      // ...and the opponent, whose `turnStart` is null, still gets the crash via the public field.
      const opponentView = buildMatchFullView(match, p0.data.id);

      expect(opponentView.turnStart).toBeNull();
      expect(opponentView.crashes?.positions).toEqual([[1, 0]]);
      // Tagged with whose units went down, so "animate my units only" can filter on it.
      expect(opponentView.crashes?.playerId).toBe(p1.data.id);
    });

    it("hides a crash the viewer had no vision of, under fog", () => {
      const match = createTestMatch({
        tiles: roadRow(8),
        players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
        rules: { fogOfWar: true },
      });
      const p0 = match.getPlayerBySlot(0)!;
      const p1 = match.getPlayerBySlot(1)!;

      // p0's only unit is at the far end, nowhere near the copter going down at [6,0].
      addUnit(p0, "infantry", [0, 0]);
      addUnit(p1, "battleCopter", [6, 0], { stats: { hp: 100, fuel: 2, ammo: 5 } });
      addUnit(p1, "infantry", [7, 0]);
      recomputeVision(match);

      dispatchMainAction(match, PASS_TURN);

      // The owner still sees their own loss...
      expect(buildMatchFullView(match, p1.data.id).crashes?.positions).toEqual([[6, 0]]);
      // ...but the crash must not announce a unit p0 never knew was there.
      expect(buildMatchFullView(match, p0.data.id).crashes?.positions).toEqual([]);
    });
  });
});
