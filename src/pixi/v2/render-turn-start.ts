import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";
import { Container, Graphics } from "pixi.js";

/**
 * The start-of-turn "upkeep" flourish for the v2 board: a brief floating icon over each of the
 * incoming player's units that the BE repaired (green "+") or refuelled (cyan fuel drop) during the
 * pass-turn upkeep. Purely presentational — the affected tiles come from `match.full`'s fog-safe
 * `turnStart` report (own units only), the client just animates them.
 *
 * Same shape as the weather overlay: a `Container` plus an `animate(delta)` driven by the pixi
 * ticker in `board-scene`. It runs once, self-reports `isDone()` after a short hold, and is then
 * removed from the ticker and destroyed. Coordinates are in `baseTileSize` units like every other
 * board layer (the stage applies `renderMultiplier`), so it lines up with the unit sprites.
 *
 * Returns `null` when there's nothing to show (no repairs, no refuels).
 */
export type TurnStartEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
};

// Ticker `delta` is ~1 per frame at 60fps, so these are roughly frames: ~1.2s of life, rising ~10px.
const LIFETIME = 72;
const RISE = 10;
const REPAIR_COLOR = 0x3fd35b;
const REFUEL_COLOR = 0x43d9e4;

type Mote = { icon: Container; startY: number };

/** A small green plus (repair). Drawn around its own origin so it can be positioned by tile centre. */
function repairIcon(): Container {
  const g = new Graphics();
  g.beginFill(REPAIR_COLOR, 1);
  g.drawRect(-3, -1, 6, 2); // horizontal bar
  g.drawRect(-1, -3, 2, 6); // vertical bar
  g.endFill();
  g.lineStyle(0.5, 0x0a3d16, 0.6);
  g.drawRect(-3, -3, 6, 6);
  return g;
}

/** A small cyan fuel drop (refuel): a rounded teardrop. */
function refuelIcon(): Container {
  const g = new Graphics();
  g.beginFill(REFUEL_COLOR, 1);
  g.drawCircle(0, 1, 2.4);
  g.drawPolygon([-1.6, 0.2, 1.6, 0.2, 0, -3.2]); // pointed top
  g.endFill();
  g.beginFill(0xffffff, 0.7);
  g.drawCircle(-0.7, 0.6, 0.7); // highlight
  g.endFill();
  return g;
}

const centreOf = ([x, y]: BoardPosition): { cx: number; cy: number } => ({
  // Unit sprites sit at (x*baseTileSize + 8); centre the mote over the sprite and lift it slightly.
  cx: x * baseTileSize + baseTileSize,
  cy: y * baseTileSize + baseTileSize * 0.5,
});

export function renderTurnStartEffect(
  repaired: readonly BoardPosition[],
  refuelled: readonly BoardPosition[],
): TurnStartEffect | null {
  if (repaired.length === 0 && refuelled.length === 0) {
    return null;
  }

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 2000; // above units, below menus

  const motes: Mote[] = [];

  const spawn = (position: BoardPosition, make: () => Container, dx: number): void => {
    const { cx, cy } = centreOf(position);
    const icon = make();
    icon.x = cx + dx;
    icon.y = cy;
    icon.alpha = 0;
    container.addChild(icon);
    motes.push({ icon, startY: cy });
  };

  // If a unit was both repaired and refuelled, nudge the two icons apart so both read.
  const alsoRefuelled = (position: BoardPosition): boolean =>
    refuelled.some((p) => p[0] === position[0] && p[1] === position[1]);

  for (const position of repaired) {
    spawn(position, repairIcon, alsoRefuelled(position) ? -3 : 0);
  }

  for (const position of refuelled) {
    const bothOnUnit = repaired.some((p) => p[0] === position[0] && p[1] === position[1]);
    spawn(position, refuelIcon, bothOnUnit ? 3 : 0);
  }

  let elapsed = 0;

  const animate = (delta: number): void => {
    elapsed += delta;
    const t = Math.min(1, elapsed / LIFETIME);
    // Ease up and fade: quick fade-in over the first fifth, hold, then fade out over the last third.
    const alpha = t < 0.2 ? t / 0.2 : t > 0.66 ? Math.max(0, 1 - (t - 0.66) / 0.34) : 1;

    for (const mote of motes) {
      mote.icon.y = mote.startY - RISE * t;
      mote.icon.alpha = alpha;
    }
  };

  return { container, animate, isDone: () => elapsed >= LIFETIME };
}
