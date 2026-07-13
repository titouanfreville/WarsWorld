import { useEffect, useRef } from "react";

/**
 * A real terrain thumbnail drawn from a map's tile-type grid (the shape `mapBanView` sends). Same
 * palette as the in-match `MiniMap` so a map reads the same here as on the board. Pure presentation —
 * it colours cells, it doesn't know any game rules. Fills its container at the map's aspect ratio,
 * drawn pixelated.
 */
type Props = {
  terrain: string[][];
  className?: string;
};

// Mirrors hud/MiniMap.tsx — kept FE-local (presentation only; not a shared contract).
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

const PROPERTY_COLOR: Record<string, string> = {
  hq: "#e6b422",
  city: "#8aa0b6",
  base: "#c07a3e",
  airport: "#6fb1c9",
  port: "#4f79b0",
  commtower: "#8f6fc0",
  lab: "#5fb08a",
};

const CELL = 5;

const colorFor = (type: string): string => PROPERTY_COLOR[type] ?? TERRAIN_COLOR[type] ?? "#6b7a5a";

export default function MapThumbnail({ terrain, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const height = terrain.length;
  const width = terrain[0]?.length ?? 0;

  useEffect(() => {
    const canvas = canvasRef.current;

    if (canvas === null || width === 0 || height === 0) {
      return;
    }

    canvas.width = width * CELL;
    canvas.height = height * CELL;
    const ctx = canvas.getContext("2d");

    if (ctx === null) {
      return;
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const type = terrain[y][x];
        ctx.fillStyle = colorFor(type);
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);

        // Give properties a small inset so they read as markers over the ground.
        if (PROPERTY_COLOR[type] !== undefined) {
          ctx.fillStyle = "rgba(0,0,0,0.35)";
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
          ctx.fillStyle = PROPERTY_COLOR[type];
          ctx.fillRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2);
        }
      }
    }
  }, [terrain, width, height]);

  if (width === 0 || height === 0) {
    return <div className={className} style={{ background: "#141c2c" }} />;
  }

  return (
    <div className={className} style={{ aspectRatio: `${width} / ${height}` }}>
      <canvas ref={canvasRef} className="@block @h-full @w-full [image-rendering:pixelated]" />
    </div>
  );
}
