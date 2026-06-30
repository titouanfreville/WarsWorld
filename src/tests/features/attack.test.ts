import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

describe("attack feature", () => {
  it("resolves a direct engagement through move+attack, applying damage to both units", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const attacker = match.getPlayerBySlot(0)!.addUnwrappedUnit({
      type: "infantry",
      isReady: true,
      position: [0, 0],
      stats: { fuel: 99, hp: 100 },
    });
    const defender = match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "infantry",
      isReady: true,
      position: [1, 0],
      stats: { fuel: 99, hp: 100 },
    });

    // Stand still (path = start tile only) and attack the adjacent enemy. luck pinned to 0.
    const action: MainAction = {
      type: "move",
      path: [[0, 0]],
      subAction: { type: "attack", defenderPosition: [1, 0] },
    };
    dispatchMainAction(match, action, { luck: 0 });

    // Defender takes damage; attacker takes counter-damage. Exact values pinned as a
    // characterization snapshot so the engine refactor can't silently change combat.
    expect({ attackerHP: attacker.getHP(), defenderHP: defender.getHP() }).toMatchInlineSnapshot(`
      {
        "attackerHP": 73,
        "defenderHP": 45,
      }
    `);
  });
});
