import type { AnimationScope } from "frontend/components/match/animation-scope";
import { shouldAnimate } from "frontend/components/match/animation-scope";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import { getUnitAt, samePosition } from "frontend/components/match/match-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import { optimisticActions, type ActionQueueState } from "frontend/utils/action-queue";
import type { MutableRefObject } from "react";

/** Units the BE repaired/refuelled this upkeep — the one-shot start-of-turn flourish. */
export type TurnStartPulse = {
  repaired: readonly BoardPosition[];
  refuelled: readonly BoardPosition[];
};

/** Tiles where units ran out of fuel — the one-shot crash flourish (public, either army). */
export type CrashPulse = { positions: readonly BoardPosition[] };

/** One unit's confirmed/buffered move to animate: the full tile path it travelled. */
export type MovePulse = { path: readonly BoardPosition[] };

/**
 * One capture flourish. `completed` marks the tick that flipped ownership (a brighter flash);
 * `full` plays the rich AW capture (soldier hops + building sink) rather than just the chevrons.
 */
export type CapturePulse = { position: BoardPosition; completed: boolean; full: boolean };

/** Every one-shot animation this render should play. Omitted fields mean "nothing to play". */
export type BoardPulses = {
  turnStartPulse?: TurnStartPulse;
  crashPulse?: CrashPulse;
  movePulses: MovePulse[];
  deathPulses: BoardPosition[];
  capturePulses: CapturePulse[];
};

/**
 * Play-once bookkeeping, mutated by `deriveBoardPulses`. The board rebuilds its stage on EVERY
 * optimistic view change, so without these gates each flourish would replay on every rebuild within
 * a turn. Held across renders by `useBoardScene` — a plain mutable object rather than refs, so a
 * test can build one with `createPulseGates()` and drive the derivation directly.
 */
export type PulseGates = {
  /**
   * The last `turn:actingPlayerId` whose start-of-turn flourish already played. Keyed on the player
   * too — `view.turn` is a day counter shared by both players in a round, so a bare turn value
   * would alias the two turns together.
   */
  sparkledTurn: string | null;
  /**
   * Same, for the fuel-out crash flourish. Tracked separately: crashes are reported to BOTH players
   * (a unit going down is public), so this fires on turns where `turnStart` is null for the viewer.
   * The player key is essential here — both sides' crashes can share one `view.turn`, so a
   * bare-turn gate would let the first-observed crash suppress the other player's on the same day.
   */
  crashedTurn: string | null;
  /** clientIds of buffered moves already animated, so a move slides once per turn, not per rebuild. */
  animatedMoves: Set<string>;
  /** Same, for buffered captures. */
  animatedCaptures: Set<string>;
  /** The turn the two sets above belong to; a change clears them so they stay bounded. */
  animatedMovesTurn: number | null;
  /**
   * The last authoritative fetch (react-query `dataUpdatedAt`) whose live opponent events we
   * drained, so a batch animates exactly once — on the rebuild that reflects it, not on every
   * within-fetch re-render.
   */
  drainedMoveFetch: number | null;
};

export const createPulseGates = (): PulseGates => ({
  sparkledTurn: null,
  crashedTurn: null,
  animatedMoves: new Set(),
  animatedCaptures: new Set(),
  animatedMovesTurn: null,
  drainedMoveFetch: null,
});

/**
 * The live opponent events `useMatchBoard` accumulates off the websocket between authoritative
 * fetches. Drained (and cleared) here so each batch animates once.
 */
export type LiveEventBuffers = {
  opponentMovePaths: MutableRefObject<[number, number][][]>;
  destroyedPositions: MutableRefObject<[number, number][]>;
  capturePositions: MutableRefObject<[number, number][]>;
};

export type DeriveBoardPulsesParams = {
  view: MatchView;
  /** The viewer — both the actor of buffered actions and the audience of every flourish. */
  playerId: string;
  /** Whose turn it is, gating the live opponent-move animations. */
  actingPlayerId: string | undefined;
  animationScope: AnimationScope;
  queue: ActionQueueState;
  snapshot: TurnSnapshot | null;
  /** react-query's `dataUpdatedAt` for the match — the key the live-event drain is gated on. */
  dataUpdatedAt: number;
  gates: PulseGates;
  live: LiveEventBuffers;
};

/**
 * Decides which one-shot flourishes this board render should play, and marks them as played.
 *
 * Extracted from the board's render effect: the scene rebuilds on every action, so the whole
 * job here is de-duplication — turn-start and crash fire once per player-turn, buffered moves and
 * captures once per `clientId`, and live opponent events once per authoritative fetch. Everything
 * is additionally gated by the viewer's `AnimationScope` preference.
 *
 * Mutates `gates` and drains `live` — call it exactly once per render of the scene.
 */
