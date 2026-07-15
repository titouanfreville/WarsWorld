import { describe, expect, it } from "vitest";
import { MatchQueue, toleranceAt, unfairnessOf, type Ticket } from "server/matchmaking/queue";
import { defaultSkill } from "server/ranking/skill";

/**
 * Pure matchmaking queue: tolerance-over-time, the `min`-rule pairing, buckets, fairest-partner
 * selection, and the anti-rematch cooldown. No timers or DB.
 *
 * Fairness is |P(win) − 0.5|, not a rating gap — see the note in `constants.ts`: no fixed rating
 * distance means "fair", because the same gap is decisive between two settled players and a coin
 * flip between two provisional ones. So these tests move `mu` and let `predictWin` decide.
 */

const NOW = 1_000_000;

/** A settled rating at `mu` — small sigma, so a mu gap translates to a decisive win probability. */
const settled = (mu: number) => ({ mu, sigma: 1.5 });

const ticket = (playerId: string, skill: { mu: number; sigma: number }, waitedSec = 0): Ticket => ({
  playerId,
  skill,
  ruleset: "standard",
  mode: "duel",
  ranked: true,
  enqueuedAt: NOW - waitedSec * 1000,
});

describe("toleranceAt", () => {
  it("starts at the base and widens with wait", () => {
    expect(toleranceAt(ticket("a", defaultSkill(), 0), NOW)).toBeCloseTo(0.12, 5);
    expect(toleranceAt(ticket("a", defaultSkill(), 10), NOW)).toBeCloseTo(0.24, 5); // .12 + .012*10
  });

  /** 0.5 is the maximum possible unfairness, so this is what makes "eventually pairs with anyone" true. */
  it("caps at MAX_TOLERANCE, which admits even a near-certain matchup", () => {
    expect(toleranceAt(ticket("a", defaultSkill(), 100_000), NOW)).toBe(0.5);
    expect(unfairnessOf(ticket("a", settled(25)), ticket("b", settled(60)))).toBeLessThanOrEqual(
      0.5,
    );
  });
});

describe("unfairnessOf", () => {
  it("is ~0 for identical skills and grows with the gap", () => {
    expect(unfairnessOf(ticket("a", settled(25)), ticket("b", settled(25)))).toBeCloseTo(0, 5);
    expect(unfairnessOf(ticket("a", settled(35)), ticket("b", settled(25)))).toBeGreaterThan(0.3);
  });

  /** The whole reason the gate isn't |Δμ|: uncertainty, not just distance, decides fairness. */
  it("reads sigma, not just the mu gap — the same gap is fairer between provisional players", () => {
    const gapSettled = unfairnessOf(ticket("a", settled(31)), ticket("b", settled(25)));
    const gapFresh = unfairnessOf(
      ticket("a", { mu: 31, sigma: 8.333 }),
      ticket("b", { mu: 25, sigma: 8.333 }),
    );

    expect(gapSettled).toBeGreaterThan(gapFresh);
  });
});

describe("MatchQueue pairing", () => {
  it("pairs the fairest compatible partner, oldest first", () => {
    const q = new MatchQueue();
    q.add(ticket("A", settled(25), 5)); // oldest
    q.add(ticket("B", settled(27), 1)); // further away
    q.add(ticket("C", settled(25.2), 1)); // nearly identical -> fairest

    const pairs = q.pair(NOW);

    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.playerId, pairs[0].b.playerId].sort()).toEqual(["A", "C"]);
    expect(q.size()).toBe(1); // B left waiting
    expect(q.has("B")).toBe(true);
  });

  it("does not pair across rulesets", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), ruleset: "standard" });
    q.add({ ...ticket("B", settled(25)), ruleset: "fog" });

    expect(q.pair(NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("does not pair across modes", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), mode: "duel" });
    q.add({ ...ticket("B", settled(25)), mode: "ffa" });

    expect(q.pair(NOW)).toHaveLength(0);
  });

  /** Ranked is a queue axis: a casual player must never be pulled into a game that moves a ladder. */
  it("does not pair ranked with casual", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), ranked: true });
    q.add({ ...ticket("B", settled(25)), ranked: false });

    expect(q.pair(NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("applies the min rule: a fresh newcomer won't be dragged past its own window", () => {
    const q = new MatchQueue();
    q.add(ticket("waiter", settled(25), 1000)); // huge tolerance from long wait
    q.add(ticket("fresh", settled(40), 0)); // tolerance only 0.12; this matchup is ~certain

    expect(q.pair(NOW)).toHaveLength(0);

    // Once the newcomer has also waited long enough, min(tolerance) admits the gap.
    q.remove("fresh");
    q.add(ticket("fresh", settled(40), 1000));
    expect(q.pair(NOW)).toHaveLength(1);
  });

  it("won't re-offer a pair on cooldown, then does once it expires", () => {
    const q = new MatchQueue();
    q.add(ticket("A", settled(25), 10));
    q.add(ticket("B", settled(25.2), 10));
    q.addCooldown("A", "B", NOW, 30_000);

    expect(q.pair(NOW)).toHaveLength(0);
    expect(q.size()).toBe(2); // both still waiting

    expect(q.pair(NOW + 31_000)).toHaveLength(1); // cooldown lapsed
  });

  it("remove returns the ticket with its original enqueuedAt (requeue keeps the wait)", () => {
    const q = new MatchQueue();
    const t = ticket("A", settled(25), 42);
    q.add(t);

    const removed = q.remove("A");
    expect(removed?.enqueuedAt).toBe(NOW - 42_000);
    expect(q.has("A")).toBe(false);
  });
});
