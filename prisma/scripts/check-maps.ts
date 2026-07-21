/**
 * Standalone fairness checker for the test map pool: `npm run maps:check`.
 *
 * Pure — it reads `map-definitions.ts` and touches neither the DB nor the engine. It exists
 * because a map pool this size is hand-typed AWBW CSV, and a single transposed digit produces a
 * map that looks fine and quietly hands one player an extra city.
 *
 * Per map it asserts:
 *  1. the grid is rectangular and every code is a known AWBW tile code;
 *  2. the declared symmetry actually holds — including tile *variants* and the slot permutation
 *     (skipped for `asymmetric` maps, where the parity checks below carry the whole load);
 *  3. every occupied slot has an identical property census, with exactly one HQ;
 *  4. `numberOfPlayers` matches the number of occupied slots;
 *  5. every HQ can reach every other HQ on foot (nobody is walled off);
 *  6. distance parity — each slot's sorted distance list to its own properties, to every neutral
 *     property kind, and to the contested objectives (labs, comm towers, silos) must match;
 *  7. terrain parity — each slot's ground, decided by a nearest-HQ Voronoi split, holds the same
 *     mix of cover and friction, to within `TERRAIN_TOLERANCE`.
 *
 * Checks 6 and 7 run on EVERY map: a symmetric map satisfies them for free (its symmetry is an
 * isometry), so one fairness standard covers the whole pool rather than two.
 *
 * Flags:
 *   --render          print an ASCII map per definition, the only practical way to review a pool
 *   --file <path>     check only the maps a module exports (as `maps` or `mapDefinitions`), so
 *                     several authors can verify their own batch with nothing shared to collide on
 *
 * Exits non-zero if any map fails, so it can gate a commit.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MapDefinition, MapSymmetry } from "./map-definitions";
import { flanksOf, mapDefinitions } from "./map-definitions";

/* -------------------------------------------------------------------------------------------- */
/* Tile-code vocabulary                                                                         */
/* -------------------------------------------------------------------------------------------- */

/**
 * Property codes are laid out in per-slot blocks in AWBW: slot 0 is 38..42, slot 1 is 43..47, and
 * so on in `city, base, airport, port, hq` order. Deriving the tables from that regularity keeps
 * this checker honest — a hand-written table could drift from `awbwTileMapping`.
 */
const propertyKinds = ["city", "base", "airport", "port", "hq"] as const;
type PropertyKind = (typeof propertyKinds)[number];

/** AWBW orders the slot blocks 0,1,2,3 then 5,6 then 4 then 7 — only 0..3 matter for our pool. */
const slotBlockStart: Record<number, number> = { 0: 38, 1: 43, 2: 48, 3: 53 };

type Property = { kind: PropertyKind; slot: number };

const propertyByCode = new Map<number, Property>();

for (const [slot, start] of Object.entries(slotBlockStart)) {
  propertyKinds.forEach((kind, index) => {
    propertyByCode.set(start + index, { kind, slot: Number(slot) });
  });
}

// Neutral properties (slot -1) are scattered rather than blocked, so they are listed explicitly.
propertyByCode.set(34, { kind: "city", slot: -1 });
propertyByCode.set(35, { kind: "base", slot: -1 });
propertyByCode.set(36, { kind: "airport", slot: -1 });
propertyByCode.set(37, { kind: "port", slot: -1 });

/** Non-property codes we allow, and how each behaves for foot movement. */
const terrainCodes = new Map<number, { land: boolean }>();

const addTerrain = (codes: number[], land: boolean) => {
  for (const code of codes) {
    terrainCodes.set(code, { land });
  }
};

addTerrain([1, 2, 3], true); // plain, mountain, forest
addTerrain([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], true); // rivers — fordable on foot
addTerrain([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25], true); // roads
addTerrain([26, 27], true); // bridges
addTerrain([28, 33], false); // sea, reef
addTerrain([29, 30, 31, 32], true); // shoals
addTerrain([101, 102, 103, 104, 105, 106, 107, 108, 109, 110], false); // pipes
addTerrain([111, 112], true); // unused / used silo
addTerrain([113, 114], false); // pipe seams — must be blown open first
addTerrain([115, 116], true); // broken pipe (plains)
addTerrain([133, 145], true); // neutral comm tower, neutral lab

/** Comm towers and labs exist per-slot too; treat them as land, and as ownable properties. */
const ownableExtras: Record<number, Property> = {
  134: { kind: "city", slot: 0 }, // comm tower, slot 0 — counted as its own kind below
  129: { kind: "city", slot: 1 },
  131: { kind: "city", slot: 2 },
  136: { kind: "city", slot: 3 },
};

const isLand = (code: number): boolean => {
  if (propertyByCode.has(code) || code in ownableExtras) {
    return true;
  }

  return terrainCodes.get(code)?.land ?? false;
};

