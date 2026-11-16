import { z } from "zod";

/** Input for the end-game summary — a match id (finished or in-progress). */
export const endgameSummarySchema = z.object({
  matchId: z.string(),
});

/**
 * Input for the post-game chat heartbeat (Epic 5). `playerId` is required by `playerBaseProcedure`
 * (see `withPlayerIdSchema`); the client re-sends it while the End-Game chat is mounted.
 */
export const endgameChatHeartbeatSchema = z.object({
  matchId: z.string(),
});
