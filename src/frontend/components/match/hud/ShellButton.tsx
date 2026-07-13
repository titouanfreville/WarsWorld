"use client";
import type { ReactNode } from "react";

/**
 * A small square icon button used for the HUD's shell controls (burger menu, fullscreen). Styled to
 * sit unobtrusively in the CommandBar alongside the day/weather chips.
 */
type Props = {
  onClick: () => void;
  title: string;
  children: ReactNode;
  /** Highlight the button as an active toggle (e.g. the intel overlay is open). */
  active?: boolean;
};

export function ShellButton({ onClick, title, children, active = false }: Props) {
  return (
    <button
      type="button"
      className={`@flex @h-8 @w-8 @flex-none @items-center @justify-center @rounded @transition ${
        active
          ? "@bg-primary @text-black"
          : "@bg-black/30 @text-slate-300 hover:@bg-white/10 hover:@text-white"
      }`}
      onClick={onClick}
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}

const ICON_PROPS = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const BurgerIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
  </svg>
);

/** Outward arrows to enter fullscreen; inward arrows to exit. */
export const FullscreenIcon = ({ active }: { active: boolean }) =>
  active ? (
    <svg {...ICON_PROPS}>
      <path d="M6 2.5v3.5H2.5M10 2.5v3.5h3.5M6 13.5v-3.5H2.5M10 13.5v-3.5h3.5" />
    </svg>
  ) : (
    <svg {...ICON_PROPS}>
      <path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" />
    </svg>
  );

/** Four corner cells — the intel overview (generals in each corner). */
export const IntelIcon = () => (
  <svg {...ICON_PROPS}>
    <rect x="2.5" y="2.5" width="4" height="4" rx="1" />
    <rect x="9.5" y="2.5" width="4" height="4" rx="1" />
    <rect x="2.5" y="9.5" width="4" height="4" rx="1" />
    <rect x="9.5" y="9.5" width="4" height="4" rx="1" />
  </svg>
);

/** Folded-map glyph — the minimap toggle. */
export const MapIcon = () => (
  <svg {...ICON_PROPS}>
    <path d="M2.5 4.5 6 3l4 1.5L13.5 3v8.5L10 13 6 11.5 2.5 13z" />
    <path d="M6 3v8.5M10 4.5V13" />
  </svg>
);
