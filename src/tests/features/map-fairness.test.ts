import { describe, expect, test } from "vitest";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Tile } from "server/core/schemas/tile";
import { evaluateMap, type FairnessReport } from "server/maps/fairness";
import { fakeTerrainAccess as access } from "../helpers/map-ports";
import { engineTerrainAccess } from "server/adapters/engine-map-access";
import type { CreatableMap } from "server/maps/schemas";

/**
 * The checker is pure, so these run on hand-built grids with no DB and no engine — the point of the
 * `TerrainAccess` port. One case per check, in both directions: a check that can only be seen to
 * pass is a check that could be `ok: true` unconditionally.
 */

const plain = (): Tile => ({ type: "plain", variant: "normal" });
const t = (type: string): Tile => ({ type }) as Tile;
const owned = (type: string, playerSlot: PlayerSlot): Tile => ({ type, playerSlot }) as Tile;

const blank = (width: number, height: number): Tile[][] =>
  Array.from({ length: height }, () => Array.from({ length: width }, plain));

const mapOf = (
  tiles: Tile[][],
  predeployedUnits: CreatableMap["predeployedUnits"] = [],
): CreatableMap => ({ name: "fixture", tiles, predeployedUnits }) as CreatableMap;

const find = (report: FairnessReport, id: string) => {
  const all = [...report.playable, ...report.fairness];
  const hit = all.find((c) => c.id === id);

  if (hit === undefined) {
    throw new Error(`No check "${id}". Have: ${all.map((c) => c.id).join(", ")}`);
  }

  return hit;
};

/**
 * A symmetric two-seat map that passes everything, as the baseline every failure case mutates.
 * Built by 180-degree rotation so parity holds by construction.
 */
const fairMap = (): Tile[][] => {
  const tiles = blank(11, 11);

  const place = (x: number, y: number, tile: Tile, mirrored: Tile) => {
    tiles[y][x] = tile;
    tiles[10 - y][10 - x] = mirrored;
  };

  place(1, 1, owned("hq", 0), owned("hq", 1));
  place(2, 1, owned("base", 0), owned("base", 1));
  place(1, 2, owned("base", 0), owned("base", 1));
  place(3, 3, owned("city", 0), owned("city", 1));
  place(4, 6, t("forest"), t("forest"));
  place(5, 5, owned("city", -1), owned("city", -1));

  return tiles;
};

describe("evaluateMap — the baseline", () => {
  test("a symmetric two-seat map is playable and fair", () => {
    const report = evaluateMap(mapOf(fairMap()), access);

    expect(report.seats).toEqual([0, 1]);
    expect(report.isPlayable).toBe(true);
    expect(report.isFair).toBe(true);
  });

  test("the real engine table agrees with the fixture table", () => {
    expect(evaluateMap(mapOf(fairMap()), engineTerrainAccess).isFair).toBe(true);
  });

  test("every check reports a stable id and a non-empty detail", () => {
    const report = evaluateMap(mapOf(fairMap()), access);

    for (const check of [...report.playable, ...report.fairness]) {
      expect(check.id).not.toBe("");
      expect(check.detail).not.toBe("");
    }
  });
});

