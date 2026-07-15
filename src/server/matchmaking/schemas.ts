import { z } from "zod";
import { gameModeSchema, rulesetSchema } from "server/core/schemas/game-mode";

/**
 * A queue is (mode × ruleset × ranked). `ranked` isn't on the wire yet — every queue game is ranked
 * today — so "Ranked Std" and "Std" would still be the same queue; that axis lands with the Play
 * page (plan phase 7). `mode` is no longer pinned to a literal, so FFA/teams queues are expressible.
 */
export const joinQueueSchema = z.object({
  mode: gameModeSchema,
  ruleset: rulesetSchema,
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

export const withLobbyIdSchema = z.object({ lobbyId: z.string() });

export const mapActionSchema = z.object({
  lobbyId: z.string(),
  mapId: z.string(),
});
