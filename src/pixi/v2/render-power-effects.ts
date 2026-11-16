import { baseTileSize } from "frontend/components/match/render-constants";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import { unitOwnerHasActivePower } from "frontend/components/match/match-view";
import { BLEND_MODES, Container, Graphics, Sprite } from "pixi.js";

/**
 * CO-power on-board effects for the v2 board, both driven by the pixi ticker in `board-scene`:
 *
 * - {@link renderPowerAura} — a PERSISTENT, subtly pulsing glow under every unit whose owner has an
 *   active CO/super power. Rebuilt each scene render (like the weather overlay) and torn down when no
 *   unit is powered, so it tracks the BE power state exactly. Purely presentational.
 * - {@link renderPowerLaunchEffect} — a ONE-SHOT launch flourish: a spherical "blink" over each unit
 *   the power touched (tinted repaired / damaged / spawned / empowered), PLUS the offensive power's
 *   signature set-piece over its impact tiles (Sturm meteor, von-Bolt lightning, Rachel missiles).
 *   Same contract as the start-of-turn flourish: runs once, self-reports `isDone()`, then the scene
 *   removes/destroys it.
 *
 * Coordinates are in `baseTileSize` units like every other board layer (the stage applies
 * `renderMultiplier`), matching the unit sprites at `(x*baseTileSize + 8)`.
 */

export type PoweredUnitPulse = {
  animate: (delta: number) => void;
};

export type PowerLaunchEffect = {
  container: Container;
  animate: (delta: number) => void;
  isDone: () => boolean;
};

/**
 * FE-local mirrors of the wire power types (the BE re-validates; these stay structurally in sync with
 * the engine unions — a drift surfaces as a tsc error at the mapping site in usePowerBoardPulse).
 */
export type PowerEffectKind = "repaired" | "damaged" | "spawned" | "empowered";
export type PowerAffectedUnit = { position: BoardPosition; kind: PowerEffectKind };
export type PowerSignatureKind =
  | "meteor"
  | "lightning"
  | "missiles"
  | "tsunami"
  | "blackWave"
  | "blizzard";
export type PowerSignature = { kind: PowerSignatureKind; epicenters: BoardPosition[] };

/** Everything the one-shot launch flourish draws for a single activation. */
export type PowerLaunchPulse = {
  affectedUnits: readonly PowerAffectedUnit[];
  signature: PowerSignature | null;
};

/** Board size in tiles — the sweep signatures need it to span the whole board. */
export type BoardExtent = { width: number; height: number };

/** The global-sweep signatures (whole-board effects) vs the positional strikes (epicenter effects). */
const SWEEP_KINDS: ReadonlySet<PowerSignatureKind> = new Set<PowerSignatureKind>([
  "tsunami",
  "blackWave",
  "blizzard",
]);

// The powered-unit tell: pulse a copy of each unit's own sprite. Ticker `delta` ≈ 1 per frame at
// 60fps, so ~60 frames ≈ 1s per breath.
// - Units that can still act get an ADDITIVE warm-gold copy → the silhouette brightens ("luminises").
// - Already-acted units stay DARK (a black NORMAL-blend copy at lower depth) so you can still tell
//   they've moved — the greyed sprite pulses darker rather than lighting up.
const POWER_LUMINISE_TINT = 0xffe6a0;
const POWER_PULSE_PERIOD = 60;
const POWER_LUMINISE_DEPTH = 0.65;
const POWER_PLAYED_TINT = 0x000000;
const POWER_PLAYED_DEPTH = 0.4;

// Per-kind blink colour: healed=green, hit=red, created=cyan, army-buffed=gold.
const BLINK_COLOR: Record<PowerEffectKind, number> = {
  repaired: 0x3fd35b,
  damaged: 0xff5a5a,
  spawned: 0x5ad1ff,
  empowered: 0xffd76a,
};
// ~0.6s life for the one-shot spherical blink: a quick materialise, then a slow fade.
const BLINK_LIFETIME = 36;

