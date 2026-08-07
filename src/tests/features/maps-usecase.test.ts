/* eslint-disable @typescript-eslint/require-await -- in-memory fakes mirror Prisma's async API */
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Tile } from "server/core/schemas/tile";
import { tileSchema } from "server/core/schemas/tile";
import { MapsUsecase } from "server/maps/maps.usecase";
import { fakeTerrainAccess, fakeUnitDefaults } from "../helpers/map-ports";
import type { CreatableMap } from "server/maps/schemas";

/**
 * The map lifecycle: who may write, what opens each gate, and what happens when two tabs race.
 *
 * The gate assertions are the point. The builder shows a live verdict, but that verdict is only ever
 * a prediction — publish and submit re-run the checker server-side, so a client that lies about
 * being fair gets refused anyway.
 */

const plain = (): Tile => ({ type: "plain", variant: "normal" });
const owned = (type: string, playerSlot: PlayerSlot): Tile => ({ type, playerSlot }) as Tile;

/** A symmetric two-seat map that passes every check. */
const fairTiles = (): Tile[][] => {
  const tiles = Array.from({ length: 11 }, () => Array.from({ length: 11 }, plain));

  const place = (x: number, y: number, type: string) => {
    tiles[y][x] = owned(type, 0);
    tiles[10 - y][10 - x] = owned(type, 1);
  };

  place(1, 1, "hq");
  place(2, 1, "base");
  place(1, 2, "base");
  place(3, 3, "city");

  return tiles;
};

/** Same map with one unmirrored city: playable, but no longer even-handed. */
const lopsidedTiles = (): Tile[][] => {
  const tiles = fairTiles();
  tiles[7][2] = owned("city", 0);

  return tiles;
};

type Row = {
  id: string;
  authorId: string | null;
  status: string;
  rankedReview: string;
  name: string;
  tiles: Tile[][];
  predeployedUnits: unknown[];
  numberOfPlayers: number;
  createdAt: Date;
  updatedAt: Date;
  evaluatedAt: Date | null;
  supportedModes: string[];
};

const makeUsecase = (rows: Partial<Row>[] = []) => {
  const store = new Map<string, Row>();
  let nextId = 0;

  for (const row of rows) {
    const id = row.id ?? `map-${nextId++}`;
    const stamp = row.updatedAt ?? new Date("2026-01-01T00:00:00Z");

    store.set(id, {
      authorId: null,
      status: "draft",
      rankedReview: "none",
      name: "fixture",
      tiles: fairTiles(),
      predeployedUnits: [],
      numberOfPlayers: 0,
      createdAt: row.createdAt ?? stamp,
      updatedAt: stamp,
      evaluatedAt: null,
      supportedModes: [],
      ...row,
      id,
    });
  }

  const matches = (row: Row, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, value]) => {
      if (key === "createdAt" && typeof value === "object" && value !== null) {
        return row.createdAt < (value as { lt: Date }).lt;
      }

      if (value instanceof Date) {
        return (row[key as keyof Row] as Date)?.getTime() === value.getTime();
      }

      return row[key as keyof Row] === value;
    });

  const db = {
    wWMap: {
      create: async ({ data }: { data: Partial<Row> }) => {
        const id = `map-${nextId++}`;
        const now = new Date();
        const row = {
          id,
          createdAt: now,
          updatedAt: now,
          evaluatedAt: null,
          ...data,
        } as Row;
        store.set(id, row);

        return row;
      },
      findUnique: async ({ where }: { where: { id: string } }) => store.get(where.id) ?? null,
      findMany: async ({
        where,
        orderBy,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, "asc" | "desc">;
      } = {}) => {
        const rows = [...store.values()].filter((row) => matches(row, where ?? {}));
        const [field, direction] = Object.entries(orderBy ?? {})[0] ?? [];

        if (field === undefined) {
          return rows;
        }

        // Ordering is a real requirement of `listMine` — the map you touched last is the one you
        // want first — so the fake honours it rather than letting the assertion pass vacuously.
        return rows.sort((a, b) => {
          const left = a[field as keyof Row];
          const right = b[field as keyof Row];
          const compared =
            left instanceof Date && right instanceof Date
              ? left.getTime() - right.getTime()
              : String(left).localeCompare(String(right));

          return direction === "desc" ? -compared : compared;
        });
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
        const row = store.get(where.id)!;
        Object.assign(row, data);

        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Partial<Row>;
      }) => {
        const hits = [...store.values()].filter((row) => matches(row, where));
        hits.forEach((row) => Object.assign(row, data));

        return { count: hits.length };
      },
      deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
        const hits = [...store.values()].filter((row) => matches(row, where));
        hits.forEach((row) => store.delete(row.id));

        return { count: hits.length };
      },
    },
  };

  return {
    usecase: new MapsUsecase(db as unknown as PrismaClient, fakeTerrainAccess, fakeUnitDefaults),
    store,
  };
};

