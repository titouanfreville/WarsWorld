/* eslint-disable @typescript-eslint/require-await -- in-memory fake db mirrors Prisma's async API */
import { describe, expect, it } from "vitest";
import { RankingUsecase } from "server/ranking/ranking.usecase";

/**
 * `setLadder` — the admin visible-rank override. Locks the two rules that aren't obvious: the two
 * rankless tiers normalise their division, and `peakRank` climbs but never drops on a demotion.
 */

type Written = {
  rankCode: string;
  division: number;
  merit: number;
  peakRankCode: string;
  placementsExempt: boolean;
};

type UpsertArg = {
  where: unknown;
  create: Written;
  update: Written;
};

/**
 * The seeded ladder, as `loadRanks` returns it. `setLadder` reads it to decide which ranks carry
 * divisions and how two ranks order — both are DATA here, not constants in the merit module.
 */
const LADDER = [
  { code: "cadet", order: 0, active: true, hasDivisions: false, populationShare: null },
  { code: "private", order: 1, active: true, hasDivisions: true, populationShare: 0.4 },
  { code: "lieutenant", order: 3, active: true, hasDivisions: true, populationShare: 0.75 },
  { code: "captain", order: 4, active: true, hasDivisions: true, populationShare: 0.95 },
  { code: "marechal", order: 7, active: true, hasDivisions: false, populationShare: 1 },
];

const makeUsecase = (existingPeak: string | null) => {
  let written: UpsertArg["create"] | null = null;

  const db = {
    rank: { findMany: async () => LADDER },
    playerRank: {
      findUnique: async () => (existingPeak === null ? null : { peakRankCode: existingPeak }),
      upsert: async (arg: UpsertArg) => {
        // Exercise the create path when there's no existing row, else the update path.
        written = existingPeak === null ? arg.create : arg.update;
        return written;
      },
    },
  };

  const usecase = new RankingUsecase(db as never);
  return { usecase, written: () => written };
};

describe("setLadder", () => {
  it("writes the chosen rank/division and resets merit to 0", async () => {
    const { usecase, written } = makeUsecase(null);

    await usecase.setLadder("p1", "duel", "captain", 3);

    expect(written()).toMatchObject({ rankCode: "captain", division: 3, merit: 0 });
  });

  it("marks the row placements-exempt so the rank shows before any games are played", async () => {
    const { usecase, written } = makeUsecase(null);

    await usecase.setLadder("p1", "duel", "captain", 3);

    expect(written()?.placementsExempt).toBe(true);
  });

  it("normalises division to the schema default for marechal (no divisions)", async () => {
    const { usecase, written } = makeUsecase(null);

    await usecase.setLadder("p1", "duel", "marechal", 2);

    expect(written()?.division).toBe(5);
  });

  it("raises peakRank when promoting", async () => {
    const { usecase, written } = makeUsecase("lieutenant");

    await usecase.setLadder("p1", "duel", "captain", 1);

    expect(written()?.peakRankCode).toBe("captain");
  });

  it("keeps the old peakRank when demoting — a demotion can't erase an earned peak", async () => {
    const { usecase, written } = makeUsecase("captain");

    await usecase.setLadder("p1", "duel", "private", 5);

    expect(written()?.peakRankCode).toBe("captain");
  });
});
