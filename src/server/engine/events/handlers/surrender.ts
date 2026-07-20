import { DispatchableError } from "server/engine/dispatchable-error";
import type { MatchWrapper } from "server/engine/entities/match";
import type { ApplyEvent } from "server/engine/events/handler-types";
import type { PlayerEliminatedEvent } from "server/engine/types/events";

/**
 * Surrender — a player conceding the match outright.
 *
 * Unlike every other action this isn't turn-bound: you may resign at any moment, including on the
 * opponent's turn, so it takes the surrendering player explicitly rather than reading
 * `getCurrentTurnPlayer()`. It also isn't part of `mainActionSchema`/`action-to-event`: those route
 * a turn-holder's move, and surrender's caller is the match-action usecase.
 *
 * The event it produces is the generic {@link PlayerEliminatedEvent} — "this player is out, and
 * here's why". Nothing here decides the match: flipping the player out of `alive` is enough for
 * `deriveGameOver`/`finalizeIfGameOver` to notice a team has no one left and end it.
 */
export const surrenderToEvent = (match: MatchWrapper, playerId: string): PlayerEliminatedEvent => {
  const player = match.getPlayerById(playerId);

  if (player === undefined) {
    throw new DispatchableError("You're not in this match");
  }

  if (match.status !== "playing") {
    throw new DispatchableError("This match isn't in progress");
  }

  if (player.data.status !== "alive") {
    throw new DispatchableError("You're already out of this match");
  }

  return { type: "player-eliminated", playerId, eliminationReason: "surrendered" };
};

/**
 * Apply an elimination to the match: the player stops being `alive`, and their units leave the
 * board — the same end state a rout reaches, so the surrenderer can't keep blocking tiles or seeing
 * through their units' vision after conceding.
 *
 * Status is set HERE, in the apply step, rather than when the event is built — that's what makes it
 * survive an event-log replay, matching how combat and crash eliminations are recorded (see
 * `applyPassTurnEvent`). Advancing the turn when the surrenderer held it is NOT done here: this
 * handler owns "player is out" and nothing else. The usecase passes the turn afterwards.
 */
export const applyPlayerEliminatedEvent: ApplyEvent<PlayerEliminatedEvent> = (match, event) => {
  const player = match.getPlayerById(event.playerId);

  if (player === undefined) {
    return;
  }

  player.data.status = event.eliminationReason === "surrendered" ? "resigned" : "routed";

  for (const unit of player.getUnits()) {
    unit.remove();
  }

  // Their units are gone, so every team's view of the board changed — including teams whose vision
  // depended on seeing them. Recalculate before anyone reads it.
  for (const team of match.teams) {
    team.vision?.recalculateVision(team.getUnits());
  }
};
