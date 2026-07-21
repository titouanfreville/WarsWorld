import type { Rank } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { REMATCH_BASE_GAP_SEC } from "server/matchmaking/constants";
import {
  MatchQueue,
  MAX_RANK_GAP,
  rematchOk,
  toleranceAt,
  unfairnessOf,
  type Ticket,
} from "server/matchmaking/queue";
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
  // Default: no settled rank, so the rank band doesn't apply and pairing rests on MMR alone. The
  // rank-band tests below opt in explicitly.
  rank: null,
  // Default: no recent opponents, so the rematch hold never fires. Opt in per-test.
  recentOpponents: {},
  enqueuedAt: NOW - waitedSec * 1000,
});

/** A ranked ticket that DOES carry a settled rank, for the rank-band tests. */
const ranked = (playerId: string, rank: Rank, waitedSec = 0, mu = 25): Ticket => ({
  ...ticket(playerId, settled(mu), waitedSec),
  rank,
});

describe("toleranceAt", () => {
  it("starts at the base and widens with wait", () => {
    expect(toleranceAt(ticket("a", defaultSkill(), 0), NOW)).toBeCloseTo(0.12, 5);
    expect(toleranceAt(ticket("a", defaultSkill(), 60), NOW)).toBeGreaterThan(0.12);
  });

  /** Exponential-in-time: the tolerance is a log of wait, so each equal wait buys less than the last. */
  it("widens with diminishing returns — leniency costs exponentially more time", () => {
    const at = (s: number) => toleranceAt(ticket("a", defaultSkill(), s), NOW);
    const firstStep = at(25) - at(0);
    const secondStep = at(50) - at(25);

    expect(secondStep).toBeLessThan(firstStep);
    expect(secondStep).toBeGreaterThan(0); // still climbing, just slower
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

/**
 * These cases are all about the PAIRING rules (tolerance, rank band, rematch, cooldown), which bind
 * identically however many seats a mode has. Formed at duel size and read back as `{a, b}` so each
 * one still says what it is testing rather than indexing into an array.
 */
const pairsOf = (q: MatchQueue, now: number) =>
  q.form(now, () => 2).map((group) => ({ a: group[0], b: group[1] }));

describe("MatchQueue pairing", () => {
  it("pairs the fairest compatible partner, oldest first", () => {
    const q = new MatchQueue();
    q.add(ticket("A", settled(25), 5)); // oldest
    q.add(ticket("B", settled(27), 1)); // further away
    q.add(ticket("C", settled(25.2), 1)); // nearly identical -> fairest

    const pairs = pairsOf(q, NOW);

    expect(pairs).toHaveLength(1);
    expect([pairs[0].a.playerId, pairs[0].b.playerId].sort()).toEqual(["A", "C"]);
    expect(q.size()).toBe(1); // B left waiting
    expect(q.has("B")).toBe(true);
  });

  it("does not pair across rulesets", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), ruleset: "standard" });
    q.add({ ...ticket("B", settled(25)), ruleset: "fog" });

    expect(pairsOf(q, NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("does not pair across modes", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), mode: "duel" });
    q.add({ ...ticket("B", settled(25)), mode: "ffa" });

    expect(pairsOf(q, NOW)).toHaveLength(0);
  });

  /** Ranked is a queue axis: a casual player must never be pulled into a game that moves a ladder. */
  it("does not pair ranked with casual", () => {
    const q = new MatchQueue();
    q.add({ ...ticket("A", settled(25)), ranked: true });
    q.add({ ...ticket("B", settled(25)), ranked: false });

    expect(pairsOf(q, NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("applies the min rule: a fresh newcomer won't be dragged past its own window", () => {
    const q = new MatchQueue();
    q.add(ticket("waiter", settled(25), 1000)); // huge tolerance from long wait
    q.add(ticket("fresh", settled(40), 0)); // tolerance only 0.12; this matchup is ~certain

    expect(pairsOf(q, NOW)).toHaveLength(0);

    // Once the newcomer has also waited long enough, min(tolerance) admits the gap.
    q.remove("fresh");
    q.add(ticket("fresh", settled(40), 1000));
    expect(pairsOf(q, NOW)).toHaveLength(1);
  });

  it("won't re-offer a pair on cooldown, then does once it expires", () => {
    const q = new MatchQueue();
    q.add(ticket("A", settled(25), 10));
    q.add(ticket("B", settled(25.2), 10));
    q.addCooldown("A", "B", NOW, 30_000);

    expect(pairsOf(q, NOW)).toHaveLength(0);
    expect(q.size()).toBe(2); // both still waiting

    expect(pairsOf(q, NOW + 31_000)).toHaveLength(1); // cooldown lapsed
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

/**
 * The rank band (ranked only). Both players carry a settled rank, MMR is held identical so the MMR
 * gate never interferes, and we watch the band: ±1 at first, widening on its own (slow) clock, hard-
 * capped. Active ranks in ladder order: cadet, private, lieutenant, captain, marechal.
 */
describe("rank band", () => {
  it("pairs neighbouring ranks immediately", () => {
    const q = new MatchQueue();
    q.add(ranked("A", "private"));
    q.add(ranked("B", "lieutenant")); // one step away

    expect(pairsOf(q, NOW)).toHaveLength(1);
  });

  it("won't pair two ranks apart at first — the band starts at ±1", () => {
    const q = new MatchQueue();
    q.add(ranked("A", "private"));
    q.add(ranked("B", "captain")); // two steps away

    expect(pairsOf(q, NOW)).toHaveLength(0);
    expect(q.size()).toBe(2);
  });

  it("pairs two ranks apart once the (slow) rank clock has widened", () => {
    const q = new MatchQueue();
    q.add(ranked("A", "private", 200)); // waited past the first rank-widen step
    q.add(ranked("B", "captain", 200));

    expect(pairsOf(q, NOW)).toHaveLength(1);
  });

  it("never pairs beyond the hard cap, however long the wait", () => {
    const q = new MatchQueue();
    // cadet ↔ marechal spans the whole ladder (4 steps), past MAX_RANK_GAP (3).
    q.add(ranked("A", "cadet", 100_000));
    q.add(ranked("B", "marechal", 100_000));

    expect(MAX_RANK_GAP).toBeLessThan(4);
    expect(pairsOf(q, NOW)).toHaveLength(0);
  });

  it("ignores the band when a side has no settled rank (placements / casual)", () => {
    const q = new MatchQueue();
    // A is placing (rank null); B is a marechal. The band can't apply, so MMR alone decides — and
    // MMR is identical, so they pair at once despite the rank chasm.
    q.add({ ...ranked("A", "marechal"), rank: null });
    q.add(ranked("B", "marechal"));

    expect(pairsOf(q, NOW)).toHaveLength(1);
  });
});

/**
 * Anti-rematch by recency. After finishing a game, two players are held apart, the hold relaxing as
 * they wait — so you meet old opponents first and only rematch a recent one when the pool leaves no
 * fresher choice. Never a permanent block.
 */
describe("rematchOk", () => {
  const played = (
    playerId: string,
    opponentId: string,
    finishedMs: number,
    waitedSec = 0,
  ): Ticket => ({
    ...ticket(playerId, settled(25), waitedSec),
    recentOpponents: { [opponentId]: finishedMs },
  });

  it("allows a pair with no shared recent game", () => {
    expect(rematchOk(ticket("A", settled(25)), ticket("B", settled(25)), NOW)).toBe(true);
  });

  it("holds off an opponent you just finished with, at zero wait", () => {
    const a = played("A", "B", NOW - 10_000); // finished 10s ago
    expect(rematchOk(a, ticket("B", settled(25)), NOW)).toBe(false);
  });

  it("allows an opponent you finished with longer ago than the base gap", () => {
    const a = played("A", "B", NOW - (REMATCH_BASE_GAP_SEC + 60) * 1000);
    expect(rematchOk(a, ticket("B", settled(25)), NOW)).toBe(true);
  });

  it("reads the history from either side (symmetric)", () => {
    const b = played("B", "A", NOW - 10_000); // B is the one carrying the record
    expect(rematchOk(ticket("A", settled(25)), b, NOW)).toBe(false);
  });

  it("relaxes with wait: requeue right after a game and the rematch frees up as you keep waiting", () => {
    // Model a requeue: they finished AND re-joined at the same moment, then time passes.
    const at = (waitedSec: number) => {
      const finished = NOW - waitedSec * 1000;
      const a = { ...played("A", "B", finished, waitedSec) };
      const b = { ...ticket("B", settled(25), waitedSec), recentOpponents: { A: finished } };
      return rematchOk(a, b, NOW);
    };

    expect(at(60)).toBe(false); // a minute after finishing — still held
    expect(at(300)).toBe(true); // five minutes on — freed up
  });

  it("keeps a just-finished pair apart in a live pairing pass, then lets them meet once they've waited", () => {
    const mk = (id: string, other: string, waitedSec: number): Ticket => {
      const finished = NOW - waitedSec * 1000;
      return { ...ticket(id, settled(25), waitedSec), recentOpponents: { [other]: finished } };
    };

    const fresh = new MatchQueue();
    fresh.add(mk("A", "B", 0));
    fresh.add(mk("B", "A", 0));
    expect(pairsOf(fresh, NOW)).toHaveLength(0); // just played → held apart

    const waited = new MatchQueue();
    waited.add(mk("A", "B", 600));
    waited.add(mk("B", "A", 600));
    expect(pairsOf(waited, NOW)).toHaveLength(1); // long wait → hold relaxed, they pair
  });
});

describe("MatchQueue group formation", () => {
  /** Four seats, as the 2v2 and free-for-all queues ask for. */
  const quadSize = () => 4;

  it("forms a group of four and clears them all from the queue", () => {
    const q = new MatchQueue();

    for (const id of ["A", "B", "C", "D"]) {
      q.add({ ...ticket(id, settled(25)), mode: "teams" });
    }

    const groups = q.form(NOW, quadSize);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(4);
    expect(q.size()).toBe(0);
  });

  it("forms NOTHING when it cannot fill the seats, leaving everyone queued", () => {
    // Three waiting for a four-seat mode is not a match, and a half-formed lobby would strand them.
    // They keep their place in line and their tolerance keeps widening.
    const q = new MatchQueue();

    for (const id of ["A", "B", "C"]) {
      q.add({ ...ticket(id, settled(25)), mode: "teams" });
    }

    expect(q.form(NOW, quadSize)).toHaveLength(0);
    expect(q.size()).toBe(3);
  });

  it("admits a candidate against EVERY member, not just the one who seeded the group", () => {
    // A and B are close. C is close to B but miles from A. Checking only against the seed would let
    // C in and hand A an opponent they were never willing to face.
    const q = new MatchQueue();

    q.add({ ...ticket("A", settled(25), 5), mode: "teams" });
    q.add({ ...ticket("B", settled(25.1)), mode: "teams" });
    q.add({ ...ticket("C", settled(45)), mode: "teams" });
    q.add({ ...ticket("D", settled(25.2)), mode: "teams" });

    const groups = q.form(NOW, quadSize);

    expect(groups).toHaveLength(0); // C can't join, so the fourth seat can't be filled
    expect(q.has("C")).toBe(true);
  });

  it("takes the surplus in wait order, leaving the newest behind", () => {
    const q = new MatchQueue();
    const ids = ["A", "B", "C", "D", "E"];

    ids.forEach((id, i) => {
      // A waited longest, E just arrived.
      q.add({ ...ticket(id, settled(25), (ids.length - i) * 10), mode: "teams" });
    });

    const groups = q.form(NOW, quadSize);

    expect(groups).toHaveLength(1);
    expect(q.size()).toBe(1);
    expect(q.has("E")).toBe(true);
  });

  it("still forms pairs for a two-seat mode", () => {
    const q = new MatchQueue();

    q.add(ticket("A", settled(25)));
    q.add(ticket("B", settled(25.1)));

    const groups = q.form(NOW, () => 2);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
  });
});
