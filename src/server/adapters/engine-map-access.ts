import { terrainProperties } from "server/engine/constants/terrain-properties";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";
import { unitSchema } from "server/core/schemas/unit";
import type { TileType } from "server/core/schemas/tile";
import type { TerrainAccess } from "server/maps/fairness";
import type { UnitDefaults } from "server/maps/unit-defaults";

/**
 * The engine-backed implementations of the `maps` feature's ports.
 *
 * They live here, in root-level infra, rather than inside either side: `maps` may not import
 * `engine` (features never import each other), and `engine` must not know a map checker exists.
 * This is the seam where the two are allowed to meet, and the composition root just wires it.
 */

/** The engine already answers this: a `null` movement cost means the tile is impassable. */
export const engineTerrainAccess: TerrainAccess = {
  canStand: (movement, tile) => terrainProperties[tile].movementCosts[movement] !== null,
  movementOf: (unitType) =>
    unitType in unitPropertiesMap
      ? unitPropertiesMap[unitType as keyof typeof unitPropertiesMap].movementType
      : undefined,
  // Keys of the engine's own terrain table, so a new tile appears in the builder's palette without
  // anyone maintaining a second list.
  tileTypes: () => Object.keys(terrainProperties) as TileType[],
  defenseStars: (tile) => terrainProperties[tile].defenseStars,
};

/** Transports whose schema requires a cargo slot. Empty at placement — you predeploy the carrier. */
const ONE_CARGO_SLOT = new Set(["apc", "transportCopter"]);
const TWO_CARGO_SLOTS = new Set(["blackBoat", "lander", "cruiser", "carrier"]);

/** Units that can be concealed. They start visible; hiding is a move, not a map property. */
const CONCEALABLE = new Set(["sub", "stealth"]);

/**
 * Fills a placed unit out to what the engine expects.
 *
 * Every unit is `unitSchema.parse`d on the way out, so if the shape here is wrong the build fails
 * rather than writing a unit into a map that only explodes when someone tries to play it. That
 * safety net is the reason the cargo and concealment sets above can be hand-written at all.
 */
export const engineUnitDefaults: UnitDefaults = {
  types: () => Object.keys(unitPropertiesMap),

  describe: (unitType) => {
    if (!(unitType in unitPropertiesMap)) {
      return null;
    }

    const { displayName, cost, movementPoints, vision, facility } =
      unitPropertiesMap[unitType as keyof typeof unitPropertiesMap];

    return { displayName, cost, movementPoints, vision, facility };
  },

  build: ({ type, playerSlot, position }) => {
    if (!(type in unitPropertiesMap)) {
      return null;
    }

    const properties = unitPropertiesMap[type as keyof typeof unitPropertiesMap];

    const parsed = unitSchema.safeParse({
      type,
      playerSlot,
      position,
      isReady: true,
      stats: {
        hp: 100,
        fuel: properties.initialFuel,
        ...("initialAmmo" in properties ? { ammo: properties.initialAmmo } : {}),
      },
      ...(CONCEALABLE.has(type) ? { hidden: false } : {}),
      ...(ONE_CARGO_SLOT.has(type) ? { loadedUnit: null } : {}),
      ...(TWO_CARGO_SLOTS.has(type) ? { loadedUnit: null, loadedUnit2: null } : {}),
    });

    return parsed.success ? parsed.data : null;
  },
};
