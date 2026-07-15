import {
  applyMainEventToMatch,
  applySubEventToMatch,
} from "server/engine/events/apply-event-to-match";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";
import { getFinalPositionSafe } from "server/core/schemas/position";
import type { Position } from "server/core/schemas/position";
import type { UnitType } from "server/core/schemas/unit";
import type { MainEventWithSubEvents, MoveEventWithSubEvent } from "server/engine/types/events";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { UnitWrapper } from "server/engine/entities/unit";

/**
 * End-game match statistics, derived by REPLAYING the event log on a fresh match seed (Epic 3). The
 * engine is the single source of truth (root CLAUDE.md §1): rather than trust numbers baked into
 * event payloads, we re-apply each event and read the resulting engine state, so the stats can never
 * disagree with how the match actually played out. Pure + Prisma-free — feed it a freshly-seeded
 * wrapper (turn 0, before `matchStart`) plus the ordered `Event.content` list; it mutates that
 * wrapper as it replays. The live/hot match must NOT be passed (it's already fully applied).
 *
 * Metrics feed the five End-Game analysis views (see .ai/plans/end-game-screen-plan.md §5):
 * - per-turn series (funds / army value / properties / income) for Global · Military · Control · Economy;
 * - built + CO-powers used;
 * - combat: damage dealt (funds, direct/indirect, by attacker domain), kills, losses — for Damage;
 * - captures + a capture log — for Control;
 * - healing (property = repair spend / power = free) + fuel-out crashes — for Damage · Economy.
 *
 * Damage/healing are read as STATE DELTAS around the relevant (sub)event — attacks around the attack
 * subevent at the two known positions, property/power heals via a position-keyed HP diff across
 * passTurn/coPower (which never relocate units). No engine change (heal-events deferred; see the plan).
 */

/** Broad unit domain for the Military / Damage "by class" breakdowns. */
export type UnitDomain = "infantry" | "vehicle" | "air" | "naval";

const domainOf = (type: UnitType): UnitDomain => {
  const { movementType, facility } = unitPropertiesMap[type];

  if (movementType === "foot" || movementType === "boots") {
    return "infantry";
  }

  if (facility === "airport") {
    return "air";
  }

  if (facility === "port") {
    return "naval";
  }

  return "vehicle";
};

/** A player's cumulative counters over the whole match. */
export type PlayerMatchStats = {
  playerId: string;
  /** Units produced from a facility (build events this player owned). */
  built: number;
  /** Split of `built` by the produced unit's domain (Military view: units built by class). */
  builtByDomain: Record<UnitDomain, number>;
  /** Units lost by the lost unit's domain — combat losses AND fuel-out crashes (Military view). */
  lostByDomain: Record<UnitDomain, number>;
  /** Per-unit-type counts (engine key, e.g. `mediumTank`) for the Military sprite sub-rows. */
  builtByUnit: Record<string, number>;
  lostByUnit: Record<string, number>;
  /** Per-unit-type funds of damage dealt (by the attacking unit), for the Damage sprite sub-rows. */
  damageByUnit: Record<string, number>;
  /** Funds spent building units (actual price paid, CO discounts included; via a funds-diff). */
  producedFunds: number;
  /**
   * Total funds earned across the match (income). Derived by conservation at the end — funds only
   * flow in via income and out via production + repair, so `earned = banked + produced + repaired −
   * starting`. Feeds the Economy income-vs-spend table.
   */
  incomeEarned: number;
  /** CO powers + super CO powers activated. */
  powersUsed: number;
  /** Units lost to a turn-start fuel-out crash (combat losses are `unitsLost`). */
  crashed: number;
  /**
   * Funds-value of HP restored by property repair (turn start). By the engine's repair rule this is
   * ALSO exactly the funds spent repairing (cost = hpHealed × buildCost/10), so it doubles as the
   * Economy "Repairs" spend. Derived by HP-diff across each `passTurn`.
   */
  healedByProperty: number;
  /** Funds-value of HP restored by CO-power heals (free — no funds cost). HP-diff across `coPower`. */
  healedByPower: number;
  /** Funds-value of enemy HP this player destroyed in combat (attacks + counters). */
  damageDealt: number;
  /** Funds-value of THIS player's own HP destroyed in combat (the trade-ratio denominator). */
  damageTaken: number;
  /** Split of `damageDealt` by the attacking unit's fire type. */
  damageDirect: number;
  damageIndirect: number;
  /** Split of `damageDealt` by the attacking unit's domain. */
  damageByDomain: Record<UnitDomain, number>;
  /** Enemy units this player destroyed in combat. */
  unitsKilled: number;
  /** Own units this player lost in combat. */
  unitsLost: number;
  /** Properties captured. */
  captures: number;
};

