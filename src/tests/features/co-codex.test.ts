import { describe, expect, it } from "vitest";
import { buildCoCodex } from "server/matches/co-codex";

/**
 * The champ-select dossier is fed by real engine CO data. These lock that the codex actually
 * resolves generals for AW2 and surfaces their power text (so the picker isn't empty and the
 * dossier isn't blank), and that COs not implemented for the version are omitted rather than
 * throwing.
 */
describe("buildCoCodex", () => {
  const codex = buildCoCodex("AW2");

  it("returns the AW2 roster with display names", () => {
    expect(codex.length).toBeGreaterThan(10);
    const andy = codex.find((c) => c.name === "andy");
    expect(andy?.displayName).toBeTruthy();
  });

  it("surfaces power name/stars/description for a CO that has them", () => {
    const andy = codex.find((c) => c.name === "andy");
    expect(andy?.superCoPower?.name).toBe("Hyper Upgrade");
    expect(andy?.superCoPower?.stars).toBeGreaterThan(0);
    expect(andy?.superCoPower?.description).toContain("HP");
  });

  it("omits COs not implemented for the version (no throw)", () => {
    // von-bolt is AWDS-only; it must not appear in the AW2 codex.
    expect(codex.some((c) => c.name === "von-bolt")).toBe(false);
  });

  // ── Per-unit ▲▼ grid (day-to-day modifiers, for the dossier "forces" tab) ──
  const forces = (name: string) => codex.find((c) => c.name === name)!.forces;

  it("only lists units a CO actually changes (non-zero modifiers)", () => {
    for (const co of codex) {
      for (const mod of Object.values(co.forces)) {
        const changed =
          mod.attackPct !== 0 ||
          mod.defensePct !== 0 ||
          mod.rangeDelta !== 0 ||
          mod.movementDelta !== 0;
        expect(changed, `${co.name} lists an all-zero unit modifier`).toBe(true);
      }
    }
  });

  it("Max buffs direct vehicles and penalises indirects (footsoldiers untouched)", () => {
    const max = forces("max");
    expect(max.tank).toEqual({ attackPct: 20, defensePct: 0, rangeDelta: 0, movementDelta: 0 });
    expect(max.artillery).toEqual({
      attackPct: -10,
      defensePct: 0,
      rangeDelta: -1,
      movementDelta: 0,
    });
    expect(max.infantry).toBeUndefined();
  });

  it("Grit mirrors Max — indirects up (+range), direct down", () => {
    const grit = forces("grit");
    expect(grit.artillery).toEqual({
      attackPct: 20,
      defensePct: 0,
      rangeDelta: 1,
      movementDelta: 0,
    });
    expect(grit.tank.attackPct).toBe(-20);
  });

  it("Kanbei buffs firepower and defense across the board", () => {
    const kanbei = forces("kanbei");
    expect(kanbei.infantry).toEqual({
      attackPct: 30,
      defensePct: 30,
      rangeDelta: 0,
      movementDelta: 0,
    });
    expect(kanbei.megaTank.defensePct).toBe(30);
  });

  it("Sensei: footsoldiers/copter up, ground+naval down, transports faster", () => {
    const sensei = forces("sensei");
    expect(sensei.infantry.attackPct).toBe(40);
    expect(sensei.battleCopter.attackPct).toBe(50);
    expect(sensei.tank.attackPct).toBe(-10);
    expect(sensei.apc.movementDelta).toBe(1);
  });

  it("omits per-unit forces for power-only and context-conditional COs", () => {
    expect(forces("adder")).toEqual({}); // day-to-day has no modifiers
    expect(forces("lash")).toEqual({}); // terrain-star scaling is conditional, not a flat modifier
  });
});
