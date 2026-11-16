import { describe, expect, it } from "vitest";
import { damageRangeLabel } from "frontend/components/match/combat-forecast-view";

/**
 * The combat box shows the RANGE OF DAMAGE done (a percentage), not the target's resulting HP — so it
 * stays correct against masked-HP units (e.g. Sonja's) and never reveals a hidden value. The engine
 * returns damage on a 0–100 scale, which reads directly as a percentage. No engine, no network.
 */
describe("damageRangeLabel", () => {
  it("formats a min/max damage range as a percentage span", () => {
    expect(damageRangeLabel({ min: 70, max: 80 })).toBe("70-80%");
  });

  it("collapses to a single percentage when the damage is exact", () => {
    expect(damageRangeLabel({ min: 45, max: 45 })).toBe("45%");
  });

  it("reports 0% when no damage is dealt (e.g. an indirect target can't counter)", () => {
    expect(damageRangeLabel({ min: 0, max: 0 })).toBe("0%");
  });
});
