"use client";
import type { BoardPosition } from "frontend/components/match/match-view";
import { useEffect, useState } from "react";
import { tileSizeCss, tileTopLeftCss } from "./board-overlay-geometry";

/**
 * A small "ambush" label pinned to the tile where a move was trapped — the unit stopped short there
 * because a fog-hidden enemy was in the way. Anchored to the board (like the combat-forecast / unit
 * cards) rather than a screen-wide banner, so it reads as "this happened HERE" and clears itself.
 *
 * Driven by `notice` from `useMatchBoard` (the halt tile + a bumping `id`); each new id re-shows the
 * label and restarts its auto-dismiss, so a repeat trap on the same tile still registers.
 */
type Props = {
  notice: { position: BoardPosition; id: number } | null;
};

const VISIBLE_MS = 2200;

export function AmbushLabel({ notice }: Props) {
  const [shown, setShown] = useState<{ position: BoardPosition; id: number } | null>(null);

  useEffect(() => {
    if (notice === null) {
      return;
    }

    setShown(notice);
    const timer = setTimeout(() => setShown(null), VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [notice]);

  if (shown === null) {
    return null;
  }

  const anchor = tileTopLeftCss(shown.position);

  return (
    <div
      className="@pointer-events-none @absolute @z-40 @flex @flex-col @items-center"
      // Centre horizontally on the tile and float just above it, with the caret pointing down at it.
      style={{
        left: anchor.left + tileSizeCss / 2,
        top: anchor.top - 4,
        transform: "translate(-50%, -100%)",
      }}
    >
      <div className="@flex @items-center @gap-1 @whitespace-nowrap @rounded @border @border-amber-400/80 @bg-black/85 @px-1.5 @py-0.5 @font-russoOne @text-[10px] @uppercase @tracking-wide @text-amber-300 @shadow-md @shadow-black/60">
        <span className="@text-amber-400">⚠</span>
        Ambush
      </div>
      {/* Caret pointing down at the tile. */}
      <div className="@h-0 @w-0 @border-l-[5px] @border-r-[5px] @border-t-[5px] @border-l-transparent @border-r-transparent @border-t-amber-400/80" />
    </div>
  );
}
