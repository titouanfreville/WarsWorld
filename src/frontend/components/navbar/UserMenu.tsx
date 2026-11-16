import { usePlayers } from "frontend/context/players";
import { signOut, useSession } from "next-auth/react";
import { avatarObjectPosition, coAvatarUrl, isPixelVariant } from "frontend/utils/sprites/avatar";
import Link from "next/link";
import type { ReactNode } from "react";
import { useEffect, useId, useRef, useState } from "react";
import UserAvatar from "./UserAvatar";

/**
 * The logged-in commander badge that replaces the old stacked name / SETTINGS / LOGOUT column.
 *
 * A single ID-tag chip (portrait + callsign + rank) opens a tactical command panel with the account
 * actions — profile, settings, logout. Admin-only tools (including "Play as" impersonation) live in
 * the separate `AdminFlyout`, not here: this menu is every player's account surface, not a staff one.
 *
 * Everything is client-side: identity, roles and image all come from the session / players context
 * that the navbar already reads. No new tRPC surface.
 */
export default function UserMenu() {
  const { currentPlayer, clearLSCurrentPlayer } = usePlayers();
  const { data: session } = useSession();

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const callsign = currentPlayer?.name ?? session?.user?.name ?? "COMMANDER";
  const roles = session?.user?.roles ?? [];
  const rankTag = roles.length > 0 ? roles[0].toUpperCase() : "COMMANDER";

  // The player's chosen CO portrait wins over the OAuth image; a monogram is the last resort.
  const avatar = currentPlayer?.preferences?.avatar ?? null;
  const avatarImage = avatar ? coAvatarUrl(avatar) : session?.user?.image;
  const avatarPixelated = avatar ? isPixelVariant(avatar.variant) : false;
  const avatarPosition = avatar ? avatarObjectPosition(avatar) : undefined;

  const handleLogout = () => {
    clearLSCurrentPlayer();
    void signOut();
  };

  return (
    <div ref={containerRef} className="@relative @text-base">
      {/* ── ID-tag trigger ─────────────────────────────────────────────── */}
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="@group @flex @items-center @gap-2.5 @py-1 @pl-1 @pr-2.5 @border @border-primary/40
          hover:@border-primary @bg-black/30 hover:@bg-black/50 @backdrop-blur-sm @transition-all
          @duration-200 hover:@shadow-[0_0_18px_-4px] hover:@shadow-primary/60
          [clip-path:polygon(0_0,100%_0,100%_72%,88%_100%,0_100%)]"
      >
        <UserAvatar
          name={callsign}
          image={avatarImage}
          pixelated={avatarPixelated}
          objectPosition={avatarPosition}
          size={34}
        />
        <span className="@flex @flex-col @items-start @leading-none">
          <span className="@max-w-[9rem] @truncate @font-russoOne @text-sm @tracking-wide @text-white">
            {callsign}
          </span>
          <span className="@mt-0.5 @flex @items-center @gap-1 @text-[9px] @font-semibold @uppercase @tracking-[0.22em] @text-primary-light">
            <span className="@h-1.5 @w-1.5 @rounded-full @bg-green-earth @shadow-[0_0_6px] @shadow-green-earth" />
            {rankTag}
          </span>
        </span>
        <Caret className={`@transition-transform @duration-200 ${open ? "@rotate-180" : ""}`} />
      </button>

      {/* ── Command panel ──────────────────────────────────────────────── */}
      <div
        id={panelId}
        role="menu"
        className={`@absolute @right-0 @top-[calc(100%+0.6rem)] @z-50 @w-64 @origin-top-right
          @transition-all @duration-200 @ease-out
          ${
            open
              ? "@pointer-events-auto @translate-y-0 @opacity-100"
              : "@pointer-events-none @-translate-y-2 @opacity-0"
          }`}
      >
        {/* orange corner tick, top-right — the panel's "hostile-contact" marker */}
        <span className="@absolute @-top-px @right-4 @h-2 @w-2 @-translate-y-full @border-x-[5px] @border-b-[8px] @border-x-transparent @border-b-primary" />

        <div
          className="@overflow-hidden @border @border-primary/50 @bg-bg-primary/95 @backdrop-blur-md
            @shadow-[0_16px_40px_-8px_rgba(0,0,0,0.8)]
            [clip-path:polygon(0_0,100%_0,100%_100%,6%_100%,0_88%)]"
        >
          {/* header — full portrait + callsign */}
          <div className="@relative @flex @items-center @gap-3 @border-b @border-primary/25 @bg-gradient-to-r @from-bg-secondary @to-transparent @px-4 @py-3.5">
            <UserAvatar
              name={callsign}
              image={avatarImage}
              pixelated={avatarPixelated}
              objectPosition={avatarPosition}
              size={44}
            />
            <div className="@min-w-0">
              <p className="@truncate @font-russoOne @text-base @text-white">{callsign}</p>
              <p className="@text-[10px] @uppercase @tracking-[0.2em] @text-primary-light">
                {rankTag}
              </p>
            </div>
          </div>

          <div className="@flex @flex-col @py-1.5">
            <MenuLink
              href={`/players/${currentPlayer?.name ?? ""}`}
              label="View Profile"
              onSelect={() => setOpen(false)}
              icon={<IconProfile />}
            />
            <MenuLink
              href="/settings"
              label="Settings"
              onSelect={() => setOpen(false)}
              icon={<IconSettings />}
            />

            <div className="@mx-4 @my-1.5 @h-px @bg-gradient-to-r @from-primary/40 @to-transparent" />

            <button
              type="button"
              role="menuitem"
              onClick={handleLogout}
              className="@group/logout @flex @items-center @gap-3 @px-4 @py-2.5 @text-left @transition-colors hover:@bg-orange-star/15"
            >
              <span className="@relative @flex @w-4 @justify-center">
                <span className="@absolute @left-0 @top-1/2 @h-4 @w-[3px] @-translate-y-1/2 @scale-y-0 @bg-orange-star @transition-transform @duration-150 group-hover/logout:@scale-y-100" />
                <span className="@text-orange-star">
                  <IconLogout />
                </span>
              </span>
              <span className="@text-sm @font-medium @uppercase @tracking-wide @text-white/90 group-hover/logout:@text-orange-star">
                Log Out
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

type MenuLinkProps = {
  href: string;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
};

function MenuLink({ href, label, icon, onSelect }: MenuLinkProps) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onSelect}
      className="@group/item @flex @items-center @gap-3 @px-4 @py-2.5 @text-white/90 @transition-colors hover:@bg-primary/15 hover:@text-white"
    >
      <span className="@relative @flex @w-4 @justify-center">
        <span className="@absolute @left-0 @top-1/2 @h-4 @w-[3px] @-translate-y-1/2 @scale-y-0 @bg-primary @transition-transform @duration-150 group-hover/item:@scale-y-100" />
        <span className="@text-primary-light group-hover/item:@text-primary">{icon}</span>
      </span>
      <span className="@text-sm @font-medium @uppercase @tracking-wide">{label}</span>
    </Link>
  );
}

/* ── icons — thin 16px line glyphs, currentColor ─────────────────────────── */

function Caret({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" className={`@text-primary-light ${className}`}>
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconProfile() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="8" cy="5" r="2.6" />
      <path d="M2.8 13.5a5.2 5.2 0 0 1 10.4 0" strokeLinecap="round" />
    </svg>
  );
}

function IconSettings() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="8" cy="8" r="2.2" />
      <path
        d="M8 1.5v1.6M8 12.9v1.6M2.3 8h1.6M12.1 8h1.6M4 4l1.1 1.1M10.9 10.9 12 12M12 4l-1.1 1.1M5.1 10.9 4 12"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconLogout() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <path d="M6 2.5H3.2A1.2 1.2 0 0 0 2 3.7v8.6a1.2 1.2 0 0 0 1.2 1.2H6" strokeLinecap="round" />
      <path d="M10 5.5 12.5 8 10 10.5M12.5 8H6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
