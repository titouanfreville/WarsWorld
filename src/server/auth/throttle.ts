/**
 * Anti-spam policy for the sign-in / sign-up endpoints. Pure — no DB, no clock of its own — so the
 * numbers can be tested directly. `throttle.dbo.ts` persists the counters; `RateLimiter` below is
 * the in-memory burst guard that sits in front of them.
 */

/** Misses allowed before the backoff starts. Covers ordinary typos without punishing anyone. */
export const GRACE_ATTEMPTS = 5;

/** First lock once the grace is spent. Each further miss doubles it. */
const BASE_LOCK_MS = 1_000;

/** Ceiling on the wait — long enough to kill a guessing run, short enough to not brick an account. */
const MAX_LOCK_MS = 15 * 60 * 1_000;

/**
 * How long to lock out after `failures` consecutive misses: nothing for the first `GRACE_ATTEMPTS`,
 * then 1s, 2s, 4s, 8s… capped at 15 minutes.
 *
 * Exponential rather than a flat window because the two cases want opposite treatment. A human who
 * mistyped twice should notice no delay at all; a script working through a word list should be
 * spending minutes per guess by its twentieth. A fixed limit has to pick one of those to serve.
 */
export const lockMsForFailures = (failures: number): number => {
  if (failures <= GRACE_ATTEMPTS) {
    return 0;
  }

  const doublings = failures - GRACE_ATTEMPTS - 1;

  // Cap the exponent before computing the power: 2 ** 5000 is Infinity, and Infinity * base then
  // poisons the Date arithmetic downstream.
  if (doublings >= 32) {
    return MAX_LOCK_MS;
  }

  return Math.min(BASE_LOCK_MS * 2 ** doublings, MAX_LOCK_MS);
};

/** Seconds a caller must wait, rounded up — what we tell them in the error message. */
export const secondsUntil = (lockedUntil: Date, now: Date): number =>
  Math.max(0, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));

/** Whether a stored lock is still in force. A missing lock never blocks. */
export const isLocked = (lockedUntil: Date | null | undefined, now: Date): boolean =>
  lockedUntil != null && lockedUntil.getTime() > now.getTime();

/**
 * Fixed-window request counter, keyed by caller (IP). This is the cheap first line: it caps how
 * fast anyone can hit the endpoint at all, including with VALID credentials, which the per-account
 * backoff deliberately doesn't.
 *
 * In-memory is the right scope for it — we run one long-lived server process (see `.env.example`),
 * and a burst guard that forgets on restart is fine precisely because the DB-backed backoff is the
 * part that must remember.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Records a hit. `false` means the caller is over the limit and should be refused. */
  take(key: string, now: number): boolean {
    const window = this.hits.get(key);

    if (window === undefined || now >= window.resetAt) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });

      return true;
    }

    window.count += 1;

    return window.count <= this.limit;
  }

  /**
   * Drops windows that have expired. Called opportunistically on each `take` from the callers'
   * side so an attacker cycling keys can't grow the map without bound.
   */
  prune(now: number): void {
    for (const [key, window] of this.hits) {
      if (now >= window.resetAt) {
        this.hits.delete(key);
      }
    }
  }
}
