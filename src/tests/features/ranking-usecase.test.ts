/* eslint-disable @typescript-eslint/require-await -- the in-memory fake tx mirrors Prisma's async API */
import { describe, expect, it } from "vitest";
import { RankingUsecase } from "server/ranking/ranking.usecase";
import { defaultSkill } from "server/ranking/skill";

/**
 * `applyMatchResult` against a hand-rolled fake transaction client — no DB. What's locked here is
 * OUR wiring, not OpenSkill's arithmetic (that's the library's job, and `skill.test.ts` covers our
 * use of it): that a ranked duel moves both sides, that the two no-op guards keep finalize
 * idempotent, and — the load-bearing one — that skill and Merit hang off `mode` alone.
 */

type MatchRow = { isRanked: boolean; ratedAt: Date | null; mode: string };
type SeatRow = { playerId: string; team: number; result: string | null };
type SkillRow = { playerId: string; mu: number; sigma: number };
type RankRow = { playerId: string; rank: string; division: number; merit: number };

const makeTx = (
  match: MatchRow,
  seats: SeatRow[],
  skills: SkillRow[] = [],
  ranks: RankRow[] = [],
) => {
  const skillWrites: { playerId: string; mode: string; mu: number; sigma: number }[] = [];
  const rankWrites: { playerId: string; mode: string; rank: string; merit: number }[] = [];
  const meritEvents: { playerId: string; delta: number }[] = [];
  const lookups: { mode?: string }[] = [];
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
    matchPlayer: { findMany: async () => seats },
    playerSkill: {
      findMany: async ({ where }: { where: { mode?: string } }) => {
        lookups.push(where);
        return skills;
      },
      upsert: async ({ create }: { create: (typeof skillWrites)[number] }) => {
        skillWrites.push(create);
      },
    },
    playerRank: {
      findMany: async () => ranks,
      upsert: async ({ create }: { create: (typeof rankWrites)[number] }) => {
        rankWrites.push(create);
      },
    },
    meritEvent: {
      upsert: async ({ create }: { create: (typeof meritEvents)[number] }) => {
        meritEvents.push(create);
      },
    },
  };

  return { tx, skillWrites, rankWrites, meritEvents, lookups, ratedAt: () => ratedAtWritten };
};

const seat = (playerId: string, team: number, result: string | null): SeatRow => ({
  playerId,
  team,
  result,
});

// The usecase reads everything through the passed `tx`, so the constructor's client is unused here.
const usecase = new RankingUsecase({} as never);

