import { describe, expect, it } from "vitest";
import { getCOProperties } from "server/engine/rules/co";
import type { COPowerState } from "server/engine/rules/co";
import { coSchema } from "shared/schemas/co";
import type { GameVersion } from "shared/schemas/game-version";
import { unitTypeSchema } from "shared/schemas/unit";
import type { UnitType, UnitWithVisibleStats } from "shared/schemas/unit";
import { UnitWrapper } from "server/engine/entities/unit";
import { createTestMatch, makeUnit, tiles } from "../helpers/scenario";

/**
 * GOLDEN REGRESSION CONTRACT for the game-data-in-DB refactor.
 *
 * It snapshots the effective output of every CO's stat hooks — attack / defense / attack-range /
 * movement / build-cost / vision / movement-cost / terrain-stars / luck — for each phase
 * (day-to-day / CO power / super CO power) and each unit type, exactly as the CURRENT procedural
 * hooks produce them. When CO stats move into the DB and hooks become generic table-readers, this
 * snapshot must stay byte-identical — any diff means a mis-transcribed modifier.
 *
 * Fixture note: units sit on plain-equivalent road terrain, so terrain/property-conditional bonuses
 * (Jake on plains, Kindle on properties) are captured in their "off" state here. A terrain-varied
 * pass is added alongside those COs in the seed step.
 */

const VERSIONS: GameVersion[] = ["AW1", "AW2", "AWDS"];
const PHASES: COPowerState[] = ["no-power", "co-power", "super-co-power"];
const UNIT_TYPES = unitTypeSchema.options as readonly UnitType[];

const unitFor = (
  match: ReturnType<typeof createTestMatch>,
  type: UnitType,
  slot: number,
): UnitWrapper =>
  new UnitWrapper({ ...makeUnit(type, [1, 0]), playerSlot: slot } as UnitWithVisibleStats, match);

const snapshotCo = (version: GameVersion, coName: (typeof coSchema.options)[number]) => {
  const match = createTestMatch({
    tiles: [Array.from({ length: 8 }, () => tiles.road())],
    players: [
      { slot: 0, coId: { name: coName, version }, hasCurrentTurn: true },
      { slot: 1, coId: { name: "andy", version: "AW1" } },
    ],
  });

  const player = match.getPlayerBySlot(0)!;
  const reference = unitFor(match, "infantry", 1); // neutral opponent for combat-prop hooks

  const byPhase: Record<string, Record<string, Record<string, number>>> = {};

  for (const phase of PHASES) {
    player.data.COPowerState = phase;
    const byUnit: Record<string, Record<string, number>> = {};

    for (const type of UNIT_TYPES) {
      const unit = unitFor(match, type, 0);
      const stats: Record<string, number> = {};

      const record = (key: string, value: number | undefined) => {
        if (value !== undefined) {
          stats[key] = value;
        }
      };

      record("attack", player.getHook("attack")?.({ attacker: unit, defender: reference }));
      record("defense", player.getHook("defense")?.({ attacker: reference, defender: unit }));
      record("range", unit.getAttackRange()?.maxRange);
      record("move", unit.getMovementPoints());
      record("buildCost", unit.getBuildCost());
      record("vision", player.getHook("vision")?.(unit.properties.vision));
      record("movementCost", player.getHook("movementCost")?.(1, unit));
      record(
        "terrainStars",
        player.getHook("terrainStars")?.(2, { attacker: unit, defender: reference }),
      );
      record("luckGood", player.getHook("maxGoodLuck")?.({ attacker: unit, defender: reference }));
      record("luckBad", player.getHook("maxBadLuck")?.({ attacker: unit, defender: reference }));

      byUnit[type] = stats;
    }

    byPhase[phase] = byUnit;
  }

  return byPhase;
};

describe("CO modifiers — golden snapshot", () => {
  for (const version of VERSIONS) {
    for (const coName of coSchema.options) {
      it(`${version} / ${coName}`, () => {
        try {
          getCOProperties({ name: coName, version });
        } catch {
          return; // CO not implemented for this version — nothing to pin.
        }

        expect(snapshotCo(version, coName)).toMatchSnapshot();
      });
    }
  }
});
