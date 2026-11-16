import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import {
  addUnit,
  createTestMatch,
  dispatchMainAction,
  property,
  recomputeVision,
  tiles,
} from "../helpers/scenario";

const road = tiles.road;

/**
 * Fog of war — what each team can see. This is the highest-risk area for a server-authoritative
 * refactor (a leak reveals hidden units to the wrong player). Tests exercise `Vision` range plus
 * the team-visibility layers: unit sight, stealth (sub/stealth) adjacency reveal, and property reveal.
 */
describe("fog of war vision", () => {
  it("sees enemy units within a unit's vision range but not beyond", () => {
    const match = createTestMatch({
      tiles: [[road(), road(), road(), road(), road(), road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p0, "infantry", [0, 0]); // infantry vision = 2
    addUnit(p1, "infantry", [2, 0]); // within range
    addUnit(p1, "infantry", [5, 0]); // out of range
    recomputeVision(match);

    expect(p0.team.canSeeUnitAtPosition([2, 0])).toBe(true);
    expect(p0.team.canSeeUnitAtPosition([5, 0])).toBe(false);
  });

  it("keeps a hidden sub concealed until a friendly unit is adjacent", () => {
    const match = createTestMatch({
      tiles: [[road(), road(), road(), road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p0, "infantry", [0, 0]);
    addUnit(p1, "sub", [3, 0], { hidden: true });
    recomputeVision(match);

    // Hidden and no friendly unit adjacent → concealed.
    expect(p0.team.canSeeUnitAtPosition([3, 0])).toBe(false);

    // A friendly unit next to it reveals it (regardless of vision range).
    addUnit(p0, "infantry", [2, 0]);
    recomputeVision(match);
    expect(p0.team.canSeeUnitAtPosition([3, 0])).toBe(true);
  });

  it("reveals an enemy standing on one of your properties", () => {
    const match = createTestMatch({
      tiles: [[road(), road(), road(), road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 0, [3, 0])], // owned by team 0
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p0, "infantry", [0, 0]); // far from the property
    addUnit(p1, "infantry", [3, 0]); // enemy sitting on team 0's city
    recomputeVision(match);

    expect(p0.team.canSeeUnitAtPosition([3, 0])).toBe(true);
  });

  // Regression: the former owner must LOSE sight of a captured property, and stay blind to it across
  // the next vision recompute (every passTurn). Vision keyed properties by array reference, so the
  // capture's `removeOwnedProperty(unit.data.position)` (a fresh array) never deleted the entry —
  // recalculateVision then rebuilt the old owner's sight of the tile they no longer own.
  it("takes property vision away from the former owner when it's captured", () => {
    const CAPTURE: MainAction = { type: "move", path: [[0, 0]], subAction: { type: "ability" } };
    const PASS_TURN: MainAction = { type: "passTurn" };

    const match = createTestMatch({
      tiles: [[road(), road(), road(), road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, [0, 0])], // team 1's city, being captured by team 0
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    const p1 = match.getPlayerBySlot(1)!;
    addUnit(p0, "infantry", [0, 0]); // stands on the city to capture it
    addUnit(p1, "infantry", [3, 0]); // far away — team 1 sees [0,0] ONLY via owning the city
    recomputeVision(match);

    // Team 1 sees its own city tile before losing it.
    expect(p1.team.vision?.isPositionVisible([0, 0])).toBe(true);

    // Capture takes two turns (20 - 10 visual HP per tick); two passes bring the turn back to slot 0.
    dispatchMainAction(match, CAPTURE);
    dispatchMainAction(match, PASS_TURN);
    dispatchMainAction(match, PASS_TURN);
    dispatchMainAction(match, CAPTURE);

    expect(match.getTile([0, 0])).toMatchObject({ playerSlot: 0 }); // ownership flipped

    // Simulate the passTurn vision recompute: the former owner must NOT regain sight of the tile.
    recomputeVision(match);
    expect(p1.team.vision?.isPositionVisible([0, 0])).toBe(false);
  });

  // Companion: HQ capture eliminates the owner and transfers ALL their properties. That transfer must
  // hand vision over too, so the NEW owner sees the transferred (distant) property after a recompute.
  it("hands transferred-property vision to the new owner on HQ capture", () => {
    const CAPTURE: MainAction = { type: "move", path: [[0, 0]], subAction: { type: "ability" } };
    const PASS_TURN: MainAction = { type: "passTurn" };

    const match = createTestMatch({
      tiles: [[road(), road(), road(), road(), road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("hq", 1, [0, 0]), property("city", 1, [4, 0])],
      rules: { fogOfWar: true },
    });
    const p0 = match.getPlayerBySlot(0)!;
    addUnit(p0, "infantry", [0, 0]); // captures the HQ; vision 2 can't reach the distant city [4,0]
    recomputeVision(match);

    // Before: team 0 can't see the enemy city 4 tiles away.
    expect(p0.team.vision?.isPositionVisible([4, 0])).toBe(false);

    dispatchMainAction(match, CAPTURE);
    dispatchMainAction(match, PASS_TURN);
    dispatchMainAction(match, PASS_TURN);
    dispatchMainAction(match, CAPTURE); // HQ falls -> owner eliminated, city transfers to slot 0

    expect(match.getTile([4, 0])).toMatchObject({ playerSlot: 0 });

    // The transferred property now reveals its tile to its new owner, even after a recompute.
    recomputeVision(match);
    expect(p0.team.vision?.isPositionVisible([4, 0])).toBe(true);
  });
});
