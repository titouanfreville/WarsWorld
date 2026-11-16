import type { RouterOutput } from "frontend/utils/trpc-client";
import type { BoardPosition } from "./match-view";
import { posKey } from "./match-view";

/** The BE unit-inspection payload (stats + the tile sets the overlay colours). tRPC-inferred. */
export type UnitInspection = NonNullable<RouterOutput["match"]["previews"]["unitDetails"]>;

/** `full` = movement (+ reach, for direct units) on first right-click; `direct` = in-place attack. */
export type InspectMode = "full" | "direct";

/** White (reachable) and red (attack) tiles the board should paint for an inspected unit. */
export type InspectHighlights = { reachable: BoardPosition[]; attack: BoardPosition[] };

/**
 * Colour the inspected unit's tiles per the board rules:
 * - `direct` (second right-click): no movement, just the in-place attack reach in red.
 * - `full` on an INDIRECT unit: movement only. An indirect fires from where it stands — it can't
 *   move and shoot in the same turn — so pairing its movement with an attack overlay would draw a
 *   threat it cannot actually carry out this turn. Its real reach is the `direct` view.
 * - `full` on a direct unit, own: white = where it can move, red = the enemies it can actually hit.
 * - `full` on a direct unit, enemy: white = its movement, red = its danger zone — every tile it could
 *   attack that ISN'T already in its movement range (so the two colours never overlap). Your units
 *   sitting in the red are in danger; the empty red tiles are reachable by its attack, not its move.
 *
 * `isIndirect` is BE-computed (the engine's `unit.isIndirect()`) — never inferred here from the range
 * numbers, which would put a rule on the client.
 */
export const inspectHighlights = (
  inspection: UnitInspection,
  mode: InspectMode,
): InspectHighlights => {
  // A pipe seam (`kind: "terrain"`) is inspectable for its HP but goes nowhere and threatens nothing,
  // so it paints no tiles. Narrowing on the BE's discriminator rather than probing for fields.
  if (inspection.kind === "terrain") {
    return { reachable: [], attack: [] };
  }

  if (mode === "direct") {
    return { reachable: [], attack: inspection.directAttackTiles };
  }

  if (inspection.isIndirect) {
    return { reachable: inspection.reachableTiles, attack: [] };
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
