import type { GameMode, Ruleset } from "@prisma/client";
import { BASE_TOLERANCE, MAX_TOLERANCE, REMATCH_COOLDOWN_MS, TOLERANCE_RATE } from "./constants";

/**
 * One player waiting in the queue. `mmr` is snapshotted at enqueue; `enqueuedAt` is ms epoch.
 *
 * A QUEUE is identified by mode × ruleset (× ranked, once join carries that axis — plan phase 7):
 * you queue for Fog specifically, and shouldn't be paired into a Standard game. The RATING is a
 * different question — it pools by mode alone, so `mmr` here is the player's whole-mode rating
 * regardless of which ruleset's bucket they're sitting in.
 */
export type Ticket = {
  playerId: string;
  mode: GameMode;
  ruleset: Ruleset;
  mmr: number;
  enqueuedAt: number;
};

export type Pair = { a: Ticket; b: Ticket };

/** Acceptable |ΔMMR| for a ticket right now: widens with wait, capped at {@link MAX_TOLERANCE}. */
export const toleranceAt = (ticket: Ticket, now: number): number => {
  const waitedSec = Math.max(0, (now - ticket.enqueuedAt) / 1000);
  return Math.min(MAX_TOLERANCE, BASE_TOLERANCE + TOLERANCE_RATE * waitedSec);
};

const bucketKey = (mode: GameMode, ruleset: Ruleset): string => `${mode}:${ruleset}`;

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
   * One pairing pass. Within each (mode, ruleset) bucket, oldest ticket first, greedily match it to
   * the closest-MMR partner that BOTH players' tolerances admit (the `min` rule) and that isn't on
   * rematch cooldown. Every returned pair's tickets are removed from the queue.
   */
  pair(now: number): Pair[] {
    this.pruneCooldowns(now);

    const buckets = new Map<string, Ticket[]>();

    for (const ticket of this.tickets.values()) {
      const key = bucketKey(ticket.mode, ticket.ruleset);
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
        let bestDiff = Infinity;

        for (const b of waiting) {
          if (b.playerId === a.playerId || matched.has(b.playerId)) {
            continue;
          }

          const diff = Math.abs(a.mmr - b.mmr);

          // `min` rule: the gap must fit inside BOTH players' current tolerance windows.
          if (
            diff <= Math.min(tolA, toleranceAt(b, now)) &&
            diff < bestDiff &&
            !this.onCooldown(a.playerId, b.playerId, now)
          ) {
            best = b;
            bestDiff = diff;
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
