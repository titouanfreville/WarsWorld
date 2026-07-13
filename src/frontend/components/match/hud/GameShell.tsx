"use client";
import { renderedTileSize } from "frontend/components/match/render-constants";
import { useFullscreen } from "frontend/utils/use-fullscreen";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { GameMenu } from "./GameMenu";

/**
 * Adaptive layout around the board. The map has a fixed pixel size; the viewport rarely matches its
 * aspect ratio, so there's always leftover space on one axis. This shell puts the HUD in that leftover
 * and scales the board to fill the rest:
 *
 * - It measures the available area, then compares two candidate layouts — HUD **beside** the board
 *   (using horizontal slack) vs HUD **above** it (using vertical slack) — and keeps whichever lets the
 *   board scale LARGER. That criterion naturally lands the HUD in the wasted margin: a tall/narrow map
 *   on a wide screen → HUD on the side; a wide map (or a small screen) → HUD stacked on top.
 * - The board is scaled with a CSS transform (pixelated preserved) — pixi internals are untouched.
 *
 * The `hud` render-prop receives the chosen orientation so the HUD can reflow (a vertical column on
 * the side, a horizontal bar on top). The `board` node is ALWAYS mounted (even before the map loads)
 * so the pixi canvas ref it carries stays attached.
 */
type Orientation = "horizontal" | "vertical";

/** Shell-owned controls the HUD surfaces (in the CommandBar): burger, fullscreen, intel, minimap. */
export type ShellControls = {
  onOpenMenu: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  intelOpen: boolean;
  onToggleIntel: () => void;
  minimapOpen: boolean;
  onToggleMinimap: () => void;
};

type Props = {
  /** Map size in tiles; 0 while the match is still loading. */
  mapWidth: number;
  mapHeight: number;
  board: ReactNode;
  hud: (orientation: Orientation, controls: ShellControls) => ReactNode;
  /** On-map intel overview, shown over a dimmed board when toggled (Tab / the CommandBar button). */
  overlay?: () => ReactNode;
  /** In-match chat — its own column on the LEFT of the board (opposite the HUD + minimap). */
  chat?: () => ReactNode;
};

// Space reserved for the HUD in each layout, and the smallest viewport width that may use the side
// layout at all (below it, a side column would crush the board or the badges).
const HUD_SIDE_W = 340;
const HUD_STACK_H = 140;
const MIN_SIDE_W = 1024;
const PAD = 16;
// Max width of the minimap panel in the STACKED (top-bar) layout, mirrored by `MatchHud` so the
// board-scale reserve below matches the minimap it actually renders. `@gap-3` (12px) separates them.
export const MINIMAP_STACK_W = 240;
const STACK_GAP = 12;
// Width reserved for the chat column on the LEFT of the board (side layout), mirroring the HUD on
// the right — so chat and minimap sit on opposite sides of the map, never overlapping.
const CHAT_W = 320;

