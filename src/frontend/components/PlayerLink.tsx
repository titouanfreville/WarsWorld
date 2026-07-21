import { type CoAvatar } from "frontend/utils/sprites/avatar";
import { resolvePortrait } from "frontend/utils/sprites/portrait";
import Link from "next/link";
import UserAvatar from "./navbar/UserAvatar";

/**
 * A player's name (and optionally their avatar) as a link to their profile. The shared primitive for
 * "click a player to open their profile" everywhere a player is named — chat, end-game, history.
 *
 * `name` is the routing handle (`/players/<name>`); `label` is what's shown (defaults to `name`), so
 * a caller can display a `[dev]`-stripped or display name while still linking to the real handle.
 */
type Props = {
  name: string;
  label?: string;
  avatar?: CoAvatar | null;
  favouriteCO?: string | null;
  size?: number;
  /** Hide the portrait and render just the linked name. */
  hideAvatar?: boolean;
  className?: string;
};

export function PlayerLink({
  name,
  label,
  avatar,
  favouriteCO,
  size = 22,
  hideAvatar = false,
  className = "",
}: Props) {
  const { image, pixelated, objectPosition } = resolvePortrait(avatar, favouriteCO);

  return (
    <Link
      href={`/players/${name}`}
      onClick={(event) => event.stopPropagation()}
      className={`@group @inline-flex @min-w-0 @items-center @gap-1.5 @align-middle @transition-colors hover:@text-primary ${className}`}
    >
      {!hideAvatar && (
        <UserAvatar
          name={label ?? name}
          image={image}
          pixelated={pixelated}
          objectPosition={objectPosition}
          size={size}
        />
      )}
      <span className="@truncate group-hover:@underline">{label ?? name}</span>
    </Link>
  );
}