const isKnownCode = (code: number): boolean =>
  propertyByCode.has(code) || terrainCodes.has(code) || code in ownableExtras;

/* -------------------------------------------------------------------------------------------- */
/* Symmetry transforms                                                                          */
/* -------------------------------------------------------------------------------------------- */

/**
 * Directional tile variants must be transformed alongside the position, or the terrain ends up
 * symmetric while the road and river graph does not. Each table maps a code to its image; codes
 * absent from a table are their own image.
 */
const buildVariantTable = (pairs: [number, number][]): Map<number, number> => {
  const table = new Map<number, number>();

  for (const [from, to] of pairs) {
    table.set(from, to);
    table.set(to, from);
  }

  return table;
};

/** 180 degrees: top <-> bottom and left <-> right, so both axes flip. */
const rotate180Variants = buildVariantTable([
  [18, 20], // road right-bottom <-> top-left
  [19, 21], // road bottom-left <-> top-right
  [22, 24], // road right-bottom-left <-> top-right-left
  [23, 25], // road top-bottom-left <-> top-right-bottom
  [7, 9], // river right-bottom <-> top-left
  [8, 10], // river bottom-left <-> top-right
  [11, 13],
  [12, 14],
  [103, 105], // pipe top-right <-> bottom-left
  [104, 106], // pipe right-bottom <-> top-left
  [107, 109], // pipe top <-> bottom
  [108, 110], // pipe right <-> left
]);

/** Horizontal mirror: left <-> right only. */
const mirrorHorizontalVariants = buildVariantTable([
  [18, 19], // road right-bottom <-> bottom-left
  [20, 21], // road top-left <-> top-right
  [23, 25], // road top-bottom-left <-> top-right-bottom
  [7, 8],
  [9, 10],
  [12, 14],
  [103, 106],
  [104, 105],
  [108, 110],
]);

/** Vertical mirror: top <-> bottom only. */
const mirrorVerticalVariants = buildVariantTable([
  [18, 21], // road right-bottom <-> top-right
  [19, 20], // road bottom-left <-> top-left
  [22, 24],
  [7, 10],
  [8, 9],
  [11, 13],
  [103, 104],
  [105, 106],
  [107, 109],
]);

/** 90 degrees clockwise: top -> right -> bottom -> left -> top. */
const rotate90Variants = new Map<number, number>([
  [15, 16],
  [16, 15],
  [18, 19],
  [19, 20],
  [20, 21],
  [21, 18],
  [22, 23],
  [23, 24],
  [24, 25],
  [25, 22],
  [4, 5],
  [5, 4],
  [7, 8],
  [8, 9],
  [9, 10],
  [10, 7],
  [11, 12],
  [12, 13],
  [13, 14],
  [14, 11],
  [26, 27],
  [27, 26],
  [101, 102],
  [102, 101],
  [103, 104],
  [104, 105],
  [105, 106],
  [106, 103],
  [107, 108],
  [108, 109],
  [109, 110],
  [110, 107],
  [113, 114],
  [114, 113],
  [115, 116],
  [116, 115],
]);

/** Re-owns a property code from `fromSlot` to `toSlot`, leaving neutral and terrain codes alone. */
const remapSlot = (code: number, shift: (slot: number) => number): number => {
  const property = propertyByCode.get(code);

  if (property === undefined || property.slot < 0) {
    return code;
  }

  const targetStart = slotBlockStart[shift(property.slot)];

  if (targetStart === undefined) {
    throw new Error(`No AWBW code block for slot ${shift(property.slot)}`);
  }

  return targetStart + propertyKinds.indexOf(property.kind);
};

type Transform = {
  label: string;
  /** Where the tile at (row, col) must appear. */
  target: (row: number, col: number, height: number, width: number) => [number, number];
  variants: Map<number, number>;
  shiftSlot: (slot: number) => number;
};

const transformsFor = (symmetry: MapSymmetry): Transform[] => {
  switch (symmetry) {
    case "rotate180":
      return [
        {
          label: "180-degree rotation (slots 0 <-> 1)",
          target: (r, c, h, w) => [h - 1 - r, w - 1 - c],
          variants: rotate180Variants,
          shiftSlot: (slot) => (slot === 0 ? 1 : 0),
        },
      ];
    case "mirrorBoth":
      return [
        {
          label: "horizontal mirror (team swap: 0 <-> 1, 2 <-> 3)",
          target: (r, c, _h, w) => [r, w - 1 - c],
          variants: mirrorHorizontalVariants,
          shiftSlot: (slot) => (slot % 2 === 0 ? slot + 1 : slot - 1),
        },
        {
          label: "vertical mirror (teammate swap: 0 <-> 2, 1 <-> 3)",
          target: (r, c, h) => [h - 1 - r, c],
          variants: mirrorVerticalVariants,
          shiftSlot: (slot) => (slot + 2) % 4,
        },
      ];
    case "rotate90":
      return [
        {
          label: "90-degree rotation (slots 0 -> 1 -> 2 -> 3)",
          target: (r, c, _h, w) => [c, w - 1 - r],
          variants: rotate90Variants,
          shiftSlot: (slot) => (slot + 1) % 4,
        },
      ];
    case "asymmetric":
      // Nothing is fair by construction here; the parity checks below carry the whole load.
      return [];
  }
};

