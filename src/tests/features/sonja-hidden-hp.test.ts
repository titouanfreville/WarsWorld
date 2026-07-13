import { describe, expect, it } from "vitest";
import { maskUnitForViewer } from "server/engine/entities/team";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

/**
 * Sonja's day-to-day hides her units' HP/fuel/ammo from opponents — and, unlike fog, it applies even
 * in clear weather. The board (`match.full`) and the fog-discovery path both serialize enemy units
 * through `maskUnitForViewer`, so an opponent can never read her true HP. These pin that single rule.
 */
describe("Sonja hidden HP", () => {
  const setup = () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain()]],
      players: [
        { slot: 0, hasCurrentTurn: true, coId: { name: "andy", version: "AW2" } },
        { slot: 1, coId: { name: "sonja", version: "AW2" } },
      ],
      // no fog — masking must apply regardless
    });
    const andy = match.getPlayerBySlot(0)!;
    const sonja = match.getPlayerBySlot(1)!;
    return { match, andy, sonja };
  };

  it("masks a Sonja unit's stats when an opponent views it", () => {
    const { andy, sonja } = setup();
    const sonjaUnit = addUnit(sonja, "infantry", [1, 0], { stats: { fuel: 50, hp: 50 } });

    expect(maskUnitForViewer(sonjaUnit, andy.team).stats).toBe("hidden");
  });

  it("keeps real stats for Sonja's own team", () => {
    const { sonja } = setup();
    const sonjaUnit = addUnit(sonja, "infantry", [1, 0], { stats: { fuel: 50, hp: 50 } });

    expect(maskUnitForViewer(sonjaUnit, sonja.team).stats).toMatchObject({ hp: 50 });
  });

  it("masks Sonja units for a spectator (no team = no privileged intel)", () => {
    const { sonja } = setup();
    const sonjaUnit = addUnit(sonja, "infantry", [1, 0], { stats: { fuel: 50, hp: 50 } });

    expect(maskUnitForViewer(sonjaUnit, null).stats).toBe("hidden");
  });

  it("does not mask a non-Sonja unit for opponents", () => {
    const { andy, sonja } = setup();
    const andyUnit = addUnit(andy, "infantry", [0, 0], { stats: { fuel: 50, hp: 70 } });

    // A normal army's HP is public to opponents — only fuel/ammo are withheld (elsewhere).
    expect(maskUnitForViewer(andyUnit, sonja.team).stats).toMatchObject({ hp: 70 });
  });
});
