import {
  baseTileSize,
  mapBorder,
  renderMultiplier,
} from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";

/**
 * Geometry for DOM overlays (combat-forecast box, unit-detail card) drawn on top of the pixi board.
 * They live in the same `@relative` node that hosts the canvas, so a tile's CSS-pixel position is the
 * pixi stage coordinate (`mapBorder` offset + tile index × `baseTileSize`) scaled by `renderMultiplier`
 * — the canvas is `autoDensity`, so its CSS size is exactly the stage size × the multiplier.
 */

/** A tile's on-screen size in CSS px. */
export const tileSizeCss = baseTileSize * renderMultiplier;

/** Top-left CSS-px position of a tile, relative to the board canvas's top-left. */
export const tileTopLeftCss = ([x, y]: BoardPosition): { left: number; top: number } => ({
  left: (mapBorder + x * baseTileSize) * renderMultiplier,
  top: (mapBorder + y * baseTileSize) * renderMultiplier,
});
