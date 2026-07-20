import { describe, expect, it } from "vitest";
import { addUnit, createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

/**
 * The CO-power activation report drives the FE's power cinematic + on-board effects. It's stamped by
 * applyCOPowerEvent (public in AW, sent to both viewers) and cleared at the next pass-turn so it
 * belongs only to the turn it fired in. These tests pin the report through the real engine pipeline.
 */
const plainGrid = (size: number) =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => tiles.plain()));

describe("CO power activation report", () => {
  it("stamps a report for a plain (non-positional) CO power", () => {
    const match = createTestMatch({
      tiles: plainGrid(3),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "rachel", version: "AWDS" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchMainAction(match, { type: "coPower", isSuper: false });

    const report = match.powerActivationReport;
    expect(report).not.toBeNull();
    expect(report!.playerId).toBe(match.getPlayerBySlot(0)!.data.id);
    expect(report!.coName).toBe("rachel");
    expect(report!.isSuper).toBe(false);
    expect(report!.powerName).toBe("Lucky lass");
    // No instant effect (Lucky lass is a luck hook), so the caster's own unit takes the generic blink.
    expect(report!.affectedUnits).toEqual([{ position: [0, 0], kind: "empowered" }]);
    expect(report!.timesPowerUsed).toBe(1);
  });

  it("tags enemy units hit by a positional super CO power as damaged", () => {
    const match = createTestMatch({
      tiles: plainGrid(5),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "rachel", version: "AWDS" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    // Rachel's SCOP (Covering Fire) targets the largest enemy clusters — give it enemies to aim at.
    const enemy = match.getPlayerBySlot(1)!;
    addUnit(enemy, "infantry", [1, 1]);
    addUnit(enemy, "infantry", [2, 2]);
    addUnit(enemy, "infantry", [3, 3]);

    dispatchMainAction(match, { type: "coPower", isSuper: true });

    const report = match.powerActivationReport;
    expect(report).not.toBeNull();
    expect(report!.isSuper).toBe(true);
    expect(report!.powerName).toBe("Covering Fire");
    // The enemy units caught in the missile radius are reported as damaged (Rachel fields no units).
    expect(report!.affectedUnits.length).toBeGreaterThan(0);
    expect(report!.affectedUnits.every((affected) => affected.kind === "damaged")).toBe(true);
    // Rachel's signature is three missiles over the chosen epicenters.
    expect(report!.signature).not.toBeNull();
    expect(report!.signature!.kind).toBe("missiles");
    expect(report!.signature!.epicenters).toHaveLength(3);
  });

  it("carries the meteor signature for Sturm's positional power", () => {
    const match = createTestMatch({
      tiles: plainGrid(5),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "sturm", version: "AW2" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    addUnit(match.getPlayerBySlot(1)!, "infantry", [2, 2]);

    dispatchMainAction(match, { type: "coPower", isSuper: true });

    const report = match.powerActivationReport;
    expect(report).not.toBeNull();
    expect(report!.signature).not.toBeNull();
    expect(report!.signature!.kind).toBe("meteor");
    expect(report!.signature!.epicenters).toHaveLength(1);
  });

  it("carries no signature for a non-positional power", () => {
    const match = createTestMatch({
      tiles: plainGrid(3),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "rachel", version: "AWDS" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchMainAction(match, { type: "coPower", isSuper: false });

    expect(match.powerActivationReport!.signature).toBeNull();
  });

  it("tags healed units from a repair power as repaired", () => {
    const match = createTestMatch({
      tiles: plainGrid(3),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "andy", version: "AW2" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    // A damaged infantry so Andy's SCOP (Hyper Upgrade, heals 5 HP) visibly repairs it.
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0], { stats: { fuel: 50, hp: 30 } });

    dispatchMainAction(match, { type: "coPower", isSuper: true });

    const report = match.powerActivationReport;
    expect(report).not.toBeNull();
    expect(report!.affectedUnits).toContainEqual({ position: [0, 0], kind: "repaired" });
  });

  it("clears the report at the next pass-turn", () => {
    const match = createTestMatch({
      tiles: plainGrid(3),
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          coId: { name: "rachel", version: "AWDS" },
          powerMeter: 999999,
        },
        { slot: 1 },
      ],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchMainAction(match, { type: "coPower", isSuper: false });
    expect(match.powerActivationReport).not.toBeNull();

    dispatchMainAction(match, { type: "passTurn" });
    expect(match.powerActivationReport).toBeNull();
  });

  // Global "sweep" powers carry a whole-board signature with NO epicenters (Drake water, Hawke dark,
  // Olaf snow) — the FE spans the animation across the board rather than over target tiles.
  it.each([
    { co: "drake", version: "AW2", kind: "tsunami" },
    { co: "hawke", version: "AW2", kind: "blackWave" },
    { co: "olaf", version: "AW2", kind: "blizzard" },
  ] as const)("carries the $kind sweep signature for $co", ({ co, version, kind }) => {
    const match = createTestMatch({
      tiles: plainGrid(4),
      players: [
        { slot: 0, hasCurrentTurn: true, coId: { name: co, version }, powerMeter: 999999 },
        { slot: 1 },
      ],
    });
    // An enemy for the damage powers to touch (and to confirm the sweep doesn't depend on targeting).
    addUnit(match.getPlayerBySlot(1)!, "infantry", [2, 2]);

    dispatchMainAction(match, { type: "coPower", isSuper: false });

    const report = match.powerActivationReport;
    expect(report).not.toBeNull();
    expect(report!.signature).not.toBeNull();
    expect(report!.signature!.kind).toBe(kind);
    expect(report!.signature!.epicenters).toEqual([]); // sweeps span the board, no target tiles
  });
});
