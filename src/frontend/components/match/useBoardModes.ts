import type { BoardPosition } from "frontend/components/match/match-view";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The armed board modes, all mutually exclusive.
 *
 * - `scrap` — every left-click on one of the viewer's OWN units disbands it, and keeps doing so
 *   until the mode is turned off. A normal `delete` action through the action queue.
 * - `teleport` — dev tool. `null` = off; `{ from: null }` = armed, waiting for a unit;
 *   `{ from: pos }` = unit picked, the next click is the destination.
 * - `devDelete` — dev tool. Distinct from `scrap`: reaches ANY unit, enemies included, via the dev
 *   endpoint rather than the action queue.
 */
export type BoardModes = {
  scrap: boolean;
  teleport: { from: BoardPosition | null } | null;
  devDelete: boolean;
};

const NO_MODES: BoardModes = { scrap: false, teleport: null, devDelete: false };

type Params = {
  isMyTurn: boolean;
  isGameOver: boolean;
};

/**
 * Owns the three armed board modes and the invariant that binds them: **exactly one can be armed at
 * a time**. The pixi click handler checks scrap, then dev-delete, then teleport, so two armed modes
 * would silently give one priority — every arming path here disarms the others by construction,
 * rather than each call site having to remember to.
 *
 * Each mode is mirrored into a ref because the click handler reads it lazily, long after the scene
 * mounted; the state drives the banners. Both are written together so the two can't drift.
 */
export function useBoardModes({ isMyTurn, isGameOver }: Params) {
  const [modes, setModesState] = useState<BoardModes>(NO_MODES);
  const modesRef = useRef<BoardModes>(NO_MODES);

  // Refs in the shape `BoardSceneRefs` wants, so they can be spread straight into the scene.
  const deleteModeRef = useRef(false);
  const teleportModeRef = useRef<{ from: BoardPosition | null } | null>(null);
  const devDeleteModeRef = useRef(false);

  const apply = useCallback((next: BoardModes) => {
    modesRef.current = next;
    deleteModeRef.current = next.scrap;
    teleportModeRef.current = next.teleport;
    devDeleteModeRef.current = next.devDelete;
    setModesState(next);
  }, []);

  const disarmAll = useCallback(() => apply(NO_MODES), [apply]);

  const toggleScrap = useCallback(
    () => apply({ ...NO_MODES, scrap: !modesRef.current.scrap }),
    [apply],
  );

  const toggleTeleport = useCallback(
    () =>
      apply({ ...NO_MODES, teleport: modesRef.current.teleport === null ? { from: null } : null }),
    [apply],
  );

  const toggleDevDelete = useCallback(
    () => apply({ ...NO_MODES, devDelete: !modesRef.current.devDelete }),
    [apply],
  );

  /** The unit picked as the teleport source (or `null` to cancel the pick). */
  const setTeleportSource = useCallback(
    (from: BoardPosition | null) =>
      apply({ ...NO_MODES, teleport: from === null ? null : { from } }),
    [apply],
  );

  // Disarm scrap mode the moment the turn stops being yours. A destructive mode must not outlive the
  // turn it was armed in: left on, the first click of your NEXT turn would disband a unit instead of
  // selecting it. The dev modes are deliberately NOT disarmed here — they are staff tools that work
  // off-turn by design.
  useEffect(() => {
    if (!isMyTurn) {
      apply({ ...modesRef.current, scrap: false });
    }
  }, [isMyTurn, apply]);

  // A finished match ends ALL modes. Their banners already hide on game-over, but the armed refs and
  // the pixi click handlers would otherwise survive — a post-finish click would still fire a
  // teleport / delete against a match the server can only reject.
  useEffect(() => {
    if (isGameOver) {
      disarmAll();
    }
  }, [isGameOver, disarmAll]);

  return {
    modes,
    refs: { deleteModeRef, teleportModeRef, devDeleteModeRef },
    toggleScrap,
    toggleTeleport,
    toggleDevDelete,
    setTeleportSource,
    disarmAll,
  };
}
