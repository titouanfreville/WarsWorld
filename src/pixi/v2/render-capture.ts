import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition } from "frontend/components/match/match-view";
import type { Resource, Texture } from "pixi.js";
import { AnimatedSprite, Container, Graphics } from "pixi.js";

/**
 * The capture flourish for the v2 board — the AW-style capture: the capturing infantry/mech STOMPS in
 * place and the property compresses on each stomp and springs back as the soldier lifts (both driven by
 * ONE shared beat, so the city is crushed exactly when the soldier comes down on it). On a completed
 * capture the final beat crushes the building flat and the new one springs up in its new colour with a
 * flash + gold chevrons — `board-scene` shows the crush on a clone of the OLD building and the rise on
 * the real (already-flipped) tile, so the owner's new colour appears only AS it rises (see
 * `isRebuilding`). Same `{ container, animate(delta), isDone() }` contract the pixi ticker drives for
 * every other board effect (see `render-crash`, `render-unit-destroy`), plus `buildingScaleY()` /
 * `isRebuilding()` which board-scene applies to the LIVE property sprites each frame so they survive the
 * stage rebuilds a capture triggers.
 *
 * Purely presentational: the position + completion come from the BE's fog-masked ability event; the
 * hopping soldier is a clone of the real unit's frames (the scene hides the static one while it hops).
 * No per-unit capture pose exists in the sheets — the hop + building sink are built from the idle frames
 * and primitives. Coordinates match `renderUnitFromView` / the other layers (in `baseTileSize` units).
 */
export type CaptureEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
  /**
   * Vertical scale (1 = full height) for the live property sprite: dips while a partial capture is
   * worked on; on a completed capture it comes all the way DOWN then rebuilds UP in its new colour.
   * `board-scene` reads this each frame and applies it, resetting to 1 on `isDone`.
   */
  buildingScaleY: () => number;
  /**
   * For a completed capture: `false` while the OLD building is crushing down, `true` once the NEW one
   * should be rising (the second half of the settle). `board-scene` uses this to hand the building over
   * from a crushing clone of the old sprite to the real (already-flipped) tile — so the owner's new
   * colour only appears AS the new building rises, never at the authoritative flip mid-animation.
   * Always `false` for a partial capture (no owner change, no hand-off).
   */
  isRebuilding: () => boolean;
};

// `delta` is ~1 per frame at 60fps, so these are roughly frames. A finished capture gets the longer
// life so its collapse-then-rebuild reads as two distinct beats rather than one quick pop; a partial
// tick is a lighter sink-and-recover.
const LIFETIME_PARTIAL = 60; // ~1s
const LIFETIME_COMPLETE = 96; // ~1.6s — the full "building crushed down, then up in its new colour"
const RISE = 12; // how far the chevrons float up
const HOP_HEIGHT = 6; // px the soldier lifts between stomps
const HOP_PERIOD = 22; // frames per stomp (down -> up -> down) — the SHARED beat for soldier AND building
const SQUASH = 0.26; // building compression at the bottom of a stomp
const MAX_SQUASH = 0.5; // a completing capture's stomps dig deeper as it finishes
const COLLAPSE_TO = 0.05; // height the building bottoms out at before the new one springs up (completed)
const CAPTURE_COLOR = 0xffd84a; // gold — a property being taken
const FLASH_COLOR = 0xffffff;
// Fraction of the settle at which a completed capture hands the building over from the crushing old
// sprite to the rising new one — matches where `buildingScaleY` turns from crush to rise.
const REBUILD_AT = 0.35;

// Three chevrons rising in a staggered column, so the capture reads as progress ticking upward.
const CHEVRONS = [
  { delay: 0, scale: 1 },
  { delay: 0.18, scale: 0.9 },
  { delay: 0.36, scale: 0.8 },
];

