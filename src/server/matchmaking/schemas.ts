import { z } from "zod";
import { gameModeSchema, rulesetSchema } from "server/core/schemas/game-mode";

/**
 * A queue is (mode × ruleset × ranked) — all three axes, each independent. Ranked Standard and casual
 * Standard are DIFFERENT queues that share a ruleset, so a casual player can never be paired into a
 * game that moves someone's ladder.
 */
export const joinQueueSchema = z.object({
  mode: gameModeSchema,
  ruleset: rulesetSchema,
  ranked: z.boolean(),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

export const withLobbyIdSchema = z.object({ lobbyId: z.string() });

export const mapActionSchema = z.object({
  lobbyId: z.string(),
  mapId: z.string(),
});
