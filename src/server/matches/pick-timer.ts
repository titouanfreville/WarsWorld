import { logger } from "shared/utils/logger";

/**
 * Server-authoritative general-picker deadlines. `Match.pickEndsAt` is the source of truth; this is
 * just the in-memory scheduler that fires when it elapses. Timers are rebuilt from `pickEndsAt` on
 * boot (see MatchesUsecase.reschedulePickDeadlines), so a restart never drops a deadline.
 */
const timers = new Map<string, NodeJS.Timeout>();

export const schedulePickDeadline = (
  matchId: string,
  endsAt: Date,
  onExpire: (matchId: string) => void | Promise<void>,
): void => {
  cancelPickDeadline(matchId);

  // A deadline already in the past fires on the next tick (e.g. a match whose timer elapsed while
  // the server was down) rather than being skipped.
  const delayMs = Math.max(0, endsAt.getTime() - Date.now());

  const timeout = setTimeout(() => {
    timers.delete(matchId);

    void (async () => {
      try {
        await onExpire(matchId);
      } catch (error) {
        logger.error(
          `[pick-timer] deadline handler for match ${matchId} threw:`,
          error instanceof Error ? error.message : error,
        );
      }
    })();
  }, delayMs);

  // Don't keep the process alive solely for a pick deadline.
  timeout.unref?.();
  timers.set(matchId, timeout);
};

export const cancelPickDeadline = (matchId: string): void => {
  const existing = timers.get(matchId);

  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(matchId);
  }
};
