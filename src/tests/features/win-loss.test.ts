import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";

/**
 * Win/loss conditions. NOTE: in the current engine most match-end handling is a TODO — the
 * attack/capture handlers *compute* an `eliminationReason` but only HQ/labs capture actually
 * eliminates a player (see capture.test.ts). These tests lock the parts that ARE implemented
 * (unit removal, reason detection) and characterize the not-yet-applied parts so a future
 * implementer has to update them deliberately.
 */
describe("win/loss conditions", () => {
  it("removes a defender's last unit on a lethal attack and flags the elimination reason", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    match
      .getPlayerBySlot(0)!
      .addUnwrappedUnit({
        type: "infantry",
        isReady: true,
        position: [0, 0],
        stats: { fuel: 99, hp: 100 },
      });
    const p1 = match.getPlayerBySlot(1)!;
    p1.addUnwrappedUnit({
      type: "infantry",
      isReady: true,
      position: [1, 0],
      stats: { fuel: 99, hp: 10 },
    });

    const attack: MainAction = {
      type: "move",
      path: [[0, 0]],
      subAction: { type: "attack", defenderPosition: [1, 0] },
    };
    const event = dispatchMainAction(match, attack, { luck: 0 });

    expect(match.getUnit([1, 0])).toBeUndefined();
    expect(p1.getUnits()).toHaveLength(0);
    expect(event).toMatchObject({
      subEvent: { eliminationReason: "all-defender-units-destroyed" },
    });
    // Characterization: the engine does NOT yet auto-eliminate a player who lost their last
    // unit to an attack (match-end handling is a TODO). Pinned so it fails loudly once wired.
    expect(p1.data.status).toBe("alive");
  });

  it("removes an attacker's last unit when it dies to the counterattack", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    match
      .getPlayerBySlot(0)!
      .addUnwrappedUnit({
        type: "infantry",
        isReady: true,
        position: [0, 0],
        stats: { fuel: 99, hp: 10 },
      });
    match
      .getPlayerBySlot(1)!
      .addUnwrappedUnit({
        type: "infantry",
        isReady: true,
        position: [1, 0],
        stats: { fuel: 99, hp: 100 },
      });

    const attack: MainAction = {
      type: "move",
      path: [[0, 0]],
      subAction: { type: "attack", defenderPosition: [1, 0] },
    };
    const event = dispatchMainAction(match, attack, { luck: 0 });

    expect(match.getUnit([0, 0])).toBeUndefined();
    expect(event).toMatchObject({
      subEvent: { eliminationReason: "all-attacker-units-destroyed" },
    });
  });

  it("flags property-goal-reached when a capture brings the owner to the capture limit", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 0, [1, 0]), property("city", 1, [0, 0])],
      rules: { captureLimit: 2 },
    });
    match
      .getPlayerBySlot(0)!
      .addUnwrappedUnit({
        type: "infantry",
        isReady: true,
        position: [0, 0],
        stats: { fuel: 99, hp: 100 },
      });

    const capture: MainAction = { type: "move", path: [[0, 0]], subAction: { type: "ability" } };
    dispatchMainAction(match, capture); // 20 -> 10
    const event = dispatchMainAction(match, capture); // completes: owned 1 + 1 >= captureLimit 2

    expect(event).toMatchObject({ subEvent: { eliminationReason: "property-goal-reached" } });
    expect(match.getTile([0, 0])).toMatchObject({ playerSlot: 0 });
  });
});
