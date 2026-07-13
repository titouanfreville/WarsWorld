import { z } from "zod";
import { leagueTypeSchema } from "server/matches/league";

/** Solo queue only for now — `mode` is fixed but present so the wire shape is future-proof. */
export const joinQueueSchema = z.object({
  leagueType: leagueTypeSchema,
  mode: z.literal("1v1"),
});
export type JoinQueueInput = z.infer<typeof joinQueueSchema>;

export const withLobbyIdSchema = z.object({ lobbyId: z.string() });

export const mapActionSchema = z.object({
  lobbyId: z.string(),
  mapId: z.string(),
});
