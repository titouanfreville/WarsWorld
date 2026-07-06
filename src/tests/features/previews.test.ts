import { describe, expect, it } from "vitest";
import { getBattleForecast } from "shared/match-logic/combat-forecast";
import { getAccessibleNodes, getAttackTargetTiles } from "shared/match-logic/pathfinding";
import type { Position } from "shared/schemas/position";
import { isSamePosition } from "shared/schemas/position";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

const has = (positions: Position[], target: Position) =>
  positions.some((p) => isSamePosition(p, target));

const roadRow = (length: number) => [Array.from({ length }, () => tiles.road())];

/**
 * These pin the pure engine queries the backend preview endpoints wrap (reachable tiles, attack
 * targets, battle forecast). Same computation the FE used to run client-side — now server-owned.
 */
describe("previews", () => {
  it("reports the tiles a unit can reach within its movement range", () => {
    const match = createTestMatch({
      tiles: roadRow(6),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const infantry = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    const reached = Array.from(getAccessibleNodes(match, infantry).values()).map((n) => n.pos);

    // Infantry moves 3 over road (cost 1/tile): x = 0..3 reachable, x = 4+ not.
    expect(has(reached, [0, 0])).toBe(true);
    expect(has(reached, [3, 0])).toBe(true);
    expect(has(reached, [4, 0])).toBe(false);
  });

  it("treats an enemy unit as an impassable blocker", () => {
    const match = createTestMatch({
      tiles: roadRow(6),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const infantry = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);
    addUnit(match.getPlayerBySlot(1)!, "infantry", [2, 0]); // enemy wall

    const reached = Array.from(getAccessibleNodes(match, infantry).values()).map((n) => n.pos);

    // Can't move onto or past the enemy on this 1-wide corridor.
    expect(has(reached, [1, 0])).toBe(true);
    expect(has(reached, [2, 0])).toBe(false);
    expect(has(reached, [3, 0])).toBe(false);
  });

  it("lists an adjacent enemy as an attack target for a direct unit", () => {
    const match = createTestMatch({
      tiles: roadRow(3),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const tank = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0]);
    addUnit(match.getPlayerBySlot(1)!, "infantry", [2, 0]);

    // Tank can move next to [2,0] and attack it.
    expect(has(getAttackTargetTiles(match, tank), [2, 0])).toBe(true);
  });

  it("forecasts a direct engagement's damage for both sides", () => {
    const match = createTestMatch({
      tiles: roadRow(2),
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const tank = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0]);
    addUnit(match.getPlayerBySlot(1)!, "infantry", [1, 0]);

    const forecast = getBattleForecast(match, tank, [0, 0], [1, 0]);

    // Tank hits the infantry for real damage; ranges are ordered min <= max.
    expect(forecast.attackerDamage.max).toBeGreaterThan(0);
    expect(forecast.attackerDamage.min).toBeLessThanOrEqual(forecast.attackerDamage.max);
    expect(forecast.defenderDamage.min).toBeLessThanOrEqual(forecast.defenderDamage.max);
  });
});
