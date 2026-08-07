/**
 * FE-local shapes for the map builder.
 *
 * Redeclared structurally rather than inferred from the router, per `src/frontend/CLAUDE.md`: the
 * server re-validates every input regardless of what these claim, so drift shows up as a tsc error
 * at the `mutate` call site instead of silently at runtime.
 */

/** One line of the certification ladder. `id` is stable; the label is free to be reworded. */
export type FairnessCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  /** Tiles this finding points at, so clicking the line can highlight them on the grid. */
  tiles: [number, number][];
};

export type MapFairnessReport = {
  seats: number[];
  playable: FairnessCheck[];
  fairness: FairnessCheck[];
  isPlayable: boolean;
  isFair: boolean;
};

/**
 * One tile as the builder holds it. Deliberately loose: the server re-parses the whole grid with
 * `tileSchema` on every save, so a stricter mirror of that union here would buy nothing but a large
 * duplicated type to keep in sync.
 */
export type BuilderTile = {
  type: string;
  /** Present only on property tiles. -1 is neutral. */
  playerSlot?: number;
  /** Connection variant for road/river/bridge/pipe, and "normal" for plain. */
  variant?: string;
  hp?: number;
};

/** The editable body of a map — what an autosave sends. */
export type DraftMap = {
  name: string;
  tiles: BuilderTile[][];
  predeployedUnits: unknown[];
};

/**
 * The game vocabulary the builder works from, as `map.vocabulary` serves it.
 *
 * None of this is declared here. The terrain roster, the property roster, the tile connection
 * table and the shape of a blank cell all used to be hardcoded in this file — a second copy of
 * game knowledge sitting where it could drift from the engine. The frontend is not allowed to
 * embed game constants, so it asks for them.
 */
export type TerrainFacts = {
  type: string;
  /** Empty when the tile has one fixed look; non-empty means its art follows its neighbours. */
  connectsTo: string[];
  singleAxis: boolean;
  /** Every variant the server's schema accepts for this tile. The direction picker offers these. */
  variants: string[];
  defenseStars: number;
};

export type PlaceableUnitFacts = {
  type: string;
  movementType: string;
  displayName: string;
  cost: number;
  movementPoints: number;
  vision: number;
  facility: string;
  /** Tiles this unit may be predeployed on, resolved server-side from the engine's own table. */
  standableOn: string[];
};

export type MirrorImage = {
  transform: "rotate180" | "flip-horizontal" | "flip-vertical" | "rotate90" | "rotate270";
  /** Seat permutation, served: a red base mirrored must become a blue one. */
  slotMap: number[];
};

export type MirrorMode = {
  id: string;
  label: string;
  hint: string;
  seats: number | null;
  squareOnly: boolean;
  images: MirrorImage[];
};

export type MapVocabulary = {
  armyBySlot: string[];
  blankTile: BuilderTile;
  terrain: TerrainFacts[];
  properties: string[];
  units: PlaceableUnitFacts[];
  size: { min: number; max: number };
  mirrors: MirrorMode[];
  resizeAnchors: string[];
};

/**
 * Where a mirrored stroke lands, and which way its art faces.
 *
 * Pure geometry over a grid — the client is allowed to do this. What it is NOT allowed to decide is
 * which seat the mirrored tile belongs to, which is why `slotMap` arrives from the server.
 */
export const mirrorImage = (
  transform: MirrorImage["transform"],
  x: number,
  y: number,
  width: number,
  height: number,
): [number, number] => {
  switch (transform) {
    case "rotate180":
      return [width - 1 - x, height - 1 - y];
    case "flip-horizontal":
      return [width - 1 - x, y];
    case "flip-vertical":
      return [x, height - 1 - y];
    case "rotate90":
      return [width - 1 - y, x];
    case "rotate270":
      return [y, height - 1 - x];
  }
};

/** How a direction name travels under the same transform, for tiles whose art has a facing. */
const DIRECTION_UNDER: Record<MirrorImage["transform"], Record<string, string>> = {
  rotate180: { top: "bottom", bottom: "top", left: "right", right: "left" },
  "flip-horizontal": { left: "right", right: "left" },
  "flip-vertical": { top: "bottom", bottom: "top" },
  rotate90: { top: "right", right: "bottom", bottom: "left", left: "top" },
  rotate270: { top: "left", left: "bottom", bottom: "right", right: "top" },
};

const DIRECTION_ORDER = ["top", "right", "bottom", "left"];

/** A `top-right` road mirrored 180 degrees is a `bottom-left` one, not another `top-right`. */
export const mirrorVariant = (
  variant: string | undefined,
  transform: MirrorImage["transform"],
): string | undefined => {
  if (variant === undefined) {
    return undefined;
  }

  const table = DIRECTION_UNDER[transform];
  const moved = variant.split("-").map((direction) => table[direction] ?? direction);
  const reordered = DIRECTION_ORDER.filter((direction) => moved.includes(direction));

  // A variant that is not a set of directions (`normal`, say) travels unchanged.
  return reordered.length === 0 ? variant : reordered.join("-");
};

/** Atlas frame names list directions in this order. */
const DIRECTIONS = ["top", "right", "bottom", "left"] as const;

/**
 * Pick a connection variant from what the tile touches — which atlas frame a road draws, nothing
 * about play. The adjacency table is the SERVER's (`vocabulary.connectsTo`); this only walks it.
 *
 * Single-axis tiles never take a corner, and roads and rivers have no one-connection art, so a stub
 * falls back to the axis it points down.
 */
