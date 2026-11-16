import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { MaskedUnit, UnitView, WWUnit } from "server/core/schemas/unit";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";
import type { Position } from "server/core/schemas/position";
import type { MatchWrapper } from "server/engine/entities/match";
import { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { UnitWrapper } from "server/engine/entities/unit";
import { Vision } from "server/engine/entities/vision";
import { isLowAmmo, isLowFuel } from "server/engine/rules/supply";

/**
 * A transport's cargo is stored inline on the transport (`loadedUnit`/`loadedUnit2`, each with the
 * loaded unit's real stats). Outside fog of war an enemy can see what a transport carries (you could
 * work it out by watching the board anyway — this just surfaces it). Under fog the cargo stays hidden.
 * So we null the cargo out of the serialized unit for enemy viewers only when the match is fogged;
 * own units always serialize unchanged.
 */
const stripLoadedCargoForEnemy = (data: WWUnit): WWUnit => {
  if (!("loadedUnit" in data)) {
    return data; // not a transport — nothing to hide
  }

  if ("loadedUnit2" in data) {
    return { ...data, loadedUnit: null, loadedUnit2: null };
  }

  return { ...data, loadedUnit: null };
};

/**
 * Fuel and ammo are only secret under fog, for the same reason cargo is: outside fog you watch the
 * unit move every turn and can infer its supply anyway, so withholding it would only make the UI lie
 * about something the viewer already knows. Under fog the unit itself is a secret, so its
 * consumables are too — and showing only the reading from the turn you happened to witness would be
 * more misleading than showing nothing, since a stale number looks exactly like a live one.
 *
 * HP is deliberately NOT stripped: a unit you can see, you can read the health of. Sonja is the only
 * thing that hides life (see maskUnitForViewer).
 */
const stripConsumablesForEnemy = (data: WWUnit): MaskedUnit => {
  if (data.stats === "hidden") {
    return data; // nothing to strip — Sonja already hides the lot
  }

  return { ...data, stats: { hp: data.stats.hp } };
};

/**
 * Serialize a unit as a given viewer sees it. Three enemy-only redactions live here:
 *
 * 1. Transport cargo: under fog an enemy can't see what a transport carries (see
 *    stripLoadedCargoForEnemy); outside fog the cargo is visible.
 * 2. Consumables (fuel/ammo): same rule as cargo — secret under fog, public outside it (see
 *    stripConsumablesForEnemy). HP is never stripped by fog.
 * 3. Sonja's day-to-day hides her units' HP/fuel/ammo from everyone but her own team — and, unlike
 *    fog, it applies even in clear weather. So an enemy viewer gets `stats: "hidden"` (the FE then
 *    renders no HP badge, exactly like a fog-masked unit).
 *
 * Every viewer also gets `supply` — whether the unit is low on fuel/ammo — derived here rather than
 * on the client, which holds no game constants and so can't compare against a maximum. It's `null`
 * exactly when the consumables behind it are masked, otherwise the flag would leak what the
 * redaction above just hid.
 *
 * The unit's own team serializes unchanged (plus supply). `viewerTeam === null` is a spectator,
 * treated as an enemy of every army so they get no privileged intel.
 *
 * This is the single masking rule; the board (`match.full`) and the fog-discovery path both route
 * through it so an enemy can never read cargo, consumables or Sonja's true HP from either.
 */
export const maskUnitForViewer = (unit: UnitWrapper, viewerTeam: TeamWrapper | null): UnitView => {
  const isOwnUnit = viewerTeam?.players.some((p) => p.data.slot === unit.data.playerSlot) ?? false;

  if (isOwnUnit) {
    return { ...unit.data, supply: { lowFuel: isLowFuel(unit), lowAmmo: isLowAmmo(unit) } };
  }

  const isFogOfWar = unit.match.isFogOfWar();
  // Cargo is only secret under fog; outside fog an enemy sees what a transport carries.
  const data = isFogOfWar ? stripLoadedCargoForEnemy(unit.data) : unit.data;

  if (unit.player.data.coId.name === "sonja") {
    // Perma-fog on life AND resources, whatever the weather — so no supply flag either.
    return { ...data, stats: "hidden", supply: null };
  }

  if (!isFogOfWar) {
    return { ...data, supply: { lowFuel: isLowFuel(unit), lowAmmo: isLowAmmo(unit) } };
  }

  // Under fog: consumables are secret like the cargo above, so the supply flag goes with them.
  return { ...stripConsumablesForEnemy(data), supply: null };
};

export class TeamWrapper {
  public players: PlayerInMatchWrapper[];
  public vision: Vision | null = null; // changes from null to vision to null when it rains / clear in awds

  // Fog memory: the last property owner this team actually SAW, keyed by "x,y". A property is always
  // drawn (it's terrain), so under fog a tile the team can't currently see must render its LAST-KNOWN
  // owner — otherwise a capture out of the team's vision would leak through the full board refetch
  // (see fogViewChangeableTiles). Shared per team, so teammates share vision memory. In-memory only:
  // wiped on server restart (falls back to the map's initial owner until re-scouted — never leaks).
  private lastKnownPropertyOwners = new Map<string, PlayerSlot>();

  constructor(
    players: PlayerInMatch[],
    public match: MatchWrapper,
    public index: number,
  ) {
    this.players = players.map((p) => new PlayerInMatchWrapper(p, this));

    if (match.isFogOfWar()) {
      this.vision = new Vision(this);
    }
  }

  isPositionVisible(position: Position) {
    if (this.match.isFogOfWar()) {
      if (this.vision === null) {
        this.vision = new Vision(this); // that should not happen, but whatever
      }

      return this.vision.isPositionVisible(position);
    }

    // in clear weather all positions are visible
    return true;
  }

  /** Record the owner this team currently sees at a property tile (its last-known owner under fog). */
  rememberPropertyOwner(position: Position, playerSlot: PlayerSlot) {
    this.lastKnownPropertyOwners.set(`${position[0]},${position[1]}`, playerSlot);
  }

  /** The last property owner this team saw at a tile, or `undefined` if it has never had vision of it. */
  getLastKnownPropertyOwner(position: Position): PlayerSlot | undefined {
    return this.lastKnownPropertyOwners.get(`${position[0]},${position[1]}`);
  }

  getUnits() {
    return this.players.flatMap((player) => player.getUnits());
  }

  getEnemyUnits() {
    const playerSlotsOfTeam = this.players.map((p) => p.data.slot);

    return this.match.units.filter((unit) => !playerSlotsOfTeam.includes(unit.data.playerSlot));
  }

  canSeeUnitAtPosition(position: Position) {
    const playerSlots = this.players.map((player) => player.data.slot);
    const tile = this.match.getTile(position);
    const unit = this.match.getUnit(position);

    if (unit === undefined) {
      return false; //no unit in specified position
    }

    if (playerSlots.includes(unit.player.data.slot)) {
      return true; // own unit
    }

    if ("playerSlot" in tile && playerSlots.includes(tile.playerSlot)) {
      return true; // on top of allied property
    }

    // sub or stealth ability
    if ("hidden" in unit.data && unit.data.hidden) {
      return unit.getNeighbouringUnits().some((unit) => playerSlots.includes(unit.data.playerSlot));
    }

    return this.isPositionVisible(unit.data.position);
  }

  getEnemyUnitsInVision() {
    const playerSlots = this.players.map((player) => player.data.slot);

    return this.getEnemyUnits()
      .filter((enemy) => {
        const tile = enemy.getTile();

        // units hidden by ability (sub/stealth) also get revealed on owned properties
        if ("playerSlot" in tile && playerSlots.includes(tile.playerSlot)) {
          return true;
        }

        // sub or stealth ability
        if ("hidden" in enemy.data && enemy.data.hidden) {
          return enemy
            .getNeighbouringUnits()
            .some((unit) => playerSlots.includes(unit.data.playerSlot));
        }

        return this.isPositionVisible(enemy.data.position);
      })
      .map<UnitView>((visibleEnemyUnit) => maskUnitForViewer(visibleEnemyUnit, this));
  }

  addUnwrappedPlayer(player: PlayerInMatch): PlayerInMatchWrapper {
    const playerWrapper = new PlayerInMatchWrapper(player, this);
    this.players.push(playerWrapper);
    return playerWrapper;
  }
}