describe("ranking usecase — applyMatchResult", () => {
  it("moves both players' hidden skill on an even ranked 1v1", async () => {
    const { tx, skillWrites, ratedAt } = makeTx({ isRanked: true, ratedAt: null, mode: "duel" }, [
      seat("winner", 0, "won"),
      seat("loser", 1, "lost"),
    ]);

    await usecase.applyMatchResult(tx as never, "m1");

    const winner = skillWrites.find((w) => w.playerId === "winner")!;
    const loser = skillWrites.find((w) => w.playerId === "loser")!;

    expect(winner.mu).toBeGreaterThan(defaultSkill().mu);
    expect(loser.mu).toBeLessThan(defaultSkill().mu);
    // Both learned something, whoever won.
    expect(winner.sigma).toBeLessThan(defaultSkill().sigma);
    expect(ratedAt()).toBeInstanceOf(Date);
  });

  it("awards the winner Merit and takes it from the loser", async () => {
    const { tx, rankWrites, meritEvents } = makeTx(
      { isRanked: true, ratedAt: null, mode: "duel" },
      [seat("winner", 0, "won"), seat("loser", 1, "lost")],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(meritEvents.find((e) => e.playerId === "winner")!.delta).toBeGreaterThan(0);
    expect(meritEvents.find((e) => e.playerId === "loser")!.delta).toBeLessThan(0);
    // A fresh winner climbs onto the bottom of the ladder rather than staying at cadet.
    expect(rankWrites.find((w) => w.playerId === "winner")!.rank).toBe("private");
  });

  /**
   * The load-bearing key. If a `ruleset` ever creeps in here, ratings silently shard per-ruleset and
   * every player's number resets — see plan §1.3.
   */
  it("keys skill by MODE, not by ruleset — fog and standard duels share one rating", async () => {
    const { tx, skillWrites, lookups } = makeTx({ isRanked: true, ratedAt: null, mode: "duel" }, [
      seat("winner", 0, "won"),
      seat("loser", 1, "lost"),
    ]);

    await usecase.applyMatchResult(tx as never, "m1");

    expect(lookups[0]).toEqual({ mode: "duel", playerId: { in: ["winner", "loser"] } });
    expect(skillWrites.every((w) => w.mode === "duel")).toBe(true);
  });

  it("no-ops for an unranked match", async () => {
    const { tx, skillWrites, meritEvents, ratedAt } = makeTx(
      { isRanked: false, ratedAt: null, mode: "duel" },
      [seat("a", 0, "won"), seat("b", 1, "lost")],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(skillWrites).toHaveLength(0);
    expect(meritEvents).toHaveLength(0);
    expect(ratedAt()).toBeNull();
  });

  /** Finalize is reachable more than once — on the deciding action AND on rebuild. */
  it("no-ops for an already-rated match", async () => {
    const { tx, skillWrites } = makeTx(
      { isRanked: true, ratedAt: new Date("2026-01-01"), mode: "duel" },
      [seat("a", 0, "won"), seat("b", 1, "lost")],
    );

    await usecase.applyMatchResult(tx as never, "m1");

    expect(skillWrites).toHaveLength(0);
  });

  it("skips a match with fewer than two sides, but still marks it rated", async () => {
    const { tx, skillWrites, ratedAt } = makeTx({ isRanked: true, ratedAt: null, mode: "duel" }, [
      seat("a", 0, "won"),
    ]);

    await usecase.applyMatchResult(tx as never, "m1");

    expect(skillWrites).toHaveLength(0);
    expect(ratedAt()).toBeInstanceOf(Date);
  });
});

/**
 * `matchOutcome` is the End-Game screen's read of the viewer's Merit swing. It reads through the
 * constructor client (not a tx), so it gets its own fake `db`. What's locked: casual games return
 * null (no MeritEvent), a rated game returns its delta + resulting rank, and placements withhold the
 * rank the same way the ladder does everywhere else.
 */
type OutcomeDb = {
  event: { delta: number; rankAfter: string; divisionAfter: number } | null;
  match: { mode: string } | null;
  skill: { mu: number; sigma: number; games: number } | null;
  rank?: { placementsExempt: boolean } | null;
};

const makeOutcomeUsecase = (data: OutcomeDb) =>
  new RankingUsecase({
    meritEvent: { findUnique: async () => data.event },
    match: { findUnique: async () => data.match },
    playerSkill: { findUnique: async () => data.skill },
    playerRank: { findUnique: async () => data.rank ?? null },
  } as never);

describe("ranking usecase — matchOutcome", () => {
  it("returns null for a casual match (no MeritEvent was written)", async () => {
    const uc = makeOutcomeUsecase({ event: null, match: { mode: "duel" }, skill: null });

    expect(await uc.matchOutcome("p1", "m1")).toBeNull();
  });

  it("returns the Merit delta and resulting rank once the player is out of placements", async () => {
    const uc = makeOutcomeUsecase({
      event: { delta: 18, rankAfter: "lieutenant", divisionAfter: 2 },
      match: { mode: "duel" },
      // Low sigma → settled → not in placements.
      skill: { mu: 27, sigma: 5, games: 25 },
    });

    const outcome = await uc.matchOutcome("p1", "m1");

    expect(outcome).toEqual({
      delta: 18,
      rank: "lieutenant",
      division: 2,
      games: 25,
      inPlacements: false,
    });
  });

  it("still reports inPlacements while the rating is unsettled — the caller withholds the rank", async () => {
    const uc = makeOutcomeUsecase({
      event: { delta: 20, rankAfter: "private", divisionAfter: 5 },
      match: { mode: "duel" },
      // Default-ish high sigma → still placing.
      skill: { mu: 25, sigma: 8.333, games: 3 },
    });

    const outcome = await uc.matchOutcome("p1", "m1");

    expect(outcome?.inPlacements).toBe(true);
  });

  it("shows the rank (not placements) when the row is admin placements-exempt, unsettled skill aside", async () => {
    const uc = makeOutcomeUsecase({
      event: { delta: 20, rankAfter: "captain", divisionAfter: 3 },
      match: { mode: "duel" },
      // Still high sigma, but the admin override marks the rank authoritative.
      skill: { mu: 25, sigma: 8.333, games: 0 },
      rank: { placementsExempt: true },
    });

    const outcome = await uc.matchOutcome("p1", "m1");

    expect(outcome?.inPlacements).toBe(false);
  });
});

/**
 * `rankFor` bands ranked matchmaking. It returns the settled rank, or null whenever the band mustn't
 * apply — a placing player (high sigma) or one with no rating row at all. Same fake-db shape.
 */
const makeRankForUsecase = (data: {
  rank: { rank: string; placementsExempt?: boolean } | null;
  skill: { mu: number; sigma: number; games: number } | null;
}) =>
  new RankingUsecase({
    playerRank: { findUnique: async () => data.rank },
    playerSkill: { findUnique: async () => data.skill },
  } as never);

describe("ranking usecase — rankFor", () => {
  it("returns the settled rank once out of placements", async () => {
    const uc = makeRankForUsecase({
      rank: { rank: "lieutenant" },
      skill: { mu: 27, sigma: 5, games: 25 }, // low sigma → settled
    });

    expect(await uc.rankFor("p1", "duel")).toBe("lieutenant");
  });

  it("returns null while still placing — no band applies", async () => {
    const uc = makeRankForUsecase({
      rank: { rank: "private" },
      skill: { mu: 25, sigma: 8.333, games: 2 }, // high sigma → placing
    });

    expect(await uc.rankFor("p1", "duel")).toBeNull();
  });

  it("returns null when the player has no rating yet", async () => {
    const uc = makeRankForUsecase({ rank: null, skill: null });

    expect(await uc.rankFor("p1", "duel")).toBeNull();
  });

  it("bands an admin placements-exempt rank even with no settled skill", async () => {
    const uc = makeRankForUsecase({
      rank: { rank: "captain", placementsExempt: true },
      skill: null, // no rating row at all — the override still bands
    });

    expect(await uc.rankFor("p1", "duel")).toBe("captain");
  });
});
