import type { BoardPosition } from "frontend/components/match/match-view";
import type { UnitType } from "frontend/components/match/unit-types";

/**
 * Directional walk-cycle selection for the moving-unit animation. Pure geometry + string keys — no
 * pixi, no spritesheet object — so it unit-tests in node and stays importable from SSR paths, while
 * the render effect (`pixi/v2/render-unit-move`) is the only pixi-coupled half.
 *
 * The per-nation spritesheets carry three directional walk cycles per unit — `<unit>-mup`,
 * `<unit>-mdown`, `<unit>-mside` — plus the idle `<unit>`. Left and right share the `-mside` art;
 * left is that art mirrored on X (`flipX`). A unit without directional frames falls back to idle,
 * but that decision lives in the effect (it holds the spritesheet); here we only name the key.
 */
export type StepDirection = "up" | "down" | "side";

export type StepAnimation = {
  /** Spritesheet animation key for this step, e.g. `"tank-mside"`. Fall back to `idleKey` if absent. */
  key: string;
  /** Idle key to fall back to when the sheet lacks the directional frames for this unit. */
  idleKey: UnitType;
  /** Mirror the sprite on X — true only when walking left (the `-mside` art faces right). */
  flipX: boolean;
};

/**
 * The dominant axis of a single path step. Paths are orthogonal one-tile steps, but guard against a
 * diagonal (pick the larger delta; ties go horizontal) so a malformed path can't throw.
 */
export const stepDirection = (
  from: BoardPosition,
  to: BoardPosition,
): { direction: StepDirection; flipX: boolean } => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];

  if (Math.abs(dy) > Math.abs(dx)) {
    return { direction: dy < 0 ? "up" : "down", flipX: false };
  }

  // Horizontal (and the diagonal/tie fallback): the `-mside` art faces right, so flip when going left.
  return { direction: "side", flipX: dx < 0 };
};

/** The walk animation for a single step: its spritesheet key, idle fallback key, and mirror flag. */
export const stepAnimation = (
  unitType: UnitType,
  from: BoardPosition,
  to: BoardPosition,
): StepAnimation => {
  const { direction, flipX } = stepDirection(from, to);

  return { key: `${unitType}-m${direction}`, idleKey: unitType, flipX };
};
