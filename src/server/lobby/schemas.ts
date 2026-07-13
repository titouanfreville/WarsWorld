import { z } from "zod";
import { matchRulesSchema } from "server/core/schemas/match-rules";
import { leagueTypeSchema } from "server/matches/league";
import { lobbyModeSchema } from "server/matches/layout";

export const createLobbySchema = z.object({
  mode: lobbyModeSchema,
  leagueType: leagueTypeSchema,
  mapId: z.string(),
  isRanked: z.boolean().default(false),
  // teamMapping in here is a placeholder; the real mapping is derived from seat assignments at spawn.
  rules: matchRulesSchema,
});
export type CreateLobbyInput = z.infer<typeof createLobbySchema>;

export const withLobbyIdSchema = z.object({ lobbyId: z.string() });

export const assignTeamSchema = withLobbyIdSchema.extend({
  // null = move to the unassigned bench
  team: z.number().int().nonnegative().nullable(),
  slotWithinTeam: z.number().int().nonnegative().optional(),
});

export const inviteSchema = withLobbyIdSchema.extend({
  usernames: z.array(z.string().min(1)).min(1),
});

export const respondInviteSchema = withLobbyIdSchema.extend({
  accept: z.boolean(),
});

export const kickSchema = withLobbyIdSchema.extend({
  // Named distinctly from the auth `playerId` that playerBaseProcedure injects (which is the host).
  targetPlayerId: z.string(),
});
