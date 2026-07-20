import type { GameMode, Rank, Ruleset } from "@prisma/client";
import { ACTIVE_RANKS } from "server/ranking/merit";
import { winProbability, type Skill } from "server/ranking/skill";
import {
  BASE_TOLERANCE,
  MAX_RANK_GAP_FRACTION,
  MAX_TOLERANCE,
  RANK_GAP_TAU,
  REMATCH_BASE_GAP_SEC,
  REMATCH_COOLDOWN_MS,
  REMATCH_TAU,
  TOLERANCE_SCALE,
  TOLERANCE_TAU,
} from "./constants";

/**
 * One player waiting in the queue. `skill` is snapshotted at enqueue; `enqueuedAt` is ms epoch.
 *
 * A QUEUE is identified by mode × ruleset × ranked: you queue for Ranked Fog specifically, and
 * shouldn't be paired into a casual Standard game. The RATING is a different question — it pools by
 * mode alone, so `skill` here is the player's whole-mode rating regardless of which bucket they're
 * sitting in.
 *
 * `rank` is the player's ACTIVE military rank, and gates ranked pairing to a widening band around it
 * (see {@link allowedRankGapAt}). It is `null` for casual tickets and for ranked players still in
 * placements (no settled rank yet) — both of which pair on MMR alone, ignoring the band.
 */
export type Ticket = {
  playerId: string;
  mode: GameMode;
  ruleset: Ruleset;
  ranked: boolean;
  skill: Skill;
  rank: Rank | null;
  /**
   * Opponents this player recently FINISHED a game with, `opponentId → lastFinishedAt` (ms epoch).
   * Snapshotted at enqueue (same mode). Drives {@link rematchOk} — a recent opponent is held off, the
   * hold relaxing as the player waits. Empty for anyone with no recent games.
   */
  recentOpponents: Record<string, number>;
  enqueuedAt: number;
};

export type Pair = { a: Ticket; b: Ticket };

/** Hard ceiling on the rank gap: a fraction of the active-rank ladder height (see constants). */
export const MAX_RANK_GAP = Math.floor(MAX_RANK_GAP_FRACTION * ACTIVE_RANKS.length);

/**
 * How unfair a matchup this ticket will currently accept, as |P(win) − 0.5|. Widens exponentially in
 * time (`BASE + SCALE·ln(1 + t/τ)`), capped at {@link MAX_TOLERANCE}. MMR never gates — the cap is a
 * ceiling on the curve, not a wall.
 */
export const toleranceAt = (ticket: Ticket, now: number): number => {
  const waitedSec = Math.max(0, (now - ticket.enqueuedAt) / 1000);
  return Math.min(
    MAX_TOLERANCE,
    BASE_TOLERANCE + TOLERANCE_SCALE * Math.log1p(waitedSec / TOLERANCE_TAU),
  );
};

/**
 * How many rank steps away this ticket will currently accept. Starts at 1 (±1 rank) and widens on a
 * doubling-in-time schedule — gap g opens after `τ·(2^(g-1) − 1)` seconds, so ±2 at τ, ±3 at 3τ, …
 * — hard-capped at {@link MAX_RANK_GAP}. Deliberately slower than the MMR curve: ranks are visible.
 */
export const allowedRankGapAt = (ticket: Ticket, now: number): number => {
  const waitedSec = Math.max(0, (now - ticket.enqueuedAt) / 1000);
  const steps = Math.floor(Math.log2(waitedSec / RANK_GAP_TAU + 1));
  return Math.min(MAX_RANK_GAP, 1 + steps);
};

/** Distance between two active ranks, in ladder steps. Dormant ranks aren't in the ladder. */
const rankDistance = (a: Rank, b: Rank): number =>
  Math.abs(ACTIVE_RANKS.indexOf(a) - ACTIVE_RANKS.indexOf(b));

/**
 * Whether a pairing clears the rank band. Only binds when BOTH players have a settled rank (ranked,
 * out of placements) — a `null` on either side (casual, or a placing player with no rank yet) means
 * the band doesn't apply and the pairing rests on MMR alone. Both players must independently admit
 * the gap, so the tighter (younger) ticket's band governs.
 */
const withinRankBand = (a: Ticket, b: Ticket, now: number): boolean => {
  if (a.rank === null || b.rank === null) {
    return true;
  }

  const distance = rankDistance(a.rank, b.rank);
  return distance <= Math.min(allowedRankGapAt(a, now), allowedRankGapAt(b, now));
};

const waitedSecondsOf = (ticket: Ticket, now: number): number =>
  Math.max(0, (now - ticket.enqueuedAt) / 1000);

/**
 * Whether these two are far enough removed from their last game together to rematch. A recently-
 * finished opponent is held off; the required gap `BASE·e^(−wait/τ)` SHRINKS as the pair waits, so a
 * rematch is never blocked forever — you just meet old opponents first, recent ones only once the
 * pool leaves you no fresher option. The tighter (younger) ticket's wait governs (the `min` rule).
 * A pair with no shared recent game always clears.
 */