/* -------------------------------------------------------------------------------------------- */
/* Checks                                                                                       */
/* -------------------------------------------------------------------------------------------- */

type Grid = number[][];

const parseGrid = (tileDataString: string): Grid =>
  tileDataString
    .trim()
    .split("\n")
    .map((line) =>
      line
        .trim()
        .split(",")
        .map((cell) => Number(cell.trim())),
    );

const checkShapeAndCodes = (grid: Grid, errors: string[]) => {
  const width = grid[0].length;

  grid.forEach((row, r) => {
    if (row.length !== width) {
      errors.push(`row ${r} has ${row.length} tiles, expected ${width}`);
    }

    row.forEach((code, c) => {
      if (!Number.isInteger(code)) {
        errors.push(`(${r},${c}) is not a number`);
      } else if (!isKnownCode(code)) {
        errors.push(`(${r},${c}) uses unknown tile code ${code}`);
      }
    });
  });
};

const checkSymmetry = (grid: Grid, symmetry: MapSymmetry, errors: string[]) => {
  const height = grid.length;
  const width = grid[0].length;

  if (symmetry === "rotate90" && height !== width) {
    errors.push(`rotate90 needs a square grid, got ${width}x${height}`);
    return;
  }

  for (const transform of transformsFor(symmetry)) {
    // Report at most a few mismatches per transform: one bad row produces a wall of noise.
    let reported = 0;

    for (let r = 0; r < height; r++) {
      for (let c = 0; c < width; c++) {
        const [tr, tc] = transform.target(r, c, height, width);
        const expected = remapSlot(
          transform.variants.get(grid[r][c]) ?? grid[r][c],
          transform.shiftSlot,
        );
        const actual = grid[tr][tc];

        if (actual !== expected && reported < 5) {
          reported += 1;
          errors.push(
            `${transform.label}: (${r},${c})=${grid[r][c]} implies (${tr},${tc})=${expected}, ` +
              `found ${actual}`,
          );
        }
      }
    }

    if (reported >= 5) {
      errors.push(`${transform.label}: further mismatches suppressed`);
    }
  }
};

type Census = Map<number, Map<PropertyKind, number>>;

const censusOf = (grid: Grid): Census => {
  const census: Census = new Map();

  for (const row of grid) {
    for (const code of row) {
      const property = propertyByCode.get(code);

      if (property === undefined) {
        continue;
      }

      const perSlot = census.get(property.slot) ?? new Map<PropertyKind, number>();
      perSlot.set(property.kind, (perSlot.get(property.kind) ?? 0) + 1);
      census.set(property.slot, perSlot);
    }
  }

  return census;
};

const describeCensus = (perSlot: Map<PropertyKind, number>): string =>
  propertyKinds
    .filter((kind) => (perSlot.get(kind) ?? 0) > 0)
    .map((kind) => `${perSlot.get(kind) ?? 0} ${kind}`)
    .join(", ");

const checkCensus = (grid: Grid, definition: MapDefinition, errors: string[]) => {
  const census = censusOf(grid);
  const slots = [...census.keys()].filter((slot) => slot >= 0).sort((a, b) => a - b);

  if (slots.length !== definition.numberOfPlayers) {
    errors.push(
      `numberOfPlayers is ${definition.numberOfPlayers} but ${slots.length} slots own property ` +
        `(${slots.join(", ")})`,
    );
  }

  const reference = census.get(slots[0]);

  for (const slot of slots) {
    const perSlot = census.get(slot);

    if (perSlot === undefined) {
      continue;
    }

    if ((perSlot.get("hq") ?? 0) !== 1) {
      errors.push(`slot ${slot} owns ${perSlot.get("hq") ?? 0} HQs, expected exactly 1`);
    }

    if (reference !== undefined && describeCensus(perSlot) !== describeCensus(reference)) {
      errors.push(
        `slot ${slot} owns [${describeCensus(perSlot)}] but slot ${slots[0]} owns ` +
          `[${describeCensus(reference)}]`,
      );
    }
  }
};

