import type { PrismaClient } from "@prisma/client";
import type { MainAction } from "server/core/schemas/action";
import { getFinalPositionSafe } from "server/core/schemas/position";
import type { EndgameUsecase } from "server/endgame/endgame.usecase";
import type { MatchWrapper } from "server/engine/entities/match";
import {
  validateMainActionAndToEvent,
  validateSubActionAndToEvent,
} from "server/engine/events/action-to-event";
import {
  applyMainEventToMatch,
  applySubEventToMatch,
} from "server/engine/events/apply-event-to-match";
import { mainEventToEmittables } from "server/engine/events/event-to-emittable";
import { updateMoveVision } from "server/engine/events/handlers/move";
import { surrenderToEvent } from "server/engine/events/handlers/surrender";
import { fillDiscoveredUnitsAndProperties } from "server/engine/events/vision-update";
import { finalizeIfGameOver, type FinalizeResult } from "server/engine/previews/finalize";
import { deriveGameOver } from "server/engine/previews/game-over";
import { emitMatchEnd, persistFinishedMatch } from "server/matches/finish-match";
import type {
  EmittableEvent,
  MainEventsWithoutSubEvents,
  MainEventWithSubEvents,
  SubEvent,
} from "server/engine/types/events";
import { emitToTeams } from "server/matches/emit-to-teams";
import type { RankingUsecase } from "server/ranking/ranking.usecase";
import { logger } from "shared/utils/logger";

const attachSubEvent = (
  mainEventWithoutSubEvent: MainEventsWithoutSubEvents,
  subEvent: SubEvent,
): MainEventWithSubEvents =>
  mainEventWithoutSubEvent.type === "move"
    ? { ...mainEventWithoutSubEvent, subEvent }
    : mainEventWithoutSubEvent;

/**
 * In-match play: turning a player's intent into events, applying them, telling everyone, and writing
 * it all down. Every board action funnels through `send`; `surrender` is the one exit that isn't a
 * board action.
 *
 * This used to live inline in the action router. It moved here because surrender needed the SAME
 * tail — emit, finalize, persist, rate, report — and the only alternatives were duplicating it or
 * letting one router import another's internals. The router is now the thin transport it's supposed
 * to be (see src/server/CLAUDE.md: "No business logic in a router").
 */
export class MatchActionUsecase {
  constructor(
    private readonly db: PrismaClient,
    private readonly ranking: RankingUsecase,
    private readonly endgame: EndgameUsecase,
  ) {}