/** One capture, for the Control view's timeline. */
export type CaptureLogEntry = { turn: number; playerId: string; property: string };

/** One snapshot row, taken at each turn boundary, of every player's economic + military footprint. */
export type StatsTimelineRow = {
  turn: number;
  perPlayer: {
    playerId: string;
    funds: number;
    armyValue: number;
    properties: number;
    income: number;
  }[];
};

export type MatchStats = {
  turns: number;
  days: number;
  players: PlayerMatchStats[];
  timeline: StatsTimelineRow[];
  captureLog: CaptureLogEntry[];
};

const armyValueOf = (player: PlayerInMatchWrapper): number =>
  player.getUnits().reduce((sum, unit) => sum + unit.getBuildCost() * (unit.getVisualHP() / 10), 0);

const propertyCountOf = (match: MatchWrapper, player: PlayerInMatchWrapper): number =>
  match.changeableTiles.filter(
    (tile) => "playerSlot" in tile && tile.playerSlot === player.data.slot,
  ).length;

const snapshotRow = (match: MatchWrapper, turn: number): StatsTimelineRow => ({
  turn,
  perPlayer: match.getAllPlayers().map((player) => ({
    playerId: player.data.id,
    funds: player.data.funds,
    armyValue: armyValueOf(player),
    properties: propertyCountOf(match, player),
    income: player.getFundsPerTurn(),
  })),
});

const posKey = (position: readonly [number, number]): string => `${position[0]},${position[1]}`;

/** Per-position unit HP fingerprint, for the heal / crash diff around passTurn / coPower. */
type UnitSnapshot = {
  ownerId: string;
  buildCost: number;
  visualHP: number;
  domain: UnitDomain;
  type: UnitType;
};

const snapshotUnits = (match: MatchWrapper): Map<string, UnitSnapshot> => {
  const snapshot = new Map<string, UnitSnapshot>();

  for (const player of match.getAllPlayers()) {
    for (const unit of player.getUnits()) {
      snapshot.set(posKey(unit.data.position), {
        ownerId: player.data.id,
        buildCost: unit.getBuildCost(),
        visualHP: unit.getVisualHP(),
        domain: domainOf(unit.data.type),
        type: unit.data.type,
      });
    }
  }

  return snapshot;
};

/** A combatant captured just before an attack resolves (it may be destroyed by the time it lands). */
type Combatant = {
  ownerId: string;
  cost: number;
  visualHP: number;
  indirect: boolean;
  domain: UnitDomain;
  type: UnitType;
};

const combatantOf = (unit: UnitWrapper): Combatant => ({
  ownerId: unit.player.data.id,
  cost: unit.getBuildCost(),
  visualHP: unit.getVisualHP(),
  indirect: unit.isIndirect(),
  domain: domainOf(unit.data.type),
  type: unit.data.type,
});

/** Owned property tiles keyed by position, for the capture (ownership-change) diff around abilities. */
const propertyOwners = (match: MatchWrapper): Map<string, { slot: number; type: string }> => {
  const owners = new Map<string, { slot: number; type: string }>();

  for (const tile of match.changeableTiles) {
    if ("playerSlot" in tile && "position" in tile) {
      owners.set(posKey(tile.position), { slot: tile.playerSlot, type: tile.type });
    }
  }

  return owners;
};

/**
 * Replay `events` on `seedMatch` (a fresh, unreplayed wrapper) and accumulate the match stats. Event
 * ordering is the log's `index` order — the caller must pass them sorted, exactly as `MatchStore`
 * rebuilds a match.
 */
