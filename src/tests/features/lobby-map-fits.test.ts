/* eslint-disable @typescript-eslint/require-await -- in-memory fake db mirrors Prisma's async API */
import { describe, expect, it } from "vitest";
import { LobbyUsecase } from "server/lobby/lobby.usecase";
import type { MatchRules } from "server/core/schemas/match-rules";
import type { GameMode } from "server/core/schemas/game-mode";

/**
 * `LobbyUsecase`'s map guard: a map must seat EXACTLY the mode's capacity.
 *
 * Regression — the guard used to be `map.numberOfPlayers < capacity`, which only rejected maps that
 * were too small. A 4-player map therefore passed in a duel, and the match then hung: the map's
 * `numberOfPlayers` (not the seat count) drives slot iteration, so slots 2 and 3 held property and
 * armies with no player behind them and `allMatchSlotsReady` could never return true.
 */

const RULES: MatchRules = {
  unitCapPerPlayer: 50,
  fogOfWar: false,
  fundsPerProperty: 1000,
  labUnitTypes: [],
  bannedUnitTypes: [],
  captureLimit: 50,
  dayLimit: 50,
  weatherSetting: "clear",
  teamMapping: [],
};

/** A lobby usecase whose only map is `map-x`, seating `numberOfPlayers`. */
const makeUsecase = (numberOfPlayers: number, supportedModes?: GameMode[]) => {
  const db = {
    wWMap: {
      findUnique: async () => ({
        id: "map-x",
        name: "Test Map",
        numberOfPlayers,
        // Default to whatever the seat count physically fits, so seat-count cases aren't
        // accidentally rejected by the mode guard instead.
        supportedModes: supportedModes ?? (numberOfPlayers === 2 ? ["duel"] : ["teams", "ffa"]),
      }),
    },
    lobby: {
      create: async ({ data }: { data: { hostPlayerId: string; mapId?: string } }) => ({
        id: "lobby-1",
        hostPlayerId: data.hostPlayerId,
        mode: "duel",
        ruleset: "standard",
        isRanked: false,
        mapId: data.mapId ?? null,
        status: "assembling",
        teamFactions: ["orange-star", "blue-moon"],
        rules: RULES,
        match: null,
        members: [],
      }),
    },
  };

  return new LobbyUsecase(db as never, {} as never);
};

const createWith = (numberOfPlayers: number, mode: GameMode, supportedModes?: GameMode[]) =>
  makeUsecase(numberOfPlayers, supportedModes).createForcedMatch({
    hostPlayerId: "admin",
    seatPlayerIds: mode === "duel" ? ["a", "b"] : ["a", "b", "c", "d"],
    mode,
    ruleset: "standard",
    isRanked: false,
    mapId: "map-x",
    rules: RULES,
  });

describe("LobbyUsecase map-size guard", () => {
  it("rejects a 4-player map in a duel", async () => {
    // The exact bug: 4 >= 2, so the old `<` check let this through.
    await expect(createWith(4, "duel")).rejects.toThrow(/4 players but duel needs exactly 2/);
  });

  it("rejects a 2-player map in a 2v2", async () => {
    await expect(createWith(2, "teams")).rejects.toThrow(/2 players but teams needs exactly 4/);
  });

  it("rejects a 2-player map in a free-for-all", async () => {
    await expect(createWith(2, "ffa")).rejects.toThrow(/2 players but ffa needs exactly 4/);
  });

  it("accepts a map whose seat count matches the mode", async () => {
    await expect(createWith(2, "duel")).resolves.toBeDefined();
    await expect(createWith(4, "teams")).resolves.toBeDefined();
    await expect(createWith(4, "ffa")).resolves.toBeDefined();
  });
});

/**
 * The seat-count guard above cannot tell a 2v2 map from a free-for-all one — both seat 4. That is
 * what `supportedModes` is for, and it is the only thing standing between the two.
 */
describe("LobbyUsecase supportedModes guard", () => {
  it("refuses a 4-seat map in a mode it does not declare", async () => {
    await expect(createWith(4, "ffa", ["teams"])).rejects.toThrow(/not playable in ffa/);
    await expect(createWith(4, "teams", ["ffa"])).rejects.toThrow(/not playable in teams/);
  });

  it("accepts a 4-seat map declaring both modes, in either", async () => {
    await expect(createWith(4, "teams", ["teams", "ffa"])).resolves.toBeDefined();
    await expect(createWith(4, "ffa", ["teams", "ffa"])).resolves.toBeDefined();
  });

  it("refuses a map with no declared modes rather than treating it as universal", async () => {
    // An unconfigured map must fail closed: empty is "nobody said where this is legal".
    await expect(createWith(2, "duel", [])).rejects.toThrow(/not playable in duel/);
  });
});
