import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { addUnit, createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

// Move the infantry at [0,0] onto the damaged friendly infantry at [1,0] → join.
const JOIN: MainAction = {
  type: "move",
  path: [
    [0, 0],
    [1, 0],
  ],
  subAction: { type: "wait" },
};

describe("joining units", () => {
  it("marks the merged unit as having acted this turn (can't move/attack again)", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const p0 = match.getPlayerBySlot(0)!;
    // Two damaged same-type units so the join is legal (destination isn't full HP).
    addUnit(p0, "infantry", [0, 0], { stats: { hp: 50, fuel: 99 } });
    addUnit(p0, "infantry", [1, 0], { stats: { hp: 30, fuel: 99 } });

    dispatchMainAction(match, JOIN);

    const merged = match.getUnit([1, 0]);
    expect(merged).toBeDefined();
    // The mover is removed; the survivor keeps the combined HP...
    expect(merged!.getVisualHP()).toBe(8); // 5 + 3
    // ...and must be spent for the turn — this is the regression guard.
    expect(merged!.data.isReady).toBe(false);
    // The mover's tile is now empty.
    expect(match.getUnit([0, 0])).toBeUndefined();
  });
});
