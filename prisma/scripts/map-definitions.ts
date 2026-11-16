/**
 * The test map pool.
 *
 * Maps are authored as AWBW-style numeric CSV, the one format `importAWBWMap` understands
 * (see `src/server/tools/map-importer-utilities.ts` for the code -> tile table).
 *
 * Every map is built on an exact symmetry so fairness is structural rather than eyeballed:
 * each player's half/quadrant is the image of every other one under that symmetry, which makes
 * property counts, terrain mix and distances identical by construction.
 * `npm run maps:check` verifies that the symmetry really holds — including tile *variants*
 * (a `top-right` road must become `bottom-left` under 180 degrees) and the player-slot permutation.
 *
 * Teams are NOT a map property: `matchRules.teamMapping` assigns slots to teams. `teamMapping`
 * here is the pairing the layout was designed for, documentation for whoever creates the match.
 */

import type { GameMode } from "server/core/schemas/game-mode";
import { maps as oneVOneNavalAndSilos } from "./maps/1v1-naval-and-silos";
import { maps as oneVOnePipesAndForest } from "./maps/1v1-pipes-and-forest";
import { maps as oneVOneAirAndIsthmus } from "./maps/1v1-air-and-isthmus";
import { maps as oneVOneRiversAndFlats } from "./maps/1v1-rivers-and-flats";
import { maps as oneVOneLabsAndBroken } from "./maps/1v1-labs-and-broken";
import { maps as twoVTwoShoresAndLanes } from "./maps/2v2-shores-and-lanes";
import { maps as twoVTwoBastionAndPipes } from "./maps/2v2-bastion-and-pipes";
import { maps as twoVTwoAirAndSilo } from "./maps/2v2-air-and-silo";
import { maps as twoVTwoLagoonAndForest } from "./maps/2v2-lagoon-and-forest";
import { maps as twoVTwoMountainsAndRivers } from "./maps/2v2-mountains-and-rivers";
import { maps as ffaCrossAndIslands } from "./maps/ffa-cross-and-islands";
import { maps as ffaChokesAndSilo } from "./maps/ffa-chokes-and-silo";
import { maps as ffaPipesAndAir } from "./maps/ffa-pipes-and-air";
import { maps as ffaCrownAndNexus } from "./maps/ffa-crown-and-nexus";
import { maps as ffaWild } from "./maps/ffa-wild";

/** How a map is meant to be played, and which symmetry guarantees its fairness. */
export type MapCategory = "1v1" | "2v2" | "ffa";

/**
 * The symmetry a map's layout obeys.
 *
 * - `rotate180` — tile (r, c) maps to (h-1-r, w-1-c), slots 0 <-> 1. Used for 1v1.
 * - `mirrorBoth` — the grid is invariant under both a horizontal and a vertical mirror.
 *   The horizontal mirror swaps the two teams, the vertical one swaps teammates. Used for 2v2.
 * - `rotate90` — tile (r, c) maps to (c, size-1-r), slots 0 -> 1 -> 2 -> 3. Square grids only.
 *   The only symmetry under which four players are positionally identical. Used for FFA.
 * - `asymmetric` — each side is shaped independently: one player may face a forest approach where
 *   the other faces a river crossing. More interesting to play, but nothing is fair by
 *   construction, so it rests entirely on the measured parity checks (census, distances, terrain
 *   mix, contested objectives) that `npm run maps:check` enforces on every map.
 *
 * Roughly 80% of the pool is symmetric and 20% asymmetric: the symmetric maps are the reliable
 * baseline, the asymmetric ones are where the pool gets its character.
 */
export type MapSymmetry = "rotate180" | "mirrorBoth" | "rotate90" | "asymmetric";