// `CreatableMap` types the grid as a non-empty tuple, which a plain array cannot prove — the same
// boundary the builder crosses. Contents are what matter here.
const bodyOf = (tiles: Tile[][]): CreatableMap =>
  ({ name: "fixture", tiles, predeployedUnits: [] }) as unknown as CreatableMap;

describe("startDraft", () => {
  it("creates a blank draft owned by the caller", async () => {
    const { usecase, store } = makeUsecase();
    const draft = await usecase.startDraft("p1", { width: 12, height: 10 });
    const row = store.get(draft.id)!;

    expect(row.authorId).toBe("p1");
    expect(row.status).toBe("draft");
    expect(row.tiles).toHaveLength(10);
    expect(row.tiles[0]).toHaveLength(12);
  });

  it("gives plain tiles the variant the schema requires", async () => {
    const { usecase, store } = makeUsecase();
    const draft = await usecase.startDraft("p1", { width: 10, height: 10 });

    expect(store.get(draft.id)!.tiles[0][0]).toEqual({ type: "plain", variant: "normal" });
  });

  describe("pruning, so opening the builder does not litter", () => {
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);

    it("drops the caller's own drafts that were opened and never edited", async () => {
      const { usecase, store } = makeUsecase([
        { id: "stale", authorId: "p1", status: "draft", createdAt: old, updatedAt: old },
      ]);

      await usecase.startDraft("p1", { width: 10, height: 10 });

      expect(store.has("stale")).toBe(false);
    });

    it("keeps a draft that was actually worked on", async () => {
      const { usecase, store } = makeUsecase([
        {
          id: "touched",
          authorId: "p1",
          status: "draft",
          createdAt: old,
          updatedAt: old,
          evaluatedAt: old,
        },
      ]);

      await usecase.startDraft("p1", { width: 10, height: 10 });

      expect(store.has("touched")).toBe(true);
    });

    it("never touches someone else's drafts", async () => {
      const { usecase, store } = makeUsecase([
        { id: "theirs", authorId: "p2", status: "draft", createdAt: old, updatedAt: old },
      ]);

      await usecase.startDraft("p1", { width: 10, height: 10 });

      expect(store.has("theirs")).toBe(true);
    });
  });
});

describe("updateDraft", () => {
  const seenAt = new Date("2026-01-01T00:00:00Z");

  it("saves, and hands back a verdict matching a direct evaluate", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);
    const body = bodyOf(fairTiles());

    const result = await usecase.updateDraft("p1", { ...body, mapId: "m", seenAt });

    expect(result.report).toEqual(usecase.evaluate(body));
    expect(result.report.isFair).toBe(true);
  });

  it("refuses a stale token rather than clobbering the other tab", async () => {
    const { usecase, store } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);
    const body = bodyOf(fairTiles());

    await usecase.updateDraft("p1", { ...body, mapId: "m", seenAt });

    await expect(
      usecase.updateDraft("p1", { ...body, name: "second tab", mapId: "m", seenAt }),
    ).rejects.toThrow(/changed somewhere else/i);

    expect(store.get("m")!.name).not.toBe("second tab");
  });

  it("refuses a map the caller does not own", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p2", updatedAt: seenAt }]);

    await expect(
      usecase.updateDraft("p1", { ...bodyOf(fairTiles()), mapId: "m", seenAt }),
    ).rejects.toThrow();
  });
});

describe("publish — the playable gate", () => {
  it("refuses an unplayable map and says what is wrong", async () => {
    const { usecase, store } = makeUsecase([
      {
        id: "m",
        authorId: "p1",
        tiles: Array.from({ length: 9 }, () => Array.from({ length: 9 }, plain)),
      },
    ]);

    await expect(usecase.publish("p1", "m")).rejects.toThrow(/cannot be played/i);
    expect(store.get("m")!.status).toBe("draft");
  });

  it("publishes a playable map even when it is not even-handed", async () => {
    const { usecase, store } = makeUsecase([{ id: "m", authorId: "p1", tiles: lopsidedTiles() }]);

    const report = await usecase.publish("p1", "m");

    expect(report.isPlayable).toBe(true);
    expect(report.isFair).toBe(false);
    expect(store.get("m")!.status).toBe("published");
  });

  it("refuses a map belonging to someone else, without confirming it exists", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p2" }]);

    await expect(usecase.publish("p1", "m")).rejects.toThrow("No such map.");
    await expect(usecase.publish("p1", "nonexistent")).rejects.toThrow("No such map.");
  });
});