/** Centre of a unit's sprite, in board (baseTileSize) coordinates. */
const unitCentre = ([x, y]: BoardPosition): { cx: number; cy: number } => ({
  cx: x * baseTileSize + baseTileSize,
  cy: y * baseTileSize + baseTileSize,
});

/**
 * The "under power" tell: over each powered unit's OWN sprite, lay a copy of that same sprite and pulse
 * its alpha in a loop, following the unit's silhouette (no square halo). Units that can still act get a
 * bright additive copy (luminise); already-acted units get a dark copy at lower depth so they stay
 * visibly "played" rather than lighting up. The overlay copies the base sprite's current animation
 * frame each tick so it stays in sync. Reads the sprites out of `unitsContainer` (each unit is a
 * `unit-x-y`-named container whose first child is the sprite — see renderUnitFromView). Returns `null`
 * when nothing is powered. The overlays live inside the unit containers, so the next scene rebuild
 * destroys them with the rest of the stage (a fresh set is made each render).
 */
export function renderPoweredUnitPulse(
  view: MatchView,
  unitsContainer: Container,
): PoweredUnitPulse | null {
  const targets: { base: Sprite; overlay: Sprite; depth: number }[] = [];

  for (const unit of view.units) {
    if (!unitOwnerHasActivePower(view, unit)) {
      continue;
    }

    const node = unitsContainer.getChildByName(`unit-${unit.position[0]}-${unit.position[1]}`);
    const base: unknown = node instanceof Container ? node.children[0] : undefined;

    if (!(node instanceof Container) || !(base instanceof Sprite)) {
      continue;
    }

    // Already-acted units keep their "played" read: a dark pulse, not a bright one.
    const played = !unit.isReady;
    const overlay = new Sprite(base.texture);
    overlay.position.copyFrom(base.position);
    overlay.anchor.copyFrom(base.anchor);
    overlay.blendMode = played ? BLEND_MODES.NORMAL : BLEND_MODES.ADD;
    overlay.tint = played ? POWER_PLAYED_TINT : POWER_LUMINISE_TINT;
    overlay.alpha = 0;
    overlay.eventMode = "none";
    // Above the unit sprite (index 0), below its HP/capture badges so they stay crisp.
    node.addChildAt(overlay, 1);
    targets.push({ base, overlay, depth: played ? POWER_PLAYED_DEPTH : POWER_LUMINISE_DEPTH });
  }

  if (targets.length === 0) {
    return null;
  }

  let elapsed = 0;

  const animate = (delta: number): void => {
    elapsed += delta;
    const phase = (Math.sin((elapsed / POWER_PULSE_PERIOD) * Math.PI * 2) + 1) / 2;

    for (const { base, overlay, depth } of targets) {
      overlay.texture = base.texture; // follow the animated frame
      overlay.alpha = phase * depth;
    }
  };

  return { animate };
}

/** A layered translucent disc (bright core → soft halo) that reads as a glowing sphere when scaled. */
const makeSphere = (color: number): Graphics => {
  const sphere = new Graphics();
  sphere.beginFill(color, 0.9);
  sphere.drawCircle(0, 0, baseTileSize * 0.3);
  sphere.endFill();
  sphere.beginFill(color, 0.45);
  sphere.drawCircle(0, 0, baseTileSize * 0.6);
  sphere.endFill();
  sphere.beginFill(color, 0.2);
  sphere.drawCircle(0, 0, baseTileSize * 0.92);
  sphere.endFill();
  // A brighter offset highlight sells the spherical read (light catching the top-left of the orb).
  sphere.beginFill(0xffffff, 0.55);
  sphere.drawCircle(-baseTileSize * 0.12, -baseTileSize * 0.12, baseTileSize * 0.14);
  sphere.endFill();
  sphere.blendMode = BLEND_MODES.ADD;

  return sphere;
};

