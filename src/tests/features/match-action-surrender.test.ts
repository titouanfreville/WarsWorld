import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MatchActionUsecase } from "server/matches/match-action.usecase";
import type { RankingUsecase } from "server/ranking/ranking.usecase";
import type { EndgameUsecase } from "server/endgame/endgame.usecase";
import type { MatchStore } from "server/match-store";
import { createTestMatch, tiles } from "../helpers/scenario";

/**
 * A Prisma stand-in that runs the `$transaction` callback inline and records the event rows written,
 * so a test can assert that BOTH events of a surrender (the elimination and the follow-on turn pass)
 * land in the SAME transaction — the crash-safety fix. ranking/endgame are no-op stubs; a
 * non-finishing surrender never reaches them, a finishing one only needs them not to throw.
 */
const stubDeps = () => {
  const eventContents: { type: string }[] = [];
  // Rows as written, so `aggregate` can serve the real per-match max the way Postgres would —
  // `appendEvent` derives the next index from it, and within one transaction each append must see
  // the one before it. A stub that always answered "no rows" would hand out the same index twice.
  const eventRows: { matchId: string; index: number }[] = [];
  // These stubs are awaited by the code under test but do no async work themselves, so they return
  // values directly rather than being `async` (which @typescript-eslint/require-await rejects).
  const tx = {
    event: {
      aggregate: ({ where }: { where: { matchId: string } }) => ({
        _max: {
          index: eventRows
            .filter((row) => row.matchId === where.matchId)
            .reduce<
              number | null
            >((max, row) => (max === null ? row.index : Math.max(max, row.index)), null),
        },
      }),
      create: ({
        data,
      }: {
        data: { matchId: string; index: number; content: { type: string } };
      }) => {
        eventRows.push({ matchId: data.matchId, index: data.index });
        eventContents.push(data.content);
      },
    },
    match: { update: () => ({}) },
    matchPlayer: { updateMany: () => ({}) },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as PrismaClient;
  const ranking = { applyMatchResult: () => ({}) } as unknown as RankingUsecase;
  const endgame = { persistStats: () => ({}) } as unknown as EndgameUsecase;
  // Only the turn-deadline paths (force-end, boot re-arm) resolve matches through the store, and a
  // surrender exercises neither — an empty store satisfies the constructor.
  const store = { get: () => undefined } as unknown as MatchStore;

  return { db, ranking, endgame, store, eventContents, eventRows };
};

const threePlayer = () =>
  createTestMatch({
    tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }, { slot: 2 }],
  });

describe("MatchActionUsecase.surrender", () => {
  it("in 3+ players, moves the turn on and writes BOTH events in one transaction", async () => {
    const match = threePlayer();
    const { db, ranking, endgame, store, eventContents } = stubDeps();

    await new MatchActionUsecase(db, ranking, endgame, store).surrender(match, "0");

    // The elimination and the follow-on pass-turn are persisted together — no split write that a
    // crash could leave the match stuck on a resigned turn-holder.
    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated", "passTurn"]);
    // The surrenderer is out and the turn moved to the next living player.
    expect(match.getPlayerById("0")?.data.status).toBe("resigned");
    expect(match.getPlayerById("0")?.data.hasCurrentTurn).toBe(false);
    expect(match.getPlayerById("1")?.data.hasCurrentTurn).toBe(true);
    expect(match.status).toBe("playing");
  });

  it("assigns each event a distinct, increasing per-match index", async () => {
    const match = threePlayer();
    const { db, ranking, endgame, store, eventRows } = stubDeps();

    await new MatchActionUsecase(db, ranking, endgame, store).surrender(match, "0");

    // Both appends happen inside ONE transaction, so the second must see the first's row when it
    // derives its index. Duplicates here would mean the composite primary key `(matchId, index)`
    // rejects the second write in production — and, worse, that the log has no write fence at all.
    expect(eventRows.map((row) => row.index)).toEqual([1, 2]);
    expect(eventRows.every((row) => row.matchId === match.id)).toBe(true);
  });

  it("in a 1v1, ends the match and writes only the elimination (no turn to pass)", async () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const { db, ranking, endgame, store, eventContents } = stubDeps();

    await new MatchActionUsecase(db, ranking, endgame, store).surrender(match, "0");

    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated"]);
    expect(match.status).toBe("finished");
    expect(match.getPlayerById("1")?.data.result).toBe("won");
  });

  it("doesn't pass the turn when the surrenderer wasn't holding it", async () => {
    const match = threePlayer();
    const { db, ranking, endgame, store, eventContents } = stubDeps();

    // Slot 2 concedes on slot 0's turn.
    await new MatchActionUsecase(db, ranking, endgame, store).surrender(match, "2");

    expect(eventContents.map((e) => e.type)).toEqual(["player-eliminated"]);
    expect(match.getPlayerById("0")?.data.hasCurrentTurn).toBe(true);
    expect(match.status).toBe("playing");
  });
});