/** Breadth-first flood over land tiles, returning the step distance to every reachable tile. */
const footDistances = (grid: Grid, from: [number, number]): Map<string, number> => {
  const distances = new Map<string, number>([[`${from[0]},${from[1]}`, 0]]);
  const queue: [number, number][] = [from];

  // Walked with a moving head rather than `shift()`: the queue grows as we go and indexing keeps
  // it typed without an assertion, while preserving FIFO order (so distances stay shortest-first).
  let head = 0;

  while (head < queue.length) {
    const [r, c] = queue[head];
    head += 1;
    const distance = distances.get(`${r},${c}`) ?? 0;

    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = r + dr;
      const nc = c + dc;

      if (nr < 0 || nr >= grid.length || nc < 0 || nc >= grid[0].length) {
        continue;
      }

      if (!isLand(grid[nr][nc]) || distances.has(`${nr},${nc}`)) {
        continue;
      }

      distances.set(`${nr},${nc}`, distance + 1);
      queue.push([nr, nc]);
    }
  }

  return distances;
};

const findHqs = (grid: Grid): Map<number, [number, number]> => {
  const hqs = new Map<number, [number, number]>();

  grid.forEach((row, r) => {
    row.forEach((code, c) => {
      const property = propertyByCode.get(code);

      if (property?.kind === "hq" && property.slot >= 0) {
        hqs.set(property.slot, [r, c]);
      }
    });
  });

  return hqs;
};

const checkConnectivityAndReport = (grid: Grid, errors: string[], notes: string[]) => {
  const hqs = findHqs(grid);

  for (const [slot, hq] of [...hqs].sort((a, b) => a[0] - b[0])) {
    const distances = footDistances(grid, hq);

    for (const [otherSlot, otherHq] of hqs) {
      if (otherSlot !== slot && !distances.has(`${otherHq[0]},${otherHq[1]}`)) {
        errors.push(`slot ${slot}'s HQ cannot reach slot ${otherSlot}'s HQ on foot`);
      }
    }

    let nearestNeutralCity = Infinity;

    grid.forEach((row, r) => {
      row.forEach((code, c) => {
        const property = propertyByCode.get(code);

        if (property?.slot === -1 && property.kind === "city") {
          nearestNeutralCity = Math.min(nearestNeutralCity, distances.get(`${r},${c}`) ?? Infinity);
        }
      });
    });

    notes.push(`slot ${slot}: nearest neutral city ${nearestNeutralCity} steps from HQ`);
  }
};

/* -------------------------------------------------------------------------------------------- */
/* Parity — the fairness guarantees that survive without symmetry                               */
/* -------------------------------------------------------------------------------------------- */

/**
 * These four checks run on EVERY map, not just the asymmetric ones.
 *
 * On a symmetric map they pass trivially (the symmetry is an isometry, so it carries distances and
 * terrain across untouched), which is exactly why running them everywhere costs nothing and leaves
 * the pool with one fairness standard rather than two. On an asymmetric map they are the *only*
 * thing standing between "characterful" and "quietly unwinnable for slot 1".
 *
 * What they deliberately do NOT catch: indirect-unit firing positions, capture-race timing, and
 * other emergent balance. Those need playtesting, not a script — an asymmetric map passing here is
 * plausible, not proven.
 */

/**
 * How many tiles of a given terrain type one player's ground may differ by. Income, production and
 * expansion speed are NOT covered by this slack — those are exact (census + distance parity).
 */
const TERRAIN_TOLERANCE = 2;

/** Distances from one HQ to every tile matching a predicate, sorted so two lists can be compared. */
const sortedDistances = (
  grid: Grid,
  distances: Map<string, number>,
  matches: (code: number) => boolean,
): number[] => {
  const found: number[] = [];

  grid.forEach((row, r) => {
    row.forEach((code, c) => {
      if (matches(code)) {
        // Unreachable stays in the list as Infinity: an island city one player can walk to and the
        // other can't is precisely the asymmetry worth failing on.
        found.push(distances.get(`${r},${c}`) ?? Infinity);
      }
    });
  });

  return found.sort((a, b) => a - b);
};

/**
 * Each land tile belongs to the HQ that reaches it fastest; ties are contested and belong to no
 * one. This is what "each player's half" means on a map with no axis of symmetry to split on.
 */
const voronoiTerrain = (
  grid: Grid,
  slots: number[],
  distanceBySlot: Map<number, Map<string, number>>,
): Map<number, Map<string, number>> => {
  const histograms = new Map<number, Map<string, number>>(slots.map((slot) => [slot, new Map()]));

  grid.forEach((row, r) => {
    row.forEach((code, c) => {
      // Properties are covered by the census; this measures the ground fought over between them.
      if (propertyByCode.has(code)) {
        return;
      }

      let best = Infinity;
      let owner: number | null = null;

      for (const slot of slots) {
        const distance = distanceBySlot.get(slot)?.get(`${r},${c}`) ?? Infinity;

        if (distance < best) {
          best = distance;
          owner = slot;
        } else if (distance === best) {
          owner = null; // contested — counts for nobody
        }
      }

      if (owner === null || best === Infinity) {
        return;
      }

      const histogram = histograms.get(owner);

      if (histogram !== undefined) {
        histogram.set(glyphOf(code), (histogram.get(glyphOf(code)) ?? 0) + 1);
      }
    });
  });

  return histograms;
};