describe("submitForRanked — the fairness gate", () => {
  it("refuses an uneven map", async () => {
    const { usecase, store } = makeUsecase([
      { id: "m", authorId: "p1", status: "published", tiles: lopsidedTiles() },
    ]);

    await expect(usecase.submitForRanked("p1", "m")).rejects.toThrow(/not even-handed/i);
    expect(store.get("m")!.rankedReview).toBe("none");
  });

  it("queues an even one for review rather than admitting it outright", async () => {
    const { usecase, store } = makeUsecase([
      { id: "m", authorId: "p1", status: "published", tiles: fairTiles() },
    ]);

    await usecase.submitForRanked("p1", "m");

    // `pending`, not `approved`: fairness is measured, but a moderator still has the last word.
    expect(store.get("m")!.rankedReview).toBe("pending");
  });
});

describe("listMaps", () => {
  it("shows published maps only, so drafts stay private", async () => {
    const { usecase } = makeUsecase([
      { id: "draft", authorId: "p1", status: "draft", name: "wip" },
      { id: "live", authorId: "p1", status: "published", name: "shipped" },
    ]);

    const listed = await usecase.listMaps();

    expect(listed.map((map) => map.name)).toEqual(["shipped"]);
  });
});

describe("predeployed units cross the authoring/engine boundary", () => {
  const seenAt = new Date("2026-01-01T00:00:00Z");

  it("stores the engine shape, not the lean one the builder sent", async () => {
    const { usecase, store } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await usecase.updateDraft("p1", {
      ...bodyOf(fairTiles()),
      mapId: "m",
      seenAt,
      predeployedUnits: [{ type: "infantry", playerSlot: 0, position: [4, 4] }],
    } as never);

    const stored = store.get("m")!.predeployedUnits as Record<string, unknown>[];

    // The client never sent stats — HP and fuel are game constants the server supplies.
    expect(stored[0]).toMatchObject({ type: "infantry", playerSlot: 0, position: [4, 4] });
    expect(stored[0].stats).toBeDefined();
    expect(stored[0].isReady).toBe(true);
  });

  it("refuses a unit type the engine does not have, and names it", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await expect(
      usecase.updateDraft("p1", {
        ...bodyOf(fairTiles()),
        mapId: "m",
        seenAt,
        predeployedUnits: [{ type: "dragon", playerSlot: 0, position: [4, 4] }],
      } as never),
    ).rejects.toThrow(/dragon/);
  });

  it("counts a unit's seat towards the player count", async () => {
    const { usecase, store } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await usecase.updateDraft("p1", {
      ...bodyOf(fairTiles()),
      mapId: "m",
      seenAt,
      predeployedUnits: [{ type: "infantry", playerSlot: 0, position: [4, 4] }],
    } as never);

    expect(store.get("m")!.numberOfPlayers).toBe(2);
  });

  it("serves the placeable roster from the injected table rather than a client list", () => {
    const { usecase } = makeUsecase();

    expect(usecase.placeableUnitTypes()).toContain("infantry");
  });
});

