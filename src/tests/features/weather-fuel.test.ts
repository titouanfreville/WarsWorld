import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

/**
 * AWDS snow doubles fuel usage for every (non-Olaf) unit — both the per-tile movement fuel and the
 * daily upkeep of air/naval units. AW1/AW2 snow slows movement instead and touches no fuel. Olaf's
 * units are immune. These pin all three cases.
 */
const PASS_TURN: MainAction = { type: "passTurn" };

describe("AWDS snow fuel", () => {
  it("burns double movement fuel per tile", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { gameVersion: "AWDS" },
    });
    match.setWeather("snow", 99);
    const tank = match.getPlayerBySlot(0)!.addUnwrappedUnit({
      type: "tank",
      isReady: true,
      position: [0, 0],
      stats: { fuel: 50, hp: 100, ammo: 9 },
    });

    // Move 2 tiles: 2 fuel in clear, doubled to 4 in AWDS snow.
    dispatchMainAction(
      match,
      {
        type: "move",
        path: [
          [0, 0],
          [1, 0],
          [2, 0],
        ],
        subAction: { type: "wait" },
      },
      { luck: 0 },
    );

    expect(tank.getFuel()).toBe(46);
  });

  it("doubles daily upkeep for air units", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { gameVersion: "AWDS" },
    });
    match.setWeather("snow", 99);
    const heli = match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "battleCopter",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 50, hp: 100, ammo: 6 },
    });

    // battleCopter burns 2 fuel/turn off an airport; AWDS snow doubles that to 4.
    dispatchMainAction(match, PASS_TURN, { luck: 0 });

    expect(heli.getFuel()).toBe(46);
  });

  it("does not penalise Olaf's units (immune to snow)", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [
        { slot: 0, hasCurrentTurn: true },
        { slot: 1, coId: { name: "olaf", version: "AWDS" } },
      ],
      rules: { gameVersion: "AWDS" },
    });
    match.setWeather("snow", 99);
    const heli = match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "battleCopter",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 50, hp: 100, ammo: 6 },
    });

    dispatchMainAction(match, PASS_TURN, { luck: 0 });

    expect(heli.getFuel()).toBe(48); // normal 2/turn, not doubled
  });

  it("leaves fuel untouched by snow outside AWDS (AW2 slows movement instead)", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { gameVersion: "AW2" },
    });
    match.setWeather("snow", 99);
    const heli = match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "battleCopter",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 50, hp: 100, ammo: 6 },
    });

    dispatchMainAction(match, PASS_TURN, { luck: 0 });

    expect(heli.getFuel()).toBe(48); // AW2 snow has no fuel penalty
  });
});
