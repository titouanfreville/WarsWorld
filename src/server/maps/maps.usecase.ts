import type { PrismaClient } from "@prisma/client";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Tile, TileType } from "server/core/schemas/tile";
import { isNotNeutralProperty, isUnitProducingProperty } from "server/core/schemas/tile";
import type {
  CreatableMap,
  DraftUnit,
  MapFilter,
  ResizeMapInput,
  StartDraftInput,
  UpdateDraftInput,
} from "./schemas";
import { MAP_MAX_SIDE, MAP_MIN_SIDE } from "./schemas";
import {
  evaluateMap,
  type EvaluatableMap,
  type FairnessCheck,
  type FairnessReport,
  type TerrainAccess,
} from "./fairness";
import type { UnitDefaults } from "./unit-defaults";
import {
  ARMY_BY_SLOT,
  connectionsFor,
  isSingleAxis,
  MIRROR_MODES,
  PROPERTY_TILE_TYPES,
  variantsFor,
  type MapVocabulary,
} from "./vocabulary";
import { RESIZE_ANCHORS, resizeMap, type ResizeRequest } from "./resize";
import { DispatchableError } from "server/engine/dispatchable-error";

/** How long a draft that was opened and never edited survives before its author's next visit prunes it. */
const UNTOUCHED_DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** The failing checks, named, so a refusal says what to go and fix. */
const failedLabels = (checks: FairnessCheck[]) =>
  checks
    .filter((check) => !check.ok)
    .map((check) => check.label.toLowerCase())
    .join("; ");

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
  constructor(
    private readonly db: PrismaClient,
    /** Injected because `maps` may not import `engine` — see fairness/terrain-access.ts. */
    private readonly terrain: TerrainAccess,
    /** Likewise: unit starting stats are engine constants. See unit-defaults.ts. */
    private readonly unitDefaults: UnitDefaults,
  ) {}

  /**
   * Is this map playable, and is it fair? Stateless on purpose: the builder calls it on every edit
   * with a candidate that has not been saved, and publish/submit call it again inside their own
   * transaction. One implementation, so the live verdict and the gate can never disagree.
   */
  evaluate(map: EvaluatableMap): FairnessReport {
    return evaluateMap(map, this.terrain);
  }

  /** The unit types a map may predeploy — the builder's palette comes from here, not from the client. */
  placeableUnitTypes(): string[] {
    return this.unitDefaults.types();
  }

  /**
   * Everything the builder needs to know about the game, in one read.
   *
   * The client used to hold the terrain list, the property list and the tile connection table.
   * That was a second copy of game knowledge sitting where it could drift, so it is served instead.
   * Static per deploy, which is why it is a plain public query the client can cache hard.
   */
  vocabulary(): MapVocabulary {
    const tiles = this.terrain.tileTypes();

    return {
      armyBySlot: ARMY_BY_SLOT,
      blankTile: { type: "plain", variant: "normal" },
      size: { min: MAP_MIN_SIDE, max: MAP_MAX_SIDE },
      properties: [...PROPERTY_TILE_TYPES],
      mirrors: MIRROR_MODES,
      resizeAnchors: [...RESIZE_ANCHORS],

      terrain: tiles.map((type) => ({
        type,
        connectsTo: connectionsFor(type),
        singleAxis: isSingleAxis(type),
        variants: variantsFor(type),
        defenseStars: this.terrain.defenseStars(type),
      })),

      units: this.unitDefaults.types().flatMap((type) => {
        const facts = this.unitDefaults.describe(type);
        const movementType = this.terrain.movementOf(type);

        if (facts === null || movementType === undefined) {
          return [];
        }

        return [
          {
            type,
            movementType,
            ...facts,
            // Resolved here so the builder can grey out an illegal square without knowing why.
            standableOn: tiles.filter((tile) => this.terrain.canStand(movementType, tile)),
          },
        ];
      }),
    };
  }

  /**
   * Authoring shape to engine shape: the author picked a type, a seat and a square; the engine's own
   * table supplies HP, fuel and ammo. An unknown type is the client's error, so it is named.
   */
  private expandUnits(units: DraftUnit[]) {
    return units.map((unit) => {
      const built = this.unitDefaults.build(unit);

      if (built === null) {
        throw new DispatchableError(`"${unit.type}" is not a unit that can be placed on a map.`);
      }

      return built;
    });
  }

  /**
   * The map library, narrowed by `filter`. Feeds both the old list view and the map browser.
   *
   * Narrowing happens in the query rather than after it: `rankedModes`/`supportedModes` are the
   * same columns the lobby and matchmaking guards read, so a browser that filtered client-side
   * could show a map as ranked-legal that the queue would never actually roll.
   */
  async listMaps(filter: MapFilter = {}) {
    const allMaps = await this.db.wWMap.findMany({
      include: { author: { select: { name: true, displayName: true } } },
      where: {
        // Drafts belong to their author alone. Without this the browser would start showing every
        // half-painted map the moment the builder shipped.
        status: "published",
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
        /**
         * `null` for the seeded and AWBW-imported pool, which nobody authored — the UI shows a
         * byline only when there is a person to credit, and links to their profile by `name`.
         */
        author: map.author ? { name: map.author.name, displayName: map.author.displayName } : null,
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

  /**
   * Open the builder: a row exists before the first tile is painted, so autosave is only ever an
   * update and a crash thirty seconds in still has somewhere to land.
   *
   * The cost is orphan rows — open the page, close the tab. Rather than a scheduled job, the one
   * code path that creates the mess cleans it up: each call first drops the caller's own drafts
   * that were never touched. Self-limiting, and it keeps the draft cap meaningful.
   */
  async startDraft(playerId: string, { width, height }: StartDraftInput) {
    await this.pruneUntouchedDrafts(playerId);

    // `variant: "normal"` is not optional — `plainTileSchema` requires one, so a blank grid built
    // without it fails validation the first time the client sends it back.
    const blankRow: Tile[] = Array.from({ length: width }, () => ({
      type: "plain",
      variant: "normal",
    }));

    return this.db.wWMap.create({
      data: {
        name: "Untitled map",
        tiles: Array.from({ length: height }, () => blankRow.map((tile) => ({ ...tile }))),
        predeployedUnits: [],
        numberOfPlayers: 0,
        supportedModes: [],
        rankedModes: [],
        status: "draft",
        authorId: playerId,
      },
      select: { id: true, name: true, updatedAt: true },
    });
  }

  /**
   * One autosave. Conditional on the `updatedAt` the client last saw, so a second tab editing the
   * same draft collides loudly rather than silently winning.
   *
   * Returns the fresh verdict: this re-evaluates anyway to store the report, so handing it back
   * costs nothing and gives the builder an authoritative reading at every save.
   */
  async updateDraft(playerId: string, input: UpdateDraftInput) {
    const { mapId, seenAt, ...map } = input;

    this.assertRectangular(map.tiles);

    // Checked on the lean shape the author edits, stored in the shape the engine reads.
    const report = this.evaluate(map);
    const units = this.expandUnits(map.predeployedUnits);
    const now = new Date();

    const { count } = await this.db.wWMap.updateMany({
      // Ownership is part of the WHERE, not a separate read: one statement that cannot be raced
      // between checking the author and performing the write.
      where: { id: mapId, authorId: playerId, updatedAt: seenAt },
      data: {
        name: map.name,
        tiles: map.tiles,
        predeployedUnits: units,
        numberOfPlayers: getPlayerAmountOfMap({ ...map, predeployedUnits: units }),
        fairnessReport: report,
        evaluatedAt: now,
        updatedAt: now,
      },
    });

    if (count === 0) {
      throw new DispatchableError(
        "This map was changed somewhere else. Reload it before saving again.",
      );
    }

    return { report, updatedAt: now };
  }

  /**
   * Publish. Re-evaluates server-side and refuses an unplayable map — the client's verdict is never
   * the thing that opens the gate, only the thing that predicts it.
   */
  async publish(playerId: string, mapId: string) {
    const map = await this.ownedMap(playerId, mapId);
    const report = this.evaluate(map);

    if (!report.isPlayable) {
      throw new DispatchableError(
        `This map cannot be played yet: ${failedLabels(report.playable)}.`,
      );
    }

    await this.db.wWMap.update({
      where: { id: mapId },
      data: {
        status: "published",
        supportedModes: report.seats.length === 2 ? ["duel"] : ["teams", "ffa"],
        fairnessReport: report,
        evaluatedAt: new Date(),
      },
    });

    return report;
  }

  /**
   * Ask for the ranked pool. Fairness is measured, not asserted, and a moderator still has the last
   * word — this only puts the map in the queue.
   */
  async submitForRanked(playerId: string, mapId: string) {
    const map = await this.ownedMap(playerId, mapId);
    const report = this.evaluate(map);

    if (!report.isFair) {
      throw new DispatchableError(
        `This map is not even-handed enough for ranked: ${failedLabels(report.fairness)}.`,
      );
    }

    await this.db.wWMap.update({
      where: { id: mapId },
      data: { rankedReview: "pending", fairnessReport: report, evaluatedAt: new Date() },
    });

    return report;
  }

  /**
   * Reshape a map. Grows with blank ground, crops what falls outside, and moves what survives.
   *
   * Server-side rather than in the builder so there is one answer to "what happens to a unit
   * standing where the map no longer reaches" — and so the reshaped grid is re-checked before it is
   * stored, since a crop can strand a unit or wall off an HQ.
   */
  async resize(playerId: string, input: ResizeMapInput) {
    const { mapId, seenAt, ...request } = input;
    const current = await this.ownedMap(playerId, mapId);

    const resized = resizeMap(
      current,
      request satisfies ResizeRequest,
      this.vocabulary().blankTile as Tile,
    );

    const report = this.evaluate(resized as EvaluatableMap);
    const now = new Date();

    const { count } = await this.db.wWMap.updateMany({
      where: { id: mapId, authorId: playerId, updatedAt: seenAt },
      data: {
        tiles: resized.tiles,
        predeployedUnits: resized.predeployedUnits,
        numberOfPlayers: getPlayerAmountOfMap({
          ...current,
          tiles: resized.tiles as CreatableMap["tiles"],
          predeployedUnits: resized.predeployedUnits,
        }),
        fairnessReport: report,
        evaluatedAt: now,
        updatedAt: now,
      },
    });

    if (count === 0) {
      throw new DispatchableError(
        "This map was changed somewhere else. Reload it before resizing.",
      );
    }

    return {
      tiles: resized.tiles,
      predeployedUnits: resized.predeployedUnits,
      droppedUnits: resized.droppedUnits,
      report,
      updatedAt: now,
    };
  }

  /** The caller's own maps, drafts included — the "My maps" view. */
  async listMine(playerId: string) {
    const mine = await this.db.wWMap.findMany({
      where: { authorId: playerId },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        rankedReview: true,
        numberOfPlayers: true,
        updatedAt: true,
        tiles: true,
      },
    });

    return mine.map(({ tiles, ...map }) => {
      const grid = tiles as Tile[][];

      return {
        ...map,
        // Size rather than the grid: enough to recognise a map in a list, without shipping every
        // tile of every map somebody has ever started.
        size: { width: grid[0]?.length ?? 0, height: grid.length },
      };
    });
  }

  /**
   * One of the caller's own maps, opened for editing.
   *
   * Units come back in the LEAN authoring shape the builder works in, not the engine shape they are
   * stored in: the client sends `{type, playerSlot, position}` and must receive the same, or a
   * round-trip through the editor would hand back fields it never asked for.
   */
  async getForEdit(playerId: string, mapId: string) {
    const map = await this.db.wWMap.findUnique({ where: { id: mapId } });

    if (map === null || map.authorId !== playerId) {
      // Same message either way, so the endpoint cannot enumerate other people's map ids.
      throw new DispatchableError("No such map.");
    }

    const tiles = map.tiles as Tile[][];
    const predeployedUnits = map.predeployedUnits.map((unit) => ({
      type: unit.type,
      playerSlot: unit.playerSlot,
      position: unit.position,
    }));

    return {
      id: map.id,
      name: map.name,
      status: map.status,
      rankedReview: map.rankedReview,
      updatedAt: map.updatedAt,
      tiles,
      predeployedUnits,
      report: this.evaluate({ tiles, predeployedUnits }),
    };
  }

  /** Loads a map the caller authored, or refuses. Every mutation below goes through this. */
  private async ownedMap(playerId: string, mapId: string): Promise<CreatableMap> {
    const map = await this.db.wWMap.findUnique({ where: { id: mapId } });

    if (map === null || map.authorId !== playerId) {
      // Deliberately the same message either way: "not yours" and "does not exist" must be
      // indistinguishable, or the endpoint enumerates other people's map ids.
      throw new DispatchableError("No such map.");
    }

    return {
      name: map.name,
      // The stored grid is `Tile[][]`; `CreatableMap` narrows that to a non-empty tuple, which a
      // row read back from the database cannot prove. Its contents were validated on the way in.
      tiles: map.tiles as CreatableMap["tiles"],
      predeployedUnits: map.predeployedUnits,
    };
  }

  /** Drafts created and never edited: `updatedAt` still equal to `createdAt`. */
  private pruneUntouchedDrafts(playerId: string) {
    const cutoff = new Date(Date.now() - UNTOUCHED_DRAFT_TTL_MS);

    return this.db.wWMap.deleteMany({
      where: { authorId: playerId, status: "draft", evaluatedAt: null, createdAt: { lt: cutoff } },
    });
  }

  private assertRectangular(tiles: Tile[][]) {
    if (!tiles.every((row) => row.length === tiles[0].length)) {
      throw new DispatchableError("All rows of the map must have the same length.");
    }
  }
}
