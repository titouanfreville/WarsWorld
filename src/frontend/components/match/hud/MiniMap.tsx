"use client";
import type { MatchView } from "frontend/components/match/match-view";
import { getPlayerBySlot, getTileAt } from "frontend/components/match/match-view";
import { ARMY_HEX, type Army } from "frontend/utils/sprites";
import { useEffect, useRef } from "react";

/**
 * A live minimap: the whole board — terrain, properties (a per-type coloured marker outlined in their
 * owner's army colour), fog of war (unseen tiles darkened), and every visible unit as an army marker.
 * Units **blink slowly** so the tile they stand on shows through at the trough, giving a read of the
 * ground under them. Fills its container width with the map's aspect ratio; drawn pixelated. The BE
 * only sends units the viewer can see, so unit rendering is fog-safe.
 */
type Props = {
  view: MatchView;
};

// A few pixels per tile so property/unit markers are legible (not a single pixel).
const CELL = 6;

const TERRAIN_COLOR: Record<string, string> = {
  plain: "#8bab5a",
  forest: "#4f7a3f",
  mountain: "#8a7358",
  road: "#b0a894",
  bridge: "#c8b89a",
  river: "#5a8fc0",
  sea: "#33608f",
  shoal: "#d9c98f",
  reef: "#3f7385",
  pipe: "#9aa0a6",
  pipeSeam: "#9aa0a6",
  usedSilo: "#a8a090",
  unusedSilo: "#a8a090",
};

// Per-type property colour (matches the intel card's property legend).
const PROPERTY_COLOR: Record<string, string> = {
  hq: "#e6b422",
  city: "#8aa0b6",
  base: "#c07a3e",
  airport: "#6fb1c9",
  port: "#4f79b0",
  commtower: "#8f6fc0",
  lab: "#5fb08a",
};

const terrainColor = (type: string): string =>
  TERRAIN_COLOR[type] ?? (PROPERTY_COLOR[type] !== undefined ? "#c4c4c4" : "#6b7a5a");

const posKey = (x: number, y: number): string => `${x},${y}`;

/** Draw the whole minimap; `unitAlpha` (0–1) drives the slow unit blink that reveals the ground. */
function drawMiniMap(canvas: HTMLCanvasElement, view: MatchView, unitAlpha: number): void {
  const width = view.map.tiles[0]?.length ?? 0;
  const height = view.map.tiles.length;

  if (width === 0 || height === 0) {
    return;
  }

  canvas.width = width * CELL;
  canvas.height = height * CELL;
  const ctx = canvas.getContext("2d");

  if (ctx === null) {
    return;
  }

  const armyHex = (slot: number): string => {
    const army = getPlayerBySlot(view, slot)?.army as Army | undefined;
    return army !== undefined ? (ARMY_HEX[army] ?? "#9a9a9a") : "#9a9a9a";
  };

  const fog = view.fogOfWar === true;
  const visible = new Set(view.visibleTiles.map(([x, y]) => posKey(x, y)));

  // Terrain, then a per-type property marker outlined in its owner's colour.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const tile = getTileAt(view, [x, y]);
      ctx.fillStyle = terrainColor(tile.type);
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

      const typeColor = PROPERTY_COLOR[tile.type];

      if (typeColor !== undefined) {
        const owner =
          "playerSlot" in tile && tile.playerSlot >= 0 ? armyHex(tile.playerSlot) : "#d0d0d0";
        // Owner-coloured border + type-coloured centre = "a property of this type, owned by X".
        ctx.fillStyle = owner;
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        ctx.fillStyle = typeColor;
        ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
      }
    }
  }

  // Fog: darken tiles the viewer can't currently see (over terrain/properties, under units).
  if (fog) {
    ctx.fillStyle = "rgba(6, 10, 24, 0.62)";

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!visible.has(posKey(x, y))) {
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }
  }

  // Units: a dark-outlined army marker, faded by `unitAlpha` so the tile shows through as it blinks.
  ctx.globalAlpha = unitAlpha;

  for (const unit of view.units) {
    const px = unit.position[0] * CELL;
    const py = unit.position[1] * CELL;
    ctx.fillStyle = "rgba(0, 0, 0, 0.7)";
    ctx.fillRect(px, py, CELL, CELL);
    ctx.fillStyle = armyHex(unit.playerSlot);
    ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
  }

  ctx.globalAlpha = 1;
}

export function MiniMap({ view }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Latest view for the animation loop (it runs off a mount effect, not per-render).
  const viewRef = useRef(view);
  viewRef.current = view;

  const width = view.map.tiles[0]?.length ?? 0;
  const height = view.map.tiles.length;

  // Redraw on a throttled rAF loop so units can blink; reads the latest view each frame.
  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null) {
      return;
    }

    let raf = 0;
    let last = 0;

    const frame = (ts: number) => {
      raf = requestAnimationFrame(frame);

      if (ts - last < 40) {
        return; // ~25fps is plenty for a slow blink
      }

      last = ts;
      // Slow ~1.8s sine: alpha eases between 0.18 (ground shows) and 1 (unit clear).
      const phase = (Math.sin((ts / 1800) * Math.PI * 2) + 1) / 2;
      drawMiniMap(canvas, viewRef.current, 0.18 + phase * 0.82);
    };

    raf = requestAnimationFrame(frame);

    return () => cancelAnimationFrame(raf);
  }, []);

  if (width === 0 || height === 0) {
    return null;
  }

  return (
    <div
      className="@w-full @overflow-hidden @rounded-lg @bg-black/40 @shadow-lg @shadow-black/40 @outline @outline-1 @outline-white/10"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <canvas ref={canvasRef} className="@block @h-full @w-full [image-rendering:pixelated]" />
    </div>
  );
}
