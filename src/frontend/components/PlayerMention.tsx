"use client";
import {
  avatarObjectPosition,
  coAvatarUrl,
  isPixelVariant,
  type CoAvatar,
} from "frontend/utils/sprites/avatar";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import UserAvatar from "./navbar/UserAvatar";

/**
 * A player's name + small avatar as it appears inline in chat. The name is NOT styled as a link —
 * when `interactive`, clicking it opens a tiny "View profile" menu (rather than navigating outright);
 * otherwise it's inert text (the in-game chat, where jumping to a profile isn't wanted).
 *
 * The menu is `position: fixed` off the trigger's rect so it escapes the chat list's scroll clipping.
 */
type Props = {
  /** Routing handle for the profile link. */
  name: string;
  /** Text shown (display name, `[dev]`-stripped, etc.). */
  label: string;
  avatar?: CoAvatar | null;
  size?: number;
  /** Colour / weight for the name, from the caller. */
  className?: string;
  /** When false, render inert text (no menu) — used by the in-game chat. */
  interactive?: boolean;
  /** Skip the inline portrait — for rows that already show the player's avatar. */
  hideAvatar?: boolean;
};

export function PlayerMention({
  name,
  label,
  avatar,
  size = 15,
  className = "",
  interactive = true,
  hideAvatar = false,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (menu === null) {
      return;
    }

    const close = () => setMenu(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", close, true);

    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const image = avatar ? coAvatarUrl(avatar) : undefined;
  const pixelated = avatar ? isPixelVariant(avatar.variant) : false;
  const objectPosition = avatar ? avatarObjectPosition(avatar) : "50% 0%";

  const inner = (
    <>
      {!hideAvatar && (
        <UserAvatar
          name={label}
          image={image}
          pixelated={pixelated}
          objectPosition={objectPosition}
          size={size}
        />
      )}
      <span className="@truncate">{label}</span>
    </>
  );

  const shell = `@inline-flex @min-w-0 @max-w-full @items-center @gap-1 @align-middle ${className}`;

  if (!interactive) {
    return <span className={shell}>{inner}</span>;
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          // Don't let the click reach a parent row handler (e.g. a contact row that opens a DM).
          event.stopPropagation();
          const rect = triggerRef.current?.getBoundingClientRect();
          setMenu(rect ? { x: rect.left, y: rect.bottom + 4 } : null);
        }}
        className={`${shell} @cursor-pointer hover:@brightness-125`}
      >
        {inner}
      </button>

      {menu !== null &&
        typeof document !== "undefined" &&
        createPortal(
          // Portalled to <body> so `position: fixed` resolves against the viewport, not a chat
          // panel's blurred/transformed box (which would otherwise offset it off-screen).
          <div
            style={{ position: "fixed", left: menu.x, top: menu.y }}
            className="@z-[90] @min-w-max @overflow-hidden @border @border-primary/40 @bg-bg-primary/95 @shadow-[0_8px_24px_-6px_rgba(0,0,0,0.8)] @backdrop-blur-sm"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Link
              href={`/players/${name}`}
              className="@flex @items-center @gap-2 @px-3 @py-1.5 @text-xs @font-medium @uppercase @tracking-wide @text-white/90 @transition-colors hover:@bg-primary/20 hover:@text-white"
            >
              <svg
                viewBox="0 0 16 16"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                className="@text-primary-light"
              >
                <circle cx="8" cy="5" r="2.6" />
                <path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" strokeLinecap="round" />
              </svg>
              View profile
            </Link>
          </div>,
          document.body,
        )}
    </>
  );
}