describe("vocabulary — the client holds no game data of its own", () => {
  it("serves the terrain roster, the property roster and the unit roster", () => {
    const { usecase } = makeUsecase();
    const words = usecase.vocabulary();

    expect(words.terrain.length).toBeGreaterThan(0);
    expect(words.properties).toContain("hq");
    expect(words.units.map((unit) => unit.type)).toContain("infantry");
  });

  it("sends a blank tile complete with the variant the schema demands", () => {
    const { usecase } = makeUsecase();

    // The client cannot know that `plain` needs a variant, so it must not have to.
    expect(usecase.vocabulary().blankTile).toEqual({ type: "plain", variant: "normal" });
  });

  it("sends the tile connection table, so the client resolves art without owning the rules", () => {
    const { usecase } = makeUsecase();
    const road = usecase.vocabulary().terrain.find((tile) => tile.type === "road");

    expect(road?.connectsTo).toContain("bridge");
    expect(road?.connectsTo).toContain("hq");
    expect(road?.singleAxis).toBe(false);
  });

  it("marks single-axis tiles, which cannot be derived from their connections", () => {
    const { usecase } = makeUsecase();
    const bridge = usecase.vocabulary().terrain.find((tile) => tile.type === "bridge");

    // A bridge connects on four sides but only ever draws two.
    expect(bridge?.connectsTo.length).toBeGreaterThan(2);
    expect(bridge?.singleAxis).toBe(true);
  });

  it("resolves where each unit may stand, so the client needs no movement table", () => {
    const { usecase } = makeUsecase();
    const units = usecase.vocabulary().units;

    const infantry = units.find((unit) => unit.type === "infantry");
    const tank = units.find((unit) => unit.type === "tank");

    expect(infantry?.standableOn).toContain("mountain");
    expect(tank?.standableOn).not.toContain("mountain");
  });

  it("carries each unit's published stats", () => {
    const { usecase } = makeUsecase();
    const infantry = usecase.vocabulary().units.find((unit) => unit.type === "infantry");

    expect(infantry).toMatchObject({ movementType: "foot", facility: "base" });
    expect(infantry?.cost).toBeGreaterThan(0);
  });

  it("bounds the size picker with the same limits the server enforces", () => {
    const { usecase } = makeUsecase();

    expect(usecase.vocabulary().size).toEqual({ min: 10, max: 40 });
  });

  it("maps every seat a map can hold to a faction", () => {
    const { usecase } = makeUsecase();

    expect(usecase.vocabulary().armyBySlot).toHaveLength(4);
  });
});

describe("resize", () => {
  const seenAt = new Date("2026-01-01T00:00:00Z");

  it("reshapes the stored grid and advances the concurrency token", async () => {
    const { usecase, store } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    const result = await usecase.resize("p1", {
      playerId: "p1",
      mapId: "m",
      seenAt,
      width: 13,
      height: 13,
      anchor: "top-left",
    } as never);

    expect(result.tiles).toHaveLength(13);
    expect(store.get("m")!.tiles).toHaveLength(13);
    expect(result.updatedAt.getTime()).toBeGreaterThan(seenAt.getTime());
  });

  it("re-checks the reshaped map, because a crop can break one", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    // The fixture puts P1's HQ at (1,1) and P2's at (9,9). Cropping to the top-left 8x8 keeps the
    // first and cuts the second off the map entirely, which leaves nobody to play against.
    const result = await usecase.resize("p1", {
      playerId: "p1",
      mapId: "m",
      seenAt,
      width: 8,
      height: 8,
      anchor: "top-left",
    } as never);

    expect(result.report.isPlayable).toBe(false);
  });

  it("refuses a stale token rather than reshaping over another tab", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await expect(
      usecase.resize("p1", {
        playerId: "p1",
        mapId: "m",
        seenAt: new Date("2020-01-01T00:00:00Z"),
        width: 12,
        height: 12,
        anchor: "center",
      } as never),
    ).rejects.toThrow(/changed somewhere else/i);
  });

  it("refuses a map the caller does not own", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p2", updatedAt: seenAt }]);

    await expect(
      usecase.resize("p1", {
        playerId: "p1",
        mapId: "m",
        seenAt,
        width: 12,
        height: 12,
        anchor: "center",
      } as never),
    ).rejects.toThrow("No such map.");
  });
});