export type MapDefinition = {
  name: string;
  category: MapCategory;
  numberOfPlayers: number;
  symmetry: MapSymmetry;
  /** The single idea the map is built around — what it is meant to make players do. */
  concept: string;
  /** The `matchRules.teamMapping` this layout was designed for. Undefined for free-for-all. */
  teamMapping?: number[];
  /**
   * Modes this map may be played in at all. Defaults from the category: a 1v1 map to `[duel]`,
   * every 4-seat map to `[teams, ffa]` — the seats fit either, only `teamMapping` differs.
   * See {@link supportedModesOf}.
   */
  supportedModes?: GameMode[];
  /**
   * Modes this map is ranked-legal in — a subset of `supportedModes`. Defaults to the single mode
   * the map was designed for, which is the one its fairness was verified against.
   *
   * Deliberately per-mode rather than one map-wide boolean: a 4-player map can be fair enough for
   * ranked free-for-all while being unbalanced for ranked 2v2, and a boolean would force banning
   * both. See {@link rankedModesOf}.
   */
  rankedModes?: GameMode[];
  /**
   * Whether a player's own territory has a strong and a weak flank. Defaults to `balanced`.
   *
   * Splitting a player's producers evenly around their HQ makes every opening the same opening.
   * A `sided` map gives each player a strong flank — more production AND a faster route to the
   * centre — and a weak one, so committing to a side is a real decision with a real cost. The
   * two must agree: extra production on the flank that is *slower* to the centre is a trap, not
   * a strong side, and the checker rejects it.
   *
   * This is per-player and does not affect fairness between players: every player gets the same
   * strong/weak profile, rotated or mirrored, so the parity checks still hold exactly.
   *
   * Roughly 30% of the pool stays `balanced` — the tight, chokepoint-driven maps where an even
   * build-up is the point.
   */
  flanks?: MapFlanks;
  tileDataString: string;
};

/** See {@link MapDefinition.flanks}. */
export type MapFlanks = "balanced" | "sided";

/**
 * The ~30% of the pool that stays `balanced`: the tight, chokepoint-driven maps where an even
 * build-up is the point and a strong flank would just decide the game before it starts.
 *
 * Held centrally rather than as a field on each map so the policy is visible in one place — the
 * split is a property of the POOL (how much of it plays which way), not of any single map, and
 * reading it off 45 scattered declarations would make it impossible to see.
 */
const BALANCED_MAPS = new Set([
  "1v1 Meridian Split",
  "1v1 Iron Corridor",
  "1v1 Silo Alley",
  "1v1 Highland Fort",
  "1v1 Salt Flats",
  "1v1 Delta Crossing",
  "1v1 Forest Vigil",
  "2v2 Crossroads Pact",
  "2v2 Silo Pressure",
  "2v2 Mountain Pass Duo",
  "FFA Cardinal Quarters",
  "FFA Cross Roads",
  "FFA Diagonal Rivers",
]);

/** An explicit `flanks` on the map wins; otherwise the pool policy above decides. */
export const flanksOf = (definition: MapDefinition): MapFlanks =>
  definition.flanks ?? (BALANCED_MAPS.has(definition.name) ? "balanced" : "sided");

/** The mode a map was actually designed and balanced for. */
const modeForCategory: Record<MapCategory, GameMode> = {
  "1v1": "duel",
  "2v2": "teams",
  ffa: "ffa",
};

/**
 * Where a map may be played. A 2-seat map only fits a duel, but every 4-seat map is *playable*
 * both as 2v2 and as a free-for-all — same seats, only `teamMapping` differs — so both are
 * offered. Whether it is any good in the mode it wasn't drawn for is a separate question, and
 * that is what `rankedModesOf` answers.
 */
export const supportedModesOf = (definition: MapDefinition): GameMode[] =>
  definition.supportedModes ?? (definition.category === "1v1" ? ["duel"] : ["teams", "ffa"]);

/**
 * Where a map counts for rating: the one mode it was designed and verified for.
 *
 * A 2v2 layout puts teammates adjacent and assumes a shared front; the same map as a free-for-all
 * hands the two "teammates" an unearned neighbour problem. It stays playable there casually and
 * stays out of the ladder. Every map in this pool is checked against its own designed mode — the
 * flank, parity and symmetry rules all assume it — so that is exactly the mode it is ranked in.
 */
export const rankedModesOf = (definition: MapDefinition): GameMode[] =>
  definition.rankedModes ?? [modeForCategory[definition.category]];

