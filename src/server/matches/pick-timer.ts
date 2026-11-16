import { createDeadlineScheduler } from "server/adapters/deadline-scheduler";

/**
 * Server-authoritative general-picker deadlines. `Match.pickEndsAt` is the source of truth; this is
 * just the in-memory scheduler that fires when it elapses. Timers are rebuilt from `pickEndsAt` on
 * boot (see MatchesUsecase.reschedulePickDeadlines), so a restart never drops a deadline.
 */
const scheduler = createDeadlineScheduler("pick-timer", "match");

export const schedulePickDeadline = (
  matchId: string,
  endsAt: Date,
  onExpire: (matchId: string) => void | Promise<void>,
): void => scheduler.schedule(matchId, endsAt, onExpire);

export const cancelPickDeadline = (matchId: string): void => scheduler.cancel(matchId);
