import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";
import { Container, Graphics } from "pixi.js";

/**
 * The unit-destruction flourish for the v2 board: a short explosion (bright flash core + a burst of
 * dark debris) over the tile a unit died on, so a kill reads as an event instead of the unit silently
 * vanishing on the next refetch. Same `{ container, animate(delta), isDone() }` contract the pixi
 * ticker drives for every other board effect (see `render-crash`, `render-unit-move`).
 *
 * Built from primitives (no battle-scene art — that pack is a later phase). Purely presentational:
 * the positions come fog-masked from the BE's emitted combat/delete events, the client only animates
 * them. Coordinates are in `baseTileSize` units like every other board layer.
 */
export type UnitDestroyEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
};

// ~0.7s at 60fps (`delta` is ~1 per frame). Long enough to register, short enough not to hold up play.
const LIFETIME = 42;
const FLASH_COLOR = 0xfff3c4;
const CORE_COLOR = 0xff8a3d;
const SMOKE_COLOR = 0x4a4a4a;
// Debris chunks flung out around the blast — spread by angle so it reads as a burst, not one blob.
const DEBRIS = [
  { angle: -1.9, dist: 9, radius: 2.4 },
  { angle: -0.6, dist: 11, radius: 2 },
  { angle: 0.7, dist: 8, radius: 2.6 },
  { angle: 2.2, dist: 10, radius: 2 },
  { angle: 3.4, dist: 7, radius: 2.2 },
];

const centreOf = ([x, y]: BoardPosition): { cx: number; cy: number } => ({
  // Match where the unit sprite sat (see renderUnitFromView / render-crash) so the blast lands on it.
  cx: x * baseTileSize + baseTileSize,
  cy: y * baseTileSize + baseTileSize * 0.5,
});

export function renderUnitDestroyEffect(position: BoardPosition): UnitDestroyEffect {
  const { cx, cy } = centreOf(position);

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 1600; // above the move slides (1500), below the crash/power flourishes (2000)

  const flash = new Graphics();
  flash.x = cx;
  flash.y = cy;
  container.addChild(flash);

  const debris = DEBRIS.map((spec) => {
    const chunk = new Graphics();
    chunk.beginFill(SMOKE_COLOR, 1);
    chunk.drawCircle(0, 0, spec.radius);
    chunk.endFill();
    chunk.x = cx;
    chunk.y = cy;
    container.addChild(chunk);

    return { chunk, spec };
  });

  let elapsed = 0;

  const animate = (delta: number): void => {
    elapsed += delta;
    const t = Math.min(1, elapsed / LIFETIME);

    // Flash core: expands over the first ~45% of the life, then fades; gone by ~60%.
    flash.clear();

    if (t < 0.6) {
      const grow = Math.min(1, t / 0.45);
      const radius = 3 + grow * 9;
      flash.beginFill(FLASH_COLOR, (1 - grow) * 0.9);
      flash.drawCircle(0, 0, radius);
      flash.endFill();
      flash.beginFill(CORE_COLOR, (1 - grow) * 0.7);
      flash.drawCircle(0, 0, radius * 0.6);
      flash.endFill();
    }

    // Debris: fly outward, drift up a touch, shrink and fade over the full run.
    for (const { chunk, spec } of debris) {
      const travelled = spec.dist * t;
      chunk.x = cx + Math.cos(spec.angle) * travelled;
      chunk.y = cy + Math.sin(spec.angle) * travelled - 4 * t;
      chunk.alpha = 1 - t;
      chunk.scale.set(1 - t * 0.4);
    }
  };

  return { container, animate, isDone: () => elapsed >= LIFETIME };
}
