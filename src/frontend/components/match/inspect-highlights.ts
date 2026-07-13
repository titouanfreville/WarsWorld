import type { inferTRPCOutput } from "frontend/utils/trpc-client";
import type { BoardPosition } from "./match-view";
import { posKey } from "./match-view";

/** The BE unit-inspection payload (stats + the tile sets the overlay colours). tRPC-inferred. */
export type UnitInspection = NonNullable<inferTRPCOutput<"matchPreview", "unitDetails">>;

/** `full` = movement + reach on first right-click; `direct` = in-place attack only on the second. */
export type InspectMode = "full" | "direct";

/** Blue (reachable) and red (attack) tiles the board should paint for an inspected unit. */
export type InspectHighlights = { reachable: BoardPosition[]; attack: BoardPosition[] };

/**
 * Colour the inspected unit's tiles per the board rules:
 * - `direct` (second right-click): no movement, just the in-place attack reach in red.
 * - own unit: blue = where it can move, red = the enemy units it can actually attack.
 * - enemy unit: blue = its movement, red = its danger zone — every tile it could attack that ISN'T
 *   already in its movement range (so the two colours never overlap). Your units sitting in the red
 *   are the ones in danger; the empty red tiles are reachable only by its attack, not its movement.
 */
export const inspectHighlights = (
  inspection: UnitInspection,
  mode: InspectMode,
): InspectHighlights => {
  if (mode === "direct") {
    return { reachable: [], attack: inspection.directAttackTiles };
  }

  if (inspection.isOwn) {
    return { reachable: inspection.reachableTiles, attack: inspection.attackTargetTiles };
  }

  const movement = new Set(inspection.reachableTiles.map(posKey));

  return {
    reachable: inspection.reachableTiles,
    attack: inspection.attackableTiles.filter((tile) => !movement.has(posKey(tile))),
  };
};
