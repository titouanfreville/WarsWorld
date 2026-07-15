import { describe, expect, it } from "vitest";
import { fogViewChangeableTiles } from "server/engine/previews/fog-view";
import type { MainAction } from "shared/schemas/action";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import {
  addUnit,
  createTestMatch,
  dispatchMainAction,
  property,
  recomputeVision,
  tiles,
} from "../helpers/scenario";

/**
 * Fog-of-war property visibility: `match.full` fog-projects `changeableTiles` so a capture out of a
 * viewer's vision does NOT leak (the board refetches match.full on every event, bypassing the
 * correctly-fogged live delta). A fogged property shows its LAST-KNOWN owner, not the live one.
 *
 * Scenario: a 5-wide road row with a city at [3,0]. Infantry vision is 2, so a unit at [1,0] sees
 * [3,0] but a unit at [0,0] does not.
 */
const CITY: [number, number] = [3, 0];

/** An in-place capture (stay put + ability) by the unit standing on the property. */
const CAPTURE: MainAction = { type: "move", path: [CITY], subAction: { type: "ability" } };

const ownerOf = (result: ChangeableTile[], position: [number, number]): number => {
  const tile = result.find((t) => t.position[0] === position[0] && t.position[1] === position[1]);

  if (tile === undefined || !("playerSlot" in tile)) {
    throw new Error("expected a property tile at that position");
  }

  return tile.playerSlot;
};

const row = (...t: ReturnType<typeof tiles.road>[]) => [t];

describe("fog property visibility (match.full changeableTiles)", () => {
  it("fog off → sends the live owner untouched", () => {
    const match = createTestMatch({
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 0, CITY)], // slot 0 currently owns it
      rules: { fogOfWar: false },
    });

    const viewer = match.getPlayerBySlot(1)!.team;

    expect(ownerOf(fogViewChangeableTiles(match, viewer), CITY)).toBe(0);
  });

  it("visible property → reveals the true owner and remembers it", () => {
    const match = createTestMatch({
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, CITY)],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    addUnit(p0, "infantry", [1, 0]); // vision 2 covers [3,0]
    recomputeVision(match);

    expect(ownerOf(fogViewChangeableTiles(match, p0.team), CITY)).toBe(1);
    // ...and the sighting is recorded as the team's last-known owner.
    expect(p0.team.getLastKnownPropertyOwner(CITY)).toBe(1);
  });

  it("once the property leaves vision, keeps the last-known owner — a later capture doesn't leak", () => {
    const match = createTestMatch({
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, CITY)],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const scout = addUnit(p0, "infantry", [1, 0]);
    recomputeVision(match);

    // While visible, the viewer records owner 1.
    expect(ownerOf(fogViewChangeableTiles(match, p0.team), CITY)).toBe(1);

    // The scout walks away so [3,0] is no longer visible, and — out of the viewer's sight — the city
    // changes hands to slot 0.
    scout.data.position = [0, 0];
    recomputeVision(match);
    (match.changeableTiles[0] as { playerSlot: number }).playerSlot = 0;

    // The viewer still sees the owner they last saw (1), NOT the live owner (0).
    expect(ownerOf(fogViewChangeableTiles(match, p0.team), CITY)).toBe(1);
  });

  it("never-seen property → shows the map's initial owner, hiding a pre-sight capture", () => {
    const match = createTestMatch({
      // Map-initial owner is NEUTRAL (-1)...
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(-1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      // ...but slot 0 has already captured it live.
      changeableTiles: [property("city", 0, CITY)],
      rules: { fogOfWar: true },
    });
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p1, "infantry", [0, 0]); // too far to see [3,0]
    recomputeVision(match);

    // Slot 1 never saw the city, so it shows the initial neutral owner — the capture stays hidden.
    expect(ownerOf(fogViewChangeableTiles(match, p1.team), CITY)).toBe(-1);
  });
});

/**
 * Witnessing rule: you always have vision of your OWN property as it's captured, so capturing your
 * building is a KNOWN event — you learn who took it even after you then lose vision of the tile. A
 * neutral captured with no vision stays unknown. Captures run through the real engine pipeline.
 */
describe("fog property visibility — capture witnessing", () => {
  it("your own building being captured is known: you learn the new owner even after losing vision", () => {
    const match = createTestMatch({
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, CITY)], // slot 1 owns it
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    // slot 0's infantry stands on slot 1's city, one tick from finishing the capture.
    const captor = addUnit(p0, "infantry", CITY);
    (captor.data as { currentCapturePoints?: number }).currentCapturePoints = 10; // visualHP 10 → done
    recomputeVision(match);

    // slot 1 owns the city, so it sees it (owned properties grant vision).
    expect(ownerOf(fogViewChangeableTiles(match, p1.team), CITY)).toBe(1);

    dispatchMainAction(match, CAPTURE);

    // slot 1 has lost the city (and its vision), but WITNESSED the flip → now sees the new owner (0).
    expect(match.getPlayerBySlot(1)!.team.isPositionVisible(CITY)).toBe(false);
    expect(ownerOf(fogViewChangeableTiles(match, p1.team), CITY)).toBe(0);
  });

  it("a neutral captured out of your vision stays unknown (still shows neutral)", () => {
    const match = createTestMatch({
      tiles: row(tiles.road(), tiles.road(), tiles.road(), tiles.city(-1), tiles.road()),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", -1, CITY)], // neutral
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    const captor = addUnit(p0, "infantry", CITY);
    (captor.data as { currentCapturePoints?: number }).currentCapturePoints = 10;
    addUnit(p1, "infantry", [0, 0]); // too far to see [3,0]
    recomputeVision(match);

    dispatchMainAction(match, CAPTURE);

    // slot 1 never saw it captured → still neutral.
    expect(ownerOf(fogViewChangeableTiles(match, p1.team), CITY)).toBe(-1);
  });
});
