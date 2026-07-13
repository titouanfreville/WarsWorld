import { describe, expect, it } from "vitest";
import { maskUnitForViewer } from "server/engine/entities/team";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

/**
 * A transport carries its cargo inline (`loadedUnit`/`loadedUnit2`, each with the loaded unit's real
 * stats). Outside fog of war an enemy can see what a transport holds (public board info); under fog
 * the contents stay hidden. The board (`match.full`) and the fog-discovery path both serialize enemy
 * units through `maskUnitForViewer`, so these pin that single redaction rule.
 */
describe("transport cargo visibility", () => {
  const setup = (opts: { coName?: "andy" | "sonja"; fog?: boolean } = {}) => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain()]],
      players: [
        { slot: 0, hasCurrentTurn: true, coId: { name: "andy", version: "AW2" } },
        { slot: 1, coId: { name: opts.coName ?? "andy", version: "AW2" } },
      ],
      ...(opts.fog === true ? { rules: { fogOfWar: true } } : {}),
    });
    const viewer = match.getPlayerBySlot(0)!;
    const owner = match.getPlayerBySlot(1)!;
    return { match, viewer, owner };
  };

  const infantryCargo = { type: "infantry" as const, stats: { hp: 80, fuel: 40 }, isReady: true };
  const mechCargo = {
    type: "mech" as const,
    stats: { hp: 60, fuel: 30, ammo: 3 },
    isReady: true,
  };

  describe("outside fog of war (cargo is public)", () => {
    it("shows a one-slot transport's cargo to an opponent", () => {
      const { viewer, owner } = setup();
      const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

      const masked = maskUnitForViewer(apc, viewer.team);
      expect("loadedUnit" in masked && masked.loadedUnit).toMatchObject({ type: "infantry" });
    });

    it("shows both cargo slots of a two-slot transport to an opponent", () => {
      const { viewer, owner } = setup();
      const lander = addUnit(owner, "lander", [1, 0], {
        loadedUnit: infantryCargo,
        loadedUnit2: mechCargo,
      });

      const masked = maskUnitForViewer(lander, viewer.team);
      expect("loadedUnit" in masked && masked.loadedUnit).toMatchObject({ type: "infantry" });
      expect("loadedUnit2" in masked && masked.loadedUnit2).toMatchObject({ type: "mech" });
    });

    it("still hides a Sonja transport's stats, but shows its cargo", () => {
      const { viewer, owner } = setup({ coName: "sonja" });
      const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

      const masked = maskUnitForViewer(apc, viewer.team);
      expect(masked.stats).toBe("hidden"); // Sonja's D2D hides stats even in clear weather
      expect("loadedUnit" in masked && masked.loadedUnit).toMatchObject({ type: "infantry" });
    });
  });

  describe("under fog of war (cargo is secret)", () => {
    it("nulls a one-slot transport's cargo for an opponent", () => {
      const { viewer, owner } = setup({ fog: true });
      const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

      const masked = maskUnitForViewer(apc, viewer.team);
      expect("loadedUnit" in masked && masked.loadedUnit).toBeNull();
    });

    it("nulls both cargo slots of a two-slot transport for an opponent", () => {
      const { viewer, owner } = setup({ fog: true });
      const lander = addUnit(owner, "lander", [1, 0], {
        loadedUnit: infantryCargo,
        loadedUnit2: mechCargo,
      });

      const masked = maskUnitForViewer(lander, viewer.team);
      expect("loadedUnit" in masked && masked.loadedUnit).toBeNull();
      expect("loadedUnit2" in masked && masked.loadedUnit2).toBeNull();
    });

    it("hides cargo for a spectator (no team = no privileged intel)", () => {
      const { owner } = setup({ fog: true });
      const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

      const masked = maskUnitForViewer(apc, null);
      expect("loadedUnit" in masked && masked.loadedUnit).toBeNull();
    });

    it("hides cargo AND stats for a Sonja transport viewed by an opponent", () => {
      const { viewer, owner } = setup({ coName: "sonja", fog: true });
      const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

      const masked = maskUnitForViewer(apc, viewer.team);
      expect(masked.stats).toBe("hidden");
      expect("loadedUnit" in masked && masked.loadedUnit).toBeNull();
    });
  });

  it("keeps cargo visible for the transport's own team, even under fog", () => {
    const { owner } = setup({ fog: true });
    const apc = addUnit(owner, "apc", [1, 0], { loadedUnit: infantryCargo });

    const masked = maskUnitForViewer(apc, owner.team);
    expect("loadedUnit" in masked && masked.loadedUnit).toMatchObject({ type: "infantry" });
  });
});
