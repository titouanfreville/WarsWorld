import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import type { TurnSnapshot, UnloadDrop } from "frontend/components/match/turn-snapshot-view";
import type { BoardSceneRefs } from "pixi/v2/board-scene";
import type { Container } from "pixi.js";
import { useRef } from "react";

/**
 * The scene refs the board itself owns. The rest of `BoardSceneRefs` is owned elsewhere and merged
 * in by `useBoardScene`: the queue/price refs come from `useMatchBoard`, the three armed-mode refs
 * from `useBoardModes`, and the highlight callback from `useUnitInspect` (its only React consumer).
 */
export type BoardSceneOwnRefs = Omit<
  BoardSceneRefs,
  | "priceTableRef"
  | "queueRef"
  | "deleteModeRef"
  | "teleportModeRef"
  | "devDeleteModeRef"
  | "inspectHighlightRef"
>;

/**
 * Allocates every ref the pixi scene reads/writes across renders — display objects, ticker
 * callbacks, and the interaction state the click handlers read lazily.
 *
 * These are refs rather than state on purpose: the scene is imperative, and re-rendering React on
 * every hover/selection change would tear down and rebuild the whole stage. See `BoardSceneRefs` in
 * `pixi/v2/board-scene.ts` for what each one carries.
 */
export function useBoardSceneRefs(): BoardSceneOwnRefs {
  return {
    reachableHighlightRef: useRef<Container | null>(null),
    attackHighlightRef: useRef<Container | null>(null),
    unloadHighlightRef: useRef<Container | null>(null),
    pathArrowRef: useRef<Container | null>(null),
    plannedPathRef: useRef<BoardPosition[]>([]),
    shimmerRef: useRef<((delta: number) => void) | null>(null),
    weatherAnimRef: useRef<((delta: number) => void) | null>(null),
    turnStartAnimRef: useRef<((delta: number) => void) | null>(null),
    crashAnimRef: useRef<((delta: number) => void) | null>(null),
    powerAuraAnimRef: useRef<((delta: number) => void) | null>(null),
    powerLaunchAnimRef: useRef<((delta: number) => void) | null>(null),
    moveAnimRef: useRef<((delta: number) => void)[]>([]),
    moveLayerRef: useRef<Container | null>(null),
    activeSlideDestsRef: useRef<Set<string>>(new Set()),
    unitsContainerRef: useRef<Container | null>(null),
    mapContainerRef: useRef<Container | null>(null),
    selectionRef: useRef<BoardPosition | null>(null),
    stagedDestRef: useRef<BoardPosition | null>(null),
    attackTargetsRef: useRef<BoardPosition[]>([]),
    unloadDropsRef: useRef<UnloadDrop[]>([]),
    missileArmRef: useRef<{ path: readonly BoardPosition[] } | null>(null),
    resetInteractionRef: useRef<() => void>(() => undefined),
    matchRef: useRef<MatchView | null>(null),
    snapshotRef: useRef<TurnSnapshot | null>(null),
  };
}
