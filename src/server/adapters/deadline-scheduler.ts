import { logger } from "shared/utils/logger";

/**
 * An in-memory scheduler for server-authoritative deadlines.
 *
 * The DB column is always the source of truth (`Match.pickEndsAt`, `Match.turnEndsAt`,
 * `Lobby.readyEndsAt`/`mapPhaseEndsAt`); this only fires when one elapses, and every user rebuilds
 * its timers from those columns on boot so a restart never drops a deadline.
 *
 * Three call sites had grown byte-identical copies of this — same `Map<string, NodeJS.Timeout>`,
 * same cancel-first, same `Math.max(0, …)`, same try/catch/log, same `unref?.()` — differing only in
 * a log label. Two near-identical files can be argued for; three is duplication, and the repo ships
 * `npm run redundant-code` precisely to catch it.
 *
 * @param label prefix for log lines, e.g. `turn-timer`
 * @param subject what the key identifies, for log lines, e.g. `match`
 */
export const createDeadlineScheduler = (label: string, subject: string) => {
  const timers = new Map<string, NodeJS.Timeout>();

  const cancel = (key: string): void => {
    const existing = timers.get(key);

    if (existing !== undefined) {
      clearTimeout(existing);
      timers.delete(key);
    }
  };

  /**
   * @param retryMs when set, a handler that THROWS re-arms this far out instead of leaving the
   *   subject with no timer at all. The timer is deleted before the handler runs, so without a retry
   *   a transient failure (a dropped DB connection, a lost append race) silently costs the deadline
   *   forever: nothing armed, an elapsed timestamp still in the DB, and a phase that never advances.
   *   A restart doesn't recover it either — the reschedule fires, throws, and disarms again.
   */
  const schedule = (
    key: string,
    endsAt: Date,
    onExpire: (key: string) => void | Promise<void>,
    retryMs?: number,
  ): void => {
    cancel(key);

    // A deadline already in the past fires on the next tick — the restart case, where the time ran
    // out while the server was down. It must still fire, not be skipped.
    const delayMs = Math.max(0, endsAt.getTime() - Date.now());

    const timeout = setTimeout(() => {
      timers.delete(key);

      void (async () => {
        try {
          await onExpire(key);
        } catch (error) {
          logger.error(
            `[${label}] deadline handler for ${subject} ${key} threw` +
              (retryMs === undefined ? ":" : `; retrying in ${retryMs}ms:`),
            error instanceof Error ? error.message : error,
          );

          // Guarded so a deterministically-throwing handler backs off rather than hot-looping, and
          // so we never stomp a timer a successful retry path has since armed.
          if (retryMs !== undefined && !timers.has(key)) {
            schedule(key, new Date(Date.now() + retryMs), onExpire, retryMs);
          }
        }
      })();
    }, delayMs);

    // Don't keep the process alive solely for a deadline.
    timeout.unref?.();
    timers.set(key, timeout);
  };

  return { schedule, cancel };
};
