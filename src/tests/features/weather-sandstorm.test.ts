import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import type { Weather } from "shared/schemas/weather";
import { createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

/**
 * Sandstorm (AWDS weather) reduces every attacking unit's firepower by 30% — so both the attack and
 * the counterattack in an engagement deal less damage than in clear weather. It has no effect on
 * attack range (the old, non-canonical range penalty was removed). We run the same infantry-vs-infantry
 * engagement in clear vs sandstorm and assert sandstorm leaves both units healthier.
 */
const engage = (weather: Weather) => {
  const match = createTestMatch({
    tiles: [[tiles.road(), tiles.road()]],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
  });
  match.setWeather(weather, 99);

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

  // Stand still and attack the adjacent enemy; luck pinned to 0 for determinism.
  const action: MainAction = {
    type: "move",
    path: [[0, 0]],
    subAction: { type: "attack", defenderPosition: [1, 0] },
  };
  dispatchMainAction(match, action, { luck: 0 });

  return { attackerHP: attacker.getHP(), defenderHP: defender.getHP() };
};

describe("sandstorm weather", () => {
  it("cuts firepower so both units take less damage than in clear weather", () => {
    const clear = engage("clear");
    const sandstorm = engage("sandstorm");

    // Clear baseline is the pinned characterization value from the attack feature test.
    expect(clear).toEqual({ attackerHP: 73, defenderHP: 45 });

    // -30% firepower on both the attack and the counter → each unit keeps more HP.
    expect(sandstorm.defenderHP).toBeGreaterThan(clear.defenderHP);
    expect(sandstorm.attackerHP).toBeGreaterThan(clear.attackerHP);
  });
});
