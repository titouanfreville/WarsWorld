import type { MatchWrapper } from "server/engine/entities/match";
import type { TeamWrapper } from "server/engine/entities/team";
import { dayLimitWinner, isDayLimitReached, teamInPlay } from "server/engine/previews/day-limit";

/**
 * Derives the match outcome from the engine's elimination status. A team is out once none of its
 * players are still "alive" — the engine flips a player to "routed"/"captured" the moment they're
 * eliminated (last unit destroyed in combat, HQ captured, …). Keying off status is what separates
 * "all units DESTROYED" (you had units and lost them -> routed -> game over, even if you own a base)
 * from "haven't produced yet" (round one, still "alive" -> not a loss): the latter never triggers an
 * elimination event, so its status stays "alive".
 */

/** Why the match ended — the endgame screen says "routed" or "day limit — most properties". */
export type GameOverReason = "elimination" | "day-limit";

export type GameOver = {
  winnerTeamIndex: number | null;
  viewerWon: boolean;
  reason: GameOverReason;
};

/** Non-null once at most one team is still in play. `winnerTeamIndex` is null on a draw. */
export const deriveGameOver = (
  match: MatchWrapper,
  viewerTeam: TeamWrapper | undefined,
): GameOver | null => {
  if (match.status === "setup") {
    return null; // not started — no outcome yet
  }

  // A `finished` match is over by decree, and the winner is whatever was STAMPED — read it from the
  // results, don't re-derive from alive-status. An admin force-outcome finishes the match while
  // leaving both armies alive, so the alive-status test below would wrongly say "still contested".
  // Natural endings pass through here identically (finalize stamps results + flips status together),
  // so this is one consistent path, not a special case. `finalizeIfGameOver` runs BEFORE the flip
  // (it guards status === "playing"), so the "did the match just end" check still uses the test below.
  if (match.status === "finished") {
    const winnerTeam = match.teams.find((team) =>
      team.players.some((player) => player.data.result === "won"),
    );
    const winnerTeamIndex = winnerTeam?.index ?? null;

    return {
      winnerTeamIndex,
      viewerWon:
        winnerTeamIndex !== null &&
        viewerTeam !== undefined &&
        viewerTeam.index === winnerTeamIndex,
      // How it ended was decided when it was stamped; a finished match just reports it back.
      reason: match.endReason ?? "elimination",
    };
  }

  const teamsInPlay = match.teams.filter(teamInPlay);

  if (teamsInPlay.length > 1) {
    // Still contested on the board — but the clock can still call it. Territory decides: most
    // properties, cities breaking the tie, otherwise a draw (see dayLimitWinner).
    if (!isDayLimitReached(match)) {
      return null;
    }

    const winnerOnTerritory = dayLimitWinner(match);

    return {
      winnerTeamIndex: winnerOnTerritory,
      viewerWon:
        winnerOnTerritory !== null &&
        viewerTeam !== undefined &&
        viewerTeam.index === winnerOnTerritory,
      reason: "day-limit",
    };
  }

  const winnerTeamIndex = teamsInPlay.length === 1 ? teamsInPlay[0].index : null;

  return {
    winnerTeamIndex,
    viewerWon:
      winnerTeamIndex !== null && viewerTeam !== undefined && viewerTeam.index === winnerTeamIndex,
    reason: "elimination",
  };
};
