import { describe, expect, it } from "vitest";
import type { MovementType } from "server/engine/constants/unit-properties";
import { getBaseMovementCost } from "server/engine/rules/movement-cost";
import type { GameVersion } from "shared/schemas/game-version";
import type { TileType } from "shared/schemas/tile";
import type { Weather } from "shared/schemas/weather";

/**
 * Movement cost = terrain × movement-type (× weather, except AWDS). `null` means impassable.
 * Data-driven because the rule is a lookup table plus a small weather-penalty branch — pinning it
 * guards terrain balance and the "impassable stays impassable" invariant against refactors.
 */
type Case = [MovementType, TileType, Weather, GameVersion, number | null];

const MOVEMENT_MATRIX: Case[] = [
  // Clear weather — base costs and impassability.
  ["foot", "plain", "clear", "AW2", 1],
  ["foot", "mountain", "clear", "AW2", 2],
  ["foot", "river", "clear", "AW2", 2],
  ["foot", "sea", "clear", "AW2", null], // land units can't enter the sea
  ["treads", "plain", "clear", "AW2", 1],
  ["treads", "forest", "clear", "AW2", 2],
  ["treads", "mountain", "clear", "AW2", null], // tanks can't climb mountains
  ["tires", "plain", "clear", "AW2", 2],
  ["tires", "forest", "clear", "AW2", 3],
  ["sea", "sea", "clear", "AW2", 1],
  ["sea", "plain", "clear", "AW2", null], // ships can't sail on land
  ["lander", "shoal", "clear", "AW2", 1], // transports can beach on shoals
  ["air", "mountain", "clear", "AW2", 1], // air ignores terrain
  ["air", "sea", "clear", "AW2", 1],
  ["pipe", "pipe", "clear", "AW2", 1],
  ["treads", "pipe", "clear", "AW2", null], // only pipe-runners use pipes

  // Rain (non-AWDS): tires/treads +1 on plains AND woods; everything else unaffected.
  ["treads", "plain", "rain", "AW2", 2], // 1 -> 2 (mud)
  ["treads", "forest", "rain", "AW2", 3], // 2 -> 3
  ["tires", "plain", "rain", "AW2", 3], // 2 -> 3
  ["tires", "forest", "rain", "AW2", 4], // 3 -> 4
  ["foot", "plain", "rain", "AW2", 1], // infantry unaffected by rain
  ["air", "mountain", "rain", "AW2", 1], // air unaffected by rain

  // Snow (non-AWDS).
  ["foot", "plain", "snow", "AW2", 2], // infantry double: 1 -> 2
  ["foot", "forest", "snow", "AW2", 2], // infantry double on woods: 1 -> 2
  ["foot", "mountain", "snow", "AW2", 4], // infantry double on mountains: 2 -> 4
  ["boots", "mountain", "snow", "AW2", 2], // mech double on mountains: 1 -> 2
  ["boots", "plain", "snow", "AW2", 1], // mech unaffected off mountains
  ["treads", "plain", "snow", "AW2", 2], // tires/treads +1 on plains: 1 -> 2
  ["treads", "forest", "snow", "AW2", 3], // ...and on woods: 2 -> 3 (the previously-missing penalty)
  ["tires", "forest", "snow", "AW2", 4], // 3 -> 4 (woods)
  ["air", "mountain", "snow", "AW2", 2], // air double everywhere: 1 -> 2
  ["sea", "sea", "snow", "AW2", 2], // ships double on sea: 1 -> 2
  ["lander", "port", "snow", "AW2", 2], // landers double on port: 1 -> 2

  // AWDS ignores weather movement penalties.
  ["treads", "plain", "rain", "AWDS", 1],
  ["treads", "forest", "snow", "AWDS", 2], // no snow penalty in AWDS
];

describe("terrain movement costs", () => {
  it.each(MOVEMENT_MATRIX)(
    "%s on %s (%s/%s) = %s",
    (movementType, tile, weather, version, expected) => {
      expect(getBaseMovementCost(movementType, weather, tile, version)).toBe(expected);
    },
  );
});
