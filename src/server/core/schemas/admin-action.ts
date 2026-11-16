import { z } from "zod";

/**
 * In-match admin actions.
 *
 * A separate union from `devActionSchema` even though both ride the same system (event → apply →
 * emit → audit): they answer to a different capability. Merging them would mean one procedure and
 * one gate, which would hand every `dev`/`tester` the power to decide matches.
 *
 * Only in-match tools live here. Modify-rank and force-match aren't match events — they don't touch
 * match state and have nothing to replay — so they're plain admin procedures, not actions.
 */

/**
 * End a live match on an imposed result.
 *
 * `winnerTeamIndex` is a TEAM index, not a player: the engine settles matches by team
 * (`deriveGameOver`), and in 2v2 a per-player winner would be meaningless. `null` is a draw — which
 * is why this is a nullable team index rather than a `"win" | "lose" | "draw"` enum: "defeat" is
 * only meaningful relative to a viewer, and the engine has no viewer.
 */
const forceOutcomeActionSchema = z.object({
  type: z.literal("forceOutcome"),
  /** null = draw */
  winnerTeamIndex: z.number().int().nonnegative().nullable(),
});

export const adminActionSchema = z.discriminatedUnion("type", [forceOutcomeActionSchema]);

export type AdminAction = z.infer<typeof adminActionSchema>;
export type ForceOutcomeAction = z.infer<typeof forceOutcomeActionSchema>;