const describeList = (values: number[]): string =>
  `[${values.map((v) => (v === Infinity ? "unreachable" : v)).join(", ")}]`;

const describeHistogram = (histogram: Map<string, number>): string =>
  [...histogram.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([glyph, count]) => `${glyph}:${count}`)
    .join(" ");

const checkParity = (grid: Grid, errors: string[]) => {
  const hqs = findHqs(grid);
  const slots = [...hqs.keys()].sort((a, b) => a - b);

  if (slots.length < 2) {
    return;
  }

  const distanceBySlot = new Map(slots.map((slot) => [slot, footDistances(grid, hqs.get(slot)!)]));

  // 1 & 2. Distance parity: to a player's own properties, and to every neutral property kind.
  //    Equal counts (the census) are not enough — a base you reach three turns later is not the
  //    same base, and neutral-city distance is what sets expansion speed.
  // 4. Contested-objective parity falls out of the same measurement: labs, comm towers and silos
  //    are neutral properties, so "same sorted distance list" means nobody is closer to a prize.
  const metrics: { label: string; matches: (slot: number) => (code: number) => boolean }[] = [
    {
      label: "own properties",
      matches: (slot) => (code) => propertyByCode.get(code)?.slot === slot,
    },
    ...propertyKinds.map((kind) => ({
      label: `neutral ${kind}s`,
      matches: () => (code: number) => {
        const property = propertyByCode.get(code);
        return property?.slot === -1 && property.kind === kind;
      },
    })),
    {
      label: "neutral labs, towers and silos",
      matches: () => (code: number) => code === 145 || code === 133 || code === 111,
    },
  ];

  for (const metric of metrics) {
    const reference = sortedDistances(
      grid,
      distanceBySlot.get(slots[0])!,
      metric.matches(slots[0]),
    );

    for (const slot of slots.slice(1)) {
      const actual = sortedDistances(grid, distanceBySlot.get(slot)!, metric.matches(slot));

      if (describeList(actual) !== describeList(reference)) {
        errors.push(
          `distance parity (${metric.label}): slot ${slot} sees ${describeList(actual)} but ` +
            `slot ${slots[0]} sees ${describeList(reference)}`,
        );
      }
    }
  }

  // 3. Terrain-mix parity: same amount of cover and movement friction on each player's ground,
  //    even when it is arranged into completely different shapes.
  //
  //    Checked to a tolerance rather than exactly. Voronoi regions are drawn by a distance race
  //    between HQs, so moving a single tile can hand a whole strip of ground from one player to the
  //    other and swing several counts at once. Demanding tile-for-tile equality would make an
  //    asymmetric map nearly unauthorable while adding little: two forests either way is noise
  //    against a 200-tile map, whereas the things that actually decide a game — income, production
  //    and expansion speed — stay exact via the census and distance checks above.
  const histograms = voronoiTerrain(grid, slots, distanceBySlot);
  const referenceTerrain = histograms.get(slots[0]);

  for (const slot of slots.slice(1)) {
    const actual = histograms.get(slot);

    if (actual === undefined || referenceTerrain === undefined) {
      continue;
    }

    for (const glyph of new Set([...actual.keys(), ...referenceTerrain.keys()])) {
      const drift = Math.abs((actual.get(glyph) ?? 0) - (referenceTerrain.get(glyph) ?? 0));

      if (drift > TERRAIN_TOLERANCE) {
        errors.push(
          `terrain parity: "${glyph}" differs by ${drift} (tolerance ${TERRAIN_TOLERANCE}) — ` +
            `slot ${slot} [${describeHistogram(actual)}] vs ` +
            `slot ${slots[0]} [${describeHistogram(referenceTerrain)}]`,
        );
      }
    }
  }
};

/* -------------------------------------------------------------------------------------------- */
/* Vehicle access, naval sanity, asymmetry and flanks                                           */
/* -------------------------------------------------------------------------------------------- */

/**
 * Treads cannot cross mountains, rivers or water; feet can. Measuring only foot distance therefore
 * proves nothing about armour, and on an asymmetric map that gap is exactly where unfairness hides:
 * one player detours to a bridge while the other drives straight in, and the foot lists still match.
 */
const treadPassable = (code: number): boolean => {
  if (propertyByCode.has(code)) {
    return true;
  }

  if (code === 2 || (code >= 4 && code <= 14)) {
    return false; // mountain, river
  }

  return terrainCodes.get(code)?.land ?? false;
};

const treadDistances = (grid: Grid, from: [number, number]): Map<string, number> => {
  const distances = new Map<string, number>([[`${from[0]},${from[1]}`, 0]]);
  const queue: [number, number][] = [from];
  let head = 0;

  while (head < queue.length) {
    const [r, c] = queue[head];
    head += 1;
    const distance = distances.get(`${r},${c}`) ?? 0;

    for (const [dr, dc] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const nr = r + dr;
      const nc = c + dc;

      if (nr < 0 || nr >= grid.length || nc < 0 || nc >= grid[0].length) {
        continue;
      }

      if (!treadPassable(grid[nr][nc]) || distances.has(`${nr},${nc}`)) {
        continue;
      }

      distances.set(`${nr},${nc}`, distance + 1);
      queue.push([nr, nc]);
    }
  }

  return distances;
};