/* -------------------------------------------------------------------------------------------- */
/* 1v1                                                                                          */
/* -------------------------------------------------------------------------------------------- */

const meridianSplit: MapDefinition = {
  name: "1v1 Meridian Split",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "A north-south river cuts the map in half and only two bridges cross it, both on one " +
    "east-west highway. Vehicles are funnelled through those two chokepoints while infantry can " +
    "ford the river slowly, so map control is decided by who holds the bridges. Two neutral labs " +
    "flank the centre, two comm towers sit in the dead corners as flank objectives.",
  tileDataString: `
2,1,3,1,1,34,1,5,1,3,1,1,3,1,2
1,40,1,3,1,1,1,5,1,1,34,1,1,1,1
3,1,39,1,1,1,3,5,3,1,1,3,1,133,1
1,42,15,15,15,19,1,5,1,3,1,34,1,1,2
1,39,1,1,3,16,1,5,1,1,3,1,1,1,1
1,3,15,15,15,24,15,26,15,15,15,15,15,3,1
1,3,1,34,1,1,2,5,1,1,111,1,1,3,1
1,2,1,145,1,3,1,5,1,3,1,145,1,2,1
1,3,1,1,111,1,1,5,2,1,1,34,1,3,1
1,3,15,15,15,15,15,26,15,22,15,15,15,3,1
1,1,1,1,3,1,1,5,1,16,3,1,1,44,1
2,1,1,34,1,3,1,5,1,21,15,15,15,47,1
1,133,1,3,1,1,3,5,3,1,1,1,44,1,3
1,1,1,1,34,1,1,5,1,1,1,3,1,45,1
2,1,3,1,1,3,1,5,1,34,1,1,3,1,2
`,
};

const ironCorridor: MapDefinition = {
  name: "1v1 Iron Corridor",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Two mountain ridges cut the map into three bands, and each ridge has only two gaps. Vehicles " +
    "must commit to a gap while infantry can climb over, so scouting which gap the enemy chose is " +
    "the whole opening. A road runs from each HQ through its own gap to the centre, making the " +
    "middle band the place both armies arrive at first.",
  tileDataString: `
2,3,1,34,1,2,1,1,1,3,1,1,1,1,2
1,42,15,15,15,19,1,1,1,34,1,3,1,1,1
1,39,1,40,1,16,1,3,1,1,1,1,133,1,1
1,39,1,1,1,16,1,1,34,1,1,1,1,3,1
2,2,3,2,2,16,2,2,2,3,2,1,2,2,2
1,1,1,34,1,16,3,1,1,1,3,1,1,1,1
1,3,1,1,1,16,1,1,1,1,1,111,1,3,1
1,2,1,145,1,16,1,1,1,16,1,145,1,2,1
1,3,1,111,1,1,1,1,1,16,1,1,1,3,1
1,1,1,1,3,1,1,1,3,16,1,34,1,1,1
2,2,2,1,2,3,2,2,2,16,2,2,3,2,2
1,3,1,1,1,1,34,1,1,16,1,1,1,44,1
1,1,133,1,1,1,1,3,1,16,1,45,1,44,1
1,1,1,3,1,34,1,1,1,21,15,15,15,47,1
2,1,1,1,1,3,1,1,1,2,1,34,1,3,2
`,
};

/* -------------------------------------------------------------------------------------------- */
/* 2v2                                                                                          */
/* -------------------------------------------------------------------------------------------- */