describe("playable — can the map be played at all?", () => {
  test("one seat is not a game", () => {
    const tiles = blank(9, 9);
    tiles[1][1] = owned("hq", 0);
    tiles[1][2] = owned("base", 0);

    const report = evaluateMap(mapOf(tiles), access);

    expect(find(report, "seats").ok).toBe(false);
    expect(report.isPlayable).toBe(false);
  });

  test("a seat with two HQs fails, and the check points at both", () => {
    const tiles = fairMap();
    tiles[4][4] = owned("hq", 0);

    const report = evaluateMap(mapOf(tiles), access);
    const check = find(report, "one-hq");

    expect(check.ok).toBe(false);
    expect(check.tiles).toHaveLength(2);
  });

  test("a seat with no producer and no predeployed unit cannot field anything", () => {
    const tiles = fairMap();
    tiles[1][2] = plain();
    tiles[2][1] = plain();

    expect(find(evaluateMap(mapOf(tiles), access), "can-produce").ok).toBe(false);
  });

  test("a predeployed unit is enough to field with, without any producer", () => {
    const tiles = fairMap();
    tiles[1][2] = plain();
    tiles[2][1] = plain();

    const withUnit = mapOf(tiles, [
      { type: "infantry", playerSlot: 0, position: [3, 1] },
    ] as CreatableMap["predeployedUnits"]);

    expect(find(evaluateMap(withUnit, access), "can-produce").ok).toBe(true);
  });

  describe("every HQ can be captured", () => {
    /** Walls off the right-hand seat behind a full-height column of `type`. */
    const walledWith = (type: string) => {
      const tiles = fairMap();

      for (let y = 0; y < 11; y++) {
        tiles[y][7] = t(type);
      }

      return tiles;
    };

    test("a solid pipe seals an HQ off — nothing in the game opens one", () => {
      expect(find(evaluateMap(mapOf(walledWith("pipe")), access), "hq-capturable").ok).toBe(false);
    });

    test("a pipe seam does not: it is a wall you blow open", () => {
      expect(find(evaluateMap(mapOf(walledWith("pipeSeam")), access), "hq-capturable").ok).toBe(
        true,
      );
    });

    test("water seals an HQ off when the map affords no transport", () => {
      expect(find(evaluateMap(mapOf(walledWith("sea")), access), "hq-capturable").ok).toBe(false);
    });

    test("...but not once a port exists to build a lander at", () => {
      const tiles = walledWith("sea");
      tiles[9][1] = owned("port", 0);
      tiles[1][9] = owned("port", 1);

      expect(find(evaluateMap(mapOf(tiles), access), "hq-capturable").ok).toBe(true);
    });

    test("a mountain range seals nothing — infantry climb", () => {
      expect(find(evaluateMap(mapOf(walledWith("mountain")), access), "hq-capturable").ok).toBe(
        true,
      );
    });
  });

  describe("every HQ has two ways in", () => {
    test("an HQ reachable by one tile only is a chokepoint map", () => {
      const tiles = fairMap();
      // Box P1's HQ at (1,1) in with water, leaving one land approach.
      tiles[1][0] = t("sea");
      tiles[0][1] = t("sea");
      tiles[1][2] = t("sea");

      const report = evaluateMap(mapOf(tiles), access);
      const check = find(report, "hq-approaches");

      expect(check.ok).toBe(false);
      expect(check.tiles.length).toBeGreaterThan(0);
    });

    test("re-opening one side is enough", () => {
      const tiles = fairMap();
      tiles[1][0] = t("sea");
      tiles[0][1] = t("sea");

      expect(find(evaluateMap(mapOf(tiles), access), "hq-approaches").ok).toBe(true);
    });
  });
});

