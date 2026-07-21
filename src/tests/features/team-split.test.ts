import { describe, expect, it } from "vitest";
import { assignSeats, splitUnfairness } from "server/matchmaking/team-split";
import { layoutForMode } from "server/matches/layout";
import type { Ticket } from "server/matchmaking/queue";

/**
 * Seating a formed group.
 *
 * Forming a fair GROUP and forming fair TEAMS are different problems: four evenly-rated players can
 * still be split 2v2 into a walkover by putting the two strongest together. The queue solves the
 * first, this solves the second.
 */
const ticket = (playerId: string, mu: number): Ticket => ({
  playerId,
  mode: "teams",
  ruleset: "standard",
  ranked: true,
  // Settled ratings (low sigma), so a mu gap means a genuinely decisive matchup rather than
  // uncertainty. `winProbability` accounts for both, which is why this has to be pinned.
  skill: { mu, sigma: 1.5 },
  rank: null,
  recentOpponents: {},
  enqueuedAt: 0,
});

const teamsOf = (seats: { playerId: string; team: number }[]) => {
  const byTeam = new Map<number, string[]>();

  for (const seat of seats) {
    byTeam.set(seat.team, [...(byTeam.get(seat.team) ?? []), seat.playerId].sort());
  }

  return [...byTeam.values()].map((ids) => ids.join("+")).sort();
};

describe("assignSeats — 2v2", () => {
  const layout = layoutForMode("teams");

  it("pairs strong with weak instead of taking the group in queue order", () => {
    // Queue order (A+B vs C+D) would put both 30s together and hand them the match.
    const { seats } = assignSeats(
      [ticket("A", 30), ticket("B", 29.5), ticket("C", 20.5), ticket("D", 20)],
      layout,
    );

    expect(teamsOf(seats)).toEqual(["A+D", "B+C"]);
  });

  it("fills two teams of two, with distinct seats", () => {
    const { seats } = assignSeats(
      [ticket("A", 25), ticket("B", 25), ticket("C", 25), ticket("D", 25)],
      layout,
    );

    expect(seats).toHaveLength(4);
    expect(seats.map((s) => `${s.team}:${s.slotWithinTeam}`).sort()).toEqual([
      "0:0",
      "0:1",
      "1:0",
      "1:1",
    ]);
  });

  it("reports the unfairness of the split it actually chose", () => {
    const balanced = assignSeats(
      [ticket("A", 30), ticket("B", 20), ticket("C", 30), ticket("D", 20)],
      layout,
    );

    // The best split here is a genuine coin flip, and that — not the raw spread of ratings in the
    // group — is what the ready-check advertises and what the lenient-decline threshold reads.
    expect(balanced.unfairness).toBeCloseTo(0, 2);
  });

  it("cannot escape a group that is lopsided however it is split", () => {
    // Three strong players and one weak one: every arrangement is unfair, and the number must say
    // so rather than being flattered by the choice of split.
    const { unfairness } = assignSeats(
      [ticket("A", 35), ticket("B", 35), ticket("C", 35), ticket("D", 15)],
      layout,
    );

    expect(unfairness).toBeGreaterThan(0.1);
  });
});

describe("assignSeats — one seat per team", () => {
  it("gives a free-for-all four separate teams", () => {
    const { seats } = assignSeats(
      [ticket("A", 25), ticket("B", 25), ticket("C", 25), ticket("D", 25)],
      layoutForMode("ffa"),
    );

    expect(seats.map((s) => s.team).sort()).toEqual([0, 1, 2, 3]);
    expect(seats.every((s) => s.slotWithinTeam === 0)).toBe(true);
  });

  it("reports a free-for-all's WIDEST pairing, since everyone plays everyone", () => {
    const { unfairness } = assignSeats(
      [ticket("A", 40), ticket("B", 25), ticket("C", 25), ticket("D", 25)],
      layoutForMode("ffa"),
    );

    expect(unfairness).toBeCloseTo(splitUnfairness([ticket("A", 40)], [ticket("B", 25)]), 5);
  });

  it("seats a duel one each — the previous behaviour, unchanged", () => {
    const { seats } = assignSeats([ticket("A", 25), ticket("B", 27)], layoutForMode("duel"));

    expect(seats).toEqual([
      { playerId: "A", team: 0, slotWithinTeam: 0 },
      { playerId: "B", team: 1, slotWithinTeam: 0 },
    ]);
  });
});