// easeOutBack — overshoots 1 slightly near the end so the finished building "pops" into place.
const easeOutBack = (x: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;

  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

const centreOf = ([x, y]: BoardPosition): { cx: number; cy: number } => ({
  // Sit low over the tile (near the property's base) so the chevrons rise up through the unit sprite.
  cx: x * baseTileSize + baseTileSize,
  cy: y * baseTileSize + baseTileSize * 0.9,
});

/** A single upward chevron (^), drawn around its own origin so it can be positioned by tile. */
function chevron(scale: number): Graphics {
  const g = new Graphics();
  g.lineStyle(1.4 * scale, CAPTURE_COLOR, 1);
  g.moveTo(-3 * scale, 1.5 * scale);
  g.lineTo(0, -1.5 * scale);
  g.lineTo(3 * scale, 1.5 * scale);

  return g;
}

export function renderCaptureEffect(
  position: BoardPosition,
  completed: boolean,
  // The capturing unit's idle frames, cloned into a hopping sprite; null when the scene is leaving the
  // unit to another effect (a move-then-capture, where the slide already owns the sprite) — then only
  // the chevrons/flash play and the caller skips the building sink.
  soldierFrames: Texture<Resource>[] | null,
): CaptureEffect {
  const [ux, uy] = position;
  const { cx, cy } = centreOf(position);

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 1600; // above the move slides (1500), below the crash/power flourishes (2000)

  // Hopping soldier clone, positioned to match `renderUnitFromView` exactly (x*tile + 8) so it sits
  // where the real (now-hidden) unit was. The scene keeps the static one hidden under it while it hops.
  const soldierBaseX = ux * baseTileSize + 8;
  const soldierBaseY = uy * baseTileSize + 8;
  let soldier: AnimatedSprite | null = null;

  if (soldierFrames !== null && soldierFrames.length > 0) {
    soldier = new AnimatedSprite(soldierFrames);
    soldier.x = soldierBaseX;
    soldier.y = soldierBaseY;
    soldier.animationSpeed = 0.12;
    soldier.play();
    container.addChild(soldier);
  }

  const chevrons = CHEVRONS.map((spec) => {
    const icon = chevron(spec.scale);
    icon.x = cx;
    icon.y = cy;
    icon.alpha = 0;
    container.addChild(icon);

    return { icon, delay: spec.delay };
  });

  // Only a finished capture flashes — the moment the property flips owner.
  const flash = new Graphics();
  flash.x = cx;
  flash.y = cy - RISE * 0.5;
  container.addChild(flash);

  const lifetime = completed ? LIFETIME_COMPLETE : LIFETIME_PARTIAL;
  // The stomp loop gives way to a clean finish near the end (grounded soldier + settled building); a
  // completed capture starts that earlier, leaving room for its crush-then-rebuild.
  const settleStart = completed ? 0.58 : 0.8;
  let elapsed = 0;
  let scaleY = 1; // starts at full height; driven below off the shared stomp beat
  let settleFromScale: number | null = null; // building height when the settle began, for a smooth end
  // For a completed capture: flips true once the NEW building should be rising (see `isRebuilding`).
  let rebuilding = false;

  const animate = (delta: number): void => {
    elapsed += delta;
    const t = Math.min(1, elapsed / lifetime);

    // ONE shared beat drives BOTH the soldier and the building, so the city compresses exactly when the
    // soldier stomps down onto it — not on a separate timeline. bounce: 0 = on the building (impact),
    // 1 = top of the hop.
    const bounce = Math.abs(Math.sin((elapsed / HOP_PERIOD) * Math.PI));
    const settling = t >= settleStart;
    const s = settling ? (t - settleStart) / (1 - settleStart) : 0;

    // Soldier hops on the beat; the hop amplitude fades out through the settle so it ends grounded (no
    // mid-air snap when it hands back to the static sprite).
    if (soldier !== null) {
      soldier.y = soldierBaseY - bounce * HOP_HEIGHT * (settling ? 1 - s : 1);
    }

    // Building. LOOP: compressed at the bottom of each stomp (bounce 0), back to full at each apex —
    // in lockstep with the soldier. SETTLE: a partial eases back to normal; a completed one crushes
    // fully then the new building (the tile already flipped colour post-refetch) springs up with a pop.
    if (settling) {
      if (settleFromScale === null) {
        settleFromScale = scaleY;
      }

      if (completed) {
        if (s < REBUILD_AT) {
          scaleY = settleFromScale + (s / REBUILD_AT) * (COLLAPSE_TO - settleFromScale);
        } else {
          const g = (s - REBUILD_AT) / (1 - REBUILD_AT);
          scaleY = Math.max(0, COLLAPSE_TO + easeOutBack(g) * (1 - COLLAPSE_TO));
        }
      } else {
        scaleY = settleFromScale + s * (2 - s) * (1 - settleFromScale);
      }
    } else {
      const squash = completed ? SQUASH + t * (MAX_SQUASH - SQUASH) : SQUASH;
      scaleY = 1 - (1 - bounce) * squash;
    }

    // A completed capture hands the building over from the crushing OLD sprite to the rising NEW one at
    // the settle's rise — board-scene reads this to swap crushing-clone → real (new-colour) tile.
    rebuilding = completed && settling && s >= REBUILD_AT;

    // Each chevron waits out its delay, then rises and fades — the stagger reads as ticking progress.
    for (const { icon, delay } of chevrons) {
      const local = Math.max(0, (t - delay) / (1 - delay));
      icon.y = cy - RISE * local;
      icon.alpha = local === 0 ? 0 : local < 0.25 ? local / 0.25 : 1 - (local - 0.25) / 0.75;
    }

    // The flash marks the new building springing up on a completed capture — timed to the rise in the
    // settle, so it reads as "planted the flag".
    flash.clear();

    if (completed && settling && s >= 0.3 && s < 0.75) {
      const local = (s - 0.3) / 0.45;
      const radius = 4 + local * 12;
      flash.beginFill(FLASH_COLOR, (1 - local) * 0.85);
      flash.drawCircle(0, 0, radius);
      flash.endFill();
      flash.lineStyle(1.5, CAPTURE_COLOR, (1 - local) * 0.9);
      flash.drawCircle(0, 0, radius);
    }
  };

  return {
    container,
    animate,
    isDone: () => elapsed >= lifetime,
    buildingScaleY: () => scaleY,
    isRebuilding: () => rebuilding,
  };
}
