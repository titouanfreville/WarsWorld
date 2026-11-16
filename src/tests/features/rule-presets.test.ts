import { describe, expect, it } from "vitest";
import {
  RANKED_PRESET,
  RULE_PRESETS,
  rankedTimeControl,
  resolveTimeControl,
} from "server/core/schemas/rule-presets";
import { matchRulesSchema } from "server/core/schemas/match-rules";
import type { MatchRules } from "server/core/schemas/match-rules";

/**
 * Time controls: three named formats for custom games, one fixed format for ranked. The point of the
 * shared table is that "Normal" in a lobby and "ranked" in the queue can never drift apart.
 */
const baseRules: MatchRules = {
  unitCapPerPlayer: 50,
  fogOfWar: false,
  fundsPerProperty: 1000,
  labUnitTypes: [],
  bannedUnitTypes: [],
  captureLimit: 50,
  dayLimit: 50,
  weatherSetting: "clear",
  teamMapping: [],
};

describe("rule presets", () => {
  it("fixes the three advertised formats", () => {
    expect(RULE_PRESETS.quick).toEqual({
      dayLimit: 30,
      turnBankSeconds: 600,
      turnIncrementSeconds: 60,
    });
    expect(RULE_PRESETS.normal).toEqual({
      dayLimit: 50,
      turnBankSeconds: 900,
      turnIncrementSeconds: 120,
    });
    expect(RULE_PRESETS.long).toEqual({
      dayLimit: 100,
      turnBankSeconds: 1800,
      turnIncrementSeconds: 240,
    });
  });

  it("plays ranked on the Normal format", () => {
    expect(RANKED_PRESET).toBe("normal");
    expect(rankedTimeControl()).toEqual(RULE_PRESETS.normal);
  });

  it("stamps a chosen preset over whatever the client asked for", () => {
    const resolved = resolveTimeControl(
      { ...baseRules, dayLimit: 7, turnBankSeconds: 60, turnIncrementSeconds: 0 },
      "quick",
      false,
    );

    expect(resolved).toMatchObject(RULE_PRESETS.quick);
  });

  it("keeps a custom time control as sent", () => {
    const custom = { ...baseRules, dayLimit: 12, turnBankSeconds: 300, turnIncrementSeconds: 30 };

    expect(resolveTimeControl(custom, "custom", false)).toMatchObject({
      dayLimit: 12,
      turnBankSeconds: 300,
      turnIncrementSeconds: 30,
    });
  });

  it("falls back to Normal's clock for a half-filled custom form", () => {
    // A custom game that names no clock must still get one, or it silently becomes untimed.
    const resolved = resolveTimeControl({ ...baseRules, dayLimit: 12 }, "custom", false);

    expect(resolved.turnBankSeconds).toBe(RULE_PRESETS.normal.turnBankSeconds);
    expect(resolved.turnIncrementSeconds).toBe(RULE_PRESETS.normal.turnIncrementSeconds);
    expect(resolved.dayLimit).toBe(12);
  });

  it("OVERRIDES a ranked match, whatever preset or values were requested", () => {
    // The ranked guarantee: the queue decides the format, never the client.
    for (const preset of ["quick", "long", "custom", "normal"] as const) {
      const resolved = resolveTimeControl(
        { ...baseRules, dayLimit: 999, turnBankSeconds: 7200, turnIncrementSeconds: 900 },
        preset,
        true,
      );

      expect(resolved).toMatchObject(rankedTimeControl());
    }
  });

  it("leaves every non-time rule untouched", () => {
    const resolved = resolveTimeControl(
      { ...baseRules, fogOfWar: true, fundsPerProperty: 3000, unitCapPerPlayer: 12 },
      "long",
      false,
    );

    expect(resolved).toMatchObject({
      fogOfWar: true,
      fundsPerProperty: 3000,
      unitCapPerPlayer: 12,
    });
  });
});

describe("clock validation at the transport boundary", () => {
  it("accepts every preset's numbers", () => {
    for (const preset of Object.values(RULE_PRESETS)) {
      expect(matchRulesSchema.safeParse({ ...baseRules, ...preset }).success).toBe(true);
    }
  });

  it("accepts rules with no clock at all (matches created before the feature)", () => {
    expect(matchRulesSchema.safeParse(baseRules).success).toBe(true);
  });

  it("rejects an absurd bank or increment", () => {
    expect(matchRulesSchema.safeParse({ ...baseRules, turnBankSeconds: 5 }).success).toBe(false);
    expect(matchRulesSchema.safeParse({ ...baseRules, turnBankSeconds: 99999 }).success).toBe(
      false,
    );
    expect(matchRulesSchema.safeParse({ ...baseRules, turnIncrementSeconds: 5000 }).success).toBe(
      false,
    );
  });

  it("rejects a zero increment, which would make running out of time terminal", () => {
    // A non-replenishing bank looks harmless and isn't: once it hits 0 the player is credited
    // nothing at the start of their turn, the deadline is armed at `now`, and they are force-passed
    // on every tick for the rest of the match. The clock is meant to end turns, not players.
    expect(matchRulesSchema.safeParse({ ...baseRules, turnIncrementSeconds: 0 }).success).toBe(
      false,
    );
    expect(matchRulesSchema.safeParse({ ...baseRules, turnIncrementSeconds: 5 }).success).toBe(
      true,
    );
  });

  it("bounds the day limit", () => {
    // `resolveTimeControl`'s custom branch passes `dayLimit` through untouched, so the schema is the
    // only thing standing between a client and a match that runs for 100,000 days.
    expect(matchRulesSchema.safeParse({ ...baseRules, dayLimit: 0 }).success).toBe(false);
    expect(matchRulesSchema.safeParse({ ...baseRules, dayLimit: -1 }).success).toBe(false);
    expect(matchRulesSchema.safeParse({ ...baseRules, dayLimit: 100000 }).success).toBe(false);
    expect(matchRulesSchema.safeParse({ ...baseRules, dayLimit: 50 }).success).toBe(true);
  });
});
