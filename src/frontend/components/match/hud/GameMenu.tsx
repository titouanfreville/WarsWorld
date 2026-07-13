"use client";
import Link from "next/link";

/**
 * The immersive game view hides the global navbar, so this slide-over (opened from the CommandBar
 * burger) is how the player reaches the rest of the site or leaves the match. A lightweight overlay
 * panel — nav destinations as client-side links, plus a prominent "Leave match" back to the lobby
 * list. Rendered inside `GameShell`, absolutely positioned over the board.
 */
type Props = {
  open: boolean;
  onClose: () => void;
};

const LINKS: { label: string; href: string }[] = [
  { label: "Your Matches", href: "/your-matches" },
  { label: "Home", href: "/" },
  { label: "News", href: "/news" },
  { label: "How to Play", href: "/howtoplay" },
];

export function GameMenu({ open, onClose }: Props) {
  if (!open) {
    return null;
  }

  return (
    <div className="@absolute @inset-0 @z-40">
      {/* scrim */}
      <button
        aria-label="Close menu"
        className="@absolute @inset-0 @bg-black/60 @backdrop-blur-sm"
        onClick={onClose}
      />

      {/* panel */}
      <nav className="@absolute @inset-y-0 @left-0 @flex @w-64 @flex-col @gap-1 @bg-bg-primary @p-4 @shadow-2xl @shadow-black/60">
        <div className="@mb-3 @flex @items-center @justify-between @border-b @border-white/10 @pb-3">
          <span className="@font-russoOne @text-lg @uppercase @tracking-widest @text-primary">
            War Room
          </span>
          <button
            aria-label="Close"
            className="@text-slate-400 @transition hover:@text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="@rounded @px-3 @py-2 @font-russoOne @text-sm @uppercase @tracking-wide @text-slate-200 @transition hover:@bg-white/5 hover:@text-primary"
            onClick={onClose}
          >
            {link.label}
          </Link>
        ))}

        <Link
          href="/your-matches"
          className="@mt-auto @rounded-lg @border @border-white/15 @px-3 @py-2 @text-center @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 @transition hover:@border-red-500/60 hover:@text-red-300"
          onClick={onClose}
        >
          Leave match
        </Link>
      </nav>
    </div>
  );
}
