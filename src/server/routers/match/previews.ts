import { matchBaseProcedure, playerInMatchBaseProcedure, router } from "server/trpc/trpc-setup";
import { DispatchableError } from "server/engine/dispatchable-error";
import { getBattleForecast } from "server/engine/previews/combat-forecast";
import { getAvailableSubActions } from "server/engine/events/available-sub-actions";
import { getTerrainDefenseStars } from "server/engine/constants/terrain-properties";
import { getUnloadablePositions } from "server/engine/events/handlers/unload/checkUnloadTiles";
import {
  getAccessibleNodes,
  getAttackableTiles,
  getAttackTargetTiles,
} from "server/engine/previews/pathfinding";
import type { UnitType } from "server/core/schemas/unit";
import { unitTypeSchema } from "server/core/schemas/unit";
import { buildTurnSnapshot } from "server/engine/previews/turn-snapshot";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import { maskUnitForViewer, type TeamWrapper } from "server/engine/entities/team";
import type { UnitWrapper } from "server/engine/entities/unit";
import { positionSchema, isSamePosition } from "server/core/schemas/position";
import type { Position } from "server/core/schemas/position";
import { z } from "zod";

/**
 * Read-only preview queries: what a unit can do, where it can go/attack, and how an engagement
 * would play out. The backend is authoritative — it computes these from match state and the client
 * merely renders them (it must not run the engine). Each is turn- and ownership-gated by
 * `playerInMatchBaseProcedure` (except `unitDetails`, which gates visibility itself).
 *
 * Fog-of-war: each preview is derived from the requesting team's VISIBLE state so a concealed unit
 * never leaks. The action/own-unit previews (reachableTiles, attackTargets, availableActions,
 * combatForecast, turnSnapshot) rest on fog-aware engine primitives — getAccessibleNodes blocks only
 * on enemies the team can see, getAttackTargetTiles / getAvailableSubActions offer only visible
 * enemies as targets, and combatForecast additionally gates on that target set. Enemy-unit inspection
 * (unitDetails) gates on `canSeeUnitAtPosition`, masks consumables + Sonja HP, carries no transport
 * cargo, and withholds the one unit-naming range set (attackTargetTiles) for enemy units.
 */

const getOwnedUnitOrThrow = (
  match: MatchWrapper,
  player: PlayerInMatchWrapper,
  position: Position,
) => {
  const unit = match.getUnitOrThrow(position);

  if (unit.data.playerSlot !== player.data.slot) {
    throw new DispatchableError("You don't own this unit");
  }

  return unit;
};

/** The broad classes AW damage is grouped into, for a compact "what can this hit" readout. */
type WeaponTargetClass = "infantry" | "ground" | "air" | "sea";

const UNIT_CLASS: Record<UnitType, WeaponTargetClass> = {
  infantry: "infantry",
  mech: "infantry",
  recon: "ground",
  apc: "ground",
  tank: "ground",
  mediumTank: "ground",
  neoTank: "ground",
  megaTank: "ground",
  artillery: "ground",
  rocket: "ground",
  antiAir: "ground",
  missile: "ground",
  pipeRunner: "ground",
  transportCopter: "air",
  battleCopter: "air",
  fighter: "air",
  bomber: "air",
  stealth: "air",
  blackBomb: "air",
  blackBoat: "sea",
  lander: "sea",
  cruiser: "sea",
  sub: "sea",
  battleship: "sea",
  carrier: "sea",
};

const CLASS_ORDER: WeaponTargetClass[] = ["infantry", "ground", "air", "sea"];

/** The target classes a weapon's damage table can actually hurt (damage > 0), in a stable order. */
const targetClassesOf = (
  damage: Partial<Record<UnitType, number>> | undefined,
): WeaponTargetClass[] => {
  if (damage === undefined) {
    return [];
  }

  const hit = new Set<WeaponTargetClass>();

  for (const [type, value] of Object.entries(damage)) {
    if ((value ?? 0) > 0) {
      hit.add(UNIT_CLASS[type as UnitType]);
    }
  }

  return CLASS_ORDER.filter((cls) => hit.has(cls));
};

/**
 * The unit's weapons, for the "arms" readout: a MAIN weapon (uses ammo) and/or a machine gun (MG,
 * unlimited). Derived from the match's active damage chart, so it reflects the game version in play.
 * Empty for unarmed units (APC, transports, black bomb, …).
 */
