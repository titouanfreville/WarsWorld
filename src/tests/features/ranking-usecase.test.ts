/* eslint-disable @typescript-eslint/require-await -- the in-memory fake tx mirrors Prisma's async API */
import { describe, expect, it } from "vitest";
import { RankingUsecase } from "server/ranking/ranking.usecase";

/**
 * `applyMatchResult` against a hand-rolled fake transaction client — no DB. Verifies the Elo deltas,
 * the `topMmr` high-water mark, and the two no-op guards (unranked / already-rated) that keep
 * finalize idempotent.
 */

type MatchRow = { isRanked: boolean; ratedAt: Date | null; leagueType: string };
type SeatRow = { playerId: string; team: number; result: string | null };
type MmrRow = { playerId: string; mmr: number; topMmr: number };

const makeTx = (match: MatchRow, seats: SeatRow[], mmr: MmrRow[]) => {
  const upserts: { playerId: string; mmr: number; topMmr: number }[] = [];
  let ratedAtWritten: Date | null = null;

  const tx = {
    match: {
      findUnique: async () => match,
      update: async ({ data }: { data: { ratedAt?: Date } }) => {
        if (data.ratedAt !== undefined) {
          ratedAtWritten = data.ratedAt;
        }

        return match;
      },
    },
    matchPlayer: {
      findMany: async () => seats,
    },
    mMR: {
      findMany: async () => mmr,
      upsert: async ({ create }: { create: { playerId: string; mmr: number; topMmr: number } }) => {
        upserts.push(create);
      },
    },
  };

  return { tx, upserts, ratedAt: () => ratedAtWritten };
};

const seat = (playerId: string, team: number, result: string | null): SeatRow => ({
  playerId,
  team,
  result,
});

// The usecase reads everything through the passed `tx`, so the constructor's client is unused here.
const usecase = new RankingUsecase({} as never);

describe("ranking usecase — applyMatchResult", () => {
  it("moves both players by ±16 on an even ranked 1v1", async () => {
    const { tx, upserts, ratedAt } = makeTx(
      { isRanked: true, ratedAt: null, leagueType: "standard" },
      [seat("winner", 0, "won"), seat("loser", 1, "lost")],
      [
        { playerId: "winner", mmr: 800, topMmr: 800 },
        { playerId: "loser", mmr: 800, topMmr: 800 },
      ],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(upserts.find((u) => u.playerId === "winner")?.mmr).toBe(816);
    expect(upserts.find((u) => u.playerId === "loser")?.mmr).toBe(784);
    expect(ratedAt()).toBeInstanceOf(Date);
  });

  it("bumps topMmr for the winner but never lowers the loser's peak", async () => {
    const { tx, upserts } = makeTx(
      { isRanked: true, ratedAt: null, leagueType: "standard" },
      [seat("winner", 0, "won"), seat("loser", 1, "lost")],
      [
        { playerId: "winner", mmr: 800, topMmr: 800 },
        { playerId: "loser", mmr: 800, topMmr: 900 },
      ],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(upserts.find((u) => u.playerId === "winner")?.topMmr).toBe(816);
    // loser drops to 784 but their recorded peak stays at 900
    expect(upserts.find((u) => u.playerId === "loser")?.topMmr).toBe(900);
  });

  it("seeds unseen players from the 800 default", async () => {
    const { tx, upserts } = makeTx(
      { isRanked: true, ratedAt: null, leagueType: "fog" },
      [seat("a", 0, "won"), seat("b", 1, "lost")],
      [], // neither player has an MMR row yet
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(upserts.find((u) => u.playerId === "a")?.mmr).toBe(816);
    expect(upserts.find((u) => u.playerId === "b")?.mmr).toBe(784);
  });

  it("no-ops for an unranked match", async () => {
    const { tx, upserts, ratedAt } = makeTx(
      { isRanked: false, ratedAt: null, leagueType: "standard" },
      [seat("a", 0, "won"), seat("b", 1, "lost")],
      [],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(upserts).toHaveLength(0);
    expect(ratedAt()).toBeNull();
  });

  it("no-ops when already rated (idempotency guard)", async () => {
    const { tx, upserts } = makeTx(
      { isRanked: true, ratedAt: new Date("2026-01-01"), leagueType: "standard" },
      [seat("a", 0, "won"), seat("b", 1, "lost")],
      [{ playerId: "a", mmr: 800, topMmr: 800 }],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(upserts).toHaveLength(0);
  });
});