/** A per-signature drawer: `update(elapsed)` redraws its Graphics for the frame; `lifetime` in frames. */
type SignaturePart = { update: (elapsed: number) => void; lifetime: number };

const TILE = baseTileSize;
// Signatures fall from well above the board, so the meteor/bolt/missiles enter from off-screen.
const SKY = TILE * 9;

/** Sturm's Meteor Strike: a fiery body streaks down to each epicenter, then a shockwave + flash. */
const buildMeteor = (container: Container, epicenters: readonly BoardPosition[]): SignaturePart => {
  const TRAVEL = 28;
  const IMPACT = 44;
  const parts = epicenters.map((position) => {
    const { cx, cy } = unitCentre(position);
    const body = new Graphics();
    body.blendMode = BLEND_MODES.ADD;
    const impact = new Graphics();
    impact.blendMode = BLEND_MODES.ADD;
    impact.x = cx;
    impact.y = cy;
    container.addChild(body, impact);

    return { cx, cy, startX: cx + TILE * 4, startY: cy - SKY, body, impact };
  });

  const update = (elapsed: number): void => {
    for (const p of parts) {
      p.body.clear();
      p.impact.clear();

      if (elapsed <= TRAVEL) {
        const t = elapsed / TRAVEL;
        const e = t * t; // accelerate as it falls
        const x = p.startX + (p.cx - p.startX) * e;
        const y = p.startY + (p.cy - p.startY) * e;
        // Fiery tail pointing back along the travel direction.
        p.body.lineStyle(TILE * 0.55, 0xff7a1a, 0.5);
        p.body.moveTo(x + (p.startX - p.cx) * 0.14, y + (p.startY - p.cy) * 0.14);
        p.body.lineTo(x, y);
        p.body.lineStyle(0);
        p.body.beginFill(0xff3b00, 0.9);
        p.body.drawCircle(x, y, TILE * 0.44);
        p.body.endFill();
        p.body.beginFill(0xffd8a0, 1);
        p.body.drawCircle(x, y, TILE * 0.24);
        p.body.endFill();
      } else {
        const it = (elapsed - TRAVEL) / IMPACT;
        const ringAlpha = Math.max(0, 1 - it);
        p.impact.lineStyle(TILE * 0.26, 0xffb066, ringAlpha);
        p.impact.drawCircle(0, 0, TILE * (0.4 + it * 2.7));
        const flash = it < 0.2 ? 1 : Math.max(0, 1 - (it - 0.2) / 0.5);
        p.impact.beginFill(0xffd8a0, flash * 0.8);
        p.impact.drawCircle(0, 0, TILE * 1.2);
        p.impact.endFill();
      }
    }
  };

  return { update, lifetime: TRAVEL + IMPACT };
};

