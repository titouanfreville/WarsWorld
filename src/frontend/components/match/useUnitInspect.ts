import { inspectHighlights, type InspectMode } from "frontend/components/match/inspect-highlights";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import {
  getArmyForSlot,
  getUnitAt,
  samePosition,
  toTuple,
} from "frontend/components/match/match-view";
import type { Army } from "frontend/utils/sprites";
import { trpc } from "frontend/utils/trpc-client";
import { useCallback, useEffect, useRef, useState } from "react";

type Params = {
  matchId: string;
  playerId: string;
  /** The OPTIMISTIC view — the card names the unit the player can actually see on the board. */
  view: MatchView | undefined;
};

/** Paints reachable/threat tiles onto the board. Filled in by the scene once it mounts. */
type HighlightPainter = (
  reachable: readonly BoardPosition[],
  attack: readonly BoardPosition[],
) => void;

/**
 * The right-click "inspect a unit" overlay: which unit is being looked at, its BE stat readout, and
 * the movement/threat ranges painted onto the board.
 *
 * Right-clicking the SAME unit rolls full -> direct -> off, so repeated right-clicks cycle the views
 * and then dismiss — right-click stays its own way out, without reaching for the left button. A
 * right-click on a different unit starts that unit's roll at `full`; null clears outright.
 */
export function useUnitInspect({ matchId, playerId, view }: Params) {
  const [inspect, setInspect] = useState<{ pos: BoardPosition; mode: InspectMode } | null>(null);
  const position = inspect?.pos ?? null;
  // Owned here rather than by the scene: this is the only React consumer, and owning it keeps the
  // hook order acyclic — the scene takes `handleInspect` and this ref, not the other way round.
  const highlightRef = useRef<HighlightPainter>(() => undefined);

  const handleInspect = useCallback((pos: BoardPosition | null) => {
    if (pos === null) {
      setInspect(null);

      return;
    }

    setInspect((prev) => {
      if (prev === null || !samePosition(prev.pos, pos)) {
        return { pos, mode: "full" };
      }

      return prev.mode === "full" ? { pos, mode: "direct" } : null;
    });
  }, []);

  /** Dismiss the card and wipe the range overlay it was showing. */
  const close = useCallback(() => {
    setInspect(null);
    highlightRef.current([], []);
  }, []);

  // BE stat readout for the inspected unit. Enabled only while a unit is being inspected.
  const detailsQuery = trpc.match.previews.unitDetails.useQuery(
    { matchId, playerId, unitPosition: position === null ? [0, 0] : toTuple(position) },
    { enabled: position !== null },
  );

  // Drop the card if its unit is gone (moved/destroyed by a refetch) — the BE rejects the stale
  // position, so close rather than show a spinning query.
  useEffect(() => {
    if (position !== null && detailsQuery.isError) {
      setInspect(null);
    }
  }, [position, detailsQuery.isError]);

  // Paint the inspected unit's ranges once the BE returns them — coloured per rule (own vs enemy)
  // and per mode (full vs the second-click direct view). Depends on the view so it repaints after a
  // scene rebuild while a unit stays inspected. We don't clear on the empty branch: the board's own
  // reset owns clearing the highlight layer, and clearing here would wipe a fresh selection's tiles.
  useEffect(() => {
    if (inspect !== null && detailsQuery.data !== undefined) {
      const { reachable, attack } = inspectHighlights(detailsQuery.data, inspect.mode);
      highlightRef.current(reachable, attack);
    }
  }, [inspect, detailsQuery.data, view]);

  // Army of the inspected unit's owner, for its sprite in the detail card.
  const unit = position !== null && view !== undefined ? getUnitAt(view, position) : undefined;
  const army =
    unit !== undefined && view !== undefined
      ? (getArmyForSlot(view, unit.playerSlot) as Army | undefined)
      : undefined;

  // Army owning the TERRAIN under the inspected unit, so the card can draw the tile in its owner's
  // colours. Distinct from `army`: a unit routinely stands on someone else's property, and an
  // unowned tile (playerSlot null or the neutral -1) has no army at all.
  const terrainSlot = detailsQuery.data?.terrain.playerSlot ?? null;
  const terrainArmy =
    terrainSlot !== null && terrainSlot !== -1 && view !== undefined
      ? (getArmyForSlot(view, terrainSlot) as Army | undefined)
      : undefined;

  return {
    position,
    details: detailsQuery.data,
    army,
    terrainArmy,
    handleInspect,
    close,
    highlightRef,
  };
}