export const rematchOk = (a: Ticket, b: Ticket, now: number): boolean => {
  const lastPlayed = Math.max(
    a.recentOpponents[b.playerId] ?? 0,
    b.recentOpponents[a.playerId] ?? 0,
  );

  if (lastPlayed === 0) {
    return true;
  }

  const sinceSec = Math.max(0, (now - lastPlayed) / 1000);
  const waitSec = Math.min(waitedSecondsOf(a, now), waitedSecondsOf(b, now));
  const requiredGap = REMATCH_BASE_GAP_SEC * Math.exp(-waitSec / REMATCH_TAU);

  return sinceSec >= requiredGap;
};

/**
 * How unfair a pairing actually is: 0 = coin flip, 0.5 = certain. Uses `predictWin`, so it accounts
 * for BOTH players' uncertainty — the same μ gap is decisive between two settled players and a
 * coin-flip between two provisional ones, and no fixed rating distance can express that.
 */
export const unfairnessOf = (a: Ticket, b: Ticket): number =>
  Math.abs(winProbability([a.skill], [b.skill]) - 0.5);

/** Queues split three ways; ratings pool by mode alone. Don't conflate them. */
const bucketKey = (mode: GameMode, ruleset: Ruleset, ranked: boolean): string =>
  `${mode}:${ruleset}:${ranked ? "ranked" : "casual"}`;

/** Order-independent key for a pair of players (anti-rematch bookkeeping). */
const pairKey = (a: string, b: string): string => (a < b ? `${a}~${b}` : `${b}~${a}`);

/**
 * In-memory matchmaking queue: the authoritative store of who's waiting (a live WS subscription is
 * required to queue, so nothing meaningful survives a restart — hence no DB table). Pure logic, no
 * timers or I/O, so the pairing rules are exhaustively unit-testable.
 */
export class MatchQueue {
  private readonly tickets = new Map<string, Ticket>(); // playerId -> ticket
  private readonly cooldowns = new Map<string, number>(); // pairKey -> expiresAt (ms epoch)

  has(playerId: string): boolean {
    return this.tickets.has(playerId);
  }

  get(playerId: string): Ticket | undefined {
    return this.tickets.get(playerId);
  }

  size(): number {
    return this.tickets.size;
  }

  all(): Ticket[] {
    return [...this.tickets.values()];
  }

  /** Add (or replace) a ticket. Enqueue eligibility is enforced by the caller, not here. */
  add(ticket: Ticket): void {
    this.tickets.set(ticket.playerId, ticket);
  }

  remove(playerId: string): Ticket | undefined {
    const ticket = this.tickets.get(playerId);
    this.tickets.delete(playerId);
    return ticket;
  }

  /** Block a just-declined pair from being re-offered for a while. */
  addCooldown(playerA: string, playerB: string, now: number, ttlMs = REMATCH_COOLDOWN_MS): void {
    this.cooldowns.set(pairKey(playerA, playerB), now + ttlMs);
  }

  private onCooldown(playerA: string, playerB: string, now: number): boolean {
    const until = this.cooldowns.get(pairKey(playerA, playerB));
    return until !== undefined && until > now;
  }

  private pruneCooldowns(now: number): void {
    for (const [key, until] of this.cooldowns) {
      if (until <= now) {
        this.cooldowns.delete(key);
      }
    }
  }

  /**
   * One pairing pass. Within each (mode, ruleset, ranked) bucket, oldest ticket first, greedily
   * match it to the FAIREST partner that BOTH players' tolerances admit (the `min` rule) and that
   * isn't on rematch cooldown. Every returned pair's tickets are removed from the queue.
   */
  pair(now: number): Pair[] {
    this.pruneCooldowns(now);

    const buckets = new Map<string, Ticket[]>();

    for (const ticket of this.tickets.values()) {
      const key = bucketKey(ticket.mode, ticket.ruleset, ticket.ranked);
      (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(ticket);
    }

    const pairs: Pair[] = [];

    for (const bucket of buckets.values()) {
      const waiting = bucket.sort((x, y) => x.enqueuedAt - y.enqueuedAt);
      const matched = new Set<string>();

      for (const a of waiting) {
        if (matched.has(a.playerId)) {
          continue;
        }

        const tolA = toleranceAt(a, now);
        let best: Ticket | undefined;
        let bestUnfairness = Infinity;

        for (const b of waiting) {
          if (b.playerId === a.playerId || matched.has(b.playerId)) {
            continue;
          }

          const unfairness = unfairnessOf(a, b);

          // `min` rule: the matchup must fit inside BOTH players' current tolerance windows, AND
          // (ranked, both settled) inside the rank band, AND clear the recency hold on a rematch.
          // These are hard filters; among everyone left, the FAIREST by MMR still wins.
          if (
            unfairness <= Math.min(tolA, toleranceAt(b, now)) &&
            withinRankBand(a, b, now) &&
            rematchOk(a, b, now) &&
            unfairness < bestUnfairness &&
            !this.onCooldown(a.playerId, b.playerId, now)
          ) {
            best = b;
            bestUnfairness = unfairness;
          }
        }

        if (best !== undefined) {
          matched.add(a.playerId);
          matched.add(best.playerId);
          this.tickets.delete(a.playerId);
          this.tickets.delete(best.playerId);
          pairs.push({ a, b: best });
        }
      }
    }

    return pairs;
  }
}