export const buildMatchStats = (
  seedMatch: MatchWrapper,
  events: readonly MainEventWithSubEvents[],
): MatchStats => {
  const counters = new Map<string, PlayerMatchStats>();
  // Funds on hand before any event replays — the conservation baseline for `incomeEarned`.
  const startFunds = new Map<string, number>();

  for (const player of seedMatch.getAllPlayers()) {
    startFunds.set(player.data.id, player.data.funds);
    counters.set(player.data.id, {
      playerId: player.data.id,
      built: 0,
      builtByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
      lostByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
      builtByUnit: {},
      lostByUnit: {},
      damageByUnit: {},
      producedFunds: 0,
      incomeEarned: 0,
      powersUsed: 0,
      crashed: 0,
      healedByProperty: 0,
      healedByPower: 0,
      damageDealt: 0,
      damageTaken: 0,
      damageDirect: 0,
      damageIndirect: 0,
      damageByDomain: { infantry: 0, vehicle: 0, air: 0, naval: 0 },
      unitsKilled: 0,
      unitsLost: 0,
      captures: 0,
    });
  }

  const timeline: StatsTimelineRow[] = [];
  const captureLog: CaptureLogEntry[] = [];

  // Our own turn counter: `match.turn` is NOT maintained by the engine (turn ownership is tracked via
  // `hasCurrentTurn` flags), so it stays 0 across replay. We count player-turns ourselves — each
  // passTurn ends one (or more, if players are skipped) — to stamp the timeline + capture log.
  let turnNo = 0;

  const bump = (
    playerId: string,
    key: "built" | "powersUsed" | "crashed" | "unitsKilled" | "unitsLost" | "captures",
  ) => {
    const row = counters.get(playerId);

    if (row !== undefined) {
      row[key] += 1;
    }
  };

  const addFunds = (
    playerId: string,
    key:
      | "healedByProperty"
      | "healedByPower"
      | "damageDealt"
      | "damageTaken"
      | "damageDirect"
      | "damageIndirect"
      | "producedFunds",
    amount: number,
  ) => {
    const row = counters.get(playerId);

    if (row !== undefined) {
      row[key] += amount;
    }
  };

  const bumpDomain = (
    playerId: string,
    key: "builtByDomain" | "lostByDomain",
    domain: UnitDomain,
  ) => {
    const row = counters.get(playerId);

    if (row !== undefined) {
      row[key][domain] += 1;
    }
  };

  // Accumulate a per-unit-type tally (engine key) for the Military / Damage sprite sub-rows.
  const addUnit = (
    playerId: string,
    key: "builtByUnit" | "lostByUnit" | "damageByUnit",
    type: UnitType,
    amount: number,
  ) => {
    const row = counters.get(playerId);

    if (row !== undefined) {
      row[key][type] = (row[key][type] ?? 0) + amount;
    }
  };

  // Credit `dealer` for `funds` of destruction — split by its fire type, domain and unit type.
  const accrueDamage = (dealer: Combatant, funds: number) => {
    addFunds(dealer.ownerId, "damageDealt", funds);
    addFunds(dealer.ownerId, dealer.indirect ? "damageIndirect" : "damageDirect", funds);
    addUnit(dealer.ownerId, "damageByUnit", dealer.type, funds);

    const row = counters.get(dealer.ownerId);

    if (row !== undefined) {
      row.damageByDomain[dealer.domain] += funds;
    }
  };

  // A destroyed slice of a `victimCost` unit → funds-value = hpLost × victimCost/10, credited to the
  // dealer (dealt) and the victim's owner (taken).
  const recordHit = (dealer: Combatant, victim: Combatant, hpLost: number) => {
    if (hpLost <= 0) {
      return;
    }

    const funds = hpLost * (victim.cost / 10);

    accrueDamage(dealer, funds);
    addFunds(victim.ownerId, "damageTaken", funds);
  };

  const hpAfter = (unit: UnitWrapper | undefined): number =>
    unit === undefined ? 0 : unit.getVisualHP();

  // An attack: capture both combatants BEFORE it resolves (either may be destroyed), then diff.
  const recordAttack = (event: MoveEventWithSubEvent, defenderPosition: Position) => {
    const attackerPosition = getFinalPositionSafe(event.path);
    const attackerUnit = seedMatch.getUnit(attackerPosition);
    const defenderUnit = seedMatch.getUnit(defenderPosition);
    const attacker = attackerUnit === undefined ? null : combatantOf(attackerUnit);
    const defender = defenderUnit === undefined ? null : combatantOf(defenderUnit);

    applySubEventToMatch(seedMatch, event);

    const attackerNow = seedMatch.getUnit(attackerPosition);
    const defenderNow = seedMatch.getUnit(defenderPosition);

    if (attacker !== null && defender !== null) {
      recordHit(attacker, defender, defender.visualHP - hpAfter(defenderNow));

      if (defenderNow === undefined) {
        bump(attacker.ownerId, "unitsKilled");
        bump(defender.ownerId, "unitsLost");
        bumpDomain(defender.ownerId, "lostByDomain", defender.domain);
        addUnit(defender.ownerId, "lostByUnit", defender.type, 1);
      }

      // Counter-attack: the defender destroys some of the attacker (classified by the defender).
      recordHit(defender, attacker, attacker.visualHP - hpAfter(attackerNow));

      if (attackerNow === undefined) {
        bump(defender.ownerId, "unitsKilled");
        bump(attacker.ownerId, "unitsLost");
        bumpDomain(attacker.ownerId, "lostByDomain", attacker.domain);
        addUnit(attacker.ownerId, "lostByUnit", attacker.type, 1);
      }
    }
  };

  // An ability may be a capture — detect it by a property changing owner (supply/dive/hide don't).
  const recordAbility = (event: MoveEventWithSubEvent) => {
    const before = propertyOwners(seedMatch);

    applySubEventToMatch(seedMatch, event);

    const after = propertyOwners(seedMatch);

    for (const [key, nowOwned] of after) {
      const previously = before.get(key);

      if (previously !== undefined && previously.slot !== nowOwned.slot) {
        const capturer = seedMatch.getPlayerBySlot(nowOwned.slot);

        if (capturer !== undefined) {
          bump(capturer.data.id, "captures");
          captureLog.push({
            // Captures happen during the current player's (in-progress) turn.
            turn: turnNo + 1,
            playerId: capturer.data.id,
            property: nowOwned.type,
          });
        }
      }
    }
  };

  for (const event of events) {
    // The acting player for build/coPower is whoever holds the turn when the event applies.
    const actor = seedMatch.getCurrentTurnPlayer();
    // Funds before the event applies — a build deducts the unit's price, read back as production spend.
    const actorFundsBefore = actor?.data.funds ?? 0;

    // passTurn (property repair) and coPower (power heal) restore HP in place without relocating
    // units, so a position-keyed before/after diff cleanly attributes heals — and, for passTurn, the
    // fuel-out crash losses.
    const diffsHeals = event.type === "passTurn" || event.type === "coPower";
    const beforeHeal = diffsHeals ? snapshotUnits(seedMatch) : null;

    applyMainEventToMatch(seedMatch, event);

    if (event.type === "move") {
      const subEvent = event.subEvent;

      if (subEvent.type === "attack") {
        recordAttack(event, subEvent.defenderPosition);
      } else if (subEvent.type === "ability") {
        recordAbility(event);
      } else {
        applySubEventToMatch(seedMatch, event);
      }
    }

    switch (event.type) {
      case "build": {
        if (actor !== undefined) {
          bump(actor.data.id, "built");
          bumpDomain(actor.data.id, "builtByDomain", domainOf(event.unitType));
          addUnit(actor.data.id, "builtByUnit", event.unitType, 1);
          // Production spend = what the build actually cost this player (CO discounts baked in).
          addFunds(
            actor.data.id,
            "producedFunds",
            Math.max(0, actorFundsBefore - actor.data.funds),
          );
        }

        break;
      }
      case "coPower": {
        if (actor !== undefined) {
          bump(actor.data.id, "powersUsed");
        }

        break;
      }
      case "passTurn": {
        // One (or more, if players were skipped/eliminated) player-turns just ended.
        turnNo += event.turns.length;
        // Snapshot everyone's economic + military footprint at this turn boundary for the series.
        timeline.push(snapshotRow(seedMatch, turnNo));

        break;
      }
    }

    if (beforeHeal !== null) {
      const after = snapshotUnits(seedMatch);
      const healKey = event.type === "passTurn" ? "healedByProperty" : "healedByPower";

      for (const [key, now] of after) {
        const prev = beforeHeal.get(key);

        if (prev !== undefined && now.visualHP > prev.visualHP) {
          // Funds-value of restored HP = healedHP × (buildCost / 10).
          addFunds(now.ownerId, healKey, (now.visualHP - prev.visualHP) * (prev.buildCost / 10));
        }
      }

      if (event.type === "passTurn") {
        for (const [key, prev] of beforeHeal) {
          if (!after.has(key)) {
            bump(prev.ownerId, "crashed");
            bumpDomain(prev.ownerId, "lostByDomain", prev.domain);
            addUnit(prev.ownerId, "lostByUnit", prev.type, 1);
          }
        }
      }
    }
  }

  // Income earned, by funds conservation: everything that ended up banked plus everything spent
  // (production + repair), minus what the player started with. Funds only flow in via income and out
  // via production/repair, so this recovers total income without instrumenting each turn-start credit.
  for (const player of seedMatch.getAllPlayers()) {
    const row = counters.get(player.data.id);

    if (row !== undefined) {
      const banked = player.data.funds;
      const start = startFunds.get(player.data.id) ?? 0;
      row.incomeEarned = Math.max(0, banked + row.producedFunds + row.healedByProperty - start);
    }
  }

  const turns = turnNo;
  const playerCount = seedMatch.getAllPlayers().length;

  return {
    turns,
    // A "day" is one full round of turns; with `playerCount` players, that's this many rounds.
    days: playerCount > 0 ? Math.floor(turns / playerCount) + 1 : 1,
    players: [...counters.values()],
    timeline,
    captureLog,
  };
};
