import { coArtUrl, coPortraitUrl, coPoseUrl, type CoName } from "./co";

/**
 * A player's chosen profile picture, built from CO art. FE-local mirror of the backend
 * `coAvatarSchema` (players/schemas.ts) — the server re-validates on save, so drift surfaces as a
 * tsc error at the `updatePreferences` call site rather than silently at runtime.
 *
 * - `art`          smooth full-body illustration (tall) — the hero look for the profile header.
 * - `portraitFull` / `portraitSmall`  pixel mugshots (square-ish) — crisp at badge size.
 */
export type AvatarVariant = "art" | "portraitFull" | "portraitSmall";
export type AvatarPose = "neutral" | "win" | "lose";

/** Focal point as object-position percentages (0..100). Undefined = top-centre. */
export type AvatarPosition = { x: number; y: number };

export type CoAvatar = {
  co: CoName;
  pose: AvatarPose;
  variant: AvatarVariant;
  position?: AvatarPosition;
};

/** Pixel variants want `image-rendering: pixelated`; the smooth art wants normal scaling. */
export const isPixelVariant = (variant: AvatarVariant): boolean => variant !== "art";

/** The chosen focal point, as a CSS `object-position` value. Defaults to top-centre. */
export const avatarObjectPosition = (avatar: CoAvatar): string =>
  avatar.position ? `${avatar.position.x}% ${avatar.position.y}%` : "50% 0%";

/**
 * Resolve an avatar to its image URL. Poses only change the smooth art, and only once that art
 * exists — `coPoseUrl` falls back to the neutral illustration by file convention until then, so a
 * win/lose pick degrades to a valid image rather than a broken one.
 */
export function coAvatarUrl({ co, pose, variant }: CoAvatar): string {
  if (variant === "art") {
    return pose === "neutral" ? coArtUrl(co) : coPoseUrl(co, pose);
  }

  return coPortraitUrl(co, variant === "portraitFull" ? "full" : "small");
}

export const DEFAULT_AVATAR: CoAvatar = { co: "andy", pose: "neutral", variant: "portraitFull" };

/** The `<UserAvatar>` image props for a chosen avatar (monogram fallback when unset). */
export const avatarImageProps = (avatar: CoAvatar | null | undefined) => ({
  image: avatar ? coAvatarUrl(avatar) : undefined,
  pixelated: avatar ? isPixelVariant(avatar.variant) : false,
  objectPosition: avatar ? avatarObjectPosition(avatar) : "50% 0%",
});
