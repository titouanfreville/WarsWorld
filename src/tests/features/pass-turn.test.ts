import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import { createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";

const PASS_TURN: MainAction = { type: "passTurn" };

describe("pass-turn feature", () => {
  it("hands the turn to the next player and readies the passing player's units", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    const unit = p0.addUnwrappedUnit({
      type: "infantry",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 99, hp: 100 },
    });

    dispatchMainAction(match, PASS_TURN);

    expect(p0.data.hasCurrentTurn).toBe(false);
    expect(p1.data.hasCurrentTurn).toBe(true);
    // The player who just ended their turn has their units readied for next time.
    expect(unit.data.isReady).toBe(true);
  });

  it("grants the incoming player their per-turn property income", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [
        { slot: 0, hasCurrentTurn: true },
        { slot: 1, funds: 500 },
      ],
      changeableTiles: [property("city", 1, [0, 0]), property("hq", 1, [1, 0])],
    });
    const p1 = match.getPlayerBySlot(1)!;
    const income = p1.getFundsPerTurn();

    expect(income).toBe(2000); // 2 funds-giving properties * 1000 fundsPerProperty

    dispatchMainAction(match, PASS_TURN);

    expect(p1.data.funds).toBe(500 + income);
  });

  it("repairs, resupplies and heals a damaged unit on an owned property", () => {
    const match = createTestMatch({
      tiles: [[tiles.road()]],
      players: [
        { slot: 0, hasCurrentTurn: true },
        { slot: 1, funds: 10000 },
      ],
      changeableTiles: [property("base", 1, [0, 0])],
    });
    const p1 = match.getPlayerBySlot(1)!;
    const unit = p1.addUnwrappedUnit({
      type: "infantry",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 20, hp: 50 },
    });

    dispatchMainAction(match, PASS_TURN);

    expect(unit.getVisualHP()).toBe(7); // healed 2 (5 -> 7)
    expect(unit.getFuel()).toBe(99); // resupplied to full
    // funds: +1000 income (owned base) - 200 repair (2 hp * 100/hp).
    expect(p1.data.funds).toBe(10000 + 1000 - 200);
  });

  it("advances the day only when the turn order wraps back to the first player", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      turn: 3,
    });

    // slot 0 -> slot 1 is still the same day (no wrap).
    dispatchMainAction(match, PASS_TURN);
    expect(match.turn).toBe(3);

    // slot 1 -> slot 0 wraps the round: a new day begins.
    dispatchMainAction(match, PASS_TURN);
    expect(match.turn).toBe(4);
  });

  it("reports the day and the units it repaired/refuelled for the incoming player", () => {
    const match = createTestMatch({
      tiles: [[tiles.road()]],
      players: [
        { slot: 0, hasCurrentTurn: true },
        { slot: 1, funds: 10000 },
      ],
      changeableTiles: [property("base", 1, [0, 0])],
      turn: 2,
    });
    const p1 = match.getPlayerBySlot(1)!;
    const unit = p1.addUnwrappedUnit({
      type: "infantry",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 20, hp: 50 },
    });

    dispatchMainAction(match, PASS_TURN);

    // slot 0 -> slot 1 doesn't wrap, so the day is unchanged at 2.
    expect(match.turnStartReport).toEqual({
      day: 2,
      playerId: p1.data.id,
      repaired: [{ position: unit.data.position, hp: 2 }], // 5 -> 7 visual HP
      refuelled: [unit.data.position], // 20 -> 99 fuel
      crashed: [], // it's on a friendly base, so it resupplies instead of running dry
      income: 1000, // one owned base @ fundsPerProperty 1000
      repairSpent: 200, // 2 visual HP of infantry repair
      fundsAfter: 10800, // 10000 banked + 1000 income - 200 repair
    });
  });

  it("leaves the turn-start report empty when nothing was repaired or refuelled", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    // A full-fuel, full-HP land unit off a facility burns no fuel and needs no repair.
    match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "infantry",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 99, hp: 100 },
    });

    dispatchMainAction(match, PASS_TURN);

    expect(match.turnStartReport?.repaired).toEqual([]);
    expect(match.turnStartReport?.refuelled).toEqual([]);
  });

  it("drains fuel from an air unit that is not on a repair facility", () => {
    const match = createTestMatch({
      tiles: [[tiles.road(), tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const heli = match.getPlayerBySlot(1)!.addUnwrappedUnit({
      type: "battleCopter",
      isReady: false,
      position: [0, 0],
      stats: { fuel: 50, hp: 100, ammo: 6 },
    });

    dispatchMainAction(match, PASS_TURN);

    // battleCopter burns 2 fuel/turn while off an airport.
    expect(heli.getFuel()).toBe(48);
  });
});