/** Von-Bolt's Ex Machina: a jagged electric bolt crackles down onto each epicenter, then a burst. */
const buildLightning = (
  container: Container,
  epicenters: readonly BoardPosition[],
): SignaturePart => {
  const STRIKE = 16;
  const IMPACT = 34;
  const parts = epicenters.map((position) => {
    const { cx, cy } = unitCentre(position);
    const bolt = new Graphics();
    bolt.blendMode = BLEND_MODES.ADD;
    const impact = new Graphics();
    impact.blendMode = BLEND_MODES.ADD;
    impact.x = cx;
    impact.y = cy;
    container.addChild(bolt, impact);

    return { cx, cy, topY: cy - SKY, bolt, impact };
  });

  // Redraw a segmented bolt with fresh horizontal jitter each frame so it crackles (FE render-only
  // randomness — unlike the engine, presentation may use Math.random, as the weather overlay does).
  const drawBolt = (g: Graphics, x: number, topY: number, cy: number, jitter: number): void => {
    const segments = 8;
    g.moveTo(x, topY);

    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const offset = i < segments ? (Math.random() - 0.5) * jitter : 0;
      g.lineTo(x + offset, topY + (cy - topY) * t);
    }
  };

  const update = (elapsed: number): void => {
    for (const p of parts) {
      p.bolt.clear();
      p.impact.clear();

      if (elapsed <= STRIKE) {
        const flicker = Math.random() > 0.35 ? 1 : 0.3; // strobe the bolt on/dim
        p.bolt.lineStyle(TILE * 0.18, 0xb060ff, flicker);
        drawBolt(p.bolt, p.cx, p.topY, p.cy, TILE * 0.9);
        p.bolt.lineStyle(TILE * 0.07, 0xffffff, flicker);
        drawBolt(p.bolt, p.cx, p.topY, p.cy, TILE * 0.9);
        p.impact.beginFill(0xd9a8ff, flicker * 0.5);
        p.impact.drawCircle(0, 0, TILE * 0.7);
        p.impact.endFill();
      } else {
        const it = (elapsed - STRIKE) / IMPACT;
        const ringAlpha = Math.max(0, 1 - it);
        p.impact.lineStyle(TILE * 0.2, 0xb060ff, ringAlpha);
        p.impact.drawCircle(0, 0, TILE * (0.4 + it * 2.4));
        const flash = it < 0.15 ? 1 : Math.max(0, 1 - (it - 0.15) / 0.5);
        p.impact.beginFill(0xe6ccff, flash * 0.7);
        p.impact.drawCircle(0, 0, TILE * 0.9);
        p.impact.endFill();
      }
    }
  };

  return { update, lifetime: STRIKE + IMPACT };
};

/** Rachel's Covering Fire: missiles rain down (staggered) onto each epicenter, each with a burst. */
const buildMissiles = (
  container: Container,
  epicenters: readonly BoardPosition[],
): SignaturePart => {
  const TRAVEL = 24;
  const IMPACT = 26;
  const STAGGER = 5;
  const parts = epicenters.map((position, index) => {
    const { cx, cy } = unitCentre(position);
    const missile = new Graphics();
    missile.blendMode = BLEND_MODES.ADD;
    const impact = new Graphics();
    impact.blendMode = BLEND_MODES.ADD;
    impact.x = cx;
    impact.y = cy;
    container.addChild(missile, impact);

    return {
      cx,
      cy,
      startX: cx - TILE * 3,
      startY: cy - SKY,
      delay: index * STAGGER,
      missile,
      impact,
    };
  });

  const update = (elapsed: number): void => {
    for (const p of parts) {
      p.missile.clear();
      p.impact.clear();
      const local = elapsed - p.delay;

      if (local <= 0) {
        continue;
      }

      if (local <= TRAVEL) {
        const t = local / TRAVEL;
        const e = t * t;
        const x = p.startX + (p.cx - p.startX) * e;
        const y = p.startY + (p.cy - p.startY) * e;
        p.missile.lineStyle(TILE * 0.28, 0xffb020, 0.6);
        p.missile.moveTo(x + (p.startX - p.cx) * 0.16, y + (p.startY - p.cy) * 0.16);
        p.missile.lineTo(x, y);
        p.missile.lineStyle(0);
        p.missile.beginFill(0xffffff, 1);
        p.missile.drawCircle(x, y, TILE * 0.16);
        p.missile.endFill();
      } else if (local <= TRAVEL + IMPACT) {
        const it = (local - TRAVEL) / IMPACT;
        const ringAlpha = Math.max(0, 1 - it);
        p.impact.lineStyle(TILE * 0.2, 0xfff2b0, ringAlpha);
        p.impact.drawCircle(0, 0, TILE * (0.3 + it * 1.9));
        const flash = it < 0.2 ? 1 : Math.max(0, 1 - (it - 0.2) / 0.5);
        p.impact.beginFill(0xffd8a0, flash * 0.75);
        p.impact.drawCircle(0, 0, TILE * 0.7);
        p.impact.endFill();
      }
    }
  };

  return { update, lifetime: (epicenters.length - 1) * STAGGER + TRAVEL + IMPACT };
};

