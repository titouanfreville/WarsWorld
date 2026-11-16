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
  /**
   * Last day that gets played; the match is decided on territory once it's over (see day-limit.ts).
   *
   * Bounded above because `resolveTimeControl`'s custom branch passes the host's number straight
   * through — `positive()` alone let a client ask for a match that outlives the server. There is no
   * "unlimited" value: `isDayLimitReached` treats `<= 0` as no-limit, but that is a TEST-FIXTURE
   * sentinel only and this schema deliberately forbids it, because an unbounded ranked match is the
   * stalemate the day limit exists to prevent.
   */
  dayLimit: z.number().int().positive().max(1000),
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
  /**
   * Turn clock, chess-style: `turnBankSeconds` is what a player starts with, and
   * `turnIncrementSeconds` is credited at the start of each of their turns. When the bank runs out
   * the turn is ended for them; they keep playing on the increment alone.
   *
   * Optional for the same reason as `pickSeconds` above — required fields would force every existing
   * rules constructor (seed, matchmaking, admin, test scenarios) to name them. **Absent means no
   * clock**, which is what every match created before this feature has, and they must keep playing.
   *
   * Bounds live here because this schema is the transport boundary for both match and lobby
   * creation; they're never applied to already-stored rules (nothing parses a persisted row through
   * this schema), so tightening them can't invalidate a match in flight.
   */
  turnBankSeconds: z.number().int().min(60).max(7200).optional(),
  /**
   * The increment MUST be positive when a clock exists. A zero increment breaks the promise made
   * just above — "they keep playing on the increment alone" — because a player whose bank has hit 0
   * would be credited nothing, arm a deadline of `now`, and be force-passed on the very next tick,
   * forever. The floor is what makes running out of time survivable rather than terminal.
   */
  turnIncrementSeconds: z.number().int().min(5).max(900).optional(),
});

export type MatchRules = z.infer<typeof matchRulesSchema>;
