import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import type { Tile } from "shared/schemas/tile";
import { addUnit, createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";

/**
 * Regression: capturing a NEUTRAL property must never "eliminate" the neutral pseudo-player.
 *
 * `getPlayerBySlot(-1)` returns the neutral pseudo-player (not undefined), so the elimination path
 * (`capturingTile.type === "hq"`, or a lab when the owner has no HQ and ≤1 lab — both always true of
 * neutral) used to fire on a neutral capture and hand EVERY neutral property + unit to the captor.
 */
const LAB: [number, number] = [1, 0];
const CITY: [number, number] = [3, 0];
const NEUTRAL_UNIT: [number, number] = [4, 0];

const labTile = (playerSlot: number): Tile => ({ type: "lab", playerSlot }) as Tile;
const hqTile = (playerSlot: number): Tile => ({ type: "hq", playerSlot }) as Tile;

const captureAt = (position: [number, number]): MainAction => ({
  type: "move",
  path: [position],
  subAction: { type: "ability" },
});

const ownerAt = (match: ReturnType<typeof createTestMatch>, position: [number, number]): number => {
  const tile = match.changeableTiles.find(
    (t) => t.position[0] === position[0] && t.position[1] === position[1],
  );

  if (tile === undefined || !("playerSlot" in tile)) {
    throw new Error("expected a property at that position");
  }

  return tile.playerSlot;
};

/** Set up a captor sitting on `target` (one tick from finishing) plus a spare neutral city + unit. */
function scenario(target: [number, number], targetMapTile: Tile) {
  const match = createTestMatch({
    tiles: [[tiles.road(), targetMapTile, tiles.road(), tiles.city(-1), tiles.road()]],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    changeableTiles: [
      property(targetMapTile.type as "lab" | "hq", -1, target),
      property("city", -1, CITY),
    ],
  });
  const captor = addUnit(match.getPlayerBySlot(0)!, "infantry", target);
  (captor.data as { currentCapturePoints?: number }).currentCapturePoints = 10; // visualHP 10 → done
  addUnit(match.getPlayerBySlot(-1)!, "infantry", NEUTRAL_UNIT); // a neutral unit that must survive

  return match;
}

describe("neutral capture does not eliminate the neutral player", () => {
  it("capturing a neutral lab flips only that tile — other neutral property + units survive", () => {
    const match = scenario(LAB, labTile(-1));

    dispatchMainAction(match, captureAt(LAB));

    expect(ownerAt(match, LAB)).toBe(0); // the captured lab flips...
    expect(ownerAt(match, CITY)).toBe(-1); // ...but the other neutral property does NOT cascade.
    expect(match.getPlayerBySlot(-1)!.getUnits()).toHaveLength(1); // neutral unit not wiped
    expect(match.getUnit(NEUTRAL_UNIT)?.data.playerSlot).toBe(-1);
  });

  it("capturing a neutral HQ flips only that tile — no cascade", () => {
    const match = scenario(LAB, hqTile(-1));

    dispatchMainAction(match, captureAt(LAB));

    expect(ownerAt(match, LAB)).toBe(0);
    expect(ownerAt(match, CITY)).toBe(-1);
    expect(match.getPlayerBySlot(-1)!.getUnits()).toHaveLength(1);
  });
});
