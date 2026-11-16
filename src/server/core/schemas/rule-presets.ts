import { z } from "zod";
import type { MatchRules } from "./match-rules";

/**
 * Time-control presets — how long a match may run, and how much clock each player gets.
 *
 * Kernel vocabulary rather than a feature's private table: the lobby (custom games), matchmaking
 * (ranked) and the admin tools all have to agree on what "Normal" means, and features may not import
 * each other. One table, three callers.
 */

export const rulePresetSchema = z.enum(["quick", "normal", "long", "custom"]);
export type RulePreset = z.infer<typeof rulePresetSchema>;

/** The three numbers a preset fixes. Everything else about a match stays the host's choice. */
export type TimeControl = {
  /** Last day that gets played; the match is decided on territory once it's over (see day-limit.ts). */
  dayLimit: number;
  /** Seconds in the bank at match start. */
  turnBankSeconds: number;
  /** Seconds added at the start of each of your turns. */
  turnIncrementSeconds: number;
};

export const RULE_PRESETS: Record<Exclude<RulePreset, "custom">, TimeControl> = {
  /** Blitz: short game, short clock. */
  quick: { dayLimit: 30, turnBankSeconds: 600, turnIncrementSeconds: 60 },
  /** The ranked standard, and the default for a custom game. */
  normal: { dayLimit: 50, turnBankSeconds: 900, turnIncrementSeconds: 120 },
  /** Marathon: room for a full economic game. */
  long: { dayLimit: 100, turnBankSeconds: 1800, turnIncrementSeconds: 240 },
};

/**
 * Ranked plays one time control, always. Named rather than inlined so the ranked guarantee is a
 * single fact in the codebase — matchmaking, the admin tools and any future queue read it here.
 */
export const RANKED_PRESET = "normal" as const satisfies Exclude<RulePreset, "custom">;

/**
 * A COPY, deliberately. Returning the shared table entry directly handed every caller a live
 * reference to it — one `tc.dayLimit = x` anywhere would silently redefine "Normal" process-wide,
 * for the ranked queue and the lobby alike. The comment above promises a single fact; this is what
 * keeps it a single *immutable* one.
 */
export const rankedTimeControl = (): TimeControl => ({ ...RULE_PRESETS[RANKED_PRESET] });

/**
 * Stamp a time control onto a set of rules — the ONE place a preset becomes concrete numbers.
 *
 * Ranked ignores both the preset and any custom values: the queue decides the format, not the
 * client. A custom game keeps whatever the host sent (already range-checked by `matchRulesSchema` at
 * the transport boundary), falling back to Normal for anything it left out, so a half-filled custom
 * form can't produce a match with no clock.
 */
export const resolveTimeControl = (
  rules: MatchRules,
  preset: RulePreset,
  isRanked: boolean,
): MatchRules => {
  if (isRanked) {
    return { ...rules, ...rankedTimeControl() };
  }

  if (preset !== "custom") {
    return { ...rules, ...RULE_PRESETS[preset] };
  }

  // `dayLimit` is NOT restated here: `...rules` already carries the host's value, and repeating it
  // only read as though it were doing something.
  return {
    ...rules,
    turnBankSeconds: rules.turnBankSeconds ?? RULE_PRESETS.normal.turnBankSeconds,
    turnIncrementSeconds: rules.turnIncrementSeconds ?? RULE_PRESETS.normal.turnIncrementSeconds,
  };
};
