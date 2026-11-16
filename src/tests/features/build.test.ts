import { describe, expect, it } from "vitest";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";
import type { MainAction } from "shared/schemas/action";
import { createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

describe("build feature", () => {
  it("builds a unit on an owned base, deducting its cost", () => {
    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 10000 }, { slot: 1 }],
    });

    const action: MainAction = { type: "build", unitType: "infantry", position: [0, 0] };
    dispatchMainAction(match, action);

    const built = match.getUnit([0, 0]);
    expect(built?.data.type).toBe("infantry");
    // Freshly built units cannot act on the turn they were produced.
    expect(built?.data.isReady).toBe(false);
    expect(match.getPlayerBySlot(0)!.data.funds).toBe(10000 - unitPropertiesMap.infantry.cost);
  });

  it("charges the CO-modified cost, never overspending into negative funds", () => {
    // Colin (AW2) builds 20% cheaper (a day-to-day `buildCost` hook). With funds equal to the
    // DISCOUNTED price the build must succeed and leave funds at exactly 0 — deducting the raw base
    // cost while validating the discounted cost used to drive funds negative (the regression this
    // guards). Funds must never go below zero from a validated build.
    const base = unitPropertiesMap.infantry.cost;
    const discounted = base * 0.8;

    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [
        {
          slot: 0,
          hasCurrentTurn: true,
          funds: discounted,
          coId: { name: "colin", version: "AW2" },
        },
        { slot: 1 },
      ],
    });

    dispatchMainAction(match, { type: "build", unitType: "infantry", position: [0, 0] });

    const funds = match.getPlayerBySlot(0)!.data.funds;
    expect(funds).toBe(0);
    expect(funds).toBeGreaterThanOrEqual(0);
  });

  it("rejects building without enough funds", () => {
    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 0 }, { slot: 1 }],
    });

    const action: MainAction = { type: "build", unitType: "infantry", position: [0, 0] };
    expect(() => dispatchMainAction(match, action)).toThrow();
  });
});