export function deriveBoardPulses({
  view,
  playerId,
  actingPlayerId,
  animationScope,
  queue,
  snapshot,
  dataUpdatedAt,
  gates,
  live,
}: DeriveBoardPulsesParams): BoardPulses {
  // Gate the start-of-turn flourish to the FIRST render of a new turn: the BE sends `turnStart`
  // (own units only, fog-safe) for the whole turn, but the scene rebuilds on every action, so we
  // fire the pulse once per turn value and then suppress it until the next turn.
  const report = view.turnStart;
  const turnStartKey = report !== null ? `${view.turn}:${report.playerId}` : null;
  const turnStartPulse =
    report !== null &&
    gates.sparkledTurn !== turnStartKey &&
    shouldAnimate(animationScope, report.playerId, playerId)
      ? { repaired: report.repaired.map((entry) => entry.position), refuelled: report.refuelled }
      : undefined;

  if (turnStartPulse !== undefined) {
    gates.sparkledTurn = turnStartKey;
  }

  // Same one-per-turn gate for the fuel-out crashes, on its own key: `crashes` is sent to BOTH
  // players (fog-masked), so it fires on turns where `turnStart` is null for this viewer. The
  // animation setting keys off whose units went down, so "own units only" stays quiet for the
  // opponent's losses.
  const crashReport = view.crashes;
  const crashKey = crashReport !== null ? `${view.turn}:${crashReport.playerId}` : null;
  const crashPulse =
    crashReport !== null &&
    crashReport.positions.length > 0 &&
    gates.crashedTurn !== crashKey &&
    shouldAnimate(animationScope, crashReport.playerId, playerId)
      ? { positions: crashReport.positions.map((p): BoardPosition => [p[0], p[1]]) }
      : undefined;

  if (crashPulse !== undefined) {
    gates.crashedTurn = crashKey;
  }

  // Slide just-moved units along their path instead of teleporting. A buffered move animates once
  // (tracked by clientId); the sets are cleared on a turn change so they stay bounded and a re-used
  // clientId can't be suppressed across turns.
  if (gates.animatedMovesTurn !== view.turn) {
    gates.animatedMoves.clear();
    gates.animatedCaptures.clear();
    gates.animatedMovesTurn = view.turn;
  }

  const movePulses: MovePulse[] = [];
  const capturePulses: CapturePulse[] = [];
  const deathPulses: BoardPosition[] = [];

  // Own moves are the acting player's, so the animation gate keys off the viewer as both actor and
  // audience.
  if (shouldAnimate(animationScope, playerId, playerId)) {
    for (const queued of optimisticActions(queue)) {
      // Key off the ACTION being a travelling move, not its queue `kind`: a move that ends in an
      // attack/capture/ability is still `{ type: "move", path, subAction }` but buffered under the
      // `attack`/`ability`/… kind — the unit walks the path either way, so it must animate too.
      if (
        queued.action.type !== "move" ||
        queued.action.path.length < 2 ||
        gates.animatedMoves.has(queued.clientId)
      ) {
        continue;
      }

      gates.animatedMoves.add(queued.clientId);
      movePulses.push({ path: queued.action.path });
    }
  }

  // Own captures — driven from the BUFFER (not the WS ability event) so the flourish shares the move
  // slide's clock: both are created in THIS rebuild, so `board-scene` can hold the capture until the
  // slide lands deterministically (the event-driven path raced two clocks and mistimed the hop).
  // Completion is known optimistically from the snapshot's capture rate — the same tick
  // `optimistic-view` applies. `full` plays the hop + building sink; a "none" scope keeps just the
  // chevrons as the no-animation indicator.
  const ownFull = shouldAnimate(animationScope, playerId, playerId);

  for (const queued of optimisticActions(queue)) {
    if (queued.kind !== "capture" || queued.action.type !== "move") {
      continue;
    }

    if (gates.animatedCaptures.has(queued.clientId)) {
      continue;
    }

    gates.animatedCaptures.add(queued.clientId);

    const path = queued.action.path;
    const from = path[0];
    const snapshotUnit = snapshot?.units.find((unit) => samePosition(unit.position, from));
    const current = snapshotUnit?.currentCapturePoints ?? 20;
    const rate = snapshotUnit?.captureRate ?? 0;

    capturePulses.push({
      position: path[path.length - 1],
      completed: Math.max(0, current - rate) === 0,
      full: ownFull,
    });
  }

  // Opponent moves, captures and unit destructions seen live: drain what accumulated since the last
  // authoritative fetch. Keyed on `dataUpdatedAt` so a batch that arrived together animates once, on
  // the rebuild that reflects it. The buffers are always cleared so suppressed entries can't pile up.
  if (gates.drainedMoveFetch !== dataUpdatedAt) {
    gates.drainedMoveFetch = dataUpdatedAt;

    // Opponent moves are gated by the acting player, so "own units only" keeps the opponent's still
    // while still showing the viewer's own (actor === viewer -> shouldAnimate own).
    const actorAnimates =
      actingPlayerId !== undefined && shouldAnimate(animationScope, actingPlayerId, playerId);

    if (actorAnimates) {
      for (const path of live.opponentMovePaths.current) {
        movePulses.push({ path });
      }
    }

    // Opponent captures (own ones come from the buffer above). Only infantry/mech capture, so an
    // accumulated ability position is a real capture iff the unit now there is one of those;
    // `currentCapturePoints` still set -> in progress, gone -> the tick that finished it. Anything
    // else (apc supply, etc.) is discarded. `full` (the AW hop + building sink) plays when the actor
    // animates; a "none" scope keeps just the chevron/flash indicator.
    if (actorAnimates || animationScope === "none") {
      for (const position of live.capturePositions.current) {
        const unit = getUnitAt(view, position);

        if (unit === undefined || (unit.type !== "infantry" && unit.type !== "mech")) {
          continue;
        }

        const stillCapturing =
          "currentCapturePoints" in unit && unit.currentCapturePoints !== undefined;
        capturePulses.push({ position, completed: !stillCapturing, full: actorAnimates });
      }
    }

    // A destruction is a public event either player caused, so it plays unless animations are off
    // entirely — mirroring how the fuel-out crash flourish is shown to both sides.
    if (animationScope !== "none") {
      for (const position of live.destroyedPositions.current) {
        deathPulses.push(position);
      }
    }

    live.opponentMovePaths.current = [];
    live.destroyedPositions.current = [];
    live.capturePositions.current = [];
  }

  return { turnStartPulse, crashPulse, movePulses, deathPulses, capturePulses };
}
