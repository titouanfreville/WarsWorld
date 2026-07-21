import { createDeadlineScheduler } from "server/adapters/deadline-scheduler";

/**
 * Server-authoritative lobby-phase deadlines (ready-check + map pick&ban), keyed by `lobbyId`. The
 * DB column (`readyEndsAt` / `mapPhaseEndsAt`) is the source of truth, this is just the in-memory
 * scheduler that fires when it elapses. Timers are rebuilt from those columns on boot (see
 * `MatchmakingUsecase.rescheduleLobbyPhases`), so a restart never drops a deadline.
 */
const scheduler = createDeadlineScheduler("lobby-phase-timer", "lobby");

export const scheduleLobbyPhase = (
  lobbyId: string,
  endsAt: Date,
  onExpire: (lobbyId: string) => void | Promise<void>,
): void => scheduler.schedule(lobbyId, endsAt, onExpire);

export const cancelLobbyPhase = (lobbyId: string): void => scheduler.cancel(lobbyId);
