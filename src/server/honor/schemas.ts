import { MedalType } from "@prisma/client";
import { z } from "zod";

/** Award one medal to a single opponent in a finished matchmaking match. */
export const awardMedalSchema = z.object({
  matchId: z.string(),
  toPlayerId: z.string(),
  medal: z.nativeEnum(MedalType),
});

/** A player's honor standing (medals + prestige) — for the profile / lobby / EG insignia. */
export const honorStandingSchema = z.object({
  playerId: z.string(),
});

/** The viewer's own commendation for a match (finished or not) — reflects it back on the EG panel. */
export const myAwardSchema = z.object({
  matchId: z.string(),
});