const buildWeapons = (unit: UnitWrapper) => {
  const weaponry = unit.player.getVersionProperties().damageChart[unit.data.type];
  const weapons: { kind: "main" | "mg"; usesAmmo: boolean; targets: WeaponTargetClass[] }[] = [];

  if (weaponry?.primary !== undefined) {
    weapons.push({ kind: "main", usesAmmo: true, targets: targetClassesOf(weaponry.primary) });
  }

  if (weaponry?.secondary !== undefined) {
    weapons.push({ kind: "mg", usesAmmo: false, targets: targetClassesOf(weaponry.secondary) });
  }

  return weapons;
};

/**
 * The detail readout for a PIPE SEAM — the one piece of terrain that carries HP and can be shot.
 * Same card, different shape (`kind: "terrain"`): no movement, consumables or weapons, just the
 * health the client needs to judge whether one more hit breaks it, plus the tile's own cover.
 *
 * Visibility defers to the engine's vision, as the board does — it just happens that seams are
 * currently visible to everyone always (Vision registers every seam like an owned property), so the
 * gate never bites today. It stays because the rule belongs to the engine, not to this readout: if
 * seam vision ever narrows, the card must narrow with it. Throws when the tile isn't a seam at all,
 * which is how "nothing inspectable here" reaches the client (the card closes on error).
 */
export const buildPipeSeamDetails = (match: MatchWrapper, viewerId: string, position: Position) => {
  const tile = match.getTile(position);

  if (tile.type !== "pipeSeam") {
    throw new DispatchableError("There's nothing to inspect there");
  }

  const viewerTeam = match.getPlayerById(viewerId)?.team;

  if (viewerTeam !== undefined && !viewerTeam.isPositionVisible(position)) {
    throw new DispatchableError("You can't see that tile");
  }

  const mapTile = match.map.data.tiles[position[1]][position[0]];

  return {
    kind: "terrain" as const,
    displayName: "Pipe Seam",
    // Seam HP rides the same 0-100 scale as a unit's (see applyAttackEvent), so it reads as the same
    // 1-10 health digit the board draws on units — one health vocabulary across the board.
    hp: tile.hp,
    visualHp: Math.ceil(tile.hp / 10),
    terrain: {
      type: tile.type,
      defenseStars: getTerrainDefenseStars(tile.type),
      // The seam's live state (`changeableTiles`) carries only hp — its connection variant, which
      // picks the art, is on the STATIC map tile underneath.
      variant: "variant" in mapTile ? mapTile.variant : null,
      playerSlot: null,
    },
  };
};

/**
 * The stats a unit-detail card renders. Reference stats (max fuel/ammo, movement, vision, range) are
 * public knowledge from the unit's type, so they're always sent. HP and the current consumables
 * (fuel/ammo) are whatever the SINGLE masking rule says this viewer may read — see maskUnitForViewer:
 * HP is public unless the unit is Sonja's, and consumables are public outside fog but secret under it.
 *
 * `terrain` describes the tile the unit stands on, and `isIndirect` says whether it fires without
 * moving. Both are engine-derived on purpose: the card renders them, and the inspect overlay keys its
 * "full" view off `isIndirect` (an indirect can't move-and-fire, so it shows movement only). The
 * client must not infer either from the range numbers — that would be rules knowledge on the FE.
 */
export const buildUnitDetails = (
  unit: UnitWrapper,
  isOwn: boolean,
  viewerTeam: TeamWrapper | null,
) => {
  const tile = unit.getTile();
  // What this viewer may read is decided ONCE, by the same rule the board uses — this card must not
  // hold a second opinion about who sees what, or the two drift. `stats: "hidden"` is a Sonja unit
  // (no HP, no consumables); a fogged enemy keeps its HP but drops fuel/ammo; otherwise it's all there.
  const masked = maskUnitForViewer(unit, viewerTeam);
  const hpHidden = masked.stats === "hidden";

  return {
    // Discriminator: this card also describes attackable TERRAIN (a pipe seam), which has HP but
    // none of a unit's stats. The client branches on it instead of sniffing for absent fields.
    kind: "unit" as const,
    type: unit.data.type,
    displayName: unit.properties.displayName,
    isOwn,
    hp: hpHidden ? null : unit.getHP(),
    visualHp: hpHidden ? null : unit.getVisualHP(),
    movementPoints: unit.properties.movementPoints,
    movementType: unit.properties.movementType,
    vision: unit.properties.vision,
    attackRange: unit.getAttackRange() ?? null,
    maxFuel: unit.properties.initialFuel,
    // `in` narrows the property union inline (a boolean alias wouldn't narrow it).
    maxAmmo: "initialAmmo" in unit.properties ? unit.properties.initialAmmo : null,
    // Read the masked view, not the live unit: outside fog an enemy's consumables are public (you can
    // infer them by watching it move anyway), under fog they're secret along with the unit itself.
    fuel: masked.stats === "hidden" ? null : (masked.stats.fuel ?? null),
    ammo: masked.stats === "hidden" ? null : (masked.stats.ammo ?? null),
    // Weapons + the unit classes each can hit — public, type-derived (no per-unit intel).
    weapons: buildWeapons(unit),
    // An indirect fires from where it stands; a direct unit moves and strikes. Drives the overlay.
    isIndirect: unit.isIndirect(),
    // The tile underfoot — terrain kind, the defense it grants, and enough of the tile's own data for
    // the client to find its art (connection variant, owning slot). Public: the map is common
    // knowledge, and `match.full` already sends every tile with these fields.
    terrain: {
      type: tile.type,
      defenseStars: getTerrainDefenseStars(tile.type),
      variant: "variant" in tile ? tile.variant : null,
      playerSlot: "playerSlot" in tile ? tile.playerSlot : null,
    },
  };
};

