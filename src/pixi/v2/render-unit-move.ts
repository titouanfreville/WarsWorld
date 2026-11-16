import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { UnitType } from "frontend/components/match/unit-types";
import type { Resource, Texture } from "pixi.js";
import { AnimatedSprite, Container } from "pixi.js";
import { stepAnimation } from "frontend/components/match/unit-animation";

/**
 * The moving-unit flourish for the v2 board: a unit sprite that slides tile-by-tile along its path,
 * playing the directional walk cycle for each segment, instead of teleporting to its destination on
 * the stage rebuild. Same `{ container, animate(delta), isDone() }` contract the pixi ticker drives
 * for every other one-shot board effect (see `render-crash`, `render-turn-start`) so `board-scene`
 * runs and disposes of it identically.
 *
 * Purely presentational: the path comes from the acting player's buffered intent (own moves) or a
 * fog-masked BE move report (opponent moves) — the client only animates it. Coordinates match
 * `renderUnitFromView` exactly (anchor 0,0 at `x*baseTileSize + baseTileSize/2`) so the slide ends
 * flush with the static sprite the scene hands back to.
 */
export type UnitMoveEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
};

/** The army sheet's parsed `animations`, loosely keyed so directional/idle lookups are plain strings. */
export type MoveAnimationFrames = Record<string, Texture<Resource>[] | undefined>;

// Tiles per second the sprite travels — brisk but readable, close to AWBW's on-map unit slide.
// `delta` is ~1 per frame at 60fps, so tiles-per-frame = SPEED_TILES_PER_SEC / 60 (≈0.28s per tile).
const SPEED_TILES_PER_SEC = 3.5;
// Frames-per-texture for the walk cycle while sliding — a readable trot, not a blur.
const WALK_ANIM_SPEED = 0.15;
// Unit sprites render inset half a tile (see `renderUnitFromView`: `x * baseTileSize + 8`).
const SPRITE_INSET = baseTileSize / 2;

/** Textures for a step, resolving the directional key and degrading to idle when the sheet lacks it. */
const framesFor = (
  animations: MoveAnimationFrames,
  from: BoardPosition,
  to: BoardPosition,
  unitType: UnitType,
): { textures: Texture<Resource>[] | undefined; flipX: boolean } => {
  const step = stepAnimation(unitType, from, to);
  const directional = animations[step.key];

  // Only mirror when the directional art actually exists — the idle fallback always faces its
  // default way, so flipping it would point the unit backwards.
  return {
    textures: directional ?? animations[step.idleKey],
    flipX: step.flipX && directional !== undefined,
  };
};

export function renderUnitMoveEffect(
  path: readonly BoardPosition[],
  unitType: UnitType,
  animations: MoveAnimationFrames,
): UnitMoveEffect | null {
  // Nothing to slide (a stationary action, or a single-tile "path") — the static sprite already sits
  // where it belongs, so there's no animation to run.
  if (path.length < 2) {
    return null;
  }

  const start = framesFor(animations, path[0], path[1], unitType);

  // No art at all for this unit (not even idle) — bail so the scene keeps the static sprite visible
  // rather than showing an empty container that never resolves.
  if (start.textures === undefined || start.textures.length === 0) {
    return null;
  }

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 1500; // above map/highlights, below the crash/power flourishes and menus

  const sprite = new AnimatedSprite(start.textures);
  sprite.animationSpeed = WALK_ANIM_SPEED;
  sprite.play();
  container.addChild(sprite);

  const totalSteps = path.length - 1;
  let travelled = 0; // distance along the path, in tiles
  let renderedSegment = -1;

  const applyPosition = (): void => {
    // Clamp to the last segment so `travelled === totalSteps` resolves to the final tile, not past it.
    const segment = Math.min(Math.floor(travelled), totalSteps - 1);
    const from = path[segment];
    const to = path[segment + 1];
    const localT = travelled - segment; // 0..1 within this segment

    if (segment !== renderedSegment) {
      renderedSegment = segment;
      const { textures, flipX } = framesFor(animations, from, to, unitType);

      if (textures !== undefined && textures.length > 0) {
        sprite.textures = textures;
        sprite.play();
      }

      sprite.scale.x = flipX ? -1 : 1;
    }

    const px = (from[0] + (to[0] - from[0]) * localT) * baseTileSize + SPRITE_INSET;
    const py = (from[1] + (to[1] - from[1]) * localT) * baseTileSize + SPRITE_INSET;
    sprite.y = py;
    // A left-facing (mirrored) sprite draws leftward from its x with anchor (0,0); shift by the frame
    // width so its visible box stays over the tile, flush with the un-mirrored static sprite.
    sprite.x = sprite.scale.x === -1 ? px + sprite.texture.width : px;
  };

  applyPosition();

  const tilesPerFrame = SPEED_TILES_PER_SEC / 60;

  const animate = (delta: number): void => {
    travelled = Math.min(totalSteps, travelled + tilesPerFrame * delta);
    applyPosition();
  };

  return { container, animate, isDone: () => travelled >= totalSteps };
}