describe("fairness — does the map favour a seat?", () => {
  test("an unmirrored city breaks the census, and names the disagreement", () => {
    const tiles = fairMap();
    tiles[7][2] = owned("city", 0);

    const report = evaluateMap(mapOf(tiles), access);
    const check = find(report, "census");

    expect(check.ok).toBe(false);
    expect(check.detail).toBe("city 2 vs 1");
    expect(report.isPlayable).toBe(true);
    expect(report.isFair).toBe(false);
  });

  test("a neutral property nearer one seat breaks distance parity", () => {
    const tiles = fairMap();
    tiles[5][5] = plain();
    tiles[2][3] = owned("city", -1);

    expect(find(evaluateMap(mapOf(tiles), access), "neutral-distance").ok).toBe(false);
  });

  test("forest stacked on one side breaks the terrain mix", () => {
    const tiles = fairMap();

    for (let y = 1; y < 5; y++) {
      tiles[y][4] = t("forest");
    }

    expect(find(evaluateMap(mapOf(tiles), access), "terrain-mix").ok).toBe(false);
  });

  test("ground open to vehicles is measured apart from ground open on foot", () => {
    const tiles = fairMap();

    // A full-height mountain ridge off-centre. Mountains are foot-passable but not
    // vehicle-passable, so this is invisible to a foot flood and must still be caught: it pens
    // P1's vehicles into a narrow strip while P2's keep the rest of the map.
    for (let y = 0; y < 11; y++) {
      tiles[y][3] = t("mountain");
    }

    const report = evaluateMap(mapOf(tiles), access);

    expect(find(report, "hq-capturable").ok).toBe(true);
    expect(find(report, "vehicle-ground").ok).toBe(false);
  });

  describe("uncontestable property is a fairness term, not a blocker", () => {
    /** An island city for `seat`, ringed by water, with no transport anywhere on the map. */
    const withIslandCityFor = (seat: PlayerSlot, tiles: Tile[][]) => {
      const [cx, cy] = seat === 0 ? [5, 1] : [5, 9];

      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        tiles[cy + dy][cx + dx] = t("sea");
      }

      tiles[cy][cx] = owned("city", seat);

      return tiles;
    };

    test("an island city only one seat holds is unfair but still playable", () => {
      const report = evaluateMap(mapOf(withIslandCityFor(0, fairMap())), access);

      expect(report.isPlayable).toBe(true);
      expect(find(report, "uncontested").ok).toBe(false);
      expect(find(report, "uncontested").detail).toBe("1 vs 0");
    });

    test("give both seats one and it is even again", () => {
      const tiles = withIslandCityFor(1, withIslandCityFor(0, fairMap()));
      const check = find(evaluateMap(mapOf(tiles), access), "uncontested");

      expect(check.ok).toBe(true);
      expect(check.detail).toBe("1 each");
    });
  });
});

describe("predeployed units must be able to stand where they are", () => {
  const withUnit = (type: string, position: [number, number], tiles = fairMap()) =>
    mapOf(tiles, [{ type, playerSlot: 0, position }] as CreatableMap["predeployedUnits"]);

  test("accepts a tank on open ground", () => {
    expect(find(evaluateMap(withUnit("tank", [4, 4]), access), "units-placeable").ok).toBe(true);
  });

  test("rejects a tank on a mountain, which it cannot climb", () => {
    const tiles = fairMap();
    tiles[4][4] = t("mountain");

    const check = find(evaluateMap(withUnit("tank", [4, 4], tiles), access), "units-placeable");

    expect(check.ok).toBe(false);
    expect(check.tiles).toEqual([[4, 4]]);
  });

  test("accepts infantry on that same mountain", () => {
    const tiles = fairMap();
    tiles[4][4] = t("mountain");

    expect(
      find(evaluateMap(withUnit("infantry", [4, 4], tiles), access), "units-placeable").ok,
    ).toBe(true);
  });

  test("rejects a lander on dry land, and accepts it at sea", () => {
    expect(find(evaluateMap(withUnit("lander", [4, 4]), access), "units-placeable").ok).toBe(false);

    const tiles = fairMap();
    tiles[4][4] = t("sea");

    expect(find(evaluateMap(withUnit("lander", [4, 4], tiles), access), "units-placeable").ok).toBe(
      true,
    );
  });

  test("rejects a unit type that does not exist", () => {
    expect(find(evaluateMap(withUnit("dragon", [4, 4]), access), "units-placeable").ok).toBe(false);
  });

  test("rejects a unit standing off the edge of the map", () => {
    expect(find(evaluateMap(withUnit("infantry", [99, 99]), access), "units-placeable").ok).toBe(
      false,
    );
  });

  test("blocks publishing, since a stranded unit is a broken map and not merely an uneven one", () => {
    const tiles = fairMap();
    tiles[4][4] = t("mountain");

    expect(evaluateMap(withUnit("tank", [4, 4], tiles), access).isPlayable).toBe(false);
  });
});
