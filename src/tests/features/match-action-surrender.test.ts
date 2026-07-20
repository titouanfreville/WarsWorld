import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MatchActionUsecase } from "server/matches/match-action.usecase";
import type { RankingUsecase } from "server/ranking/ranking.usecase";
import type { EndgameUsecase } from "server/endgame/endgame.usecase";
import { createTestMatch, tiles } from "../helpers/scenario";

/**
 * A Prisma stand-in that runs the `$transaction` callback inline and records the event rows written,
 * so a test can assert that BOTH events of a surrender (the elimination and the follow-on turn pass)
 * land in the SAME transaction — the crash-safety fix. ranking/endgame are no-op stubs; a
 * non-finishing surrender never reaches them, a finishing one only needs them not to throw.
 */
const stubDeps = () => {
  const eventContents: { type: string }[] = [];
  const tx = {
    event: {
      create: async ({ data }: { data: { content: { type: string } } }) => {
        eventContents.push(data.content);
      },
    },
    match: { update: async () => ({}) },
    matchPlayer: { updateMany: async () => ({}) },
  };
  const db = {
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  const ranking = { applyMatchResult: async () => ({}) } as unknown as RankingUsecase;
  const endgame = { persistStats: async () => ({}) } as unknown as EndgameUsecase;

  return { db, ranking, endgame, eventContents };
};

const threePlayer = () =>
  createTestMatch({
    tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }, { slot: 2 }],
  });

describe("MatchActionUsecase.surrender", () => {
  it("in 3+ players, moves the turn on and writes BOTH events in one transaction", async () => {
    const match = threePlayer();
    const { db, ranking, endgame, eventContents } = stubDeps();

    await new MatchActionUsecase(db, ranking, endgame).surrender(match, "0");

    // The elimination and the follow-on pass-turn are persisted together — no split write that a
    // crash could leave the match stuck on a resigned turn-holder.
    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated", "passTurn"]);
    // The surrenderer is out and the turn moved to the next living player.
    expect(match.getPlayerById("0")?.data.status).toBe("resigned");
    expect(match.getPlayerById("0")?.data.hasCurrentTurn).toBe(false);
    expect(match.getPlayerById("1")?.data.hasCurrentTurn).toBe(true);
    expect(match.status).toBe("playing");
  });

  it("in a 1v1, ends the match and writes only the elimination (no turn to pass)", async () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const { db, ranking, endgame, eventContents } = stubDeps();

    await new MatchActionUsecase(db, ranking, endgame).surrender(match, "0");

    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated"]);
    expect(match.status).toBe("finished");
    expect(match.getPlayerById("1")?.data.result).toBe("won");
  });

  it("doesn't pass the turn when the surrenderer wasn't holding it", async () => {
    const match = threePlayer();
    const { db, ranking, endgame, eventContents } = stubDeps();

    // Slot 2 concedes on slot 0's turn.
    await new MatchActionUsecase(db, ranking, endgame).surrender(match, "2");

    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated"]);
    expect(match.getPlayerById("0")?.data.hasCurrentTurn).toBe(true);
    expect(match.status).toBe("playing");
  });
});
