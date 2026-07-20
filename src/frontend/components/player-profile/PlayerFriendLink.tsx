import {
  avatarObjectPosition,
  coAvatarUrl,
  isPixelVariant,
  type CoAvatar,
} from "frontend/utils/sprites/avatar";
import { coArtUrl } from "frontend/utils/sprites/co";
import Link from "next/link";
import UserAvatar from "../navbar/UserAvatar";

type Props = {
  name: string;
  avatar: CoAvatar | null;
  favouriteCO: string | null;
};

/** One friend row: their chosen portrait (or favourite-CO / monogram fallback) + handle, linked. */
export function PlayerFriendLink({ name, avatar, favouriteCO }: Props) {
  const image = avatar ? coAvatarUrl(avatar) : favouriteCO ? coArtUrl(favouriteCO) : undefined;
  const pixelated = avatar ? isPixelVariant(avatar.variant) : false;
  const objectPosition = avatar ? avatarObjectPosition(avatar) : "50% 0%";

  return (
    <Link
      href={`/players/${name}`}
      className="@group @flex @items-center @gap-3 @border @border-transparent @px-2 @py-1.5 @transition-colors hover:@border-primary/30 hover:@bg-primary/10"
    >
      <UserAvatar
        name={name}
        image={image}
        pixelated={pixelated}
        objectPosition={objectPosition}
        size={36}
      />
      <span className="@min-w-0 @truncate @text-sm @text-white/85 group-hover:@text-white">
        {name}
      </span>
    </Link>
  );
}
