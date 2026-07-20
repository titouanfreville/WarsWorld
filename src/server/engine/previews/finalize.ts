import type { MatchWrapper } from "server/engine/entities/match";
import { deriveGameOver } from "./game-over";

export type FinalizeResult = { winnerTeamIndex: number | null };

/**
 * If a playing match has become decided, flip it to "finished" in memory and stamp each player's
 * result. Pure state mutation — persistence (DB write, live emit) is the caller's job.
 *
 * Returns the outcome when it just transitioned to finished, or `null` when there's nothing to do
 * (still contested, or already finalized). Idempotent: a match already "finished" returns null.
 */
export const finalizeIfGameOver = (match: MatchWrapper): FinalizeResult | null => {
  if (match.status !== "playing") {
    return null;
  }

  const gameOver = deriveGameOver(match, undefined);

  if (gameOver === null) {
    return null;
  }

  return stampOutcome(match, gameOver.winnerTeamIndex);
};

/**
 * End a playing match on an outcome the engine did NOT derive — the admin force-outcome tool.
 *
 * Shares `stampOutcome` with `finalizeIfGameOver` deliberately: a forced ending must leave a match in
 * exactly the state a natural one does, or the endgame screen, battle report and ranking would all
 * read a subtly different shape depending on how the game ended.
 *
 * The `playing` guard makes it idempotent and stops an admin re-deciding a settled match.
 */
export const forceOutcome = (
  match: MatchWrapper,
  winnerTeamIndex: number | null,
): FinalizeResult | null => {
  if (match.status !== "playing") {
    return null;
  }

  return stampOutcome(match, winnerTeamIndex);
};

/** Flip to finished and stamp each player's result. The one place an outcome is written to state. */
const stampOutcome = (match: MatchWrapper, winnerTeamIndex: number | null): FinalizeResult => {
  match.status = "finished";

  for (const player of match.getAllPlayers()) {
    player.data.result =
      winnerTeamIndex === null ? "drawn" : player.team.index === winnerTeamIndex ? "won" : "lost";
  }

  return { winnerTeamIndex };
};
