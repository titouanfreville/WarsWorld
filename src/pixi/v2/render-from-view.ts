import { baseTileSize, mapBorder } from "frontend/components/match/render-constants";
import type { SpriteAnimationKeys } from "frontend/components/match/getSpritesheetData";
import type {
  BoardPosition,
  MatchChangeableTile,
  MatchTile,
  MatchUnit,
  MatchView,
} from "frontend/components/match/match-view";
import {
  getArmyForSlot,
  getTileAt,
  samePosition,
  visualHP,
} from "frontend/components/match/match-view";
import { FRAME_ALIAS, pipeSeamFrameName } from "frontend/components/match/hud/terrain-sprite";
import type { FederatedPointerEvent, Resource } from "pixi.js";
import { AnimatedSprite, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { LoadedSpriteSheet } from "../load-spritesheet";

/**
 * Snapshot-driven (v2) board rendering — draws map, units, and an interactive tile grid straight
 * from the plain `MatchView` the backend sends. No engine, no `MatchWrapper`: the client renders
 * BE state, it does not compute it. This is the render half of the Phase-C cut.
 */

type AnimationsProperty = Record<SpriteAnimationKeys, Texture<Resource>[]>;

// Multiplicative tint applied to a fogged tile's sprite (~48% brightness) — the fog-of-war dim.
const FOG_TINT = "#7a7a7a";

// Only snow and rain have per-tile art (suffix "-snow"/"-rain" on the base frame/animation name);
// every other weather — and any tile lacking a variant (sea, roads, rivers…) — keeps its base sprite.
const weatherTileVariant = (weather: MatchView["currentWeather"]): "snow" | "rain" | null =>
  weather === "snow" || weather === "rain" ? weather : null;

const tileSprite = (
  match: MatchView,
  tile: MatchTile | MatchChangeableTile,
  spriteSheets: LoadedSpriteSheet,
  position: BoardPosition,
): Sprite => {
  const variant = weatherTileVariant(match.currentWeather);

  if (!("playerSlot" in tile)) {
    // The atlas spells a few tiles differently from the engine (`pipeSeam` → `pipeseam-*.png`);
    // without the alias the key misses and the tile draws as an empty sprite.
    let spriteName: string = FRAME_ALIAS[tile.type] ?? tile.type;

    if ("fired" in tile && tile.fired) {
      spriteName = "usedSilo";
    }

    if ("variant" in tile) {
      spriteName += `-${tile.variant}`;
    } else if (tile.type === "pipeSeam" && "hp" in tile) {
      const mapTile = match.map.tiles[position[1]][position[0]];

      spriteName = pipeSeamFrameName(tile.hp, "variant" in mapTile ? mapTile.variant : null);
    }

    const { textures } = spriteSheets.neutral;
    const weatherKey = `${spriteName}-${variant}.png`;
    const key = variant !== null && weatherKey in textures ? weatherKey : `${spriteName}.png`;

    return new Sprite(textures[key]);
  }

  if (tile.playerSlot === -1) {
    const { textures } = spriteSheets.neutral;
    const weatherKey = `${tile.type}-${variant}-0.png`;
    const key = variant !== null && weatherKey in textures ? weatherKey : `${tile.type}-0.png`;

    return new Sprite(textures[key]);
  }

  const army = getArmyForSlot(match, tile.playerSlot);

  if (army === undefined) {
    throw new Error("Could not find player while rendering tile with playerSlot");
  }

  // pixi's spritesheet type doesn't index the generic properly, hence the cast.
  const animations = spriteSheets[army].animations as AnimationsProperty;
  const weatherKey = `${tile.type}-${variant}` as keyof AnimationsProperty;
  const frames =
    variant !== null && weatherKey in animations ? animations[weatherKey] : animations[tile.type];
  const sprite = new AnimatedSprite(frames);
  sprite.animationSpeed = 0.04;
  sprite.play();

  return sprite;
};

export const renderMapFromView = (match: MatchView, spriteSheets: LoadedSpriteSheet): Container => {
  const mapContainer = new Container();
  mapContainer.x = mapBorder;
  mapContainer.y = mapBorder;

  // Fog dims each tile by TINTING its own sprite dark, rather than overlaying a dark square. A tile's
  // sprite can be taller than one tile (properties, mountains, forests overhang upward), and its
  // darkening must follow ITS OWN tile's visibility uniformly — an overlay on the neighbouring tile
  // would either dim a visible property's top or leave a fogged property's top lit. Vision is
  // BE-authoritative (from match.full).
  const fogVisible =
    match.fogOfWar === true ? new Set(match.visibleTiles.map(([x, y]) => `${x},${y}`)) : null;

  for (let y = 0; y < match.map.tiles.length; y++) {
    for (let x = 0; x < match.map.tiles[y].length; x++) {
      const tile = getTileAt(match, [x, y]);
      const sprite = tileSprite(match, tile, spriteSheets, [x, y]);

      sprite.anchor.set(0, 1); // render from the bottom, not the top
      sprite.x = x * baseTileSize;
      sprite.y = (y + 1) * baseTileSize;
      sprite.zIndex = y;
      // Named so an effect can address one tile after a rebuild — the capture flourish shrinks the
      // property sprite (scale.y off its anchored base, so it sinks) while it's being captured.
      sprite.name = `tile-${x}-${y}`;

      const fogged = fogVisible !== null && !fogVisible.has(`${x},${y}`);

      if (fogged) {
        sprite.tint = FOG_TINT; // multiplicative dim of the whole tile sprite (base + tall top)
      }

      mapContainer.addChild(sprite);

      // A damaged pipe seam carries its health right on the tile, in the same digit sprites and the
      // same corner a unit uses — a seam is shot like a unit, so it reads like one. Full health shows
      // nothing (as with units, no badge means untouched), and a seam you have no vision of shows
      // nothing either: its condition is intel you haven't scouted.
      // hp < 1 is a BROKEN seam — plain ground now, with no health left to report.
      if (tile.type === "pipeSeam" && "hp" in tile && tile.hp >= 1 && !fogged) {
        const seamHp = Math.ceil(tile.hp / 10);

        if (seamHp < 10) {
          mapContainer.addChild(
            createIcon(
              spriteSheets,
              x * baseTileSize + 8,
              y * baseTileSize + 8,
              `health-${seamHp}.png`,
            ),
          );
        }
      }
    }
  }

  mapContainer.sortableChildren = true;

  return mapContainer;
};

// Frames per texture swap for the supply badge: ~0.8s each at 60fps — a readable pulse, not a flicker.
const SUPPLY_BLINK_SPEED = 0.02;

/**
 * The low-supply badge, drawn in the unit's free TOP-RIGHT corner (capture owns bottom-left, the HP
 * digit bottom-right, cargo top-left). `supply` is the engine's verdict — the client neither knows
 * the maximums nor compares against them (see maskUnitForViewer / engine rules/supply.ts) — and is
 * null whenever the consumables behind it are masked from this viewer, so a fogged enemy shows nothing.
 *
 * Always animates, so the warning draws the eye whether the unit is short on one thing or both:
 * - low on ONE — the icon blinks against a transparent frame (icon ↔ blank);
 * - low on BOTH — the two icons alternate in the one corner, since two 8px icons don't read on a
 *   16px tile side by side.
 * It's an AnimatedSprite so pixi drives the cycle on its own shared ticker and disposes of it with
 * the container — unit containers are rebuilt on every render, so a hand-rolled ticker handler here
 * would leak one per render.
 *
 * Returns null when the unit is fine, or when the icons are missing from the spritesheet.
 */
const createSupplyIcon = (
  spriteSheet: LoadedSpriteSheet,
  x: number,
  y: number,
  supply: NonNullable<MatchUnit["supply"]>,
): AnimatedSprite | null => {
  const names: string[] = [];

  if (supply.lowFuel) {
    names.push("lowfuel.png");
  }

  if (supply.lowAmmo) {
    names.push("lowammo.png");
  }

  const textures = names
    .map((name) => spriteSheet.icons?.textures[name])
    .filter((texture): texture is Texture<Resource> => texture !== undefined);

  if (textures.length === 0) {
    return null;
  }

  // A lone icon gets a transparent second frame so it blinks on/off instead of sitting static; two
  // already alternate against each other. Either way there are ≥2 frames to animate.
  const frames = textures.length === 1 ? [textures[0], Texture.EMPTY] : textures;

  const icon = new AnimatedSprite(frames);
  icon.x = x;
  icon.y = y;
  icon.width = 8;
  icon.height = 8;
  icon.eventMode = "static";
  icon.zIndex = 999;
  icon.animationSpeed = SUPPLY_BLINK_SPEED;
  icon.play();

  return icon;
};

const createIcon = (
  spriteSheet: LoadedSpriteSheet,
  x: number,
  y: number,
  texture: string,
): Sprite => {
  const icon = new Sprite(spriteSheet.icons?.textures[texture]);
  icon.x = x;
  icon.y = y;
  icon.width = 8;
  icon.height = 8;
  icon.eventMode = "static";
  icon.zIndex = 999;

  return icon;
};

export const renderUnitFromView = (
  unit: MatchUnit,
  army: MatchView["players"][number]["army"],
  spriteSheets: LoadedSpriteSheet,
  // A phantom is buffered intent the BE hasn't confirmed yet — drawn translucent so it reads as
  // "pending" rather than as a settled unit. It hardens into a normal sprite once the action confirms.
  phantom = false,
): Container => {
  const [x, y] = unit.position;
  const spriteX = x * baseTileSize + 8;
  const spriteY = y * baseTileSize + 8;

  const unitContainer = new Container();
  unitContainer.name = `unit-${x}-${y}`;

  const unitSprite = new AnimatedSprite(spriteSheets[army].animations[unit.type]);
  unitSprite.x = spriteX;
  unitSprite.y = spriteY;
  unitSprite.animationSpeed = 0.07;

  if (!unit.isReady) {
    unitSprite.tint = "#bbbbbb";
  }

  if (phantom) {
    unitContainer.alpha = 0.6;
  }

  // A dived sub / hidden stealth shows translucent so the owner can tell it's submerged.
  if ("hidden" in unit && unit.hidden) {
    unitSprite.alpha = 0.5;
  }

  unitSprite.play();
  unitContainer.addChild(unitSprite);

  if ("currentCapturePoints" in unit && unit.currentCapturePoints !== undefined) {
    unitContainer.addChild(createIcon(spriteSheets, spriteX, spriteY + 8, "capturing.png"));
  }

  const hp = visualHP(unit);

  if (hp === undefined) {
    // HP is masked (an enemy Sonja unit hides its HP) — show the "?" badge where the health digit
    // would sit, so it reads as "unknown" rather than the absence of a badge (which means full HP).
    // Same pixel-art sprite family as health-1..9 (see icons.json), rendered identically to a digit.
    unitContainer.addChild(
      createIcon(spriteSheets, spriteX + 8, spriteY + 8, "health-question.png"),
    );
  } else if (hp !== 10) {
    unitContainer.addChild(createIcon(spriteSheets, spriteX + 8, spriteY + 8, `health-${hp}.png`));
  }

  // Low fuel/ammo warning, top-right. Null for a unit whose consumables this viewer can't read, and
  // `undefined` for a render-only phantom the optimistic view casts into being (see ghostBuiltUnit) —
  // that one is outside the type system's reach, so treat any absence as "nothing to warn about"
  // rather than trusting the declared shape and taking the whole board down with a TypeError.
  if (unit.supply !== null && unit.supply !== undefined) {
    const supplyIcon = createSupplyIcon(spriteSheets, spriteX + 8, spriteY, unit.supply);

    if (supplyIcon !== null) {
      unitContainer.addChild(supplyIcon);
    }
  }

  // Cargo indicator: a transport shows a mini sprite of each unit it carries in its top-left corner,
  // so it's clear it's loaded and WHICH units are inside (they belong to the same owner/army).
  const cargoTypes: MatchUnit["type"][] = [];

  if ("loadedUnit" in unit && unit.loadedUnit) {
    cargoTypes.push(unit.loadedUnit.type);
  }

  if ("loadedUnit2" in unit && unit.loadedUnit2) {
    cargoTypes.push(unit.loadedUnit2.type);
  }

  if (cargoTypes.length > 0) {
    const cargoSize = baseTileSize / 2;
    const backing = new Sprite(Texture.WHITE);
    backing.tint = "#000000";
    backing.alpha = 0.5;
    backing.x = spriteX;
    backing.y = spriteY;
    backing.width = cargoSize * cargoTypes.length;
    backing.height = cargoSize;
    unitContainer.addChild(backing);

    cargoTypes.forEach((cargoType, index) => {
      const mini = new Sprite(spriteSheets[army].animations[cargoType][0]);
      mini.width = cargoSize;
      mini.height = cargoSize;
      mini.x = spriteX + index * cargoSize;
      mini.y = spriteY;
      unitContainer.addChild(mini);
    });
  }

  return unitContainer;
};

export const renderUnitsFromView = (
  match: MatchView,
  spriteSheets: LoadedSpriteSheet,
  // Tiles whose unit is buffered (unconfirmed) intent — drawn as phantoms. Empty = nothing pending.
  phantomPositions: readonly BoardPosition[] = [],
): Container => {
  const unitContainer = new Container();
  const isPhantom = (position: BoardPosition) =>
    phantomPositions.some((phantom) => samePosition(phantom, position));

  for (const unit of match.units) {
    const army = getArmyForSlot(match, unit.playerSlot);

    if (army !== undefined) {
      unitContainer.addChild(
        renderUnitFromView(unit, army, spriteSheets, isPhantom(unit.position)),
      );
    }
  }

  return unitContainer;
};

/**
 * A translucent overlay marking a set of tiles (e.g. a unit's reachable tiles). Positioned exactly
 * like the map tiles so it lines up; caller adds it to the map container so units still render on top.
 */
/** Alpha of the wash laid over each highlighted tile — low enough to read the terrain underneath. */
const HIGHLIGHT_FILL_ALPHA = 0.25;
/** Alpha of the outline traced around the region's rim. Bright: it's what gives the raised read. */
const HIGHLIGHT_EDGE_ALPHA = 0.85;
const HIGHLIGHT_EDGE_WIDTH = 1;

/**
 * Paint a set of tiles as a single raised plate: a translucent wash over every tile, plus a bright
 * outline traced around the region's RIM only (an edge is drawn where the neighbouring tile isn't in
 * the set). Outlining the rim rather than each tile is what reads as one contiguous area lifted off
 * the board, instead of a grid of separate squares.
 *
 * Movement and attack ranges differ only by `color` — same geometry, same treatment — and the board
 * draws the selected unit's movement through this very function, so selection and right-click
 * inspection share one visual language by construction.
 */
export const renderHighlightTiles = (
  positions: readonly BoardPosition[],
  color: string,
): Container => {
  const container = new Container();
  container.zIndex = 1000; // above the map tiles (which use zIndex = y), below the units container
  container.name = "v2-highlights";

  if (positions.length === 0) {
    return container;
  }

  const inRegion = new Set(positions.map(([x, y]) => `${x},${y}`));
  const graphics = new Graphics();

  graphics.beginFill(color, HIGHLIGHT_FILL_ALPHA);

  for (const [x, y] of positions) {
    graphics.drawRect(x * baseTileSize, y * baseTileSize, baseTileSize, baseTileSize);
  }

  graphics.endFill();

  // `alignment: 0` keeps the stroke inside the tile, so the rim can't bleed onto the neighbour.
  graphics.lineStyle({
    width: HIGHLIGHT_EDGE_WIDTH,
    color,
    alpha: HIGHLIGHT_EDGE_ALPHA,
    alignment: 0,
  });

  for (const [x, y] of positions) {
    const left = x * baseTileSize;
    const top = y * baseTileSize;
    const right = left + baseTileSize;
    const bottom = top + baseTileSize;

    if (!inRegion.has(`${x},${y - 1}`)) {
      graphics.moveTo(left, top);
      graphics.lineTo(right, top);
    }

    if (!inRegion.has(`${x},${y + 1}`)) {
      graphics.moveTo(left, bottom);
      graphics.lineTo(right, bottom);
    }

    if (!inRegion.has(`${x - 1},${y}`)) {
      graphics.moveTo(left, top);
      graphics.lineTo(left, bottom);
    }

    if (!inRegion.has(`${x + 1},${y}`)) {
      graphics.moveTo(right, top);
      graphics.lineTo(right, bottom);
    }
  }

  container.addChild(graphics);

  return container;
};

export const renderInteractiveTilesFromView = (
  match: MatchView,
  onTileClick: (pos: BoardPosition) => void,
  onTileHover: (pos: BoardPosition) => void,
  onTileRightClick?: (pos: BoardPosition) => void,
): Container => {
  const container = new Container();
  container.x = baseTileSize / 2;
  container.y = baseTileSize / 2;

  for (let y = 0; y < match.map.tiles.length; y++) {
    for (let x = 0; x < match.map.tiles[y].length; x++) {
      const sprite = new Sprite(Texture.EMPTY);
      sprite.height = baseTileSize;
      sprite.width = baseTileSize;
      sprite.anchor.set(0, 1);
      sprite.x = x * baseTileSize;
      sprite.y = (y + 1) * baseTileSize;
      sprite.interactive = true;
      // `pointertap` also fires for the right (and middle) button, so gate it to the LEFT button —
      // otherwise a right-click would run the action path (select/stage) AND the `rightclick` handler,
      // and the co-fired tap would clobber the inspect card that `rightclick` just opened.
      sprite.on("pointertap", (event: FederatedPointerEvent) => {
        if (event.button === 0) {
          onTileClick([x, y]);
        }
      });
      sprite.on("pointerenter", () => onTileHover([x, y]));
      sprite.on("rightclick", () => onTileRightClick?.([x, y]));
      container.addChild(sprite);
    }
  }

  container.sortableChildren = true;

  return container;
};
