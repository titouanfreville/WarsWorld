import { logger } from "shared/utils/logger";

/**
 * Server-authoritative lobby-phase deadlines (ready-check + map pick&ban), keyed by `lobbyId`. Same
 * shape as `matches/pick-timer.ts`: the DB column (`readyEndsAt` / `mapPhaseEndsAt`) is the source
 * of truth, this is just the in-memory scheduler that fires when it elapses. Timers are rebuilt from
 * those columns on boot (see `MatchmakingUsecase.rescheduleLobbyPhases`), so a restart never drops a
 * deadline.
 */
const timers = new Map<string, NodeJS.Timeout>();

export const scheduleLobbyPhase = (
  lobbyId: string,
  endsAt: Date,
  onExpire: (lobbyId: string) => void | Promise<void>,
): void => {
  cancelLobbyPhase(lobbyId);

  // A deadline already in the past fires on the next tick (e.g. one that elapsed while the server
  // was down) rather than being skipped.
  const delayMs = Math.max(0, endsAt.getTime() - Date.now());

  const timeout = setTimeout(() => {
    timers.delete(lobbyId);

    void (async () => {
      try {
        await onExpire(lobbyId);
      } catch (error) {
        logger.error(
          `[lobby-phase-timer] deadline handler for lobby ${lobbyId} threw:`,
          error instanceof Error ? error.message : error,
        );
      }
    })();
  }, delayMs);

  // Don't keep the process alive solely for a lobby-phase deadline.
  timeout.unref?.();
  timers.set(lobbyId, timeout);
};

export const cancelLobbyPhase = (lobbyId: string): void => {
  const existing = timers.get(lobbyId);

  if (existing !== undefined) {
    clearTimeout(existing);
    timers.delete(lobbyId);
  }
};
