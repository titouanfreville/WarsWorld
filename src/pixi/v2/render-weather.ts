import type { MatchView } from "frontend/components/match/match-view";
import { BLEND_MODES, Container, Graphics } from "pixi.js";

/**
 * A full-board weather overlay for the v2 snapshot board. Two things per weather, matching how the
 * Advance Wars games (and the usual 2D-weather references) sell it, so the weather reads on the board
 * and not only in the HUD chip:
 *
 * 1. A full-board colour grade via a blended veil that sits above map + units:
 *    - rain  → dark blue, MULTIPLY  → dims the light and cools it (overcast).
 *    - snow  → cool white, SCREEN   → whitens the whole map, "snow on everything".
 *    - sand  → warm tan, MULTIPLY + a NORMAL haze → dims, warms, and cuts visibility.
 * 2. An animated particle layer (rain streaks, falling snow, blowing sand).
 *
 * Pure presentation — the BE owns the actual weather (`view.currentWeather`). Coordinates are in
 * `baseTileSize` units (the stage applies `renderMultiplier`), matching every other board layer, so it
 * scales with the board. Each particle is a `Graphics` drawn once and only repositioned each frame
 * (cheap); `animate` is driven by the pixi ticker in `board-scene`.
 *
 * `clear` returns `null` (no overlay). The container is non-interactive so it never eats tile clicks.
 */
export type WeatherOverlay = { container: Container; animate: (delta: number) => void };

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const makeContainer = (): Container => {
  const container = new Container();
  container.eventMode = "none";
  container.interactiveChildren = false;
  return container;
};

const addVeil = (
  container: Container,
  width: number,
  height: number,
  color: number,
  alpha: number,
  blendMode: BLEND_MODES = BLEND_MODES.NORMAL,
) => {
  const veil = new Graphics();
  veil.beginFill(color, alpha).drawRect(0, 0, width, height).endFill();
  veil.blendMode = blendMode;
  container.addChild(veil);
};

export function renderWeatherOverlay(
  weather: MatchView["currentWeather"],
  width: number,
  height: number,
): WeatherOverlay | null {
  switch (weather) {
    case "rain":
      return rain(width, height);
    case "snow":
      return snow(width, height);
    case "sandstorm":
      return sandstorm(width, height);
    default:
      return null; // clear — nothing to draw
  }
}

/** Slanted blue streaks falling fast, over a dimming cool-blue grade (overcast rain). */
function rain(width: number, height: number): WeatherOverlay {
  const container = makeContainer();
  addVeil(container, width, height, 0x2a3550, 0.55, BLEND_MODES.MULTIPLY);

  const count = clamp(Math.round((width * height) / 260), 60, 400);
  const length = 5;
  const slant = -1.5;
  const drops: { g: Graphics; vy: number }[] = [];

  for (let i = 0; i < count; i++) {
    const g = new Graphics();
    g.lineStyle(0.5, 0x9fd4ff, 0.55);
    g.moveTo(0, 0);
    g.lineTo(slant, length);
    g.x = Math.random() * width;
    g.y = Math.random() * height;
    container.addChild(g);
    drops.push({ g, vy: 4 + Math.random() * 3 });
  }

  const animate = (delta: number) => {
    for (const drop of drops) {
      drop.g.y += drop.vy * delta;
      drop.g.x += slant * 0.5 * delta;

      if (drop.g.y > height) {
        drop.g.y = -length;
        drop.g.x = Math.random() * width;
      }
    }
  };

  return { container, animate };
}

/** Small white flakes drifting down with a horizontal sway. The board itself already reads as snowy
 *  because the tiles swap to their "-snow" art (see render-from-view), so no colour grade here. */
function snow(width: number, height: number): WeatherOverlay {
  const container = makeContainer();

  const count = clamp(Math.round((width * height) / 380), 40, 280);
  const flakes: { g: Graphics; vy: number; phase: number; sway: number }[] = [];

  for (let i = 0; i < count; i++) {
    const g = new Graphics();
    g.beginFill(0xffffff, 0.85)
      .drawCircle(0, 0, 0.5 + Math.random() * 0.9)
      .endFill();
    g.x = Math.random() * width;
    g.y = Math.random() * height;
    container.addChild(g);
    flakes.push({
      g,
      vy: 0.5 + Math.random() * 0.7,
      phase: Math.random() * Math.PI * 2,
      sway: 0.2 + Math.random() * 0.4,
    });
  }

  const animate = (delta: number) => {
    for (const flake of flakes) {
      flake.g.y += flake.vy * delta;
      flake.phase += delta * 0.04;
      flake.g.x += Math.sin(flake.phase) * flake.sway * delta;

      if (flake.g.y > height) {
        flake.g.y = -2;
        flake.g.x = Math.random() * width;
      }
    }
  };

  return { container, animate };
}

/** Fast horizontal sand streaks over a warm, dimming haze (blowing dust cuts visibility). */
function sandstorm(width: number, height: number): WeatherOverlay {
  const container = makeContainer();
  // MULTIPLY warms + dims the light; the NORMAL tan layer is the dust haze over the top.
  addVeil(container, width, height, 0xd9b25a, 0.3, BLEND_MODES.MULTIPLY);
  addVeil(container, width, height, 0xd9a441, 0.2);

  const count = clamp(Math.round((width * height) / 300), 50, 320);
  const streaks: { g: Graphics; vx: number; len: number }[] = [];

  for (let i = 0; i < count; i++) {
    const len = 4 + Math.random() * 8;
    const g = new Graphics();
    g.lineStyle(0.7, 0xe8c07a, 0.5);
    g.moveTo(0, 0);
    g.lineTo(len, 0);
    g.x = Math.random() * width;
    g.y = Math.random() * height;
    container.addChild(g);
    streaks.push({ g, vx: 6 + Math.random() * 5, len });
  }

  const animate = (delta: number) => {
    for (const streak of streaks) {
      streak.g.x += streak.vx * delta;

      if (streak.g.x > width) {
        streak.g.x = -streak.len;
        streak.g.y = Math.random() * height;
      }
    }
  };

  return { container, animate };
}
