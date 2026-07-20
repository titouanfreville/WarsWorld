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

// Cosmetic profile avatar built from CO art: which general, which pose, and which of the two art
// sets (smooth full-body vs pixel mugshot). Win/lose poses only differ for the smooth art, and only
// once that art is drawn — until then the FE resolver falls back to the neutral art gracefully.
export const coAvatarSchema = z.object({
  co: coSchema,
  pose: z.enum(["neutral", "win", "lose"]),
  variant: z.enum(["art", "portraitFull", "portraitSmall"]),
  // Focal point as object-position percentages (0..100). Full-body art frames the character at
  // different heights, so a fixed top-crop leaves some portraits empty — the player pans to the
  // interesting part. Absent = top-centre (matches the previous fixed crop).
  position: z.optional(z.object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })),
});

export type CoAvatar = z.infer<typeof coAvatarSchema>;

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
  // Profile identity the player sets themselves. `realName` is optional and shown only if provided.
  realName: z.optional(z.string().trim().max(60)),
  // Chosen profile picture, built from CO art (see coAvatarSchema). Absent = fall back to a favourite
  // CO or a generated monogram on the FE.
  avatar: z.optional(coAvatarSchema),
  favouriteCOs: z.optional(z.array(coSchema)),
  favouriteUnits: z.optional(z.array(unitTypeSchema)),
  favouriteGames: z.optional(z.array(favouriteGamesSchema)),
  youtubeChannelId: z.optional(z.string()),
  twitchUserName: z.optional(z.string()),
  // Global default skins; a match may override them per-player (MatchPlayer.skins).
  skins: z.optional(playerSkinsSchema),
  // Cosmetic end-of-match particle effect the player picks for themselves; a CO's signature effect
  // still overrides it on the game-over screen (FE resolves — see frontend particle-effects.ts).
  particleEffect: z.optional(z.enum(["festive", "golden", "petals", "inferno", "storm"])),
  // How much board animation to play, AWDS-style: every army's, only the player's own, or none.
  // Covers the one-shot flourishes (fuel-out crashes, the start-of-turn upkeep motes) — never the
  // persistent badges (HP, capture, low supply), which are information rather than decoration and so
  // are not the player's to switch off. Defaults to "all" when unset (see readAnimationScope).
  animations: z.optional(z.enum(["all", "own", "none"])),
});

export type Preferences = z.infer<typeof preferencesSchema>;