export function GameShell({ mapWidth, mapHeight, board, hud, overlay, chat }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [menuOpen, setMenuOpen] = useState(false);
  const [intelOpen, setIntelOpen] = useState(false);
  // Minimap defaults on for laptop-and-up; smaller screens start hidden and opt in via the button.
  const [minimapOpen, setMinimapOpen] = useState(
    () => typeof window !== "undefined" && window.innerWidth >= MIN_SIDE_W,
  );
  const { isFullscreen, toggle } = useFullscreen(shellRef);

  // Keyboard: Tab toggles the intel overview (like a scoreboard); Esc closes any open overlay/menu.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        setIntelOpen((open) => !open);
      } else if (event.key === "Escape") {
        setIntelOpen(false);
        setMenuOpen(false);
      }
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Track the available area: full width of the shell, and the viewport height below its top edge
  // (so the global nav is respected without hard-coding its size). Height is derived from the
  // element's DOCUMENT-absolute top (`rect.top + scrollY`), which is stable across scroll — using the
  // raw `rect.top` made the board rescale (zoom) as the page scrolled. Not tied to the scroll event.
  useEffect(() => {
    const el = shellRef.current;

    if (el === null) {
      return;
    }

    const measure = () => {
      const rect = el.getBoundingClientRect();
      const absoluteTop = rect.top + window.scrollY;
      setBox({ w: rect.width, h: Math.max(0, window.innerHeight - absoluteTop) });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const boardW = (mapWidth + 1) * renderedTileSize;
  const boardH = (mapHeight + 1) * renderedTileSize;
  const availW = box.w - PAD * 2;
  const availH = box.h - PAD * 2;
  const ready = mapWidth > 0 && mapHeight > 0 && availW > 0 && availH > 0;

  let mode: "side" | "stacked" = "stacked";
  let scale = 1;

  // Side layout flanks the board: chat column (left) + HUD column (right). Stacked reserves neither
  // side (chat/minimap ride along in the stacked HUD).
  const sideReserve = HUD_SIDE_W + (chat !== undefined ? CHAT_W : 0);

  if (ready) {
    // Stacked reserve = tempo/badges (HUD_STACK_H) + the minimap panel when open. The minimap fills
    // its capped width at the map's aspect ratio, so its rendered height is analytic — no measuring.
    const minimapH = minimapOpen
      ? Math.min(MINIMAP_STACK_W, availW) * (mapHeight / mapWidth) + STACK_GAP
      : 0;
    const stackReserve = HUD_STACK_H + minimapH;
    const stackedScale = Math.min(availW / boardW, (availH - stackReserve) / boardH);
    const sideScale = Math.min((availW - sideReserve) / boardW, availH / boardH);
    // Only offer the side layout on a wide-enough screen that still leaves the board real room.
    const sideAllowed = box.w >= MIN_SIDE_W && availW - sideReserve > boardW * 0.4 && sideScale > 0;

    mode = sideAllowed && sideScale >= stackedScale ? "side" : "stacked";
    const chosen = mode === "side" ? sideScale : stackedScale;
    // Clamp to a sane range and snap to 0.05 so a resize doesn't jitter the board pixel-by-pixel.
    scale = Math.min(4, Math.max(0.5, Math.round(chosen * 20) / 20));
  }

  const scaledW = boardW * scale;
  const scaledH = boardH * scale;
  const hudNode = hud(mode === "side" ? "vertical" : "horizontal", {
    onOpenMenu: () => setMenuOpen(true),
    isFullscreen,
    onToggleFullscreen: toggle,
    intelOpen,
    onToggleIntel: () => setIntelOpen((open) => !open),
    minimapOpen,
    onToggleMinimap: () => setMinimapOpen((open) => !open),
  });

  // The board box frames the intel overlay — a game overlay ON THE MAP, so its scrim + corner
  // generals size to the board, not the whole screen.
  const boardBox = (
    <div className="@relative @flex-none" style={{ width: scaledW, height: scaledH }}>
      <div
        style={{
          width: boardW,
          height: boardH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {board}
      </div>

      {intelOpen && overlay !== undefined && (
        <div className="@absolute @inset-0 @z-30">
          <button
            aria-label="Close intel overview"
            className="@absolute @inset-0 @bg-black/60 @backdrop-blur-sm"
            onClick={() => setIntelOpen(false)}
          />
          {overlay()}
        </div>
      )}
    </div>
  );

  return (
    <div
      ref={shellRef}
      className="@relative @w-full @overflow-hidden @bg-bg-primary"
      style={{ height: box.h || undefined }}
    >
      {mode === "side" ? (
        // [ chat column (left) ] [ board ] [ HUD column (right, minimap at its bottom) ]
        <div className="@flex @h-full @w-full @items-stretch @justify-center @gap-4 @p-4">
          {chat !== undefined && (
            <div className="@flex @flex-none @flex-col @justify-end" style={{ width: CHAT_W }}>
              {chat()}
            </div>
          )}
          <div className="@flex @flex-none @items-center">{boardBox}</div>
          {hudNode}
        </div>
      ) : (
        // Small / wide-map screens: HUD on top, board below, chat under it.
        <div className="@flex @h-full @w-full @flex-col @items-center @justify-center @gap-3 @p-4">
          {hudNode}
          {boardBox}
          {chat !== undefined && <div className="@w-full @max-w-[960px]">{chat()}</div>}
        </div>
      )}

      <GameMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  );
}