export const resolveVariant = (
  tiles: BuilderTile[][],
  x: number,
  y: number,
  vocabulary: MapVocabulary,
): string | undefined => {
  const tile = tiles[y][x];
  const facts = vocabulary.terrain.find((entry) => entry.type === tile.type);

  if (facts === undefined || facts.connectsTo.length === 0) {
    // A tile with no neighbour-dependent art keeps whatever fixed variant the server gave it.
    return tile.type === vocabulary.blankTile.type ? vocabulary.blankTile.variant : undefined;
  }

  const joins = (nx: number, ny: number) =>
    tiles[ny]?.[nx] !== undefined && facts.connectsTo.includes(tiles[ny][nx].type);

  const touching = DIRECTIONS.filter((direction) => {
    switch (direction) {
      case "top":
        return joins(x, y - 1);
      case "right":
        return joins(x + 1, y);
      case "bottom":
        return joins(x, y + 1);
      case "left":
        return joins(x - 1, y);
    }
  });

  const vertical = touching.includes("top") || touching.includes("bottom");
  const horizontal = touching.includes("right") || touching.includes("left");

  if (facts.singleAxis) {
    return bestVariant(
      facts.variants,
      vertical && !horizontal ? ["top", "bottom"] : ["right", "left"],
    );
  }

  return bestVariant(facts.variants, touching);
};

/**
 * The legal variant that best matches what a tile actually touches.
 *
 * Chosen from the server's list rather than composed from the directions, because not every tile
 * has art for every combination: a pipe has one- and two-way pieces and NOTHING for three or four.
 * Composing `top-right-bottom-left` for a pipe named a frame that does not exist, so the tile drew
 * as nothing — a filled area came out as a black hole — and the server would have rejected the save
 * too. Scoring against the real list cannot produce a variant that does not exist.
 *
 * Best means: covers the most directions the tile touches, then differs least from them overall.
 */
const bestVariant = (variants: string[], touching: string[]): string | undefined => {
  if (variants.length === 0) {
    return undefined;
  }

  const wanted = new Set(touching);

  const score = (variant: string) => {
    const directions = variant.split("-");
    const covered = directions.filter((direction) => wanted.has(direction)).length;
    const spurious = directions.length - covered;
    const missed = wanted.size - covered;

    return { covered, difference: spurious + missed };
  };

  return [...variants].sort((a, b) => {
    const left = score(a);
    const right = score(b);

    if (left.covered !== right.covered) {
      return right.covered - left.covered;
    }

    if (left.difference !== right.difference) {
      return left.difference - right.difference;
    }

    // Nothing to go on: prefer a straight run, which reads as a piece of road rather than a stub.
    return fallbackRank(a) - fallbackRank(b);
  })[0];
};

/** Tie-break order when a tile touches nothing. */
const PREFERRED_FALLBACKS = ["right-left", "top-bottom"];

/**
 * Position in the fallback order, with anything unlisted sorted last.
 *
 * Not `indexOf` alone: that returns -1 for an unlisted variant, which sorts it BEFORE the preferred
 * ones — the exact opposite of the intent, and it made a lone road come out as a corner.
 */
const fallbackRank = (variant: string) => {
  const rank = PREFERRED_FALLBACKS.indexOf(variant);

  return rank === -1 ? PREFERRED_FALLBACKS.length : rank;
};

/**
 * Re-resolves a painted tile and its four neighbours, which the stroke may have just changed.
 *
 * `pinned` holds coordinates whose facing the author chose by hand. Those are left exactly as they
 * are — an explicit direction outranks anything the neighbours imply, or picking one would be
 * undone by the next stroke beside it.
 */
export const reflowVariants = (
  tiles: BuilderTile[][],
  x: number,
  y: number,
  vocabulary: MapVocabulary,
  pinned: ReadonlySet<string> = new Set(),
) => {
  for (const [dx, dy] of [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const nx = x + dx;
    const ny = y + dy;

    if (tiles[ny]?.[nx] === undefined || pinned.has(`${nx},${ny}`)) {
      continue;
    }

    const variant = resolveVariant(tiles, nx, ny, vocabulary);
    const tile = tiles[ny][nx];

    if (variant === undefined) {
      delete tile.variant;
    } else {
      tile.variant = variant;
    }
  }
};

/**
 * What the save indicator shows. Modelled as a union rather than booleans so "saving" and "failed"
 * cannot both be true, and so a failure always carries its reason.
 */
export type SaveState =
  | { kind: "saved"; at: Date }
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "failed"; message: string };

export const describeSaveState = (state: SaveState): string => {
  switch (state.kind) {
    case "saved":
      return "Saved";
    case "dirty":
      return "Unsaved changes";
    case "saving":
      return "Saving…";
    case "failed":
      return state.message;
  }
};

/**
 * The contiguous run of same-typed tiles reachable from a square, four-way.
 *
 * Matches on type alone: filling a lake should take every sea tile in it regardless of which
 * connection variant each one happens to be drawn with. Diagonals do not connect, so two regions
 * touching only at a corner stay separate — which is what a person means by "this lake".
 */
export const floodRegion = (tiles: BuilderTile[][], x: number, y: number): [number, number][] => {
  const seed = tiles[y]?.[x]?.type;

  if (seed === undefined) {
    return [];
  }

  const key = (cx: number, cy: number) => `${cx},${cy}`;
  const seen = new Set([key(x, y)]);
  const region: [number, number][] = [];
  const queue: [number, number][] = [[x, y]];

  // for-of over a queue that grows as we go: the array iterator re-reads length each step.
  for (const [cx, cy] of queue) {
    region.push([cx, cy]);

    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = cx + dx;
      const ny = cy + dy;

      if (tiles[ny]?.[nx] === undefined || seen.has(key(nx, ny))) {
        continue;
      }

      if (tiles[ny][nx].type !== seed) {
        continue;
      }

      seen.add(key(nx, ny));
      queue.push([nx, ny]);
    }
  }

  return region;
};
