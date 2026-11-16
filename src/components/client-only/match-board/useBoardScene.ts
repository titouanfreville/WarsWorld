import type { AnimationScope } from "frontend/components/match/animation-scope";
import type { LiveEventBuffers } from "frontend/components/match/board-pulses";
import { createPulseGates, deriveBoardPulses } from "frontend/components/match/board-pulses";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import { useBoardSceneRefs } from "./useBoardSceneRefs";
import { usePixiApp } from "./usePixiApp";
import type { ActionQueueEvent, ActionQueueState } from "frontend/utils/action-queue";
import type { LoadedSpriteSheet } from "pixi/load-spritesheet";
import type { AttackForecastFocus } from "pixi/v2/board-controller";
import type { BoardSceneRefs } from "pixi/v2/board-scene";
import { mountBoardScene } from "pixi/v2/board-scene";
import type { PowerLaunchPulse } from "pixi/v2/render-power-effects";
import type { Dispatch } from "react";
import { useCallback, useEffect, useRef } from "react";

type ModeRefs = Pick<BoardSceneRefs, "deleteModeRef" | "teleportModeRef" | "devDeleteModeRef">;

type QueueRefs = Pick<BoardSceneRefs, "queueRef" | "priceTableRef">;

type Params = {
  /** The OPTIMISTIC view — what's on screen (authoritative state + buffered intent). */
  view: MatchView | undefined;
  snapshot: TurnSnapshot | null;
  spriteSheets: LoadedSpriteSheet | undefined;
  playerId: string;
  /** Whose turn it is, gating the live opponent-move animations. */
  actingPlayerId: string | undefined;
  animationScope: AnimationScope;
  queue: ActionQueueState;
  dispatchQueue: Dispatch<ActionQueueEvent>;
  /** Refs `useMatchBoard` owns; merged into the scene's ref bag. */
  queueRefs: QueueRefs;
  /** Refs `useBoardModes` owns; merged into the scene's ref bag. */
  modeRefs: ModeRefs;
  /** react-query's `dataUpdatedAt` for the match — the key the live-event drain is gated on. */
  dataUpdatedAt: number;
  live: LiveEventBuffers;
  /** Owned by `useUnitInspect`; the scene fills it in so React can paint the inspected ranges. */
  inspectHighlightRef: BoardSceneRefs["inspectHighlightRef"];
  /** The delayed CO-power set-piece; returns its pulse exactly once. See `usePowerBoardPulse`. */
  powerPulse: { nonce: number; takePulse: () => PowerLaunchPulse | undefined };
  onAttackTargetFocus: (focus: AttackForecastFocus | null) => void;
  onUnitInspect: (position: BoardPosition | null) => void;
  onContextMenu: (position: BoardPosition | null) => void;
  onTeleportPick: (position: BoardPosition | null) => void;
  onDevTeleport: (from: BoardPosition, to: BoardPosition) => void;
  onDevDeleteUnit: (position: BoardPosition) => void;
};

/**
 * The board's rendering half: owns the pixi app, the scene refs, and the single effect that rebuilds
 * the stage whenever the rendered view changes. Which one-shot flourishes that rebuild plays is
 * decided by `deriveBoardPulses` (pure, tested) — this hook only holds the play-once bookkeeping
 * across renders and hands the result to `mountBoardScene`.
 *
 * See `useMatchBoard` for the data half.
 */
export function useBoardScene(params: Params) {
  const { view, snapshot, spriteSheets, playerId, queue, dispatchQueue } = params;
  const { containerRef, appRef } = usePixiApp();
  const ownRefs = useBoardSceneRefs();
  const gatesRef = useRef(createPulseGates());

  const { matchRef, snapshotRef, resetInteractionRef } = ownRefs;

  // Interaction handlers read the OPTIMISTIC view (what's on screen), not the raw authoritative one,
  // so a just-moved unit is looked up at its new tile and can't be re-selected. Assign in an effect
  // rather than the render body (mutating a ref during render is a StrictMode/concurrent hazard) —
  // the handlers only read these lazily on a click/hover, well after the effect has committed.
  useEffect(() => {
    matchRef.current = view ?? null;
    snapshotRef.current = snapshot;
  }, [view, snapshot, matchRef, snapshotRef]);

  // (Re)render the stage content whenever the rendered (optimistic) view changes. The app persists.
  useEffect(() => {
    const app = appRef.current;

    if (app === null || view === undefined || spriteSheets === undefined) {
      return;
    }

    const pulses = deriveBoardPulses({
      view,
      playerId,
      actingPlayerId: params.actingPlayerId,
      animationScope: params.animationScope,
      queue,
      snapshot,
      dataUpdatedAt: params.dataUpdatedAt,
      gates: gatesRef.current,
      live: params.live,
    });

    mountBoardScene({
      app,
      view,
      spriteSheets,
      playerId,
      queue,
      dispatchQueue,
      refs: {
        ...ownRefs,
        ...params.queueRefs,
        ...params.modeRefs,
        inspectHighlightRef: params.inspectHighlightRef,
      },
      powerLaunchPulse: params.powerPulse.takePulse(),
      ...pulses,
      onAttackTargetFocus: params.onAttackTargetFocus,
      onUnitInspect: params.onUnitInspect,
      onContextMenu: params.onContextMenu,
      onTeleportPick: params.onTeleportPick,
      onDevTeleport: params.onDevTeleport,
      onDevDeleteUnit: params.onDevDeleteUnit,
    });
    // `dataUpdatedAt` is in the deps because the live-event drain keys on it: without it the effect
    // would rely on `view` getting a fresh identity every fetch, and a reference-stable refetch would
    // skip the drain and stall opponent animations until the next rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, spriteSheets, params.powerPulse.nonce, params.dataUpdatedAt]);

  /** Cancel whatever board interaction is in progress (selection, staged move, open menu). */
  const resetInteraction = useCallback(() => resetInteractionRef.current(), [resetInteractionRef]);

  return {
    /** Mount this on the always-rendered node the canvas attaches to. */
    containerRef,
    resetInteraction,
  };
}