  /**
   * Play a main action: validate it into an event, apply it, emit what each team may see, and persist.
   * Returns whether the move was cut short by a hidden enemy (and where), which the client uses to
   * flag the ambush.
   *
   * The caller is responsible for the "is it your turn / is it your unit" gate — that's the
   * `playerInMatchBaseProcedure` the router binds this to.
   */
  async send(
    match: MatchWrapper,
    action: MainAction,
  ): Promise<{
    trapped: boolean;
    trapPosition: [number, number] | null;
  }> {
    /**
     * EXTREMELY IMPORTANT! This order MUST be followed, otherwise some things may not have required information:
     * 1. Move action to event
     * 2. Apply move event to match
     * 3. Sub action to event
     * 4. Sub event to emittable sub events
     * 5. Move event to emittable move events
     * 6. Update move event vision
     * 7. Apply sub event to match and update sub event vision
     * 8. Add new discovered info (vision) to emittable events
     * 9. Emit emittable events
     * 10. Save event
     */

    logger.debug("Received action:", action);

    /* 1. Move action to event */
    const mainEventWithoutSubEvent = validateMainActionAndToEvent(match, action);

    // A move whose path was cut short by a (fog-hidden) enemy unit in the way. Surfaced to the
    // client so it can flag the ambush — the unit stops before the blocker instead of reaching its
    // requested destination. `trapPosition` is the tile the unit halted on, so the client can pin
    // the "ambush" label right there instead of a screen-wide banner.
    const trapped =
      mainEventWithoutSubEvent.type === "move" && mainEventWithoutSubEvent.trap === true;
    const trapPosition =
      trapped && mainEventWithoutSubEvent.type === "move"
        ? getFinalPositionSafe(mainEventWithoutSubEvent.path)
        : null;

    // if there was a trap or join/load, the default subEvent is "wait" (check must be done before moving the unit)
    const isJoinOrLoad =
      mainEventWithoutSubEvent.type === "move" &&
      match.getUnit(getFinalPositionSafe(mainEventWithoutSubEvent.path)) !== undefined &&
      getFinalPositionSafe(mainEventWithoutSubEvent.path) !== mainEventWithoutSubEvent.path[0];

    /* 2. Apply move event to match */
    applyMainEventToMatch(match, mainEventWithoutSubEvent);

    /**
     * TODO important!
     * we must try-catch the subEvent generation and applying
     * and then apply the "wait" subEvent as a fallback.
     * otherwise bugs or invalid moves would cause a desync
     * between server match state and database/client state
     * because we stop about here and don't store/emit.
     */

    let emittableEvents: (EmittableEvent | undefined)[]; // undefined means that team doesn't receive the event

    // having this subEvent variable is shitty code but it's type-safe and good enough for now.
    let subEvent: SubEvent = { type: "wait" };

    if (mainEventWithoutSubEvent.type === "move" && action.type === "move") {
      // second condition is only needed for type-gating input event

      /* 3. Sub action to event */
      const mainEventWithSubEvent: MainEventWithSubEvents = {
        ...mainEventWithoutSubEvent,
        subEvent: { type: "wait" },
      };

      if (!mainEventWithoutSubEvent.trap && !isJoinOrLoad) {
        mainEventWithSubEvent.subEvent = validateSubActionAndToEvent(match, action);
      }

      /* 4. Sub event to emittable sub events (done inside, first)*/
      /* 5. Move event to emittable move events */
      emittableEvents = mainEventToEmittables(match, mainEventWithSubEvent);

      /* 6. Update move event vision */
      updateMoveVision(match, mainEventWithSubEvent);

      /* 7. Apply sub event to match and update sub event vision */
      applySubEventToMatch(match, mainEventWithSubEvent);
      subEvent = mainEventWithSubEvent.subEvent;
    } else {
      emittableEvents = mainEventToEmittables(match, mainEventWithoutSubEvent);
    }

    /* 8. Update move vision (and add new vision in general to emittable events) */
    fillDiscoveredUnitsAndProperties(match, emittableEvents);

    /* 9. Emit emittable events */
    emitToTeams(match, emittableEvents);

    /* 10-12. Finalize if this decided the match, persist, and announce the end. */
    await this.persistEventAndOutcome(match, attachSubEvent(mainEventWithoutSubEvent, subEvent));

    return { trapped, trapPosition };
  }

