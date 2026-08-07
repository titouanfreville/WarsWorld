import type { Position } from "server/core/schemas/position";
import type { PropertyTile, Tile, TileType } from "server/core/schemas/tile";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import { CAPTURING_MOVEMENT, type TerrainAccess } from "./terrain-access";

/**
 * Grid reading for the fairness checker: who owns what, what reaches what.
 *
 * Deliberately free of any verdict — everything here answers a factual question about the grid, and
 * `evaluate.ts` decides what the answers mean. Keeping the two apart is what makes each check a
 * couple of readable lines instead of a flood algorithm with an opinion baked into it.
 */

export const PROPERTY_TYPES = [
  "hq",
  "city",
  "base",
  "airport",
  "port",
  "lab",
  "commtower",
] satisfies TileType[];

export type PropertyType = (typeof PROPERTY_TYPES)[number];

const propertySet = new Set<string>(PROPERTY_TYPES);

export const isProperty = (tile: Tile): tile is PropertyTile => propertySet.has(tile.type);

/** Properties that build units. A city funds you; it does not field anything. */
const PRODUCERS = new Set<string>(["base", "airport", "port"]);

export type Grid = Tile[][];

export const gridWidth = (tiles: Grid) => tiles[0]?.length ?? 0;
export const gridHeight = (tiles: Grid) => tiles.length;

export const inBounds = (tiles: Grid, [x, y]: Position) =>
  y >= 0 && y < gridHeight(tiles) && x >= 0 && x < gridWidth(tiles);

export const tileAt = (tiles: Grid, [x, y]: Position): Tile => tiles[y][x];

const positionKey = ([x, y]: Position) => `${x},${y}`;

/** Every position whose tile satisfies `predicate`, in row-major order. */
export const positionsWhere = (tiles: Grid, predicate: (tile: Tile) => boolean): Position[] => {
  const found: Position[] = [];

  for (let y = 0; y < gridHeight(tiles); y++) {
    for (let x = 0; x < gridWidth(tiles); x++) {
      if (predicate(tiles[y][x])) {
        found.push([x, y]);
      }
    }
  }

  return found;
};

const NEIGHBOUR_OFFSETS: Position[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export const neighbours = (tiles: Grid, [x, y]: Position): Position[] =>
  NEIGHBOUR_OFFSETS.map(([dx, dy]): Position => [x + dx, y + dy]).filter((p) => inBounds(tiles, p));

/**
 * Seats that are actually in play: a slot holding a producer, an HQ, or a predeployed unit. A slot
 * that owns nothing but a city is not a player — it cannot field anything and cannot be eliminated.
 */
export const occupiedSeats = (tiles: Grid, units: { playerSlot: PlayerSlot }[]): PlayerSlot[] => {
  const seats = new Set<PlayerSlot>();

  for (const tile of tiles.flat()) {
    if (
      isProperty(tile) &&
      tile.playerSlot >= 0 &&
      (PRODUCERS.has(tile.type) || tile.type === "hq")
    ) {
      seats.add(tile.playerSlot);
    }
  }

  for (const unit of units) {
    if (unit.playerSlot >= 0) {
      seats.add(unit.playerSlot);
    }
  }

  return [...seats].sort((a, b) => a - b);
};

/** Every property owned by `seat`, counted by kind. */
export const censusOf = (tiles: Grid, seat: PlayerSlot): Record<PropertyType, number> => {
  const census = Object.fromEntries(PROPERTY_TYPES.map((type) => [type, 0])) as Record<
    PropertyType,
    number
  >;

  for (const tile of tiles.flat()) {
    if (isProperty(tile) && tile.playerSlot === seat) {
      census[tile.type as PropertyType] += 1;
    }
  }

  return census;
};

export type Distances = Map<string, number>;

export const distanceTo = (distances: Distances, position: Position): number | undefined =>
  distances.get(positionKey(position));

export const isReachable = (distances: Distances, position: Position) =>
  distances.has(positionKey(position));

/** Breadth-first step count from `origin` over every tile `passable` accepts. */
export const flood = (
  tiles: Grid,
  origin: Position,
  passable: (tile: Tile) => boolean,
): Distances => {
  const distances: Distances = new Map([[positionKey(origin), 0]]);

  // Walked with for-of over a queue that grows as we go — the array iterator re-reads length each
  // step, so pushes land in the same pass. Deliberately not `shift()`, which is O(n) on a large
  // array and would make a 40x40 flood quadratic on the path the live builder hits on every edit.
  const queue = [{ position: origin, steps: 0 }];

  for (const { position, steps } of queue) {
    for (const next of neighbours(tiles, position)) {
      if (distances.has(positionKey(next)) || !passable(tileAt(tiles, next))) {
        continue;
      }

      distances.set(positionKey(next), steps + 1);
      queue.push({ position: next, steps: steps + 1 });
    }
  }

  return distances;
};

/** A transport exists if anyone can build one: without a port or airport, water is a wall. */
export const hasTransport = (tiles: Grid) =>
  tiles.flat().some((tile) => tile.type === "port" || tile.type === "airport");

/**
 * Where a capture unit can END UP. This is the set that decides whether an HQ is takeable, and it
 * is strictly smaller than what it can route through.
 */
export const canCaptureStandOn = (access: TerrainAccess, tile: Tile) =>
  CAPTURING_MOVEMENT.some((movement) => access.canStand(movement, tile.type));

/**
 * What a capture unit can ROUTE THROUGH on its way somewhere, which is looser than where it can
 * stand:
 *
 * - a **pipe seam** is a wall you blow open, so it delays a capture rather than preventing one;
 * - **water** is a wall you ride across, but only when the map affords a transport at all;
 * - a **solid pipe** stays solid — nothing in the game opens one.
 */
export const canCaptureRouteThrough = (
  access: TerrainAccess,
  tile: Tile,
  options: { transport: boolean },
) => {
  if (tile.type === "pipeSeam") {
    return true;
  }

  if (tile.type === "sea" || tile.type === "reef") {
    return options.transport;
  }

  return canCaptureStandOn(access, tile);
};

/** Adjacent tiles a capture unit could stand on — an HQ's ways in. */
export const approachesTo = (tiles: Grid, access: TerrainAccess, hq: Position): Position[] =>
  neighbours(tiles, hq).filter((p) => canCaptureStandOn(access, tileAt(tiles, p)));
