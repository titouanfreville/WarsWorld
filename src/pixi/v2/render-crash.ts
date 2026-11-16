import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";
import { Container, Graphics } from "pixi.js";

/**
 * The fuel-out crash flourish for the v2 board: a short smoke puff over every tile where a unit ran
 * out of fuel during the pass-turn upkeep. Without it a crash reads as a unit silently vanishing
 * between two renders — the player never learns what happened to it.
 *
 * Same shape as the turn-start upkeep effect (see render-turn-start): a `Container` plus an
 * `animate(delta)` driven by the pixi ticker in `board-scene`, run once, self-reporting `isDone()`
 * so the scene can remove and destroy it. Coordinates are in `baseTileSize` units like every other
 * board layer, so the puffs line up with where the sprites were.
 *
 * Purely presentational: the tiles come from `match.full`'s fog-masked `crashes` report, and the
 * client just animates them. Returns `null` when nothing crashed.
 */
export type CrashEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
};

// Ticker `delta` is ~1 per frame at 60fps, so roughly frames. Matched to the upkeep motes' ~1.2s so
// a crash and a neighbouring refuel read as one beat rather than two.
const LIFETIME = 72;
const RISE = 8;
/** Puffs per crash, offset around the tile centre so it reads as smoke rather than one blob. */
const PUFFS = [
  { dx: 0, dy: 0, radius: 3.2, delay: 0 },
  { dx: -2.6, dy: 1, radius: 2.4, delay: 0.12 },
  { dx: 2.6, dy: 0.6, radius: 2.4, delay: 0.2 },
  { dx: 0.8, dy: -2.2, radius: 2, delay: 0.3 },
];
const SMOKE_DARK = 0x4a4a4a;
const SMOKE_LIGHT = 0x9a9a9a;

type Puff = { icon: Graphics; startY: number; delay: number };

const centreOf = ([x, y]: BoardPosition): { cx: number; cy: number } => ({
  // Unit sprites sit at (x*baseTileSize + 8) — centre the puff over where the sprite was.
  cx: x * baseTileSize + baseTileSize,
  cy: y * baseTileSize + baseTileSize * 0.5,
});

export function renderCrashEffect(crashed: readonly BoardPosition[]): CrashEffect | null {
  if (crashed.length === 0) {
    return null;
  }

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 2000; // above units, below menus — same band as the upkeep motes

  const puffs: Puff[] = [];

  for (const position of crashed) {
    const { cx, cy } = centreOf(position);

    for (const spec of PUFFS) {
      const icon = new Graphics();
      icon.beginFill(spec.delay === 0 ? SMOKE_DARK : SMOKE_LIGHT, 1);
      icon.drawCircle(0, 0, spec.radius);
      icon.endFill();
      icon.x = cx + spec.dx;
      icon.y = cy + spec.dy;
      icon.alpha = 0;
      container.addChild(icon);
      puffs.push({ icon, startY: cy + spec.dy, delay: spec.delay });
    }
  }

  let elapsed = 0;

  const animate = (delta: number): void => {
    elapsed += delta;
    const t = Math.min(1, elapsed / LIFETIME);

    for (const puff of puffs) {
      // Each puff waits out its delay, then billows over the rest of the run — staggering them is
      // what makes it read as smoke dispersing instead of four circles moving in lockstep.
      const local = Math.max(0, (t - puff.delay) / (1 - puff.delay));

      puff.icon.y = puff.startY - RISE * local;
      puff.icon.scale.set(0.6 + local * 0.8);
      // Fade in over the first fifth of its own life, then out across the remainder.
      puff.icon.alpha = local === 0 ? 0 : local < 0.2 ? local / 0.2 : 1 - (local - 0.2) / 0.8;
    }
  };

  return { container, animate, isDone: () => elapsed >= LIFETIME };
}
