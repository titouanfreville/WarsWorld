import { describe, expect, it } from "vitest";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";
import { maskUnitForViewer } from "server/engine/entities/team";
import { buildMatchFullView } from "server/engine/previews/match-view";
import { isLowAmmo, isLowFuel } from "server/engine/rules/supply";
import { addUnit, createTestMatch, recomputeVision, tiles } from "../helpers/scenario";

const roadRow = (length: number) => [Array.from({ length }, () => tiles.road())];

/**
 * The low-fuel/low-ammo board badge. Two things are under test:
 *
 * 1. the threshold rule itself (engine/rules/supply) — at or below 1/3 of the unit's maximum;
 * 2. WHO gets told, which is the load-bearing half. `supply` is a derived flag, so it has to be
 *    masked exactly like the consumables behind it — otherwise it leaks under fog what the
 *    consumable redaction just hid.
 */
describe("low supply", () => {
  describe("the threshold rule", () => {
    it("flags fuel at or below a third of the maximum, and not above it", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }] });
      const player = match.getPlayerBySlot(0)!;
      const maxFuel = unitPropertiesMap.tank.initialFuel;
      const third = maxFuel / 3;

      const low = addUnit(player, "tank", [0, 0], { stats: { hp: 100, fuel: third, ammo: 5 } });
      const fine = addUnit(player, "tank", [1, 0], {
        stats: { hp: 100, fuel: third + 1, ammo: 5 },
      });

      expect(isLowFuel(low)).toBe(true); // exactly a third counts as low — the boundary is inclusive
      expect(isLowFuel(fine)).toBe(false);
    });

    it("flags ammo at or below a third of the maximum, and not above it", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }] });
      const player = match.getPlayerBySlot(0)!;
      const third = unitPropertiesMap.tank.initialAmmo / 3;

      const low = addUnit(player, "tank", [0, 0], { stats: { hp: 100, fuel: 50, ammo: third } });
      const fine = addUnit(player, "tank", [1, 0], {
        stats: { hp: 100, fuel: 50, ammo: third + 1 },
      });

      expect(isLowAmmo(low)).toBe(true);
      expect(isLowAmmo(fine)).toBe(false);
    });

    it("never flags low ammo on a unit that carries none", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }] });
      // Infantry has no ammo at all, so "a third of its maximum" is meaningless — it must not badge.
      const infantry = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

      expect(isLowAmmo(infantry)).toBe(false);
    });

    it("flags an empty tank on both counts", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }] });
      const dry = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0], {
        stats: { hp: 100, fuel: 0, ammo: 0 },
      });

      expect(isLowFuel(dry)).toBe(true);
      expect(isLowAmmo(dry)).toBe(true);
    });
  });

  /**
   * The masking matrix. Each case is asserted on `maskUnitForViewer` — the single rule both the board
   * (`match.full`) and the fog-discovery reveal path route through, so covering it here covers both.
   */
  describe("who sees the flag", () => {
    const lowStats = { hp: 100, fuel: 1, ammo: 0 };

    it("gives the owner the flag on their own unit, fog or not", () => {
      const match = createTestMatch({
        tiles: roadRow(3),
        players: [{ slot: 0 }, { slot: 1 }],
        rules: { fogOfWar: true },
      });
      const own = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0], { stats: lowStats });

      const masked = maskUnitForViewer(own, match.getPlayerBySlot(0)!.team);

      expect(masked.supply).toEqual({ lowFuel: true, lowAmmo: true });
      expect(masked.stats).toEqual(lowStats); // own units are never redacted
    });

    it("gives an enemy the flag OUTSIDE fog, where consumables are public anyway", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }, { slot: 1 }] });
      const enemy = addUnit(match.getPlayerBySlot(1)!, "tank", [2, 0], { stats: lowStats });

      const masked = maskUnitForViewer(enemy, match.getPlayerBySlot(0)!.team);

      expect(masked.supply).toEqual({ lowFuel: true, lowAmmo: true });
      expect(masked.stats).toEqual(lowStats);
    });

    it("withholds the flag AND the consumables from an enemy under fog, but keeps HP", () => {
      const match = createTestMatch({
        tiles: roadRow(3),
        players: [{ slot: 0 }, { slot: 1 }],
        rules: { fogOfWar: true },
      });
      const enemy = addUnit(match.getPlayerBySlot(1)!, "tank", [2, 0], { stats: lowStats });

      const masked = maskUnitForViewer(enemy, match.getPlayerBySlot(0)!.team);

      // The flag would leak "this tank is nearly dry" — exactly what dropping fuel/ammo hides.
      expect(masked.supply).toBeNull();
      expect(masked.stats).toEqual({ hp: 100 });
      expect(masked.stats).not.toHaveProperty("fuel");
      expect(masked.stats).not.toHaveProperty("ammo");
    });

    it("withholds the flag from an enemy Sonja unit even outside fog", () => {
      const match = createTestMatch({
        tiles: roadRow(3),
        players: [{ slot: 0 }, { slot: 1, coId: { name: "sonja", version: "AWDS" } }],
      });
      const sonjaTank = addUnit(match.getPlayerBySlot(1)!, "tank", [2, 0], { stats: lowStats });

      const masked = maskUnitForViewer(sonjaTank, match.getPlayerBySlot(0)!.team);

      // Sonja is permanent fog on life AND resources — clear weather doesn't make her supply public.
      expect(masked.stats).toBe("hidden");
      expect(masked.supply).toBeNull();
    });
  });

  describe("on the wire", () => {
    it("carries the flag per unit on match.full", () => {
      const match = createTestMatch({ tiles: roadRow(3), players: [{ slot: 0 }, { slot: 1 }] });
      const player = match.getPlayerBySlot(0)!;

      addUnit(player, "tank", [0, 0], { stats: { hp: 100, fuel: 1, ammo: 5 } });
      addUnit(player, "tank", [1, 0], { stats: { hp: 100, fuel: 50, ammo: 5 } });

      const view = buildMatchFullView(match, player.data.id);
      const [dry, fuelled] = view.units;

      expect(dry.supply).toEqual({ lowFuel: true, lowAmmo: false });
      expect(fuelled.supply).toEqual({ lowFuel: false, lowAmmo: false });
    });

    it("strips a fogged enemy's consumables from the payload, not just from the UI", () => {
      const match = createTestMatch({
        tiles: roadRow(3),
        players: [{ slot: 0 }, { slot: 1 }],
        rules: { fogOfWar: true },
      });
      const viewer = match.getPlayerBySlot(0)!;

      addUnit(viewer, "infantry", [0, 0]);
      addUnit(match.getPlayerBySlot(1)!, "tank", [1, 0], { stats: { hp: 100, fuel: 1, ammo: 0 } });
      recomputeVision(match);

      const view = buildMatchFullView(match, viewer.data.id);
      const enemy = view.units.find((unit) => unit.playerSlot === 1);

      // The point of routing this through the mask: an opponent can't read the tank's remaining
      // reach out of the raw payload, even though the unit itself is visible to them.
      expect(enemy).toBeDefined();
      expect(enemy!.supply).toBeNull();
      expect(enemy!.stats).toEqual({ hp: 100 });
    });
  });
});
