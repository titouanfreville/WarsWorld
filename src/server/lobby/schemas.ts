import { z } from "zod";
import { gameModeSchema, rulesetSchema } from "server/core/schemas/game-mode";
import { matchRulesSchema } from "server/core/schemas/match-rules";

export const createLobbySchema = z.object({
  mode: gameModeSchema,
  ruleset: rulesetSchema,
  // Optional at creation — the host picks the map in the lobby's setup panel (see setMap), the same
  // room where invitees are added, so a map is never asked for at invite time.
  mapId: z.string().min(1).optional(),
  isRanked: z.boolean().default(false),
  // teamMapping in here is a placeholder; the real mapping is derived from seat assignments at spawn.
  rules: matchRulesSchema,
});
export type CreateLobbyInput = z.infer<typeof createLobbySchema>;

export const withLobbyIdSchema = z.object({ lobbyId: z.string() });

export const setMapSchema = withLobbyIdSchema.extend({
  mapId: z.string().min(1),
});

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