const SIGNATURE_BUILDERS: Record<
  "meteor" | "lightning" | "missiles",
  (container: Container, epicenters: readonly BoardPosition[]) => SignaturePart
> = {
  meteor: buildMeteor,
  lightning: buildLightning,
  missiles: buildMissiles,
};

type SweepKind = "tsunami" | "blackWave" | "blizzard";
type SweepParticle = { behind: number; y: number; vy: number; r: number; phase: number };

// Per-sweep look: a tint `fill` (drawn on a NORMAL-blend body so a dark wave can actually darken the
// board), a bright `crest`/`particle`/`flash` (drawn additively), and the vertical particle `drift`.
const SWEEP_THEME: Record<
  SweepKind,
  {
    fill: number;
    crest: number;
    particle: number;
    drift: number;
    flash: number | null;
    bodyAlpha: number;
  }
> = {
  tsunami: {
    fill: 0x1f6fe0,
    crest: 0xbfe6ff,
    particle: 0xffffff,
    drift: -0.5,
    flash: null,
    bodyAlpha: 0.55,
  },
  blackWave: {
    fill: 0x140026,
    crest: 0xc98cff,
    particle: 0x9a5fe0,
    drift: -0.2,
    flash: 0xc98cff,
    bodyAlpha: 0.7,
  },
  blizzard: {
    fill: 0xcfe8ff,
    crest: 0xffffff,
    particle: 0xffffff,
    drift: 0.9,
    flash: null,
    bodyAlpha: 0.5,
  },
};

const SWEEP_LIFETIME = 66;

/**
 * A whole-board "sweep": a tinted wave-front translates across the board with a bright crest and a
 * trail of drifting particles (foam for Drake, embers for Hawke, snow for Olaf). Hawke also gets a
 * single mid-sweep screen flash. Used for the global powers that hit every enemy at once.
 */
const buildSweep = (kind: SweepKind, extent: BoardExtent, container: Container): SignaturePart => {
  const boardW = (extent.width + 1) * TILE;
  const boardH = (extent.height + 1) * TILE;
  const band = boardW * 0.42;
  const theme = SWEEP_THEME[kind];

  const body = new Graphics(); // NORMAL blend so a dark wave darkens; a light one tints
  const glow = new Graphics(); // ADD blend for the bright crest / particles / flash
  glow.blendMode = BLEND_MODES.ADD;
  container.addChild(body, glow);

  const count = Math.max(16, Math.min(48, Math.round(extent.width * 2.4)));
  const particles: SweepParticle[] = Array.from({ length: count }, () => ({
    behind: Math.random(), // 0..1 of the band, how far behind the crest it rides
    y: Math.random() * boardH,
    vy: (Math.random() * 0.6 + 0.4) * theme.drift,
    r: TILE * (0.06 + Math.random() * 0.11),
    phase: Math.random() * 6,
  }));

  const update = (elapsed: number): void => {
    const t = Math.min(1, elapsed / SWEEP_LIFETIME);
    const leadX = -band + t * (boardW + band * 1.4); // crest travels off-left → off-right
    const env = t < 0.12 ? t / 0.12 : t > 0.8 ? Math.max(0, 1 - (t - 0.8) / 0.2) : 1;

    body.clear();
    glow.clear();

    // Layered vertical slabs trailing the crest → a gradient wave body.
    const slabs = 5;

    for (let i = 0; i < slabs; i++) {
      const f = i / slabs;
      body.beginFill(theme.fill, Math.max(0, env * theme.bodyAlpha * (1 - f * 0.7)));
      body.drawRect(leadX - (f + 1) * (band / slabs), 0, band / slabs + 1, boardH);
      body.endFill();
    }

    // Bright crest line.
    glow.beginFill(theme.crest, env * 0.8);
    glow.drawRect(leadX - TILE * 0.15, 0, TILE * 0.3, boardH);
    glow.endFill();

    // Particles ride just behind the crest, twinkling and drifting per kind.
    for (const p of particles) {
      const px = leadX - p.behind * band;

      if (px < -TILE || px > boardW + TILE) {
        continue;
      }

      const py = (((p.y + elapsed * p.vy) % boardH) + boardH) % boardH;
      glow.beginFill(theme.particle, env * (0.45 + 0.4 * Math.sin(elapsed * 0.3 + p.phase)));
      glow.drawCircle(px, py, p.r);
      glow.endFill();
    }

    // Whole-board flash (Hawke): a single bright pulse peaking as the crest crosses the middle.
    if (theme.flash !== null) {
      const pulse = Math.max(0, 1 - Math.abs(t - 0.5) / 0.25);
      glow.beginFill(theme.flash, pulse * 0.3 * env);
      glow.drawRect(-TILE, -TILE, boardW + TILE * 2, boardH + TILE * 2);
      glow.endFill();
    }
  };

  return { update, lifetime: SWEEP_LIFETIME };
};

