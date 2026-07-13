import { describe, expect, it } from "vitest";
import { DEFAULT_MMR, ELO_K, expectedScore, nextRating, scoreForResult } from "server/ranking/elo";

/**
 * Pure Elo math backing ranked MMR. Locks the properties the matchmaker and finalize rely on:
 * symmetry, zero-sum for 1v1, and the result→score mapping.
 */
describe("elo", () => {
  it("expects a coin-flip between equal ratings", () => {
    expect(expectedScore(1200, 1200)).toBeCloseTo(0.5, 6);
  });

  it("expected scores of the two sides sum to 1", () => {
    expect(expectedScore(1500, 1100) + expectedScore(1100, 1500)).toBeCloseTo(1, 6);
  });

  it("favours the higher-rated player (~0.91 at +400)", () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.909, 3);
  });

  it("is zero-sum for a 1v1: winner's gain equals loser's loss", () => {
    const a = 1200;
    const b = 1200;
    const winnerDelta = nextRating(a, b, 1) - a;
    const loserDelta = nextRating(b, a, 0) - b;

    expect(winnerDelta).toBe(ELO_K / 2); // even game, K=32 → +16
    expect(winnerDelta).toBe(-loserDelta);
  });

  it("moves an equal-rated draw by nothing", () => {
    expect(nextRating(1000, 1000, 0.5)).toBe(1000);
  });

  it("rewards an underdog upset more than a favourite's expected win", () => {
    const underdogGain = nextRating(1000, 1600, 1) - 1000;
    const favouriteGain = nextRating(1600, 1000, 1) - 1600;

    expect(underdogGain).toBeGreaterThan(favouriteGain);
    expect(underdogGain).toBe(31); // round(32 * (1 - expected(1000,1600))), expected ≈ 0.031
  });

  it("maps stored results to scores (loss is the default)", () => {
    expect(scoreForResult("won")).toBe(1);
    expect(scoreForResult("drawn")).toBe(0.5);
    expect(scoreForResult("lost")).toBe(0);
    expect(scoreForResult(null)).toBe(0);
  });

  it("seeds new players at the Prisma default", () => {
    expect(DEFAULT_MMR).toBe(800);
  });
});
