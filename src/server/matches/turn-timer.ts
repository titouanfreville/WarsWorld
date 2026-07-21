import { createDeadlineScheduler } from "server/adapters/deadline-scheduler";

/**
 * Server-authoritative turn deadlines. `Match.turnEndsAt` is the source of truth; this is only the
 * in-memory scheduler that fires when it elapses. Deadlines are rebuilt from the DB on boot (see
 * MatchActionUsecase.rescheduleTurnDeadlines), so a restart never drops one and never silently gifts
 * the acting player a fresh clock.
 */
const scheduler = createDeadlineScheduler("turn-timer", "match");

/**
 * The shortest turn the clock will ever arm. A deadline of `now` fires on the next tick, ends the
 * turn, and re-arms at `now` again — a match that plays itself out in a tight loop.
 * `matchRulesSchema` forbids the zero increment that produces it; this is the backstop for rules
 * blobs written before that floor existed.
 */
export const MIN_TURN_MS = 10_000;

/**
 * Spread of the jitter added when re-arming already-expired deadlines on boot. Without it, a restart
 * after downtime fires every stale deadline on the same tick — N concurrent force-end transactions
 * in one go. They still all fire promptly; they just don't stampede.
 */
export const BOOT_STAGGER_MS = 5_000;

/**
 * Backoff before retrying a deadline whose handler threw. Losing the clock outright is far worse
 * than firing it a few seconds late: an unarmed match sits at 0:00 on both clients with a turn that
 * never ends.
 */
export const RETRY_MS = 15_000;

export const scheduleTurnDeadline = (
  matchId: string,
  endsAt: Date,
  onExpire: (matchId: string) => void | Promise<void>,
): void => scheduler.schedule(matchId, endsAt, onExpire, RETRY_MS);

export const cancelTurnDeadline = (matchId: string): void => scheduler.cancel(matchId);