  /**
   * Concede the match. Deliberately NOT a `MainAction`: those are things the player with the turn
   * does with their army, gated on it being their turn, whereas resigning is something you may do at
   * any moment — most often while watching the opponent take theirs. So it takes the player
   * explicitly instead of reading `getCurrentTurnPlayer()`, and the router binds it to
   * `matchBaseProcedure` (which loads the match but does NOT gate on the turn); membership is enforced
   * by `surrenderToEvent`, which throws "You're not in this match" for a non-participant.
   *
   * Nothing here decides the outcome: the engine flips the player out of `alive` and
   * `finalizeIfGameOver` notices their team is empty. That's what makes a 1v1 resignation end the
   * match without this method knowing anything about winners.
   */
  async surrender(match: MatchWrapper, playerId: string): Promise<void> {
    const event = surrenderToEvent(match, playerId);
    const hadTurn = match.getPlayerById(playerId)?.data.hasCurrentTurn === true;

    applyMainEventToMatch(match, event);

    // Public: a concession is announced to everyone, with nothing to fog (the `default` branch of
    // mainEventToEmittables fans it out to every team unchanged).
    emitToTeams(match, mainEventToEmittables(match, event));

    // The elimination and the follow-on turn pass must land in ONE transaction. The old approach
    // persisted the concession, then passed the turn in a SEPARATE write — a crash between the two
    // left the concession durable but the turn frozen on a player who's already out, so on reboot the
    // match replayed stuck with nobody able to act. Both events, one write.
    const contents: MainEventWithSubEvents[] = [event];

    // Does the concession itself end the match? (1v1: the surrenderer's team empties → yes; 3+
    // players: no.) Asked via `deriveGameOver` — the same test finalize uses — BEFORE flipping
    // status, so we can tell whether a turn still needs moving on.
    const stillPlaying = deriveGameOver(match, undefined) === null;

    if (stillPlaying && hadTurn) {
      // Move the turn off the player who's out — as a real pass-turn event so upkeep (weather, funds,
      // repair, fuel) runs exactly once through its one implementation. Mirrors `send`'s non-move
      // pipeline: apply → emittables → reveal-discovered → emit.
      const passTurnEvent = validateMainActionAndToEvent(match, { type: "passTurn" });
      applyMainEventToMatch(match, passTurnEvent);

      const passTurnEmittables = mainEventToEmittables(match, passTurnEvent);
      fillDiscoveredUnitsAndProperties(match, passTurnEmittables);
      emitToTeams(match, passTurnEmittables);

      contents.push(attachSubEvent(passTurnEvent, { type: "wait" }));
    }

    // Finalize AFTER both applies — a fuel-out crash during the pass-turn upkeep could itself decide
    // the match (drop a 3-player game to one surviving team). Run once, over the final state.
    const finished = finalizeIfGameOver(match);

    await this.writeEventsAndOutcome(match, contents, finished);

    if (finished !== null) {
      emitMatchEnd(match, finished);
    }
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /**
   * Write the event down and, if it ended the match, everything that follows from that — in ONE
   * transaction.
   *
   * Finished matches are archived out of the hot store on reboot (rebuild skips `finished`), so the
   * DB is their only record: a crash between the event write and the outcome write would strand a
   * decided match as "playing" forever. The v1 `playerState` blob AND the v2 relational
   * `MatchPlayer.result` are both stamped so either read path sees the result.
   */
  private async persistEventAndOutcome(
    match: MatchWrapper,
    content: MainEventWithSubEvents,
  ): Promise<void> {
    // Flip the match to finished + stamp each player's result in memory (pure engine mutation).
    const finished = finalizeIfGameOver(match);

    await this.writeEventsAndOutcome(match, [content], finished);

    // Once the outcome is durably committed, push a live matchEnd so open boards flip to their
    // result screen without a refetch.
    if (finished !== null) {
      emitMatchEnd(match, finished);
    }
  }

  /**
   * Write one or more event rows and, when the match just ended, its outcome — all in ONE
   * transaction. Surrender uses the multi-event form (elimination + turn pass) so a crash can't split
   * them; a normal action passes a single event.
   *
   * Finished matches are archived out of the hot store on reboot (rebuild skips `finished`), so the
   * DB is their only record: a crash between the event write and the outcome write would strand a
   * decided match as "playing" forever. The v1 `playerState` blob AND the v2 relational
   * `MatchPlayer.result` are both stamped so either read path sees the result.
   */
  private async writeEventsAndOutcome(
    match: MatchWrapper,
    contents: MainEventWithSubEvents[],
    finished: FinalizeResult | null,
  ): Promise<void> {
    await this.db.$transaction(async (tx) => {
      for (const content of contents) {
        await tx.event.create({ data: { matchId: match.id, content } });
      }

      if (finished !== null) {
        // Shared with the admin force-outcome path (`finish-match.ts`) so the two can't drift: a
        // forced ending has to write the same rows a natural one does, or a match reads as finished
        // on one screen and unfinished on another.
        await persistFinishedMatch(tx, match, finished, {
          applyMatchResult: (client, matchId) => this.ranking.applyMatchResult(client, matchId),
          persistStats: (client, matchId) => this.endgame.persistStats(client, matchId),
        });
      }
    });
  }
}
