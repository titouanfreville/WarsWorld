import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Position } from "server/core/schemas/position";
import type { Tile } from "server/core/schemas/tile";
import { VEHICLE_MOVEMENT, type TerrainAccess } from "./terrain-access";
import {
  approachesTo,
  canCaptureRouteThrough,
  canCaptureStandOn,
  censusOf,
  distanceTo,
  flood,
  hasTransport,
  inBounds,
  isProperty,
  isReachable,
  occupiedSeats,
  positionsWhere,
  PROPERTY_TYPES,
  tileAt,
  type Distances,
  type Grid,
} from "./topology";

/**
 * What the checker needs of a map, which is less than a `CreatableMap`.
 *
 * Units are read for their seat, their type and where they stand — never their fuel or ammo — so
 * the builder can be checked while holding units in the lean `{type, playerSlot, position}` shape
 * it actually edits, before the server fills in the engine's stats.
 */
export type EvaluatableMap = {
  tiles: Grid;
  predeployedUnits: { type: string; playerSlot: PlayerSlot; position: Position }[];
};

/**
 * The fairness checker: does this map work, and is it even-handed?
 *
 * Pure — grid in, verdict out. No Prisma, no engine import, no I/O. It is called two ways and must
 * give the same answer to both: live from the builder on every edit, and again inside the
 * transaction that publishes or submits a map, because the client's verdict is never trusted.
 *
 * Two tiers, and the split is deliberate. **Playable** is about whether the map can be played at
 * all; failing it is a defect and blocks publishing. **Fairness** is about whether it favours a
 * seat; failing it is a legitimate design choice for a casual map and only blocks the ranked pool.
 */

export type FairnessCheck = {
  /** Stable machine key — the UI maps it to a highlight, so it must not track the label's wording. */
  id: string;
  label: string;
  ok: boolean;
  /** Short human-readable finding, e.g. "city 3 vs 2". Shown next to the label. */
  detail: string;
  /** Tiles this finding points at, for the builder to highlight. Empty when there is nothing to show. */
  tiles: Position[];
};

export type FairnessReport = {
  seats: PlayerSlot[];
  playable: FairnessCheck[];
  fairness: FairnessCheck[];
  isPlayable: boolean;
  isFair: boolean;
};

/** How far two seats' terrain mixes may differ before the map is calling it uneven. */
const TERRAIN_TOLERANCE = 2;

/** How much more ground one seat's vehicles may have, as a percentage of the larger. */
const VEHICLE_SKEW_TOLERANCE = 5;

const check = (
  id: string,
  label: string,
  ok: boolean,
  detail: string,
  tiles: Position[] = [],
): FairnessCheck => ({ id, label, ok, detail, tiles });

const seatName = (seat: PlayerSlot) => `P${seat + 1}`;

/** Terrain whose presence is the point of a "cover and friction" comparison. */
const MIXED_TERRAIN = ["forest", "mountain", "river"] as const;