const crossroadsPact: MapDefinition = {
  name: "2v2 Crossroads Pact",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Two vertical and two horizontal highways carve the map into nine fields. Each team owns a " +
    "side, and their vertical highway is the lateral road that lets teammates reinforce each " +
    "other; the horizontal highways are the contested lanes into the enemy half. A mountain " +
    "massif holds the centre, ringed by four neutral labs.",
  tileDataString: `
2,2,3,16,1,1,133,1,1,133,1,1,16,3,2,2
2,42,39,16,3,1,1,1,1,1,1,3,16,44,47,2
3,39,1,16,1,34,1,3,3,1,34,1,16,1,44,3
15,15,15,17,15,15,15,15,15,15,15,15,17,15,15,15
1,40,1,16,34,1,3,1,1,3,1,34,16,1,45,1
34,3,1,16,1,1,3,111,111,3,1,1,16,1,3,34
1,1,3,16,1,3,1,1,1,1,3,1,16,3,1,1
1,2,1,16,1,3,145,2,2,145,3,1,16,1,2,1
1,2,1,16,1,3,145,2,2,145,3,1,16,1,2,1
1,1,3,16,1,3,1,1,1,1,3,1,16,3,1,1
34,3,1,16,1,1,3,111,111,3,1,1,16,1,3,34
1,50,1,16,34,1,3,1,1,3,1,34,16,1,55,1
15,15,15,17,15,15,15,15,15,15,15,15,17,15,15,15
3,49,1,16,1,34,1,3,3,1,34,1,16,1,54,3
2,52,49,16,3,1,1,1,1,1,1,3,16,54,57,2
2,2,3,16,1,1,133,1,1,133,1,1,16,3,2,2
`,
};

/* -------------------------------------------------------------------------------------------- */
/* FFA (4 players)                                                                              */
/* -------------------------------------------------------------------------------------------- */

const cardinalQuarters: MapDefinition = {
  name: "FFA Cardinal Quarters",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four identical quarters, each with its HQ tucked in a corner behind a mountain ridge. Under " +
    "90-degree rotation no player borders another more closely than the rest, so there is no " +
    "'weak neighbour' to gang up on. The centre is a 2x2 block of neutral labs: a prize you can " +
    "only hold by exposing yourself to the other three at once.",
  tileDataString: `
2,2,3,1,1,1,34,1,1,3,1,1,1,3,2,2
2,42,39,1,3,1,1,3,2,1,1,45,1,44,47,2
3,39,1,1,34,1,1,1,1,1,34,1,1,1,44,3
1,1,1,3,1,1,3,34,1,3,1,1,3,1,1,1
1,40,1,1,1,3,1,1,111,1,2,1,1,34,3,1
1,1,34,1,2,1,1,133,1,1,1,3,1,1,1,1
3,1,1,3,1,1,1,1,1,1,1,1,3,1,1,34
1,2,1,1,111,1,1,145,145,1,133,1,34,1,3,1
1,3,1,34,1,133,1,145,145,1,1,111,1,1,2,1
34,1,1,3,1,1,1,1,1,1,1,1,3,1,1,3
1,1,1,1,3,1,1,1,133,1,1,2,1,34,1,1
1,3,34,1,1,2,1,111,1,1,3,1,1,1,50,1
1,1,1,3,1,1,3,1,34,3,1,1,3,1,1,1
3,54,1,1,1,34,1,1,1,1,1,34,1,1,49,3
2,57,54,1,55,1,1,2,3,1,1,3,1,49,52,2
2,2,3,1,1,1,3,1,1,34,1,1,1,3,2,2
`,
};

/**
 * The rest of the pool lives in `maps/`, one file per batch, so that several maps can be worked on
 * without every edit landing in this file. Aggregation is explicit — ES modules cannot glob, and an
 * explicit list is what makes a missing batch a compile error rather than a silently smaller pool.
 */
export const mapDefinitions: MapDefinition[] = [
  // Authored here, as the worked examples of each symmetry.
  meridianSplit,
  ironCorridor,
  crossroadsPact,
  cardinalQuarters,
  ...oneVOneNavalAndSilos,
  ...oneVOnePipesAndForest,
  ...oneVOneAirAndIsthmus,
  ...oneVOneRiversAndFlats,
  ...oneVOneLabsAndBroken,
  ...twoVTwoShoresAndLanes,
  ...twoVTwoBastionAndPipes,
  ...twoVTwoAirAndSilo,
  ...twoVTwoLagoonAndForest,
  ...twoVTwoMountainsAndRivers,
  ...ffaCrossAndIslands,
  ...ffaChokesAndSilo,
  ...ffaPipesAndAir,
  ...ffaCrownAndNexus,
  ...ffaWild,
];
