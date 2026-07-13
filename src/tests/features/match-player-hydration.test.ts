import type { MatchPlayer } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  matchPlayerToRuntime,
  teamMappingFromRows,
  type MatchPlayerRow,
} from "server/matches/match-player";
import { INITIAL_FUNDS } from "server/engine/constants/funds";

/**
 * v2 hydration: how a relational `MatchPlayer` row becomes the engine's runtime `PlayerInMatch`
 * seed, and how the authoritative `team` column is turned back into `rules.teamMapping` for the
 * wrapper. Volatile runtime (funds beyond the initial grant, power, turn) is out of scope — that's
 * re-derived from the event log.
 */
const row = (over: Partial<MatchPlayer> & { name?: string }): MatchPlayerRow => {
  const { name = "P", ...rest } = over;

  return {
    id: "mp",
    matchId: "m",
    playerId: rest.playerId ?? "p",
    slot: rest.slot ?? 0,
    team: rest.team ?? 0,
    army: rest.army ?? "orange-star",
    coId: rest.coId ?? null,
    ready: rest.ready ?? false,
    isSpectator: rest.isSpectator ?? false,
    skins: rest.skins ?? null,
    result: rest.result ?? null,
    createdAt: new Date(0),
    ...rest,
    player: { id: rest.playerId ?? "p", name },
  };
};

describe("matchPlayerToRuntime", () => {
  it("carries identity, army and the locked general through", () => {
    const runtime = matchPlayerToRuntime(
      row({
        playerId: "abc",
        name: "Alice",
        slot: 1,
        army: "blue-moon",
        coId: { name: "grit", version: "AW2" },
      }),
    );

    expect(runtime.id).toBe("abc");
    expect(runtime.name).toBe("Alice");
    expect(runtime.slot).toBe(1);
    expect(runtime.army).toBe("blue-moon");
    expect(runtime.coId).toEqual({ name: "grit", version: "AW2" });
    expect(runtime.funds).toBe(INITIAL_FUNDS);
    expect(runtime.status).toBe("alive");
  });

  it("uses a placeholder general when none is locked yet (setup round)", () => {
    const runtime = matchPlayerToRuntime(row({ coId: null }));
    expect(runtime.coId).toEqual({ name: "andy", version: "AW2" });
  });

  it("only slot 0 opens with the turn", () => {
    expect(matchPlayerToRuntime(row({ slot: 0 })).hasCurrentTurn).toBe(true);
    expect(matchPlayerToRuntime(row({ slot: 1 })).hasCurrentTurn).toBe(false);
  });

  it("passes a persisted result through, or leaves it undefined", () => {
    expect(matchPlayerToRuntime(row({ result: "won" })).result).toBe("won");
    expect(matchPlayerToRuntime(row({ result: null })).result).toBeUndefined();
  });
});

describe("teamMappingFromRows", () => {
  it("indexes team by map slot (2v2)", () => {
    const mapping = teamMappingFromRows([
      { slot: 0, team: 0 },
      { slot: 1, team: 0 },
      { slot: 2, team: 1 },
      { slot: 3, team: 1 },
    ]);

    expect(mapping).toEqual([0, 0, 1, 1]);
  });

  it("places each team at its own slot index regardless of row order (ffa)", () => {
    const mapping = teamMappingFromRows([
      { slot: 2, team: 2 },
      { slot: 0, team: 0 },
      { slot: 3, team: 3 },
      { slot: 1, team: 1 },
    ]);

    expect(mapping).toEqual([0, 1, 2, 3]);
  });
});