export const evaluateMap = (map: EvaluatableMap, access: TerrainAccess): FairnessReport => {
  const { tiles } = map;
  const seats = occupiedSeats(tiles, map.predeployedUnits);
  const transport = hasTransport(tiles);

  const hqsBySeat = new Map<PlayerSlot, Position[]>();

  for (const position of positionsWhere(tiles, (tile) => tile.type === "hq")) {
    const tile = tileAt(tiles, position);

    if (isProperty(tile) && tile.playerSlot >= 0) {
      hqsBySeat.set(tile.playerSlot, [...(hqsBySeat.get(tile.playerSlot) ?? []), position]);
    }
  }

  /** One HQ per seat, in seat order — the anchor for every distance measured below. */
  const hqs = seats
    .map((seat) => hqsBySeat.get(seat)?.[0])
    .filter((p): p is Position => p !== undefined);

  const routable = (tile: Tile) => canCaptureRouteThrough(access, tile, { transport });
  const captureFloods: Distances[] = hqs.map((hq) => flood(tiles, hq, routable));

  /* ---------------------------------------------------------------------------------------- */
  /* Playable — can this map be played at all?                                                  */
  /* ---------------------------------------------------------------------------------------- */

  const playable: FairnessCheck[] = [];

  playable.push(
    check(
      "seats",
      "At least two seats occupied",
      seats.length >= 2,
      `${seats.length} seat${seats.length === 1 ? "" : "s"}`,
    ),
  );

  const badHqCounts = seats.filter((seat) => (hqsBySeat.get(seat) ?? []).length !== 1);
  playable.push(
    check(
      "one-hq",
      "Exactly one HQ per seat",
      seats.length >= 2 && badHqCounts.length === 0,
      badHqCounts.length === 0 ? "1 each" : `${badHqCounts.map(seatName).join(", ")} off`,
      badHqCounts.flatMap((seat) => hqsBySeat.get(seat) ?? []),
    ),
  );

  const cannotProduce = seats.filter((seat) => {
    const census = censusOf(tiles, seat);
    const hasProducer = census.base + census.airport + census.port > 0;

    return !hasProducer && !map.predeployedUnits.some((unit) => unit.playerSlot === seat);
  });
  playable.push(
    check(
      "can-produce",
      "Every seat can field units",
      seats.length >= 2 && cannotProduce.length === 0,
      cannotProduce.length === 0 ? "all can" : `${cannotProduce.map(seatName).join(", ")} cannot`,
      cannotProduce.flatMap((seat) => hqsBySeat.get(seat) ?? []),
    ),
  );

  // Not "is there a land path" but "can a unit that CAPTURES get there" — the only kind that can
  // end the game. An HQ nothing can take is a map nobody can win.
  const sealedOff =
    hqs.length >= 2 ? hqs.slice(1).filter((hq) => !isReachable(captureFloods[0], hq)) : [];
  playable.push(
    check(
      "hq-capturable",
      "Every HQ can be captured",
      hqs.length >= 2 && sealedOff.length === 0,
      sealedOff.length > 0
        ? `${sealedOff.length} sealed off`
        : transport
          ? "reachable"
          : "reachable on foot",
      sealedOff,
    ),
  );

  // A predeployed unit standing where its own movement type cannot go: a lander on a mountain, a
  // tank at sea. The map would place a unit the engine has no legal square for.
  const stranded = map.predeployedUnits.filter((unit) => {
    const movement = access.movementOf(unit.type);

    if (movement === undefined || !inBounds(tiles, unit.position)) {
      return true;
    }

    return !access.canStand(movement, tileAt(tiles, unit.position).type);
  });

  playable.push(
    check(
      "units-placeable",
      "Every predeployed unit can stand where it is",
      stranded.length === 0,
      stranded.length === 0
        ? `${map.predeployedUnits.length} placed`
        : `${stranded.length} stranded`,
      stranded.map((unit) => unit.position),
    ),
  );

  // One way in is a map that ends at a single chokepoint. Two approaches forces the defender to
  // hold ground rather than plug a corridor.
  const choked = hqs.filter((hq) => approachesTo(tiles, access, hq).length < 2);
  playable.push(
    check(
      "hq-approaches",
      "Every HQ has two ways in",
      hqs.length >= 2 && choked.length === 0,
      choked.length > 0
        ? `${choked.length} with a single approach`
        : `${Math.min(...hqs.map((hq) => approachesTo(tiles, access, hq).length))} minimum`,
      choked.flatMap((hq) => [hq, ...approachesTo(tiles, access, hq)]),
    ),
  );

  /* ---------------------------------------------------------------------------------------- */
  /* Fairness — does it favour a seat?                                                          */
  /* ---------------------------------------------------------------------------------------- */

  const fairness: FairnessCheck[] = [];
  const censuses = seats.map((seat) => censusOf(tiles, seat));
  const baseline = censuses[0];

  const censusOk =
    seats.length >= 2 && censuses.every((c) => PROPERTY_TYPES.every((t) => c[t] === baseline[t]));

  // Passing, report the shared census. Failing, name the disagreement — the widest-spread property
  // and its high/low — rather than one seat's numbers, which say nothing about what is wrong.
  let censusDetail = "no seats";

  if (baseline !== undefined && censusOk) {
    censusDetail =
      PROPERTY_TYPES.filter((t) => baseline[t] > 0)
        .map((t) => `${t} ${baseline[t]}`)
        .join(", ") || "none";
  } else if (baseline !== undefined) {
    const worst = PROPERTY_TYPES.map((type) => ({
      type,
      high: Math.max(...censuses.map((c) => c[type])),
      low: Math.min(...censuses.map((c) => c[type])),
    }))
      .filter((row) => row.high !== row.low)
      .sort((a, b) => b.high - b.low - (a.high - a.low))[0];

    censusDetail = worst === undefined ? "uneven" : `${worst.type} ${worst.high} vs ${worst.low}`;
  }

  fairness.push(
    check(
      "census",
      "Identical property census per seat",
      censusOk,
      censusDetail,
      censusOk ? [] : positionsWhere(tiles, (tile) => isProperty(tile) && tile.playerSlot >= 0),
    ),
  );

  const neutralProperties = positionsWhere(
    tiles,
    (tile) => isProperty(tile) && tile.playerSlot === -1,
  );

  let neutralOk = hqs.length >= 2;
  let neutralDetail = hqs.length >= 2 ? "no neutral property" : "needs two HQs";

  if (hqs.length >= 2 && neutralProperties.length > 0) {
    const perSeat = captureFloods.map((distances) =>
      neutralProperties
        .map((p) => distanceTo(distances, p) ?? Number.POSITIVE_INFINITY)
        .sort((a, b) => a - b),
    );
    neutralOk = perSeat.every((list) => list.join() === perSeat[0].join());
    const nearest = perSeat.map((list) => list[0]);
    neutralDetail = neutralOk
      ? "matched"
      : `nearest differs by ${Math.max(...nearest) - Math.min(...nearest)}`;
  }

  fairness.push(
    check(
      "neutral-distance",
      "Equal distance to neutral property",
      neutralOk,
      neutralDetail,
      neutralOk ? [] : neutralProperties,
    ),
  );

  // Terrain parity over a nearest-HQ split: each seat's own ground should hold the same mix of
  // cover and friction. A tile equidistant from two seats belongs to neither and is skipped.
  let terrainOk = hqs.length >= 2;
  let terrainDetail = "needs two HQs";

  if (hqs.length >= 2) {
    const mixes = hqs.map(() => ({ forest: 0, mountain: 0, river: 0 }));

    for (const position of positionsWhere(tiles, (tile) =>
      (MIXED_TERRAIN as readonly string[]).includes(tile.type),
    )) {
      const reach = captureFloods.map((d) => distanceTo(d, position));
      const best = Math.min(...reach.map((d) => d ?? Number.POSITIVE_INFINITY));

      if (best === Number.POSITIVE_INFINITY) {
        continue;
      }

      const owners = reach.filter((d) => d === best).length;

      if (owners !== 1) {
        continue;
      }

      const owner = reach.findIndex((d) => d === best);
      mixes[owner][tileAt(tiles, position).type as (typeof MIXED_TERRAIN)[number]] += 1;
    }

    const widest = Math.max(
      ...MIXED_TERRAIN.map(
        (type) => Math.max(...mixes.map((m) => m[type])) - Math.min(...mixes.map((m) => m[type])),
      ),
    );
    terrainOk = widest <= TERRAIN_TOLERANCE;
    terrainDetail = `widest gap ${widest}, tolerance ${TERRAIN_TOLERANCE}`;
  }

  fairness.push(
    check("terrain-mix", "Matched cover and friction per seat", terrainOk, terrainDetail),
  );

  // Infantry cross rivers and climb mountains; vehicles do neither. A map can be perfectly fair on
  // foot and still hand one seat far more ground its tanks can actually use.
  let vehicleOk = hqs.length >= 2;
  let vehicleDetail = "needs two HQs";

  if (hqs.length >= 2) {
    const vehicleStandable = (tile: Tile) =>
      VEHICLE_MOVEMENT.some((movement) => access.canStand(movement, tile.type));
    const openGround = hqs.map((hq) => flood(tiles, hq, vehicleStandable).size);
    const high = Math.max(...openGround);
    const low = Math.min(...openGround);
    const skew = high === 0 ? 0 : Math.round(((high - low) / high) * 100);
    vehicleOk = skew <= VEHICLE_SKEW_TOLERANCE;
    vehicleDetail = `${low}–${high} tiles, ${skew}% apart`;
  }

  fairness.push(check("vehicle-ground", "Equal ground open to vehicles", vehicleOk, vehicleDetail));

  /*
   * A property no rival's capture units can reach is permanent income nobody can contest. That is
   * not a defect — an island city behind a pipe is a legitimate design — but it IS an advantage, so
   * every seat must hold the same number of them. This is why unreachable property is a fairness
   * term and not a playability blocker.
   */
  let uncontestedOk = hqs.length >= 2;
  let uncontestedDetail = "needs two HQs";
  let uncontestedTiles: Position[] = [];

  if (hqs.length >= 2) {
    const perSeat = seats.map((seat, index) =>
      positionsWhere(tiles, (tile) => isProperty(tile) && tile.playerSlot === seat).filter((p) =>
        captureFloods.every((flooded, other) => other === index || !isReachable(flooded, p)),
      ),
    );
    const counts = perSeat.map((list) => list.length);
    const high = Math.max(...counts);
    const low = Math.min(...counts);
    uncontestedOk = high === low;
    uncontestedDetail =
      high === 0 ? "none, all contested" : uncontestedOk ? `${high} each` : `${high} vs ${low}`;
    uncontestedTiles = uncontestedOk ? [] : perSeat.flat();
  }

  fairness.push(
    check(
      "uncontested",
      "Uncontestable property split evenly",
      uncontestedOk,
      uncontestedDetail,
      uncontestedTiles,
    ),
  );

  const isPlayable = playable.every((c) => c.ok);

  return {
    seats,
    playable,
    fairness,
    isPlayable,
    isFair: isPlayable && fairness.every((c) => c.ok),
  };
};

/** Positions a capture unit could stand on. Exported for the builder's reachability overlay. */
export const captureStandablePositions = (tiles: Grid, access: TerrainAccess): Position[] =>
  positionsWhere(tiles, (tile) => canCaptureStandOn(access, tile));
