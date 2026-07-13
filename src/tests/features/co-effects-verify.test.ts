import { describe, expect, it, vi } from "vitest";
import { getProceduralCOProperties as getCOProperties } from "server/engine/rules/co";
import type { COProperties } from "server/engine/rules/co";
import type { CO } from "shared/schemas/co";
import { applyEffects } from "server/engine/constants/co-effects";
import { CO_PROFILES } from "server/engine/constants/co-profiles";
import type { Position } from "shared/schemas/position";
import type { MatchWrapper } from "server/engine/entities/match";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

/**
 * Proves the declarative CO EFFECTS reproduce the procedural `instantEffect`s EXACTLY. For every
 * authored phase that has effects, we build two identical matches, run the real `instantEffect` on
 * one and `applyEffects(profile.effects)` on the other (feeding both the SAME engine-computed target
 * positions), then assert the resulting match state is byte-identical. Complements the hook-level
 * `co-profile-verify` so the whole CO — passive stats AND one-shot power effects — is validated
 * before the DB seed.
 */

type PowerReal = COProperties["powers"]["COPower"];

const PHASES = [
  { key: "coPower", real: (c: COProperties) => c.powers.COPower },
  { key: "superCoPower", real: (c: COProperties) => c.powers.superCOPower },
] as const;

/** A small map with owned cities (empty ones for Sensei spawns, an occupied one for Kindle). */
const buildMatch = (coName: CO, version: "AW1" | "AW2" | "AWDS"): MatchWrapper => {
  const cityAt = new Set(["2,2", "4,3", "4,4"]);
  const grid = Array.from({ length: 5 }, (_, y) =>
    Array.from({ length: 5 }, (_, x) => (cityAt.has(`${x},${y}`) ? tiles.city(0) : tiles.road())),
  );

  const match = createTestMatch({
    tiles: grid,
    players: [
      {
        slot: 0,
        coId: { name: coName, version },
        hasCurrentTurn: true,
        funds: 30000,
        powerMeter: 8000,
      },
      { slot: 1, coId: { name: "andy", version: "AW1" }, powerMeter: 40000 },
    ],
  });

  const p0 = match.getPlayerBySlot(0)!;
  const p1 = match.getPlayerBySlot(1)!;

  // Own units: damaged / low-fuel / spent so heal, resupply and refresh visibly change them.
  addUnit(p0, "infantry", [0, 0], { stats: { hp: 45, fuel: 10 }, isReady: false });
  addUnit(p0, "tank", [1, 0], { stats: { hp: 75, fuel: 20, ammo: 2 }, isReady: false });
  addUnit(p0, "artillery", [3, 0], { stats: { hp: 100, fuel: 99, ammo: 0 } });
  // Enemy units: one sits on a city (Kindle's property filter); all full for damage/drain.
  addUnit(p1, "infantry", [3, 3], { stats: { hp: 100, fuel: 99 }, isReady: false });
  addUnit(p1, "tank", [2, 2], { stats: { hp: 100, fuel: 99, ammo: 5 } });
  addUnit(p1, "battleship", [3, 2], { stats: { hp: 100, fuel: 99, ammo: 9 } });

  return match;
};

const snapshot = (match: MatchWrapper) => ({
  weather: match.getCurrentWeather(),
  players: match
    .getAllPlayers()
    .map((p) => ({ slot: p.data.slot, funds: p.data.funds, powerMeter: p.data.powerMeter }))
    .sort((a, b) => a.slot - b.slot),
  units: match.units
    .map((u) => {
      const stats = u.data.stats;
      return {
        slot: u.data.playerSlot,
        type: u.data.type,
        pos: u.data.position.join(","),
        hp: stats === "hidden" ? "hidden" : stats.hp,
        fuel: stats === "hidden" ? "hidden" : stats.fuel,
        ammo: stats !== "hidden" && "ammo" in stats ? stats.ammo : null,
        ready: u.data.isReady,
      };
    })
    .sort((a, b) => a.slot - b.slot || a.pos.localeCompare(b.pos) || a.type.localeCompare(b.type)),
});

/** Positions the engine would target, computed once (random pinned) so both sides get the same. */
const computePositions = (realPhase: PowerReal, match: MatchWrapper): Position[] | undefined => {
  if (realPhase?.calculatePositions === undefined) {
    return undefined;
  }

  const spy = vi.spyOn(Math, "random").mockReturnValue(0.5);

  try {
    return realPhase.calculatePositions(match.getPlayerBySlot(0)!);
  } finally {
    spy.mockRestore();
  }
};

describe("CO effects — reproduces the engine", () => {
  for (const profile of CO_PROFILES) {
    const anyEffects = PHASES.some((p) => profile[p.key]?.effects);

    if (!anyEffects) {
      continue;
    }

    it(`${profile.gameVersion} / ${profile.key}`, () => {
      const realCo = getCOProperties({ name: profile.key, version: profile.gameVersion });

      for (const phase of PHASES) {
        const realPhase = phase.real(realCo);
        const profilePhase = profile[phase.key];

        // Only phases the engine applies as a one-shot effect are comparable here.
        if (realPhase?.instantEffect === undefined) {
          continue;
        }

        const where = `${profile.gameVersion}/${profile.key} ${phase.key}`;
        const matchReal = buildMatch(profile.key, profile.gameVersion);
        const matchMine = buildMatch(profile.key, profile.gameVersion);

        const positions = computePositions(realPhase, matchReal);
        realPhase.instantEffect(matchReal.getPlayerBySlot(0)!, positions);
        applyEffects(profilePhase?.effects, matchMine.getPlayerBySlot(0)!, positions);

        expect(snapshot(matchMine), where).toEqual(snapshot(matchReal));
      }
    });
  }
});
