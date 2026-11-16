import { z } from "zod";
import { armySchema } from "server/core/schemas/army";
import { coIdSchema } from "server/core/schemas/co";
import { playerSkinsSchema } from "server/players/schemas";

// Cosmetic team labelling for the lobby + match: each team index is assigned a random AW faction,
// re-rolled per match. Label + colour derive from the faction (army), so we only persist the army
// per team index. `teamFactions[teamIndex] === "blue-moon"` ⇒ that team is shown as Blue Moon.
export const teamFactionsSchema = z.array(armySchema);

export type TeamFactions = z.infer<typeof teamFactionsSchema>;

export const pickViewSchema = z.object({ matchId: z.string() });

/** Lock a general during the picker round (per-match skins optional; default from preferences). */
export const lockCoSchema = z.object({
  matchId: z.string(),
  coId: coIdSchema,
  skins: playerSkinsSchema.optional(),
});
