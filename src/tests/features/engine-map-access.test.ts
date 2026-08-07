import { describe, expect, test } from "vitest";
import { engineTerrainAccess, engineUnitDefaults } from "server/adapters/engine-map-access";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";

/**
 * The seam between the engine's tables and the `maps` ports.
 *
 * The unit builder hand-enumerates which units need a cargo slot and which can hide, and a wrong
 * guess there makes that unit silently unplaceable — `build` returns `null` and the palette entry
 * just refuses. So every type in the roster is built here: this is the test that keeps those sets
 * honest as units are added.
 */

describe("engineUnitDefaults", () => {
  const roster = Object.keys(unitPropertiesMap);

  test("offers the engine's whole roster", () => {
    expect(engineUnitDefaults.types()).toEqual(roster);
  });

  test.each(roster)("builds a schema-valid %s", (type) => {
    const built = engineUnitDefaults.build({ type, playerSlot: 0, position: [3, 4] });

    expect(
      built,
      `${type} did not survive unitSchema — check its cargo/hidden fields`,
    ).not.toBeNull();
    expect(built).toMatchObject({ type, playerSlot: 0, position: [3, 4], isReady: true });
  });

  test("gives every unit full HP and the engine's own starting fuel", () => {
    for (const type of roster) {
      const built = engineUnitDefaults.build({ type, playerSlot: 1, position: [0, 0] });
      const properties = unitPropertiesMap[type as keyof typeof unitPropertiesMap];

      expect(built).not.toBeNull();
      expect(built?.stats.hp).toBe(100);
      expect(built?.stats.fuel).toBe(properties.initialFuel);
    }
  });

  test("refuses a type that is not a unit", () => {
    expect(
      engineUnitDefaults.build({ type: "dragon", playerSlot: 0, position: [0, 0] }),
    ).toBeNull();
  });

  test("refuses a unit built for a seat the schema rejects", () => {
    expect(
      engineUnitDefaults.build({ type: "infantry", playerSlot: 99 as never, position: [0, 0] }),
    ).toBeNull();
  });
});

describe("engineTerrainAccess", () => {
  test("reads impassability straight off the engine's movement costs", () => {
    expect(engineTerrainAccess.canStand("treads", "sea")).toBe(false);
    expect(engineTerrainAccess.canStand("treads", "plain")).toBe(true);
    expect(engineTerrainAccess.canStand("foot", "mountain")).toBe(true);
    expect(engineTerrainAccess.canStand("treads", "mountain")).toBe(false);
    expect(engineTerrainAccess.canStand("sea", "sea")).toBe(true);
  });

  test("resolves a unit's movement type, and admits when it cannot", () => {
    expect(engineTerrainAccess.movementOf("infantry")).toBe("foot");
    expect(engineTerrainAccess.movementOf("mech")).toBe("boots");
    expect(engineTerrainAccess.movementOf("lander")).toBe("lander");
    expect(engineTerrainAccess.movementOf("dragon")).toBeUndefined();
  });

  test("every unit's movement type has somewhere it can stand", () => {
    for (const type of Object.keys(unitPropertiesMap)) {
      const movement = engineTerrainAccess.movementOf(type);

      expect(movement).toBeDefined();
    }
  });
});
