import { describe, expect, it } from "vitest";
import { MatchQueue, toleranceAt, type Ticket } from "server/matchmaking/queue";

/**
 * Pure matchmaking queue: tolerance-over-time, the `min`-rule pairing, buckets, closest-partner
 * selection, and the anti-rematch cooldown. No timers or DB.
 */

const NOW = 1_000_000;
const ticket = (playerId: string, mmr: number, waitedSec = 0): Ticket => ({
  playerId,
  mmr,
  ruleset: "standard",
  mode: "duel",
  enqueuedAt: NOW - waitedSec * 1000,
});

describe("toleranceAt", () => {
  it("starts at the base and widens with wait", () => {
    expect(toleranceAt(ticket("a", 1000, 0), NOW)).toBe(100);
    expect(toleranceAt(ticket("a", 1000, 10), NOW)).toBe(250); // 100 + 15*10
  });

  it("caps at MAX_TOLERANCE", () => {
    expect(toleranceAt(ticket("a", 1000, 100_000), NOW)).toBe(2000);
  });
});

describe("MatchQueue pairing", () => {
  it("pairs the closest-MMR compatible partner, oldest first", () => {
    const q = new MatchQueue();
    q.add(ticket("A", 1000, 5)); // oldest
    q.add(ticket("B", 1050, 1));
    q.add(ticket("C", 1010, 1));

    const pairs = q.pair(NOW);

    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.playerId, pairs[0].b.playerId].sort()).toEqual(["A", "C"]);
    expect(q.size()).toBe(1); // B left waiting
    expect(q.has("B")).toBe(true);
  });

  it("does not pair across rulesets or modes", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", 1000), ruleset: "standard" });
    q.add({ ...ticket("B", 1000), ruleset: "fog" });

    expect(q.pair(NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("applies the min rule: a fresh newcomer won't be dragged past its own window", () => {
    const q = new MatchQueue();
    q.add(ticket("waiter", 1000, 1000)); // huge tolerance from long wait
    q.add(ticket("fresh", 1600, 0)); // tolerance only 100; gap is 600

    expect(q.pair(NOW)).toHaveLength(0);

    // Once the newcomer has also waited long enough, min(tolerance) admits the gap.
    q.remove("fresh");
    q.add(ticket("fresh", 1600, 1000));
    expect(q.pair(NOW)).toHaveLength(1);
  });

  it("won't re-offer a pair on cooldown, then does once it expires", () => {
    const q = new MatchQueue();
    q.add(ticket("A", 1000, 10));
    q.add(ticket("B", 1010, 10));
    q.addCooldown("A", "B", NOW, 30_000);

    expect(q.pair(NOW)).toHaveLength(0);
    expect(q.size()).toBe(2); // both still waiting

    expect(q.pair(NOW + 31_000)).toHaveLength(1); // cooldown lapsed
  });

  it("remove returns the ticket with its original enqueuedAt (requeue keeps the wait)", () => {
    const q = new MatchQueue();
    const t = ticket("A", 1000, 42);
    q.add(t);

    const removed = q.remove("A");
    expect(removed?.enqueuedAt).toBe(NOW - 42_000);
    expect(q.has("A")).toBe(false);
  });
});
