import { describe, expect, it } from "vitest";
import { getProceduralCOProperties as getCOProperties } from "server/engine/rules/co";
import type { COProperties } from "server/engine/rules/co";
import { buildPhaseHooks } from "server/engine/constants/co-profile";
import { CO_PROFILES } from "server/engine/constants/co-profiles";
import { unitTypeSchema } from "shared/schemas/unit";
import type { UnitType, UnitWithVisibleStats } from "shared/schemas/unit";
import { UnitWrapper } from "server/engine/entities/unit";
import { createTestMatch, makeUnit, tiles } from "../helpers/scenario";

/**
 * Proves the declarative CO profiles reproduce the procedural engine hooks EXACTLY. For every
 * authored profile, phase and unit type, the generic hooks built from the profile must return the
 * same attack / defense / range / movement / build-cost / vision as `getCOProperties`. A failure
 * pinpoints the mis-transcribed CO/phase/unit, so scaling to all 57 COs stays safe.
 */

const UNIT_TYPES = unitTypeSchema.options as readonly UnitType[];

const PHASES = [
  { state: "no-power", key: "dayToDay", real: (c: COProperties) => c.dayToDay?.hooks },
  { state: "co-power", key: "coPower", real: (c: COProperties) => c.powers.COPower?.hooks },
  {
    state: "super-co-power",
    key: "superCoPower",
    real: (c: COProperties) => c.powers.superCOPower?.hooks,
  },
] as const;

const unitFor = (match: ReturnType<typeof createTestMatch>, type: UnitType, slot: number) =>
  new UnitWrapper({ ...makeUnit(type, [1, 0]), playerSlot: slot } as UnitWithVisibleStats, match);

describe("CO profile — reproduces the engine", () => {
  for (const profile of CO_PROFILES) {
    it(`${profile.gameVersion} / ${profile.key}`, () => {
      const realCo = getCOProperties({ name: profile.key, version: profile.gameVersion });

      // Road + plain + owned city so terrain-conditional hooks (Jake on plains, Koal on roads,
      // Kindle/Lash on properties + non-zero terrain stars) are all exercised.
      for (const terrain of [tiles.road, tiles.plain, () => tiles.city(0)] as const) {
        const match = createTestMatch({
          tiles: [Array.from({ length: 8 }, terrain)],
          // Non-zero funds + an owned Comm Tower so variable-scaling COs (Colin funds, Javier
          // commtower boost) are exercised with real values, not just the trivial zero case.
          changeableTiles: [{ type: "commtower", playerSlot: 0, position: [7, 0] }],
          players: [
            {
              slot: 0,
              coId: { name: profile.key, version: profile.gameVersion },
              hasCurrentTurn: true,
              funds: 3000,
            },
            { slot: 1, coId: { name: "andy", version: "AW1" } },
          ],
        });
        // Two opponents so opponent-conditioned modifiers (vsGroup) are actually exercised.
        const opponents = [unitFor(match, "infantry", 1), unitFor(match, "artillery", 1)];
        const terrainName = terrain().type;

        // Snow exercises weather-conditional hooks (Olaf AWDS); clear covers everyone else.
        for (const weather of ["clear", "snow"] as const) {
          match.setWeather(weather, 99);

          for (const phase of PHASES) {
            const mine = buildPhaseHooks(profile[phase.key]);
            const real = phase.real(realCo) ?? {};

            for (const type of UNIT_TYPES) {
              const u = unitFor(match, type, 0);
              const baseRange = "attackRange" in u.properties ? u.properties.attackRange[1] : 1;
              const where = `${profile.gameVersion}/${profile.key} ${phase.state} ${terrainName}/${weather} ${type}`;

              for (const opp of opponents) {
                expect(
                  mine.attack?.({ attacker: u, defender: opp }),
                  `attack ${where} vs ${opp.data.type}`,
                ).toBe(real.attack?.({ attacker: u, defender: opp }));
                expect(
                  mine.defense?.({ attacker: opp, defender: u }),
                  `defense ${where} vs ${opp.data.type}`,
                ).toBe(real.defense?.({ attacker: opp, defender: u }));
                expect(
                  mine.terrainStars?.(2, { attacker: opp, defender: u }),
                  `terrainStars ${where} vs ${opp.data.type}`,
                ).toBe(real.terrainStars?.(2, { attacker: opp, defender: u }));
              }

              expect(mine.attackRange?.(baseRange, u), `range ${where}`).toBe(
                real.attackRange?.(baseRange, u),
              );
              expect(mine.movementPoints?.(u.properties.movementPoints, u), `move ${where}`).toBe(
                real.movementPoints?.(u.properties.movementPoints, u),
              );
              expect(mine.movementCost?.(1, u), `movementCost ${where}`).toBe(
                real.movementCost?.(1, u),
              );
              expect(mine.buildCost?.(u.properties.cost, match), `buildCost ${where}`).toBe(
                real.buildCost?.(u.properties.cost, match),
              );
              expect(mine.vision?.(u.properties.vision), `vision ${where}`).toBe(
                real.vision?.(u.properties.vision),
              );

              const combat = { attacker: u, defender: opponents[0] };
              expect(mine.maxGoodLuck?.(combat), `goodLuck ${where}`).toBe(
                real.maxGoodLuck?.(combat),
              );
              expect(mine.maxBadLuck?.(combat), `badLuck ${where}`).toBe(real.maxBadLuck?.(combat));
            }
          }
        }
      }
    });
  }
});
