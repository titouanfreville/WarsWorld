import { avatarObjectPosition, coAvatarUrl, isPixelVariant, type CoAvatar } from "./avatar";
import { coArtUrl } from "./co";

/**
 * How a player is pictured: their chosen avatar, else their favourite CO's art, else nothing (the
 * caller renders a monogram).
 *
 * One derivation, three callers — `PlayerLink`, `PlayerFriendLink` and `ProfileHeader` each carried
 * a byte-identical copy of this ternary plus its two companions, which is exactly the "put shared
 * derivation in `frontend/utils` and reuse it" rule in src/frontend/CLAUDE.md. It also settles the
 * nullish handling in one place rather than three: `avatar` and `favouriteCO` are both
 * `T | null`, so both are tested the same explicit way instead of one truthy and one `!= null`
 * within a single expression.
 */
export type Portrait = {
  /** Image URL, or undefined when there's nothing to show. */
  image: string | undefined;
  /** Pixel-art variants must not be smoothed when scaled. */
  pixelated: boolean;
  /** CO art is framed on the face rather than centred. */
  objectPosition: string;
};

export const resolvePortrait = (
  avatar: CoAvatar | null | undefined,
  favouriteCO: string | null | undefined,
): Portrait => {
  if (avatar != null) {
    return {
      image: coAvatarUrl(avatar),
      pixelated: isPixelVariant(avatar.variant),
      objectPosition: avatarObjectPosition(avatar),
    };
  }

  return {
    image: favouriteCO != null ? coArtUrl(favouriteCO) : undefined,
    pixelated: false,
    objectPosition: "50% 0%",
  };
};
