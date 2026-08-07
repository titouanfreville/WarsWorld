import type { MovementType } from "server/engine/constants/unit-properties";
import type { TileType } from "server/core/schemas/tile";
import type { TerrainAccess } from "server/maps/fairness";
import type { UnitDefaults } from "server/maps/unit-defaults";

/**
 * Hand-written stand-ins for the `maps` feature's engine ports.
 *
 * Deliberately not the real engine tables: these fixtures assert what the CHECKER does with the
 * answers, so a balance change to a real unit must not be able to rewrite a test's meaning. The
 * production wiring is verified separately, against the engine itself, in `engine-map-access.test.ts`.
 */

const LAND: string[] = [
  "plain",
  "road",
  "bridge",
  "forest",
  "hq",
  "city",
  "base",
  "airport",
  "port",
  "lab",
  "commtower",
];

/** Only foot and boots may enter these. */
const ROUGH: string[] = ["mountain", "river"];
const WATER: string[] = ["sea", "reef"];

const MOVEMENT: Record<string, MovementType> = {
  infantry: "foot",
  mech: "boots",
  recon: "tires",
  tank: "treads",
  lander: "lander",
  battleship: "sea",
  fighter: "air",
  pipeRunner: "pipe",
};

export const fakeTerrainAccess: TerrainAccess = {
  canStand: (movement, tile) => {
    switch (movement) {
      case "foot":
      case "boots":
        return LAND.includes(tile) || ROUGH.includes(tile);
      case "treads":
      case "tires":
        return LAND.includes(tile);
      case "air":
        return true;
      case "sea":
        return WATER.includes(tile) || tile === "port";
      case "lander":
        return tile === "sea" || tile === "shoal" || tile === "port";
      case "pipe":
        return tile === "pipe" || tile === "pipeSeam";
      default:
        return false;
    }
  },

  movementOf: (unitType) => MOVEMENT[unitType],

  tileTypes: () => [...LAND, ...ROUGH, ...WATER, "shoal", "pipe", "pipeSeam"] as TileType[],

  defenseStars: (tile) => (tile === "mountain" ? 4 : tile === "forest" ? 2 : 0),
};

export const fakeUnitDefaults: UnitDefaults = {
  types: () => Object.keys(MOVEMENT),

  describe: (unitType) =>
    unitType in MOVEMENT
      ? {
          displayName: unitType,
          cost: 1000,
          movementPoints: 3,
          vision: 2,
          facility: "base",
        }
      : null,

  build: ({ type, playerSlot, position }) =>
    type in MOVEMENT
      ? ({ type, playerSlot, position, isReady: true, stats: { hp: 100, fuel: 99 } } as never)
      : null,
};
