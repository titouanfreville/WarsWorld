import { observable } from "@trpc/server/observable";
import { emit, subscribe } from "server/emitter/event-emitter";
import { prisma } from "server/prisma/prisma-client";
import {
  validateMainActionAndToEvent,
  validateSubActionAndToEvent,
} from "server/engine/events/action-to-event";
import {
  applyMainEventToMatch,
  applySubEventToMatch,
} from "server/engine/events/apply-event-to-match";
import { mainActionSchema } from "server/core/schemas/action";
import { getFinalPositionSafe } from "server/core/schemas/position";
import { logger } from "shared/utils/logger";
import type {
  Emittable,
  EmittableEvent,
  MainEventsWithoutSubEvents,
  MainEventWithSubEvents,
  SubEvent,
} from "server/engine/types/events";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import { mainEventToEmittables } from "server/engine/events/event-to-emittable";
import { updateMoveVision } from "server/engine/events/handlers/move";
import { fillDiscoveredUnitsAndProperties } from "server/engine/events/vision-update";
import { rankingUsecase } from "../ranking/router";
import { matchBaseProcedure, playerInMatchBaseProcedure, router } from "../trpc/trpc-setup";
import { finalizeIfGameOver } from "./match/finalize";

const attachSubEvent = (
  mainEventWithoutSubEvent: MainEventsWithoutSubEvents,
  subEvent: SubEvent,
): MainEventWithSubEvents => {
  if (mainEventWithoutSubEvent.type === "move") {
    return {
      ...mainEventWithoutSubEvent,
      subEvent,
    };
  }

  return mainEventWithoutSubEvent;
};

export const actionRouter = router({
  send: playerInMatchBaseProcedure
    .input(mainActionSchema)
    .mutation(async ({ input, ctx: { match } }) => {
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

      logger.debug("Received action:", input);

      /* 1. Move action to event */
      const mainEventWithoutSubEvent = validateMainActionAndToEvent(match, input);

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

      if (mainEventWithoutSubEvent.type === "move" && input.type === "move") {
        // second condition is only needed for type-gating input event

        /* 3. Sub action to event */
        const mainEventWithSubEvent: MainEventWithSubEvents = {
          ...mainEventWithoutSubEvent,
          subEvent: {
            type: "wait",
          },
        };

        if (!mainEventWithoutSubEvent.trap && !isJoinOrLoad) {
          mainEventWithSubEvent.subEvent = validateSubActionAndToEvent(match, input);
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
      // TODO @function either this function gets a list of emittables, or we iterate through them here.
      //  undefined means that team shouldn't receive the event
      //  emittableEvents[i] is from match.teams[i]. emittableEvents has one extra "no team"(spectator) at the end
      emittableEvents.forEach((emittableEvent: EmittableEvent | undefined) => {
        if (emittableEvent) {
          // teamIndex is a team's logical index (-1 = spectators, who have no connected players).
          // Look it up by index and skip when there's no such team, instead of match.teams[-1].
          const team = match.teams.find((t) => t.index === emittableEvent.teamIndex);

          team?.players.forEach((player: PlayerInMatchWrapper) => {
            emit(player.data.id, { ...emittableEvent, matchId: match.id });
          });
        }
      });

      /* 10. If this action decided the match, finalize it in memory: flip status + stamp each
       * player's won/lost/drawn result (pure engine mutation — persistence is below). */
      const finished = finalizeIfGameOver(match);

      /* 11. Persist the event and, when the match just ended, its outcome snapshot in ONE
       * transaction. Finished matches are archived out of the hot store on reboot (rebuild skips
       * `finished`), so the DB is their only record — a crash between the event write and the
       * outcome write would strand a decided match as "playing" forever. The v1 `playerState` blob
       * AND the v2 relational `MatchPlayer.result` are both stamped so either read path sees the
       * result (the v2 columns are what the end-game summary/grade query). */
      await prisma.$transaction(async (tx) => {
        await tx.event.create({
          data: {
            matchId: input.matchId,
            content: attachSubEvent(mainEventWithoutSubEvent, subEvent),
          },
        });

        if (finished !== null) {
          await tx.match.update({
            where: { id: match.id },
            data: {
              status: "finished",
              winnerTeamIndex: finished.winnerTeamIndex,
              finishedAt: new Date(),
              playerState: match.getAllPlayers().map((player) => player.data),
            },
          });

          // v2 relational store: stamp result per seat. `updateMany` (keyed by matchId+playerId) is
          // a no-op for v1 matches, which have no MatchPlayer rows — so this is safe on both paths.
          await Promise.all(
            match.getAllPlayers().map((player) =>
              tx.matchPlayer.updateMany({
                where: { matchId: match.id, playerId: player.data.id },
                data: { result: player.data.result ?? null },
              }),
            ),
          );

          // Ranked matches move MMR in the SAME transaction, off the results just stamped above.
          // Self-guards on `isRanked`/`ratedAt`, so v1 and unranked matches are a cheap no-op.
          await rankingUsecase.applyMatchResult(tx, match.id);
        }
      });

      /* 12. After the outcome is durably committed, push a live matchEnd so open boards flip to
       * their result screen without a refetch. */
      if (finished !== null) {
        const winningTeamPlayerIds =
          finished.winnerTeamIndex === null
            ? null
            : (match.teams
                .find((team) => team.index === finished.winnerTeamIndex)
                ?.players.map((player) => player.data.id) ?? null);

        match.getAllPlayers().forEach((player) => {
          emit(player.data.id, {
            type: "matchEnd",
            winningTeamPlayerIds,
            teamIndex: player.team.index,
            matchId: match.id,
          });
        });
      }

      return { trapped, trapPosition };

      // TODO we still need something like the following to handle timeout eliminations.

      // if (playerEliminatedEvent !== null) {
      //   applyMainEventToMatch(match, playerEliminatedEvent);

      //   const eliminationEventOnDB = await prisma.event.create({
      //     data: {
      //       content: playerEliminatedEvent,
      //       matchId: match.id
      //     }
      //   })

      //   const emittableEliminationEvent: EmittableEvent = {
      //     ...playerEliminatedEvent,
      //     matchId: match.id,
      //     index: eliminationEventOnDB.index
      //   }

      //   emit(emittableEliminationEvent)
      // }
    }),
  onEvent: matchBaseProcedure.subscription(({ ctx: { match, currentPlayer } }) =>
    observable<Emittable>((emit) => subscribe(match.id, currentPlayer.id, emit.next)),
  ),
  // TODO create procedure for anonymous users to observe games
  // (they get their own special "-1" team or something)
});
