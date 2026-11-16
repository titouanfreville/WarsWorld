import { DispatchableError } from "server/engine/dispatchable-error";
import type { AdminAction } from "server/core/schemas/admin-action";
import type { MatchWrapper } from "server/engine/entities/match";
import type { AdminToolEvent } from "server/engine/types/events";
import { forceOutcome } from "server/engine/previews/finalize";

/**
 * In-match admin tools, as events — same reasoning as the dev tools: match state is rebuilt from the
 * event log, so an outcome imposed outside it would replay to a still-playing match.
 *
 * Authorisation happens before we get here (`requireCapability("adminTools")` on the procedure).
 */
export const adminActionToEvent = (
  match: MatchWrapper,
  action: AdminAction,
  actorName: string,
): AdminToolEvent => {
  switch (action.type) {
    case "forceOutcome": {
      if (match.status !== "playing") {
        throw new DispatchableError(`Can't force an outcome on a match that is ${match.status}`);
      }

      /* Validate the team EXISTS at event time. A bogus index would otherwise stamp every player as
       * "lost" — a match nobody won — and replay would do it again, forever. */
      if (
        action.winnerTeamIndex !== null &&
        !match.teams.some((team) => team.index === action.winnerTeamIndex)
      ) {
        throw new DispatchableError(`No team with index ${action.winnerTeamIndex} in this match`);
      }

      return {
        type: "adminTool",
        actorName,
        effect: { kind: "forceOutcome", winnerTeamIndex: action.winnerTeamIndex },
      };
    }
  }
};

export const applyAdminToolEvent = (match: MatchWrapper, event: AdminToolEvent): void => {
  switch (event.effect.kind) {
    case "forceOutcome": {
      /* Shares `stampOutcome` with the natural ending, so a forced result leaves the match in exactly
       * the state a real one does. Returns null if already finished — idempotent on replay. */
      forceOutcome(match, event.effect.winnerTeamIndex);
      break;
    }
  }
};
