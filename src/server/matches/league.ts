import { z } from "zod";

/** Mirrors the Prisma `LeagueType` enum (and the engine's `LeagueType` domain type). */
export const leagueTypeSchema = z.enum([
  "standard",
  "fog",
  "highFunds",
  "dualLeague",
  "standardTeams",
  "broken",
]);

export type LeagueType = z.infer<typeof leagueTypeSchema>;