/**
 * The inspect overlay's tile sets — computed for ANY unit (own or enemy) so a player can read an
 * enemy's reach + threat by right-clicking it. The client colours them per rule (own vs enemy, and
 * the "direct attack only" second-click view).
 * - `reachableTiles`: where it can move (blue). Movement blockers are fog-aware — a hidden enemy
 *   never dents the set (that would leak it; see getAccessibleNodes).
 * - `attackableTiles`: every tile it could hit after moving (move-and-attack reach) — geometry only,
 *   names no units.
 * - `directAttackTiles`: tiles it can hit from where it stands NOW (adjacent for melee, range ring
 *   for indirect) — the second-click "direct attack" view. Geometry only.
 * - `attackTargetTiles`: the reachable tiles that actually hold an attackable enemy / pipe seam. This
 *   is the ONE set naming concrete unit positions, so it is built for OWN units ONLY (fog-aware —
 *   hidden enemies excluded). For an enemy unit it would use the ENEMY's vision and could name a unit
 *   the viewer can't see, so we withhold it; the enemy overlay uses the geometric threat tiles.
 */
export const buildInspectionRanges = (match: MatchWrapper, unit: UnitWrapper, isOwn: boolean) => {
  const canAttack = buildWeapons(unit).length > 0;
  const accessibleNodes = getAccessibleNodes(match, unit);
  const attackableTiles = canAttack
    ? getAttackableTiles(match, unit, undefined, accessibleNodes)
    : [];

  return {
    reachableTiles: Array.from(accessibleNodes.keys()),
    attackableTiles,
    directAttackTiles: canAttack ? getAttackableTiles(match, unit, unit.data.position) : [],
    attackTargetTiles:
      canAttack && isOwn ? getAttackTargetTiles(match, unit, undefined, attackableTiles) : [],
  };
};

