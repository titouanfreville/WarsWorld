import type { z } from "zod";
import { armySchema } from "server/core/schemas/army";
import { variableTileSchema } from "server/core/schemas/variable-tiles";
import type { TileType } from "server/core/schemas/tile";
import { propertyTileSchema } from "server/core/schemas/tile";
import type { MovementType } from "server/engine/constants/unit-properties";

/**
 * Which faction a seat is drawn in. Taken from `armySchema` in the order it declares, so adding a
 * faction never needs a second list edited here — and never a third one edited in the client.
 *
 * A map has four seats at most, which is what bounds this.
 */
export const ARMY_BY_SLOT: string[] = armySchema.options.slice(0, 4);

/**
 * Everything the map builder needs to know about the game, assembled server-side.
 *
 * The client holds none of this. It used to hold the terrain list, the property list, which tiles
 * join to which, and what a blank cell looks like — all of it a second copy of game knowledge that
 * would drift the moment a tile or unit was added. Per `src/frontend/CLAUDE.md` the frontend does
 * not embed game constants, so the builder asks for its whole vocabulary instead.
 */

/** Ownable tiles, straight off the schema rather than a hand-written list. */
export const PROPERTY_TILE_TYPES = propertyTileSchema.shape.type.options;

/**
 * Which tiles a connecting tile draws itself joined to.
 *
 * Adjacency, not rules — it decides which atlas frame a road picks, nothing about play. It lives
 * here rather than in the engine because it is a fact about how MAPS are drawn, and here rather
 * than in the client because the client must not hold a second copy of it.
 */
const CONNECTS_TO: Partial<Record<TileType, TileType[]>> = {
  road: ["road", "bridge", ...PROPERTY_TILE_TYPES],
  bridge: ["road", "bridge", ...PROPERTY_TILE_TYPES],
  river: ["river", "bridge"],
  pipe: ["pipe", "pipeSeam"],
  pipeSeam: ["pipe", "pipeSeam"],
};

/**
 * Tiles that run along a single axis only, so they never take a corner or a tee. The builder needs
 * this to pick a fallback variant; deriving it from `CONNECTS_TO` is not possible — a bridge
 * connects in four directions but only ever draws two.
 */
const SINGLE_AXIS: TileType[] = ["bridge", "pipeSeam"];

/**
 * Every `variant` a tile type accepts, read out of the schema that validates it.
 *
 * Enumerated rather than listed by hand: `variableTileSchema` is what decides whether a variant is
 * legal, so anything written here separately would be a second opinion — and the builder's
 * direction picker would eventually offer a variant the server rejects.
 */
const enumerateVariants = (schema: z.ZodTypeAny): string[] => {
  const def = schema._def as {
    typeName: string;
    options?: z.ZodTypeAny[];
    values?: string[];
    value?: string;
  };

  switch (def.typeName) {
    case "ZodUnion":
      return (def.options ?? []).flatMap(enumerateVariants);
    case "ZodEnum":
      return def.values ?? [];
    case "ZodLiteral":
      return def.value === undefined ? [] : [def.value];
    default:
      return [];
  }
};

const VARIANTS_BY_TILE = new Map<string, string[]>(
  variableTileSchema.options.map((option) => [
    option.shape.type.value,
    [...new Set(enumerateVariants(option.shape.variant))],
  ]),
);

export const variantsFor = (tile: TileType): string[] => VARIANTS_BY_TILE.get(tile) ?? [];

export type TerrainFacts = {
  type: TileType;
  /** Empty when the tile has one fixed look. Non-empty means its art depends on its neighbours. */
  connectsTo: TileType[];
  /** True when the tile only ever draws along one axis. */
  singleAxis: boolean;
  /**
   * Every variant the schema accepts for this tile, so the direction picker can only ever offer
   * something the server would take.
   */
  variants: string[];
  defenseStars: number;
};

export type PlaceableUnitFacts = {
  type: string;
  movementType: MovementType;
  displayName: string;
  cost: number;
  movementPoints: number;
  vision: number;
  facility: string;
  /** Every tile this unit could be predeployed on, so the builder can preview legality. */
  standableOn: TileType[];
};

/**
 * How a mirrored stroke's coordinate is transformed. Pure geometry, which is why the client is
 * allowed to perform it — what is NOT geometry is which seat the mirrored tile ends up belonging
 * to, so that travels as data in `slotMap`.
 */
export type MirrorTransform =
  | "rotate180"
  | "flip-horizontal"
  | "flip-vertical"
  | "rotate90"
  | "rotate270";

export type MirrorImage = {
  transform: MirrorTransform;
  /** Seat permutation: a red base mirrored must become a BLUE base, not a second red one. */
  slotMap: number[];
};

export type MirrorMode = {
  id: string;
  label: string;
  hint: string;
  /** Seats the arrangement is designed for; null when it imposes none. */
  seats: number | null;
  squareOnly: boolean;
  /** The extra tiles each stroke paints. Empty means the brush paints one tile. */
  images: MirrorImage[];
};

/**
 * Mirror modes for the builder's brush.
 *
 * An authoring convenience, not a property of the map — nothing here is stored, and a map's actual
 * symmetry is measured off the grid rather than declared. Served because the seat permutations are
 * game data, and a copy of them in the client is exactly the kind of drift we just removed.
 */
export const MIRROR_MODES: MirrorMode[] = [
  {
    id: "none",
    label: "Off",
    hint: "Every stroke lands on one tile.",
    seats: null,
    squareOnly: false,
    images: [],
  },
  {
    id: "rotate180",
    label: "Rotational, 180°",
    hint: "Paints the opposite corner too, and hands it to the other seat. The duel symmetry.",
    seats: 2,
    squareOnly: false,
    images: [{ transform: "rotate180", slotMap: [1, 0, 3, 2] }],
  },
  {
    id: "mirrorBoth",
    label: "Mirrored on both axes",
    hint: "Paints all four quadrants. The horizontal pair are opponents, the vertical pair teammates.",
    seats: 4,
    squareOnly: false,
    images: [
      { transform: "flip-horizontal", slotMap: [1, 0, 3, 2] },
      { transform: "flip-vertical", slotMap: [2, 3, 0, 1] },
      { transform: "rotate180", slotMap: [3, 2, 1, 0] },
    ],
  },
  {
    id: "rotate90",
    label: "Rotational, 90°",
    hint: "Four quadrants a quarter-turn apart — the only arrangement where nobody is anyone's near neighbour.",
    seats: 4,
    squareOnly: true,
    images: [
      { transform: "rotate90", slotMap: [1, 2, 3, 0] },
      { transform: "rotate180", slotMap: [2, 3, 0, 1] },
      { transform: "rotate270", slotMap: [3, 0, 1, 2] },
    ],
  },
];

export type MapVocabulary = {
  /** Slot index to faction. Decides which atlas a property or unit is drawn from. */
  armyBySlot: string[];
  /** What a fresh cell is. Sent rather than assumed — `plain` requires a variant the client shouldn't know. */
  blankTile: { type: TileType; variant: string };
  terrain: TerrainFacts[];
  properties: TileType[];
  units: PlaceableUnitFacts[];
  /** Bounds a map may be built at, so the size picker cannot offer one the server would refuse. */
  size: { min: number; max: number };
  /** Brush mirror modes, with their seat permutations. */
  mirrors: MirrorMode[];
  /** Where a resized map may be anchored inside its new frame. */
  resizeAnchors: string[];
};

export const connectionsFor = (tile: TileType): TileType[] => CONNECTS_TO[tile] ?? [];

export const isSingleAxis = (tile: TileType): boolean => SINGLE_AXIS.includes(tile);