const checkTreadParity = (grid: Grid, errors: string[]) => {
  const hqs = findHqs(grid);
  const slots = [...hqs.keys()].sort((a, b) => a - b);

  if (slots.length < 2) {
    return;
  }

  const bySlot = new Map(slots.map((s) => [s, treadDistances(grid, hqs.get(s)!)]));

  const metrics: { label: string; matches: (code: number) => boolean }[] = [
    {
      label: "neutral cities",
      matches: (c) => propertyByCode.get(c)?.slot === -1 && propertyByCode.get(c)?.kind === "city",
    },
    { label: "contested objectives", matches: (c) => c === 145 || c === 133 || c === 111 },
  ];

  for (const metric of metrics) {
    const reference = sortedDistances(grid, bySlot.get(slots[0])!, metric.matches);

    for (const slot of slots.slice(1)) {
      const actual = sortedDistances(grid, bySlot.get(slot)!, metric.matches);

      if (describeList(actual) !== describeList(reference)) {
        errors.push(
          `vehicle parity (${metric.label}): slot ${slot} ${describeList(actual)} vs ` +
            `slot ${slots[0]} ${describeList(reference)}`,
        );
      }
    }
  }
};

/**
 * A port and some sea are not a naval map. `getUnloadablePositions` requires the TRANSPORT to sit
 * on a tile the cargo could also stand on, so a Lander unloads only from a shoal or a port — with
 * no shoals, an amphibious landing on hostile coast is impossible and the concept is a lie.
 */
const checkNaval = (grid: Grid, errors: string[]) => {
  const codes = grid.flat();
  const ports = codes.filter((c) => propertyByCode.get(c)?.kind === "port").length;
  const sea = codes.filter((c) => c === 28).length;
  const shoals = codes.filter((c) => c >= 29 && c <= 32).length;

  if (ports > 0 && sea > 0 && shoals === 0) {
    errors.push(
      `naval: ${ports} ports and ${sea} sea tiles but no shoals — a Lander can only unload from a ` +
        `shoal or a port, so no landing on hostile coast is possible`,
    );
  }
};

/** Minimum share of tiles that must differ under the category's natural symmetry. */
const ASYMMETRY_FLOOR = 40;

/** How many steps a `balanced` map's two flanks may differ by on the route to the centre. */
const BALANCED_ROUTE_SKEW = 2;

/**
 * A map declaring `asymmetric` must actually be asymmetric. Keeping property positions on the
 * symmetric orbit and varying only terrain satisfies every parity check while producing a map that
 * reads as a mirror — this measures the difference instead of trusting the label.
 */
const checkAsymmetryDegree = (grid: Grid, definition: MapDefinition, errors: string[]) => {
  if (definition.symmetry !== "asymmetric") {
    return;
  }

  const h = grid.length;
  const w = grid[0].length;

  const image = (r: number, c: number): [number, number] =>
    definition.category === "1v1"
      ? [h - 1 - r, w - 1 - c]
      : definition.category === "ffa" && h === w
        ? [c, w - 1 - r]
        : [r, w - 1 - c];

  let differ = 0;
  let total = 0;

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const [ir, ic] = image(r, c);

      if (ir < 0 || ir >= h || ic < 0 || ic >= w) {
        continue;
      }

      total += 1;

      if (glyphOf(grid[r][c]) !== glyphOf(grid[ir][ic])) {
        differ += 1;
      }
    }
  }

  const pct = total ? Math.round((differ / total) * 100) : 0;

  if (pct < ASYMMETRY_FLOOR) {
    errors.push(
      `asymmetry: only ${pct}% of tiles differ under the ${definition.category} symmetry ` +
        `(floor ${ASYMMETRY_FLOOR}%) — this is a symmetric map wearing an asymmetric label`,
    );
  }
};

/** Production buildings — the things that actually make units. Cities and HQs are not producers. */
const isProducer = (code: number): boolean => {
  const kind = propertyByCode.get(code)?.kind;
  return kind === "base" || kind === "airport" || kind === "port";
};

/**
 * The required strong/weak gap, bounded by what the map can express: a player with three producers
 * cannot show a three-building split, and three steps is decisive on a small map but invisible on
 * a large one. So producer count sets the production gap and map size sets the distance gap.
 */
const flankTiers = (producers: number, width: number, height: number) => ({
  production: producers >= 5 ? 3 : producers >= 4 ? 2 : 1,
  steps: (width + height) / 2 >= 20 ? 4 : (width + height) / 2 >= 17 ? 3 : 2,
});

