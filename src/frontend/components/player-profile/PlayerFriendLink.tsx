import { type CoAvatar } from "frontend/utils/sprites/avatar";
import { resolvePortrait } from "frontend/utils/sprites/portrait";
import Link from "next/link";
import UserAvatar from "../navbar/UserAvatar";

type Props = {
  name: string;
  avatar: CoAvatar | null;
  favouriteCO: string | null;
};

/** One friend row: their chosen portrait (or favourite-CO / monogram fallback) + handle, linked. */
export function PlayerFriendLink({ name, avatar, favouriteCO }: Props) {
  const { image, pixelated, objectPosition } = resolvePortrait(avatar, favouriteCO);

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
