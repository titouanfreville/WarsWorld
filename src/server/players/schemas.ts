import { z } from "zod";
import { armySchema } from "server/core/schemas/army";
import { coSchema } from "server/core/schemas/co";
import { unitTypeSchema } from "server/core/schemas/unit";

// Cosmetic, own-side-only skins (no gameplay effect). Chosen once as a preference and overridable
// per match. Asset folders aren't organised yet, so `map` is a free-form tileset id for now.
export const playerSkinsSchema = z.object({
  map: z.string(), // tileset variant id (placeholder until skin assets exist)
  army: armySchema, // faction palette
  camp: z.enum(["aw1", "aw2", "ds", "dor"]), // building / HQ style
});

export type PlayerSkins = z.infer<typeof playerSkinsSchema>;

// Player preferences are a `players` feature concern (not the game engine); the engine's co/unit
// vocabulary is reused for the "favourite COs/units" fields. Moved out of src/shared.

const favouriteGamesSchema = z.enum([
  "advance_wars_1",
  "advance_wars_2_black_hole_rising",
  "advance_wars_dual_strike",
  "advance_wars_days_of_ruin",
  "advance_wars_reboot_camp",
  "advance_wars_by_web",
  "wargroove",
]);

export type FavouriteGames = z.infer<typeof favouriteGamesSchema>;

export const preferencesSchema = z.object({
  favouriteCOs: z.optional(z.array(coSchema)),
  favouriteUnits: z.optional(z.array(unitTypeSchema)),
  favouriteGames: z.optional(z.array(favouriteGamesSchema)),
  youtubeChannelId: z.optional(z.string()),
  twitchUserName: z.optional(z.string()),
  // Global default skins; a match may override them per-player (MatchPlayer.skins).
  skins: z.optional(playerSkinsSchema),
});

export type Preferences = z.infer<typeof preferencesSchema>;