/**
 * Splits a player's producers by which side of the HQ-to-centre axis they sit on, and reports the
 * production count and best route to the centre for each flank.
 */
const flankProfile = (grid: Grid, hq: [number, number], slot: number) => {
  const h = grid.length;
  const w = grid[0].length;
  const centre: [number, number] = [(h - 1) / 2, (w - 1) / 2];
  const axis = [centre[0] - hq[0], centre[1] - hq[1]];
  const tread = treadDistances(grid, hq);
  const toCentre = treadDistances(grid, [Math.round(centre[0]), Math.round(centre[1])]);

  const sides: { count: number; best: number }[] = [
    { count: 0, best: Infinity },
    { count: 0, best: Infinity },
  ];

  grid.forEach((row, r) => {
    row.forEach((code, c) => {
      if (!isProducer(code) || propertyByCode.get(code)?.slot !== slot) {
        return;
      }

      // Cross product of the HQ->centre axis with HQ->producer decides the flank.
      const cross = axis[0] * (c - hq[1]) - axis[1] * (r - hq[0]);

      if (cross === 0) {
        return;
      } // sits on the axis; belongs to neither flank

      const side = cross > 0 ? 0 : 1;
      sides[side].count += 1;
      sides[side].best = Math.min(sides[side].best, toCentre.get(`${r},${c}`) ?? Infinity);
    });
  });

  return { sides, reachable: tread.size };
};

const checkFlanks = (grid: Grid, definition: MapDefinition, errors: string[], notes: string[]) => {
  const declared = flanksOf(definition);
  const hqs = findHqs(grid);
  const slots = [...hqs.keys()].sort((a, b) => a - b);
  const w = grid[0].length;
  const h = grid.length;

  for (const slot of slots) {
    const { sides } = flankProfile(grid, hqs.get(slot)!, slot);
    const producers = sides[0].count + sides[1].count;
    const strong = sides[0].count >= sides[1].count ? sides[0] : sides[1];
    const weak = strong === sides[0] ? sides[1] : sides[0];
    const productionGap = strong.count - weak.count;
    const stepGap = weak.best - strong.best;

    // Every slot is reported: on an asymmetric map slot 0's profile says nothing about slot 2's.
    notes.push(
      `flanks (${declared}) slot ${slot}: strong ${strong.count} @${strong.best} to centre, ` +
        `weak ${weak.count} @${weak.best === Infinity ? "-" : weak.best}`,
    );

    if (declared === "balanced") {
      if (productionGap > 1) {
        errors.push(
          `flanks: declared balanced but slot ${slot}'s flanks differ by ${productionGap} producers`,
        );
      }

      // Balanced means neither flank is the obvious one. Equal building counts with one flank far
      // closer to the centre is still a strong side — just expressed through routes, not buildings.
      const routeSkew = Math.abs(stepGap);

      if (Number.isFinite(routeSkew) && routeSkew > BALANCED_ROUTE_SKEW) {
        errors.push(
          `flanks: declared balanced but slot ${slot}'s flanks differ by ${routeSkew} steps to ` +
            `the centre (max ${BALANCED_ROUTE_SKEW}) — that is a strong side by route`,
        );
      }

      continue;
    }

    const tier = flankTiers(producers, w, h);

    if (producers <= 2) {
      errors.push(
        `flanks: declared sided but slot ${slot} has only ${producers} producers off-axis — ` +
          `too few to express a strong and a weak side`,
      );
      continue;
    }

    if (productionGap < tier.production) {
      errors.push(
        `flanks: slot ${slot} production gap is ${productionGap}, needs ${tier.production} ` +
          `(${producers} producers)`,
      );
    }

    // An EMPTY weak flank is not a strong/weak split — it is all production in one place, which is
    // the clustering this check exists to stop, merely pushed off-axis. A weak flank must be a real
    // second front you can lose ground on, so it needs at least one producer of its own.
    if (weak.count === 0) {
      errors.push(
        `flanks: slot ${slot} has all ${producers} producers on one flank and none on the other — ` +
          `that is clustered production, not a strong and a weak side`,
      );
      continue;
    }

    // The strong side must ALSO be the faster one — more buildings behind a slower route is a trap.
    if (!Number.isFinite(stepGap) || stepGap < tier.steps) {
      errors.push(
        `flanks: slot ${slot}'s stronger flank reaches the centre only ` +
          `${Number.isFinite(stepGap) ? stepGap : "?"} steps sooner, needs ${tier.steps}`,
      );
    }
  }
};

/* -------------------------------------------------------------------------------------------- */
/* Entry point                                                                                  */
/* -------------------------------------------------------------------------------------------- */

