import { z } from "zod";
import { unitTypeSchema } from "./unit";
import { weatherSettingSchema } from "./weather";
import { gameVersionSchema } from "./game-version";

export const matchRulesSchema = z.object({
  unitCapPerPlayer: z.number().int().positive(),
  fogOfWar: z.boolean(),
  /**
   * If no game version is specified, each CO will use its own
   */
  gameVersion: gameVersionSchema.optional(),
  fundsPerProperty: z.number().int(),
  /**
   * Allowed unit types only if a lab is owned
   */
  labUnitTypes: unitTypeSchema.array(),
  bannedUnitTypes: unitTypeSchema.array(),
  captureLimit: z.number().int().positive(),
  dayLimit: z.number().int().positive(),
  weatherSetting: weatherSettingSchema,
  /**
   * indexes are playerSlots of the map, values are the team
   * the slot is assigned to.
   *
   * team indexes start at 0, playerSlots as well but -1 is special value for neutral properties
   * so teamMapping[0] would tell us the team for playerSlot 0 (which is the first player)
   */
  teamMapping: z.array(z.number().int().nonnegative()),
  /**
   * Seconds allowed for the general-picker round (v2 lobby → Match `setup`). Optional so v1 match
   * creation is unaffected; the spawn path falls back to a default when unset.
   */
  pickSeconds: z.number().int().positive().optional(),
  /**
   * Opts this match into the testing tools, which is what lets a `tester` use them here (a `dev` or
   * `admin` doesn't need the opt-in). Chosen at creation and frozen once the match leaves `setup` —
   * otherwise a player could switch cheats on mid-game.
   *
   * Never true on a ranked match; match creation refuses that combination outright so it can't be
   * persisted, rather than relying on every read path to re-check.
   *
   * Optional rather than `.default(false)`, matching `pickSeconds` above: a default would make the
   * field required on the inferred *output* type and force every existing rules constructor (seed,
   * matchmaking, test scenarios) to name it. Absent means off, which is the safe reading.
   */
  testingTools: z.boolean().optional(),
});

export type MatchRules = z.infer<typeof matchRulesSchema>;