describe("mirror modes are served, not assumed by the client", () => {
  it("carries a seat permutation for every image of every mode", () => {
    const { usecase } = makeUsecase();

    for (const mode of usecase.vocabulary().mirrors) {
      for (const image of mode.images) {
        expect(image.slotMap).toHaveLength(4);
        // A permutation, not an arbitrary list: every seat appears exactly once.
        expect([...image.slotMap].sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it("offers an off mode that paints one tile", () => {
    const { usecase } = makeUsecase();
    const off = usecase.vocabulary().mirrors.find((mode) => mode.id === "none");

    expect(off?.images).toHaveLength(0);
  });

  it("marks the quarter-turn mode as square-only", () => {
    const { usecase } = makeUsecase();
    const rotate90 = usecase.vocabulary().mirrors.find((mode) => mode.id === "rotate90");

    expect(rotate90?.squareOnly).toBe(true);
    expect(rotate90?.images).toHaveLength(3);
  });
});

describe("variant lists come out of the schema that validates them", () => {
  const terrainFor = (type: string) => {
    const { usecase } = makeUsecase();

    return usecase.vocabulary().terrain.find((tile) => tile.type === type);
  };

  it("gives a road every two-, three- and four-way connection", () => {
    // 6 two-way + 4 three-way + 1 four-way.
    expect(terrainFor("road")?.variants).toHaveLength(11);
    expect(terrainFor("road")?.variants).toContain("top-right-bottom-left");
  });

  it("gives a bridge only its two axes", () => {
    expect(terrainFor("bridge")?.variants.sort()).toEqual(["right-left", "top-bottom"]);
  });

  it("gives a pipe its dead ends as well as its runs", () => {
    // Pipes are the one connecting tile with one-way art, so a stub is drawable.
    expect(terrainFor("pipe")?.variants).toContain("top");
    expect(terrainFor("pipe")?.variants).toHaveLength(10);
  });

  it("gives plain its broken-pipe looks", () => {
    expect(terrainFor("plain")?.variants).toContain("normal");
    expect(terrainFor("plain")?.variants).toContain("broken-pipe-right-left");
  });

  it("leaves a fixed-look tile with no variants at all", () => {
    expect(terrainFor("sea")?.variants).toEqual([]);
    expect(terrainFor("mountain")?.variants).toEqual([]);
  });

  it("never offers a variant the tile schema would reject", () => {
    const { usecase } = makeUsecase();

    for (const tile of usecase.vocabulary().terrain) {
      for (const variant of tile.variants) {
        expect(tileSchema.safeParse({ type: tile.type, variant, hp: 99 }).success).toBe(true);
      }
    }
  });
});

describe("coming back to a map", () => {
  const seenAt = new Date("2026-01-01T00:00:00Z");

  it("lists the caller's own maps, most recently touched first", async () => {
    const older = new Date("2026-01-01T00:00:00Z");
    const newer = new Date("2026-02-01T00:00:00Z");
    const { usecase } = makeUsecase([
      { id: "old", authorId: "p1", name: "older", updatedAt: older },
      { id: "new", authorId: "p1", name: "newer", updatedAt: newer },
      { id: "theirs", authorId: "p2", name: "someone else's" },
    ]);

    const mine = await usecase.listMine("p1");

    expect(mine.map((map) => map.name)).toEqual(["newer", "older"]);
  });

  it("carries the size, so a map is recognisable in the list", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1" }]);
    const [map] = await usecase.listMine("p1");

    expect(map.size).toEqual({ width: 11, height: 11 });
  });

  it("opens a map with its grid, its units and a fresh verdict", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await usecase.updateDraft("p1", {
      ...bodyOf(fairTiles()),
      name: "Meridian",
      mapId: "m",
      seenAt,
      predeployedUnits: [{ type: "infantry", playerSlot: 0, position: [4, 4] }],
    } as never);

    const loaded = await usecase.getForEdit("p1", "m");

    expect(loaded.name).toBe("Meridian");
    expect(loaded.tiles).toHaveLength(11);
    expect(loaded.report.isPlayable).toBe(true);
  });

  it("hands units back in the lean shape the builder edits, not the stored one", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    await usecase.updateDraft("p1", {
      ...bodyOf(fairTiles()),
      mapId: "m",
      seenAt,
      predeployedUnits: [{ type: "infantry", playerSlot: 0, position: [4, 4] }],
    } as never);

    const [unit] = (await usecase.getForEdit("p1", "m")).predeployedUnits;

    // Stored WITH stats, returned WITHOUT: the builder sends `{type, playerSlot, position}` and
    // must get the same back, or a round-trip hands it fields it never asked for.
    expect(unit).toEqual({ type: "infantry", playerSlot: 0, position: [4, 4] });
  });

  it("survives a full round-trip through the editor", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p1", updatedAt: seenAt }]);

    const first = await usecase.updateDraft("p1", {
      ...bodyOf(fairTiles()),
      mapId: "m",
      seenAt,
      predeployedUnits: [{ type: "tank", playerSlot: 1, position: [6, 6] }],
    } as never);

    const loaded = await usecase.getForEdit("p1", "m");

    // Saving exactly what was loaded must be accepted, which is what "open it again" really means.
    const again = await usecase.updateDraft("p1", {
      name: loaded.name,
      tiles: loaded.tiles,
      predeployedUnits: loaded.predeployedUnits,
      mapId: "m",
      seenAt: first.updatedAt,
    } as never);

    expect(again.report).toEqual(loaded.report);
  });

  it("refuses someone else's map without confirming it exists", async () => {
    const { usecase } = makeUsecase([{ id: "m", authorId: "p2" }]);

    await expect(usecase.getForEdit("p1", "m")).rejects.toThrow("No such map.");
    await expect(usecase.getForEdit("p1", "nope")).rejects.toThrow("No such map.");
  });
});
