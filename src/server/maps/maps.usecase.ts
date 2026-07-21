import type { PrismaClient } from "@prisma/client";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Tile, TileType } from "server/core/schemas/tile";
import { isNotNeutralProperty, isUnitProducingProperty } from "server/core/schemas/tile";
import type { CreatableMap, MapFilter } from "./schemas";

/** Tile types surfaced in the map list's property breakdown. */
const propertyTileTypes = [
  "city",
  "base",
  "airport",
  "commtower",
  "lab",
  "port",
] satisfies TileType[];

type PropertyStatsType = Record<(typeof propertyTileTypes)[number], number>;

/** Number of distinct player slots that own a producing property or a predeployed unit. */
export const getPlayerAmountOfMap = (map: CreatableMap) => {
  const seenPlayerSlots: PlayerSlot[] = [];

  const addToPlayerSlotsIfNotAddedAlready = (item: { playerSlot: PlayerSlot }) => {
    if (!seenPlayerSlots.includes(item.playerSlot)) {
      seenPlayerSlots.push(item.playerSlot);
    }
  };

  map.tiles
    .flat()
    .filter(isUnitProducingProperty)
    .filter(isNotNeutralProperty)
    .forEach(addToPlayerSlotsIfNotAddedAlready);

  map.predeployedUnits.forEach(addToPlayerSlotsIfNotAddedAlready);

  return seenPlayerSlots.length;
};

/**
 * The `maps` feature: management (create/list) of the `WWMap` entity. It depends on the engine's
 * tile/unit vocabulary but owns the map entity and its CRUD. Prisma access is trivial here, so it
 * stays inline rather than behind a `dbo`.
 */
export class MapsUsecase {
  constructor(private readonly db: PrismaClient) {}

  /**
   * The map library, narrowed by `filter`. Feeds both the old list view and the map browser.
   *
   * Narrowing happens in the query rather than after it: `rankedModes`/`supportedModes` are the
   * same columns the lobby and matchmaking guards read, so a browser that filtered client-side
   * could show a map as ranked-legal that the queue would never actually roll.
   */
  async listMaps(filter: MapFilter = {}) {
    const allMaps = await this.db.wWMap.findMany({
      where: {
        ...(filter.search === undefined || filter.search === ""
          ? {}
          : { name: { contains: filter.search, mode: "insensitive" } }),
        ...(filter.players === undefined ? {} : { numberOfPlayers: filter.players }),
        ...(filter.mode === undefined
          ? {}
          : filter.rankedOnly === true
            ? { rankedModes: { has: filter.mode } }
            : { supportedModes: { has: filter.mode } }),
        // Ranked-only with no mode chosen: any map ranked-legal somewhere.
        ...(filter.mode === undefined && filter.rankedOnly === true
          ? { NOT: { rankedModes: { isEmpty: true } } }
          : {}),
      },
      orderBy: { name: "asc" },
    });

    return allMaps.map((map) => {
      const tiles = map.tiles as Tile[][];
      const tilesFlat = tiles.flat();

      return {
        id: map.id,
        name: map.name,
        author: "not implemented",
        numberOfPlayers: map.numberOfPlayers,
        // TODO which armies exactly?
        size: {
          width: tiles[0].length,
          height: tiles.length,
        },
        // Terrain type per cell — the FE colours it into a thumbnail. Sending the type only (not
        // the tile objects) keeps the payload small and keeps ownership/HP off the wire, which a
        // browser has no use for.
        terrain: tiles.map((row) => row.map((tile) => tile.type as string)),
        supportedModes: map.supportedModes,
        rankedModes: map.rankedModes,
        propertyStats: propertyTileTypes.reduce<PropertyStatsType>(
          (prev, cur) => ({
            ...prev,
            [cur]: tilesFlat.filter((tile) => tile.type === cur).length,
          }),
          {} as PropertyStatsType,
        ),
        created: map.createdAt,
      };
    });
  }

  async createMap(input: CreatableMap) {
    const numberOfPlayers = getPlayerAmountOfMap(input);

    if (numberOfPlayers < 2) {
      throw new Error("Map must be playable by at least 2 players");
    }

    const tiles = input.tiles;

    if (!tiles.every((row) => row.length === tiles[0].length)) {
      throw new Error("All rows of the map must have the same length");
    }

    return this.db.wWMap.create({
      data: {
        ...input,
        numberOfPlayers,
      },
    });
  }
}
