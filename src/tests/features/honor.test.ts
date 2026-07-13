import { describe, expect, it } from "vitest";
import { computeStanding } from "server/honor/honor";

describe("computeStanding", () => {
  it("derives medal tier + star sub-rank + prestige from per-medal counts", () => {
    const standing = computeStanding({
      GOOD_CONDUCT: 18, // Bronze band (10–29), ~40% in → star 2
      MEDAILLE_MILITAIRE: 42, // Silver band (30–74), early → star 1
      CROIX_DE_GUERRE: 27, // Bronze band, ~85% in → star 3
    });

    const byMedal = Object.fromEntries(standing.medals.map((m) => [m.medal, m]));

    expect(byMedal.GOOD_CONDUCT).toMatchObject({ tierKey: "bronze", star: 2 });
    expect(byMedal.MEDAILLE_MILITAIRE).toMatchObject({ tierKey: "silver", star: 1 });
    expect(byMedal.CROIX_DE_GUERRE).toMatchObject({ tierKey: "bronze", star: 3 });

    // Prestige = sum of tier indices: bronze(1) + silver(2) + bronze(1).
    expect(standing.prestige).toEqual({ points: 4, max: 15 });
  });

  it("puts a fresh player at Recruit across the board with zero prestige", () => {
    const standing = computeStanding({});

    expect(standing.medals.every((m) => m.tierKey === "recruit")).toBe(true);
    expect(standing.prestige.points).toBe(0);
    // Progress toward Bronze is defined (not the top tier).
    expect(standing.medals[0].nextThreshold).toBe(10);
  });
});
