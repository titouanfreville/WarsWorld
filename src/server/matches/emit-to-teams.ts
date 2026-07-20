import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { EmittableEvent } from "server/engine/types/events";
import { emit } from "server/emitter/event-emitter";

/**
 * Deliver each team's view of a set of events to that team's connected players. `events` is
 * positional — one entry per team, plus a trailing spectator slot — and `undefined` means "not for
 * that team" (already fog-masked upstream by `mainEventToEmittables`).
 *
 * Shared by every match-play orchestrator (play, dev tools, admin tools) so the fan-out has exactly
 * one implementation. Lives in `matches` — one of the match-play features the layering rules let
 * touch `engine` (see src/server/CLAUDE.md).
 */
export const emitToTeams = (match: MatchWrapper, events: (EmittableEvent | undefined)[]): void => {
  events.forEach((emittableEvent) => {
    if (!emittableEvent) {
      return;
    }

    // teamIndex is a team's logical index (-1 = spectators, who have no connected players). Look it
    // up by index and skip when there's no such team, rather than indexing match.teams[-1].
    const team = match.teams.find((t) => t.index === emittableEvent.teamIndex);

    team?.players.forEach((player: PlayerInMatchWrapper) => {
      emit(player.data.id, { ...emittableEvent, matchId: match.id });
    });
  });
};