/**
 * The one-shot power launch flourish: a spherical "blink" over every unit the power touched (tinted by
 * kind), plus — for offensive positional powers — the CO's signature set-piece (meteor / lightning /
 * missiles) over its impact tiles. One container, one clock; `isDone()` once the longest part ends.
 * Returns `null` when there's nothing to show.
 */
export function renderPowerLaunchEffect(
  pulse: PowerLaunchPulse,
  boardExtent: BoardExtent,
): PowerLaunchEffect | null {
  const { affectedUnits, signature } = pulse;
  // A signature draws if it's a global sweep (needs no tiles) or a positional strike with impact
  // tiles (positional epicenters can be fog-masked down to none — then there's nothing to draw).
  const hasSignature =
    signature !== null && (SWEEP_KINDS.has(signature.kind) || signature.epicenters.length > 0);

  if (affectedUnits.length === 0 && !hasSignature) {
    return null;
  }

  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  container.zIndex = 2100; // above the aura and start-of-turn flourish, below menus

  const updaters: ((elapsed: number) => void)[] = [];
  let lifetime = 0;

  if (affectedUnits.length > 0) {
    const spheres = affectedUnits.map((affected) => {
      const { cx, cy } = unitCentre(affected.position);
      const sphere = makeSphere(BLINK_COLOR[affected.kind]);
      sphere.x = cx;
      sphere.y = cy;
      sphere.alpha = 0;
      container.addChild(sphere);

      return sphere;
    });

    updaters.push((elapsed) => {
      const t = Math.min(1, elapsed / BLINK_LIFETIME);
      // Blink: scale up fast with a slight overshoot (back-ease), alpha rises over the first third
      // then fades — a quick "pop" that materialises the orb over the unit and vanishes.
      const scale = 0.25 + (1 - Math.pow(1 - t, 3)) * 1.15 + Math.sin(t * Math.PI) * 0.12;
      const alpha = t < 0.3 ? t / 0.3 : Math.max(0, 1 - (t - 0.3) / 0.7);

      for (const sphere of spheres) {
        sphere.scale.set(scale);
        sphere.alpha = alpha;
      }
    });
    lifetime = Math.max(lifetime, BLINK_LIFETIME);
  }

  if (signature !== null) {
    // Global sweeps span the whole board; positional strikes draw over their (fog-masked) impact tiles.
    let part: SignaturePart | null = null;

    if (SWEEP_KINDS.has(signature.kind)) {
      part = buildSweep(signature.kind as SweepKind, boardExtent, container);
    } else if (signature.epicenters.length > 0) {
      part = SIGNATURE_BUILDERS[signature.kind as "meteor" | "lightning" | "missiles"](
        container,
        signature.epicenters,
      );
    }

    if (part !== null) {
      updaters.push(part.update);
      lifetime = Math.max(lifetime, part.lifetime);
    }
  }

  let elapsed = 0;

  const animate = (delta: number): void => {
    elapsed += delta;

    for (const update of updaters) {
      update(elapsed);
    }
  };

  return { container, animate, isDone: () => elapsed >= lifetime };
}
