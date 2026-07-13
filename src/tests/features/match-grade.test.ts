import { describe, expect, it } from "vitest";
import { computeGrades } from "server/routers/match/match-grade";
import type { MatchStats, PlayerMatchStats } from "server/routers/match/match-stats";

/** A zeroed player-stats row with the fields a test cares about overridden. */
const player = (playerId: string, over: Partial<PlayerMatchStats>): PlayerMatchStats => ({
  playerId,
  built: 0,
  builtByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
  lostByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
  builtByUnit: {},
  lostByUnit: {},
  damageByUnit: {},
  producedFunds: 0,
  incomeEarned: 0,
  powersUsed: 0,
  crashed: 0,
  healedByProperty: 0,
  healedByPower: 0,
  damageDealt: 0,
  damageTaken: 0,
  damageDirect: 0,
  damageIndirect: 0,
  damageByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
  unitsKilled: 0,
  unitsLost: 0,
  captures: 0,
  ...over,
});

const timelineRow = (turn: number) => ({
  turn,
  perPlayer: [
    { playerId: "win", funds: 500, armyValue: 0, properties: 0, income: 5000 },
    { playerId: "lose", funds: 2000, armyValue: 0, properties: 0, income: 3000 },
  ],
});

describe("computeGrades", () => {
  it("grades a dominant player far above the player they beat, relative to the field", () => {
    const stats: MatchStats = {
      turns: 6,
      days: 3,
      players: [
        player("win", { damageDealt: 3400, damageTaken: 900, captures: 6 }),
        player("lose", { damageDealt: 900, damageTaken: 3400, captures: 2 }),
      ],
      timeline: [timelineRow(1), timelineRow(2), timelineRow(3)],
      captureLog: [],
    };

    const grades = computeGrades(stats);
    const win = grades.find((g) => g.playerId === "win")!;
    const lose = grades.find((g) => g.playerId === "lose")!;

    expect(["A", "S"]).toContain(win.overall);
    expect(lose.overall).toBe("C");
    expect(win.tactics.score).toBeGreaterThan(lose.tactics.score);
    expect(win.strength.score).toBeGreaterThan(lose.strength.score);
    expect(win.economy.score).toBeGreaterThan(lose.economy.score);
  });

  it("gives a neutral (B) tactics grade when a player saw no combat", () => {
    const stats: MatchStats = {
      turns: 2,
      days: 1,
      players: [player("a", {}), player("b", {})],
      timeline: [timelineRow(1)].map((r) => ({
        ...r,
        perPlayer: [
          { playerId: "a", funds: 0, armyValue: 0, properties: 0, income: 1000 },
          { playerId: "b", funds: 0, armyValue: 0, properties: 0, income: 1000 },
        ],
      })),
      captureLog: [],
    };

    const grades = computeGrades(stats);

    // No damage dealt or taken by anyone → trade score is the neutral midpoint.
    expect(grades.every((g) => g.tactics.letter === "B")).toBe(true);
  });
});
