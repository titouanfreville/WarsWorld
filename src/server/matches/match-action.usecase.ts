import type { PrismaClient } from "@prisma/client";
import { appendEvent } from "server/adapters/event-log";
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
import { withMatchLock } from "server/matches/match-lock";
import {
  BOOT_STAGGER_MS,
  cancelTurnDeadline,
  MIN_TURN_MS,
  scheduleTurnDeadline,
} from "server/matches/turn-timer";
import { bankOf } from "server/engine/rules/turn-clock";
import type { MatchStore } from "server/match-store";
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
    /** Needed to resolve a match from a fired turn deadline, which only carries an id. */
    private readonly store: MatchStore,
  ) {}

  /**
   * End the turn of whoever is on the clock, because their time ran out.
   *
   * Runs the SAME pipeline a voluntary pass does — validate → apply → emit → persist — rather than
   * mutating state directly: a forced end must leave a match indistinguishable from one where the
   * player pressed the button, or upkeep (weather, funds, repair, fuel) would silently differ
   * depending on how the turn ended. The clock is settled to zero by the pass-turn event itself,
   * since `turnEndsAt` has by definition already elapsed.
   *
   * Idempotent and defensive: a match that finished, was archived, or has already moved on since the
   * timer was armed is simply left alone.
   */
  async forceEndTurn(matchId: string): Promise<void> {
    // Queue behind any action already in flight for this match. The guards below all read state that
    // an in-flight `send` is in the middle of changing, so checking them outside the lock is
    // checking a value that can be stale by the time we act on it (see match-lock.ts).
    return withMatchLock(matchId, async () => {
      const match = this.store.get(matchId);

      if (match === undefined || match.status !== "playing" || match.turnEndsAt === null) {
        return;
      }

      // The deadline moved (the player acted, or another path re-armed it) — this firing is stale.
      // Now meaningful: the action that moved it has fully committed before we get here.
      if (match.turnEndsAt > Date.now()) {
        return;
      }

      await this.endTurnNow(match);
    });
  }

  /** The forced-pass body, already holding the match lock. */
  private async endTurnNow(match: MatchWrapper): Promise<void> {
    const event = validateMainActionAndToEvent(match, { type: "passTurn" });

    applyMainEventToMatch(match, event);

    const emittables = mainEventToEmittables(match, event);
    fillDiscoveredUnitsAndProperties(match, emittables);
    emitToTeams(match, emittables);

    await this.persistEventAndOutcome(match, attachSubEvent(event, { type: "wait" }));
  }

  /**
   * Re-arm turn deadlines from the DB on boot (called after the match-store rebuild).
   *
   * Also restores `turnEndsAt` onto the rebuilt engine entity: the banks replay from the event log,
   * but the deadline can't, and without it the first pass-turn after a restart would record no
   * remaining time and quietly hand the acting player their whole bank back. A deadline that expired
   * while the server was down fires immediately, which is correct — their time really did run out.
   */
  async rescheduleTurnDeadlines(): Promise<void> {
    const rows = await this.db.match.findMany({
      where: { status: "playing", turnEndsAt: { not: null } },
      select: { id: true, turnEndsAt: true },
    });

    const orphaned: string[] = [];

    rows.forEach((row, i) => {
      const match = this.store.get(row.id);

      if (match === undefined || row.turnEndsAt === null) {
        // Quarantined or archived by the rebuild — nothing to time. Clear the row too: left set, it
        // is re-selected and re-skipped by this query on every boot from now until forever.
        orphaned.push(row.id);

        return;
      }

      match.turnEndsAt = row.turnEndsAt.getTime();

      // Deadlines that expired while we were down must still fire — their time really did run out —
      // but firing them all on one tick means N concurrent force-end transactions. Stagger the
      // already-expired ones; live deadlines keep their real time.
      const expired = row.turnEndsAt.getTime() <= Date.now();
      const firesAt = expired ? new Date(Date.now() + i * BOOT_STAGGER_MS) : row.turnEndsAt;

      scheduleTurnDeadline(row.id, firesAt, (id) => this.forceEndTurn(id));
    });

    if (orphaned.length > 0) {
      logger.info(`[turn-timer] clearing ${orphaned.length} turn deadline(s) on untracked matches`);
      await this.db.match.updateMany({
        where: { id: { in: orphaned } },
        data: { turnEndsAt: null },
      });
    }
  }

  /**
   * PLAN the deadline for the turn that just began — pure: no mutation, no timer, no I/O.
   *
   * Split from `commitTurnClock` deliberately. Arming used to happen before the transaction that
   * persists the events causing it, so a rollback (a DB failure, or the EventLogConflictError this
   * same seam can now raise) left the in-memory entity and a live `setTimeout` ahead of the durable
   * row — and the next reboot restored the stale one. Planning is safe to do early; committing is
   * not, so it waits for the commit.
   *
   * Public because the match lifecycle starts the FIRST turn's clock through it (see
   * MatchesUsecase.reveal). An untimed match, or one that just ended, plans `null`.
   */
  planTurnClock(match: MatchWrapper): Date | null {
    const bankMs = match.status === "playing" ? bankOf(match.getCurrentTurnPlayer()) : null;

    if (bankMs === null) {
      return null;
    }

    // Floor the turn length. `matchRulesSchema` now forbids a zero increment, which is the real
    // guard, but a bank of 0 must never arm a deadline of `now`: that fires on the next tick, ends
    // the turn, and does it again forever — a match no one can play. Defence in depth for any rules
    // blob that predates the schema floor.
    return new Date(Date.now() + Math.max(MIN_TURN_MS, bankMs));
  }

  /**
   * ADOPT a planned deadline: mutate the live entity and arm (or cancel) the timer.
   *
   * Call this ONLY after the transaction that persisted the deadline has committed — see
   * `planTurnClock`. Clearing (`null`) also cancels any live timeout, because leaving one on a
   * finished match would force-end a turn in a game nobody is playing.
   */
  commitTurnClock(match: MatchWrapper, endsAt: Date | null): void {
    match.turnEndsAt = endsAt?.getTime() ?? null;

    if (endsAt === null) {
      cancelTurnDeadline(match.id);

      return;
    }

    scheduleTurnDeadline(match.id, endsAt, (id) => this.forceEndTurn(id));
  }

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
    // Serialized per match: the whole validate → apply → emit → persist sequence is one critical
    // section, and the turn deadline is a second writer that can fire into the middle of it.
    return withMatchLock(match.id, () => this.sendLocked(match, action));
  }

  private async sendLocked(
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
    // Same critical section as `send` — a concession must not interleave with a firing deadline.
    return withMatchLock(match.id, () => this.surrenderLocked(match, playerId));
  }

  private async surrenderLocked(match: MatchWrapper, playerId: string): Promise<void> {
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
    // PLAN the next deadline (pure), persist it in the SAME transaction as the events that caused
    // it, and only ADOPT it once that transaction has committed. Persisted because elapsed
    // wall-clock can't be replayed: on reboot this row is what stops the acting player getting a
    // fresh full bank. `undefined` means "this action didn't touch the clock — leave the row alone".
    //
    // A match that just FINISHED clears its deadline even when the turn didn't move: an attack or a
    // surrender by a non-turn-holder decides a match without a passTurn, and without this the row
    // keeps a live deadline on a finished match and the timeout survives until it fires.
    const movedTurn = contents.some((content) => content.type === "passTurn");
    const turnEndsAt = finished !== null ? null : movedTurn ? this.planTurnClock(match) : undefined;

    await this.db.$transaction(async (tx) => {
      for (const content of contents) {
        await appendEvent(tx, match.id, content);
      }

      if (turnEndsAt !== undefined) {
        await tx.match.update({ where: { id: match.id }, data: { turnEndsAt } });
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

    // Durable now — safe to move the in-memory deadline and arm the real timeout.
    if (turnEndsAt !== undefined) {
      this.commitTurnClock(match, turnEndsAt);
    }
  }
}
