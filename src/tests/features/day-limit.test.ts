import { describe, expect, it } from "vitest";
import { deriveGameOver } from "server/engine/previews/game-over";
import { finalizeIfGameOver } from "server/engine/previews/finalize";
import { countTeamHoldings, isDayLimitReached } from "server/engine/previews/day-limit";
import { createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import type { MatchWrapper } from "server/engine/entities/match";

/**
 * The day limit: a match that reaches its last day is decided on territory rather than running
 * forever. `dayLimit` had been in `MatchRules` (and shown in the lobby) since long before anything
 * enforced it — these tests are the enforcement.
 */
const grid = () => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => tiles.plain()));

/** A match sitting one day PAST `dayLimit` — i.e. the last day has been played out. */
const matchAtLimit = (
  changeableTiles: ChangeableTile[],
  { dayLimit = 50, turn = 51 }: { dayLimit?: number; turn?: number } = {},
): MatchWrapper =>
  createTestMatch({
    tiles: grid(),
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true },
      { slot: 1, id: "p1" },
    ],
    changeableTiles,
    rules: { dayLimit },
    turn,
  });

describe("day limit", () => {
  it("does not end a match before the last day is played", () => {
    const match = matchAtLimit([property("city", 0, [1, 1])], { dayLimit: 50, turn: 50 });

    expect(isDayLimitReached(match)).toBe(false);
    expect(deriveGameOver(match, undefined)).toBeNull();
  });

  it("treats dayLimit 0 as no limit, however long the match runs", () => {
    // A TEST-FIXTURE sentinel, not a user-facing option: `matchRulesSchema` requires a positive day
    // limit, so nothing crossing the transport boundary can express 0. The guard exists so the
    // engine fixtures (which don't go through the schema) aren't all declared over on first derive.
    const match = matchAtLimit([property("city", 0, [1, 1])], { dayLimit: 0, turn: 900 });

    expect(isDayLimitReached(match)).toBe(false);
    expect(deriveGameOver(match, undefined)).toBeNull();
  });

  it("awards the team holding the most properties", () => {
    const match = matchAtLimit([
      property("city", 0, [1, 1]),
      property("base", 0, [2, 1]),
      property("city", 1, [4, 4]),
    ]);

    const outcome = deriveGameOver(match, undefined);

    expect(outcome).toMatchObject({ winnerTeamIndex: 0, reason: "day-limit" });
  });

  it("breaks a property tie on city count", () => {
    // Two properties each, but slot 1 holds two CITIES to slot 0's one.
    const match = matchAtLimit([
      property("city", 0, [1, 1]),
      property("base", 0, [2, 1]),
      property("city", 1, [4, 4]),
      property("city", 1, [5, 4]),
    ]);

    expect(countTeamHoldings(match)).toEqual(
      expect.arrayContaining([
        { teamIndex: 0, properties: 2, cities: 1 },
        { teamIndex: 1, properties: 2, cities: 2 },
      ]),
    );
    expect(deriveGameOver(match, undefined)).toMatchObject({
      winnerTeamIndex: 1,
      reason: "day-limit",
    });
  });

  it("is a draw when properties and cities are both level", () => {
    const match = matchAtLimit([
      property("city", 0, [1, 1]),
      property("base", 0, [2, 1]),
      property("city", 1, [4, 4]),
      property("base", 1, [5, 4]),
    ]);

    expect(deriveGameOver(match, undefined)).toMatchObject({
      winnerTeamIndex: null,
      reason: "day-limit",
    });
  });

  it("ignores neutral property tiles", () => {
    // getPlayerBySlot(-1) answers a neutral PSEUDO-PLAYER rather than undefined, so an unguarded
    // lookup would bank every neutral city into a real team's total.
    const match = matchAtLimit([
      property("city", -1, [0, 0]),
      property("city", -1, [1, 0]),
      property("city", 0, [1, 1]),
    ]);

    expect(countTeamHoldings(match)).toEqual(
      expect.arrayContaining([
        { teamIndex: 0, properties: 1, cities: 1 },
        { teamIndex: 1, properties: 0, cities: 0 },
      ]),
    );
    expect(deriveGameOver(match, undefined)).toMatchObject({ winnerTeamIndex: 0 });
  });

  it("finalizes the match, stamping results and the reason", () => {
    const match = matchAtLimit([property("city", 0, [1, 1])]);

    expect(finalizeIfGameOver(match)).toEqual({ winnerTeamIndex: 0, reason: "day-limit" });
    expect(match.status).toBe("finished");
    expect(match.getPlayerBySlot(0)?.data.result).toBe("won");
    expect(match.getPlayerBySlot(1)?.data.result).toBe("lost");
    // A finished match keeps reporting HOW it ended, rather than falling back to "elimination".
    expect(deriveGameOver(match, undefined)).toMatchObject({ reason: "day-limit" });
  });

  it("still ends on elimination before the limit, and says so", () => {
    const match = matchAtLimit([property("city", 1, [4, 4])], { dayLimit: 50, turn: 10 });
    match.getPlayerBySlot(0)!.data.status = "routed";

    expect(deriveGameOver(match, undefined)).toMatchObject({
      winnerTeamIndex: 1,
      reason: "elimination",
    });
  });

  it("ends through the real pass-turn pipeline as the last day rolls over", () => {
    // The wiring that matters in play: passing the turn advances the day, and the finalize that
    // every action's persist step runs is what notices the limit. Nothing calls the day-limit rule
    // directly here.
    const match = createTestMatch({
      tiles: grid(),
      players: [
        { slot: 0, id: "p0" },
        { slot: 1, id: "p1", hasCurrentTurn: true },
      ],
      changeableTiles: [property("city", 0, [1, 1]), property("city", 0, [2, 1])],
      rules: { dayLimit: 50 },
      turn: 50,
    });

    expect(finalizeIfGameOver(match)).toBeNull(); // day 50 still being played

    dispatchMainAction(match, { type: "passTurn" }); // wraps to slot 0 → day 51

    expect(match.turn).toBe(51);
    expect(finalizeIfGameOver(match)).toEqual({ winnerTeamIndex: 0, reason: "day-limit" });
    expect(match.status).toBe("finished");
  });

  it("scores 2v2 by TEAM, not by the best individual player", () => {
    const match = createTestMatch({
      tiles: grid(),
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
        { slot: 2, id: "p2" },
        { slot: 3, id: "p3" },
      ],
      // Slots 0+2 are team 0; slots 1+3 are team 1.
      changeableTiles: [
        property("city", 0, [1, 1]),
        property("city", 2, [2, 1]),
        // Slot 1 alone out-holds either individual on team 0, but not their combined total.
        property("city", 1, [4, 4]),
        property("base", 1, [5, 4]),
      ],
      rules: { dayLimit: 50, teamMapping: [0, 1, 0, 1] },
      turn: 51,
    });

    expect(countTeamHoldings(match)).toEqual(
      expect.arrayContaining([
        { teamIndex: 0, properties: 2, cities: 2 },
        { teamIndex: 1, properties: 2, cities: 1 },
      ]),
    );
    expect(deriveGameOver(match, undefined)).toMatchObject({ winnerTeamIndex: 0 });
  });
});
