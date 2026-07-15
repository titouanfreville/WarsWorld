import { describe, expect, it } from "vitest";
import {
  ACTIVE_RANKS,
  BASE_MERIT,
  DIVISIONS_PER_RANK,
  LADDER_CEILING,
  MERIT_PER_DIVISION,
  ORDINAL_CEIL,
  anchorOrdinalOf,
  applyMerit,
  hasDivisions,
  ladderFromTotal,
  meritDelta,
  startingLadder,
  totalMeritOf,
  type Ladder,
} from "server/ranking/merit";

/**
 * Military Merit + the ladder — pure, no DB. This is the displayed half of ranked, so it's the half
 * players will argue about; every claim the plan's table makes is locked here.
 */

const at = (rank: Ladder["rank"], division: number, merit = 0): Ladder => ({
  rank,
  division,
  merit,
});

describe("ladder geometry", () => {
  it("round-trips a position through its linear Merit coordinate", () => {
    for (const ladder of [
      at("private", 5),
      at("private", 1, 99),
      at("lieutenant", 3, 50),
      at("captain", 1, 99),
    ]) {
      expect(ladderFromTotal(totalMeritOf(ladder))).toEqual(ladder);
    }
  });

  it("starts a fresh player in placements, below the ladder", () => {
    expect(startingLadder()).toEqual({ rank: "cadet", division: DIVISIONS_PER_RANK, merit: 0 });
    expect(totalMeritOf(startingLadder())).toBe(0);
  });

  it("counts divisions DOWN — V is the bottom, I the top of a rank", () => {
    expect(totalMeritOf(at("private", 5))).toBeLessThan(totalMeritOf(at("private", 1)));
  });

  it("promotes across a division at 100 Merit, and across a rank at the top of one", () => {
    expect(applyMerit(at("private", 5, 90), 20)).toEqual(at("private", 4, 10));
    // Private I + 100 -> the next active rank. Sergeant is dormant, so that's Lieutenant.
    expect(applyMerit(at("private", 1, 90), 20)).toEqual(at("lieutenant", 5, 10));
  });

  it("demotes back down, and floors at the bottom of the ladder", () => {
    expect(applyMerit(at("lieutenant", 5, 10), -20)).toEqual(at("private", 1, 90));
    expect(applyMerit(at("private", 5, 10), -50)).toEqual(at("private", 5, 0));
  });

  it("skips dormant ranks entirely — the ladder is ACTIVE_RANKS, not the whole enum", () => {
    const climbed = Array.from({ length: DIVISIONS_PER_RANK * 3 }, (_, i) => i).reduce(
      (ladder) => applyMerit(ladder, MERIT_PER_DIVISION),
      at("private", 5),
    );

    // Never lands on sergeant/major/colonel, which ship in the enum but aren't active.
    expect(ACTIVE_RANKS).not.toContain("sergeant");
    expect(["lieutenant", "captain", "marechal"]).toContain(climbed.rank);
  });

  it("makes marechal an apex: no divisions, unbounded Merit so the top still sorts", () => {
    expect(hasDivisions("marechal")).toBe(false);
    expect(hasDivisions("cadet")).toBe(false);
    expect(hasDivisions("captain")).toBe(true);

    const apex = ladderFromTotal(LADDER_CEILING() + 250);
    expect(apex.rank).toBe("marechal");
    expect(apex.merit).toBe(250);
    // Still climbing above the ceiling: two Marechals are comparable.
    expect(totalMeritOf(applyMerit(apex, 30))).toBeGreaterThan(totalMeritOf(apex));
  });
});

describe("anchorOrdinalOf", () => {
  /** The convergence term compares skill to rank, so both must be in ordinal units — not Merit. */
  it("projects a ladder position onto the ordinal scale, rising with rank", () => {
    expect(anchorOrdinalOf(at("private", 5))).toBe(0);
    expect(anchorOrdinalOf(ladderFromTotal(LADDER_CEILING()))).toBeCloseTo(ORDINAL_CEIL, 5);
    expect(anchorOrdinalOf(at("captain", 1))).toBeGreaterThan(anchorOrdinalOf(at("private", 1)));
  });
});

describe("meritDelta", () => {
  /** The headline promise: an even, converged game is a predictable ±20. */
  it("pays ±BASE_MERIT for an even match at a converged rank", () => {
    expect(meritDelta(0.5, 1, 0)).toBe(BASE_MERIT);
    expect(meritDelta(0.5, 0, 0)).toBe(-BASE_MERIT);
  });

  /** "Balanced by the expected result" — this IS Elo's (S − E), rescaled. */
  it("pays more for beating a favourite, and less for beating an underdog", () => {
    expect(meritDelta(0.2, 1, 0)).toBe(32);
    expect(meritDelta(0.85, 1, 0)).toBe(6);
  });

  it("punishes losing to an underdog, and forgives losing to a favourite", () => {
    expect(meritDelta(0.85, 0, 0)).toBe(-34);
    expect(meritDelta(0.2, 0, 0)).toBe(-8);
  });

  /** A win always pays and a loss always costs — never 0, however lopsided. */
  it("clamps so a win never yields nothing and a loss is never free", () => {
    expect(meritDelta(0.99, 1, 0)).toBeGreaterThanOrEqual(5);
    expect(meritDelta(0.01, 0, 0)).toBeLessThanOrEqual(-5);
    expect(meritDelta(0.01, 1, 30)).toBeLessThanOrEqual(40);
    expect(meritDelta(0.99, 0, -30)).toBeGreaterThanOrEqual(-40);
  });

  /** The LoL trick: rank chases skill, so a smurf climbs and an over-ranked player slides. */
  it("nudges an under-ranked player up faster and an over-ranked one down faster", () => {
    const underWin = meritDelta(0.5, 1, 30);
    const underLoss = meritDelta(0.5, 0, 30);
    expect(underWin).toBeGreaterThan(BASE_MERIT);
    expect(underLoss).toBeGreaterThan(-BASE_MERIT); // loses less

    const overWin = meritDelta(0.5, 1, -30);
    const overLoss = meritDelta(0.5, 0, -30);
    expect(overWin).toBeLessThan(BASE_MERIT); // gains less
    expect(overLoss).toBeLessThan(-BASE_MERIT); // loses more
  });

  it("treats a draw as its own thing, not a nudged win or loss", () => {
    expect(meritDelta(0.5, 0.5, 0)).toBe(0);
    // `expected` is THIS player's win probability. Holding a favourite (E=0.1) to a draw beat the
    // prediction, so it pays...
    expect(meritDelta(0.1, 0.5, 0)).toBeGreaterThan(0);
    // ...and being held to one as the favourite (E=0.9) did not, so it costs.
    expect(meritDelta(0.9, 0.5, 0)).toBeLessThan(0);
  });
});