const checkMap = (definition: MapDefinition): { errors: string[]; notes: string[] } => {
  const errors: string[] = [];
  const notes: string[] = [];
  const grid = parseGrid(definition.tileDataString);

  checkShapeAndCodes(grid, errors);

  // Every later check indexes the grid freely, so a malformed one has to stop here.
  if (errors.length > 0) {
    return { errors, notes };
  }

  notes.push(`${grid[0].length}x${grid.length}, ${definition.symmetry}`);
  checkSymmetry(grid, definition.symmetry, errors);
  checkCensus(grid, definition, errors);
  checkConnectivityAndReport(grid, errors, notes);
  checkParity(grid, errors);
  checkTreadParity(grid, errors);
  checkNaval(grid, errors);
  checkAsymmetryDegree(grid, definition, errors);
  checkFlanks(grid, definition, errors, notes);

  return { errors, notes };
};

/**
 * ASCII rendering, behind `--render`. Reviewing a pool this size as raw CSV is not realistic;
 * seeing the shape is how a concept ("two bridges are the only crossings") gets judged.
 */
const neutralGlyphs: Record<PropertyKind, string> = {
  hq: "h",
  base: "b",
  airport: "a",
  port: "p",
  city: "c",
};

/** First matching range wins; anything unmatched renders as plain. */
const terrainGlyphs: { from: number; to: number; glyph: string }[] = [
  { from: 2, to: 2, glyph: "^" }, // mountain
  { from: 3, to: 3, glyph: "*" }, // forest
  { from: 4, to: 14, glyph: "~" }, // river
  { from: 15, to: 25, glyph: "=" }, // road
  { from: 26, to: 27, glyph: "#" }, // bridge
  { from: 28, to: 28, glyph: " " }, // sea
  { from: 29, to: 32, glyph: "," }, // shoal
  { from: 33, to: 33, glyph: " " }, // reef
  { from: 101, to: 110, glyph: "O" }, // pipe
  { from: 111, to: 112, glyph: "!" }, // silo
  { from: 113, to: 114, glyph: "X" }, // pipe seam
  { from: 133, to: 133, glyph: "T" }, // neutral comm tower
  { from: 145, to: 145, glyph: "L" }, // neutral lab
];

const glyphOf = (code: number): string => {
  const property = propertyByCode.get(code);

  // Owned properties never reach here — `render` prints their slot digit instead.
  if (property !== undefined) {
    return neutralGlyphs[property.kind];
  }

  return terrainGlyphs.find(({ from, to }) => code >= from && code <= to)?.glyph ?? ".";
};

const render = (grid: Grid): string =>
  grid
    .map((row) =>
      row
        .map((code) => {
          const property = propertyByCode.get(code);

          // Owned properties render as the slot digit so ownership reads at a glance.
          return property !== undefined && property.slot >= 0
            ? String(property.slot)
            : glyphOf(code);
        })
        .join(" "),
    )
    .join("\n");

/**
 * `--file <path>` checks only the maps exported by that module, instead of the whole pool.
 *
 * This is what lets several authors work at once: each writes its own batch file under
 * `maps/` and verifies it in isolation, with nothing shared to collide over. The module must
 * export an array as `maps` or `mapDefinitions`.
 */
const loadFromFiles = async (paths: string[]): Promise<MapDefinition[]> => {
  const loaded: MapDefinition[] = [];

  for (const path of paths) {
    const batchModule = (await import(pathToFileURL(resolve(path)).href)) as {
      maps?: MapDefinition[];
      mapDefinitions?: MapDefinition[];
    };
    const batch = batchModule.maps ?? batchModule.mapDefinitions;

    if (batch === undefined) {
      throw new Error(`${path} exports neither "maps" nor "mapDefinitions"`);
    }

    loaded.push(...batch);
  }

  return loaded;
};

const filesFromArgv = (): string[] =>
  process.argv.reduce<string[]>(
    (paths, arg, index) =>
      arg === "--file" && process.argv[index + 1] !== undefined
        ? [...paths, process.argv[index + 1]]
        : paths,
    [],
  );

const main = async () => {
  let failed = 0;
  const shouldRender = process.argv.includes("--render");
  const files = filesFromArgv();
  const definitions = files.length > 0 ? await loadFromFiles(files) : mapDefinitions;

  if (definitions.length === 0) {
    console.error("No maps to check.");
    process.exit(1);
  }

  for (const definition of definitions) {
    const { errors, notes } = checkMap(definition);
    const status = errors.length === 0 ? "OK  " : "FAIL";

    console.info(`${status} ${definition.name} [${definition.category}]`);

    for (const note of notes) {
      console.info(`       ${note}`);
    }

    if (shouldRender && errors.length === 0) {
      console.info(`       ${definition.concept}\n`);
      console.info(render(parseGrid(definition.tileDataString)));
      console.info("");
    }

    for (const error of errors) {
      console.error(`       ${error}`);
    }

    if (errors.length > 0) {
      failed += 1;
    }
  }

  console.info(`\n${definitions.length - failed}/${definitions.length} maps pass.`);

  if (failed > 0) {
    process.exit(1);
  }
};

void main();