export const matchPreviewRouter = router({
  /**
   * Everything the client needs to buffer simple actions this turn without any rules knowledge
   * (see `src/frontend/CLAUDE.md`): per-unit reachable tiles, capture state, and production data.
   * Fetched once at the start of the player's turn; the client applies its buffered moves/captures/
   * production against this and lets the backend reconcile.
   */
  turnSnapshot: playerInMatchBaseProcedure.query(({ ctx: { match, player } }) =>
    buildTurnSnapshot(match, player),
  ),

  /** Tiles the unit can move to, with the shortest-path distance and parent for path drawing. */
  reachableTiles: playerInMatchBaseProcedure
    .input(z.object({ unitPosition: positionSchema }))
    .query(({ ctx: { match, player }, input }) => {
      const unit = getOwnedUnitOrThrow(match, player, input.unitPosition);

      return Array.from(getAccessibleNodes(match, unit).values());
    }),

  /** Enemy units / pipe seams the unit could attack, optionally from a moved-to position. */
  attackTargets: playerInMatchBaseProcedure
    .input(z.object({ unitPosition: positionSchema, fromPosition: positionSchema.optional() }))
    .query(({ ctx: { match, player }, input }) => {
      const unit = getOwnedUnitOrThrow(match, player, input.unitPosition);

      return getAttackTargetTiles(match, unit, input.fromPosition);
    }),

  /** Sub-actions available to the unit after moving to `toPosition` (wait/capture/attack/...). */
  availableActions: playerInMatchBaseProcedure
    .input(
      z.object({
        unitPosition: positionSchema,
        toPosition: positionSchema,
        hasMoved: z.boolean(),
      }),
    )
    .query(({ ctx: { match, player }, input }) => {
      const unit = getOwnedUnitOrThrow(match, player, input.unitPosition);
      const actions = getAvailableSubActions(match, player, unit, input.toPosition, input.hasMoved);

      return Array.from(actions.entries()).map(([action, subAction]) => ({ action, subAction }));
    }),

  /** Tiles a transport (optionally at a moved-to position) can drop a carried unit type onto. */
  unloadTargets: playerInMatchBaseProcedure
    .input(
      z.object({
        transportPosition: positionSchema,
        unitToUnloadType: unitTypeSchema,
        toPosition: positionSchema.optional(),
      }),
    )
    .query(({ ctx: { match, player }, input }): Position[] => {
      const transport = getOwnedUnitOrThrow(match, player, input.transportPosition);
      const unitToUnload: { type: UnitType } = { type: input.unitToUnloadType };

      return getUnloadablePositions(transport, unitToUnload, input.toPosition);
    }),

  /** Min/max damage each side would take if the attacker (at `toPosition`) hits `targetPosition`. */
  combatForecast: playerInMatchBaseProcedure
    .input(
      z.object({
        attackerPosition: positionSchema,
        toPosition: positionSchema,
        targetPosition: positionSchema,
      }),
    )
    .query(({ ctx: { match, player }, input }) => {
      const attacker = getOwnedUnitOrThrow(match, player, input.attackerPosition);

      // Only forecast against a target the attacker can actually, VISIBLY attack from `toPosition`.
      // getAttackTargetTiles is fog-aware (hidden/dived enemies aren't offered), so gating on it both
      // rejects illegal/stale targets with a typed error instead of a raw 500, AND closes the fog
      // probe leak — a concealed enemy can't be forecast because it is never a valid target here.
      const targets = getAttackTargetTiles(match, attacker, input.toPosition);

      if (!targets.some((target) => isSamePosition(target, input.targetPosition))) {
        throw new DispatchableError("That target can't be attacked from that position");
      }

      // If the viewer can't see the defender's real HP (a Sonja unit masks it), forecast against a
      // full-HP defender — otherwise the returned damage range would leak the hidden value (it scales
      // with the defender's HP). Same masking rule the board uses (`maskUnitForViewer`).
      const defenderUnit = match.getUnit(input.targetPosition);
      const hpHidden =
        defenderUnit !== undefined &&
        maskUnitForViewer(defenderUnit, player.team).stats === "hidden";

      const forecast = getBattleForecast(
        match,
        attacker,
        input.toPosition,
        input.targetPosition,
        hpHidden,
      );

      // Enrich with the context the combat box shows: each side's type and the target tile's terrain
      // defense stars (the "applied def modifier" — already baked into the damage math, surfaced here
      // so the player can SEE it). Defender may be a pipe seam rather than a unit.
      //
      // We deliberately do NOT send either side's current HP: the box shows the RANGE OF DAMAGE (a
      // percentage), not the resulting life, so HP isn't needed — and sending the defender's HP would
      // leak it when it's masked.
      const targetTile = match.getTile(input.targetPosition);
      const defenderType = defenderUnit !== undefined ? defenderUnit.data.type : "pipeSeam";

      return {
        ...forecast,
        attacker: { type: attacker.data.type as string },
        defender: { type: defenderType as string },
        defenseStars: getTerrainDefenseStars(targetTile.type),
        terrainType: targetTile.type,
      };
    }),

  /**
   * Full stat readout for a single VISIBLE unit — powers the right-click unit-detail card. Unlike the
   * other previews this is NOT turn-gated (you inspect enemy units on their turn too), so it rides on
   * `matchBaseProcedure` and gates visibility itself: a fog-hidden / concealed unit can't be probed.
   */
  unitDetails: matchBaseProcedure
    .input(z.object({ unitPosition: positionSchema }))
    .query(({ ctx: { match, currentPlayer }, input }) => {
      const unit = match.getUnit(input.unitPosition);

      if (unit === undefined) {
        // A pipe seam is attackable terrain with its own HP — "half a unit": no movement, fuel or
        // weapons, but a health bar you must be able to read before committing a shot at it. It has
        // no unit to inspect, so it answers here rather than needing its own endpoint.
        return buildPipeSeamDetails(match, currentPlayer.id, input.unitPosition);
      }

      // Same visibility rule as `match.full`: a spectator (no team) sees every non-concealed unit;
      // a player sees what their team's vision covers. Don't leak a unit the viewer can't see.
      const viewer = match.getPlayerById(currentPlayer.id);
      const viewerTeam = viewer?.team;
      const isVisible =
        viewerTeam === undefined
          ? !("hidden" in unit.data && unit.data.hidden)
          : viewerTeam.canSeeUnitAtPosition(unit.data.position);

      if (!isVisible) {
        throw new DispatchableError("You can't see that unit");
      }

      const isOwn = viewer !== undefined && unit.data.playerSlot === viewer.data.slot;

      return {
        ...buildUnitDetails(unit, isOwn, viewerTeam ?? null),
        ...buildInspectionRanges(match, unit, isOwn),
      };
    }),
});
