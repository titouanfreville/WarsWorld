import { describe, expect, it } from "vitest";
import { mainEventToEmittables } from "server/engine/events/event-to-emittable";
import { fillDiscoveredUnitsAndProperties } from "server/engine/events/vision-update";
import type { EmittableEvent } from "server/engine/types/events";
import type { MainAction } from "shared/schemas/action";
import {
  addUnit,
  createTestMatch,
  dispatchMainAction,
  recomputeVision,
  tiles,
} from "../helpers/scenario";

const roadRow = (n: number) => [Array.from({ length: n }, () => tiles.road())];

/** Grab the (move) view for a team as a loose shape. */
function viewForTeam(
  emittables: ReturnType<typeof mainEventToEmittables>,
  teamIndex: number,
): { appearingUnit?: { stats?: unknown; loadedUnit?: unknown } } | undefined {
  return emittables.find((e) => e?.teamIndex === teamIndex) as
    | { appearingUnit?: { stats?: unknown; loadedUnit?: unknown } }
    | undefined;
}

const MOVE: MainAction = {
  type: "move",
  path: [
    [0, 0],
    [1, 0],
  ],
  subAction: { type: "wait" },
};

/**
 * A unit revealed out of fog (appearingUnit) or discovered by a moving scout (discoveredUnits) must
 * be masked for the RECEIVING team exactly like the board is — the WS reveal payload must not leak a
 * transport's cargo or a Sonja unit's hidden stats. See maskUnitForViewer.
 */
describe("fog reveal payload masking", () => {
  it("masks an appearing Sonja transport's cargo + stats for the discovering enemy", () => {
    const match = createTestMatch({
      tiles: roadRow(6),
      players: [
        { slot: 0, hasCurrentTurn: true, coId: { name: "sonja", version: "AW2" } },
        { slot: 1, coId: { name: "andy", version: "AW2" } },
      ],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    const infantryCargo = { type: "infantry" as const, stats: { hp: 80, fuel: 40 }, isReady: true };
    addUnit(p0, "apc", [0, 0], { loadedUnit: infantryCargo });
    addUnit(p1, "tank", [4, 0]); // vision 3: sees dest [1,0] (dist 3), not origin [0,0] (dist 4)
    recomputeVision(match);

    const emittables = mainEventToEmittables(match, dispatchMainAction(match, MOVE));
    const appearing = viewForTeam(emittables, 1)?.appearingUnit;

    expect(appearing).toBeDefined();
    expect(appearing?.stats).toBe("hidden"); // Sonja HP hidden
    expect(appearing?.loadedUnit).toBeNull(); // cargo stripped
  });

  it("fills discoveredUnits for EVERY team on a recalc event (not just team 0)", () => {
    const match = createTestMatch({
      tiles: roadRow(3),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p0, "infantry", [0, 0]);
    addUnit(p1, "infantry", [1, 0]); // adjacent — each team sees the other
    recomputeVision(match);

    // A recalc event (matchStart/passTurn/coPower) refills every team's discovered units.
    const events: (EmittableEvent | undefined)[] = [
      { type: "passTurn" } as unknown as EmittableEvent,
      { type: "passTurn" } as unknown as EmittableEvent,
      undefined, // spectator slot
    ];

    fillDiscoveredUnitsAndProperties(match, events);

    // Before the return->continue fix, team 1 was dropped (function returned after team 0).
    expect(events[0]?.discoveredUnits?.length).toBeGreaterThan(0);
    expect(events[1]?.discoveredUnits?.length).toBeGreaterThan(0);
  });
});
