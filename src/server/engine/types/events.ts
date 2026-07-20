import type {
  AbilityAction,
  AttackAction,
  BuildAction,
  COPowerAction,
  DeleteAction,
  LaunchMissileAction,
  MoveAction,
  PassTurnAction,
  RepairAction,
  UnloadNoWaitAction,
  UnloadWaitAction,
  WaitAction,
} from "server/core/schemas/action";
import type { Army } from "server/core/schemas/army";
import type { COID } from "server/core/schemas/co";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { Position } from "server/core/schemas/position";
import type { UnitType, UnitView } from "server/core/schemas/unit";
import type { Weather } from "server/core/schemas/weather";
import type { CapturableTile } from "server/core/schemas/tile-state";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";

/** Engine events are per-match; this id wrapper travels with the non-stored event types below. */
export type WithMatchId = { matchId: string };

/** player slot 0 implicity starts */
export type MatchStartEvent = {
  type: "matchStart";
  weather: Weather;
};

export type MatchEndEvent = {
  type: "matchEnd";
  winningTeamPlayerIds: string[] | null; // null = draw
  // TODO this type can probably be made a lot more fine-grained later on
};

export type MoveEventWithoutSubEvent = {
  trap: boolean;
  fundsGained?: number; //for joining. it is not undefined if and only if the move is a join
} & Omit<MoveAction, "subAction">;

export type MoveEventWithSubEvent<SubEventType extends SubEvent = SubEvent> =
  MoveEventWithoutSubEvent & {
    subEvent: SubEventType;
  };

export type AttackEvent = {
  /**
   * The new defender HP after the attack.
   */
  defenderHP: number;
  /**
   * The new attacker HP after the attack.
   * If undefined, that means HP is unchanged
   * because there was no counter-attack.
   */
  attackerHP?: number;
} & AttackAction &
  WithElimination<`all-${"attacker" | "defender"}-units-destroyed`>;

export type COPowerEvent = COPowerAction & {
  /** used for rachel, von-bolt and sturm SCOPs */
  positions?: Position[];
};

type WithPlayer = {
  playerId: string;
};

/**
 * A player leaving the match for good, and why. Most eliminations are recorded inline on the event
 * that caused them (an attack's `eliminationReason`, a pass-turn's `Turn.eliminationReason`) and this
 * event is the standalone form — for an exit that no other action explains. `surrendered` is its
 * first real producer; `timer-ran-out` is the same shape, for when the turn timer lands.
 */
export type PlayerEliminatedEvent = WithPlayer & {
  type: "player-eliminated";
} & (
    | { eliminationReason: Exclude<Turn["eliminationReason"], undefined> }
    | { eliminationReason: Exclude<AttackEvent["eliminationReason"], undefined> }
    | {
        eliminationReason: Exclude<AbilityEvent["eliminationReason"], undefined>;
        capturedByPlayerId: string;
      }
    | { eliminationReason: "timer-ran-out" }
    | { eliminationReason: "surrendered" }
  );

type WithElimination<Reason extends string> = {
  eliminationReason?: Reason;
};

/** TODO maybe add the turn/day number */
export type Turn = WithElimination<"all-units-crashed"> & {
  newWeather: Weather | null;
  /**
   * Duration in days for a newly-drawn random weather (see getRandomWeatherDurationDays). Only set
   * when `newWeather` is a non-clear random draw; defaults to 1 day when absent (CO-power / legacy
   * events, which carry their own fixed duration through `setWeather`).
   */
  newWeatherDays?: number;
};

export type PassTurnEvent = PassTurnAction & { turns: Turn[] };

/**
 * The "start of turn" summary for the player whose turn just began — day number plus which of their
 * units the engine repaired/refuelled during the pass-turn upkeep. Derived state (rebuilt by
 * replaying the event log, like weather/funds), not a stored event; the engine keeps only the latest
 * one on the match and the FE renders the start-round animation from it. See applyPassTurnEvent.
 */
export type TurnStartReport = {
  day: number;
  playerId: string;
  /** visual-HP gained per repaired unit (property/CO repair), keyed by board position */
  repaired: { position: Position; hp: number }[];
  /** units whose fuel went up this upkeep (property resupply or adjacent APC) */
  refuelled: Position[];
  /**
   * Units destroyed by running out of fuel during this upkeep, at the tile they went down on. The FE
   * plays a crash animation over each — without it a fuel-out reads as a unit silently vanishing.
   *
   * Collected as they crash rather than diffed afterwards like `repaired`/`refuelled`: they're
   * removed from the match during the upkeep, so by the time the report is built they're gone.
   */
  crashed: Position[];
  /** funds gained from owned properties this upkeep (income). */
  income: number;
  /** funds spent repairing units on friendly properties this upkeep (refuel/resupply is free). */
  repairSpent: number;
  /** the player's funds after the whole upkeep (previous banked + income − repairSpent). */
  fundsAfter: number;
};

/**
 * How a unit was touched by a power at activation, for the FE's per-unit launch blink:
 * - `repaired` — HP went up (Andy Hyper Repair, Andy SCOP, …)
 * - `damaged`  — HP went down (Rachel/Sturm/von-Bolt SCOP area hits)
 * - `spawned`  — a unit the power created (Sensei's copters/mechs)
 * - `empowered`— the activating army taking the power on (stat/movement buffs via ongoing hooks like
 *   Max/Sami, or simply "the power is now active on this unit") — the default for the caster's units.
 */
export type PowerEffectKind = "repaired" | "damaged" | "spawned" | "empowered";

/** A unit the power affected, tagged with how — the FE blinks each one, tinted by `kind`. */
export type PowerAffectedUnit = {
  position: Position;
  kind: PowerEffectKind;
};

/**
 * The signature set-piece of a power — the canonical Advance Wars animation the FE plays at launch.
 * Two flavours:
 * - POSITIONAL strikes over `epicenters`: Sturm's falling `meteor`, von-Bolt's "Ex Machina"
 *   `lightning`, Rachel's `missiles` barrage.
 * - GLOBAL sweeps across the whole board (no epicenters): Drake's `tsunami` wave, Hawke's `blackWave`
 *   dark flash, Olaf's `blizzard` flurry.
 * Declared per power via `COPower.signatureEffect`; absent for powers with no set-piece. Epicenters
 * (positional flavours only) are fog-masked per viewer at the view boundary.
 */
export type PowerSignatureKind =
  | "meteor"
  | "lightning"
  | "missiles"
  | "tsunami"
  | "blackWave"
  | "blizzard";

export type PowerSignature = {
  kind: PowerSignatureKind;
  /** Impact tiles for positional strikes; empty for global sweeps. */
  epicenters: Position[];
};

/**
 * The most recent CO-power activation, set by applyCOPowerEvent and cleared at the next pass-turn.
 * Transient derived state (rebuilt on event-log replay, like {@link TurnStartReport}) — the FE reads
 * it from `match.full` to play the activation cinematic once, then the on-board effects. Public in AW,
 * so it's sent to BOTH viewers; `affectedUnits` is fog-masked per viewer at the view boundary.
 */
export type PowerActivationReport = {
  playerId: string;
  /** the activating CO, for the splash art/portrait */
  coName: COID["name"];
  isSuper: boolean;
  /** the power's display name (e.g. "Tsunami"), from the engine CO constants */
  powerName: string;
  /**
   * The units the power touched, each tagged with what happened (heal/damage/spawn/empower) — derived
   * by diffing unit HP + identity across the instant effect, plus the caster's remaining units as
   * `empowered`. The FE plays a one-shot per-unit blink over these at launch.
   */
  affectedUnits: PowerAffectedUnit[];
  /**
   * The signature set-piece for an offensive positional power (meteor / lightning / missiles) plus
   * its impact tiles, or null for powers with no positional impact. The FE plays it over the board at
   * launch, on top of the per-unit blinks.
   */
  signature: PowerSignature | null;
  /**
   * The activating player's total power-usage count AFTER this activation — a monotonic key the FE
   * gates one-shot playback on (so within-turn refetches don't replay the cinematic).
   */
  timesPowerUsed: number;
};

export type AbilityEvent = AbilityAction &
  WithElimination<"hq-or-labs-captured" | "property-goal-reached">;

export type DeleteEvent = DeleteAction & WithElimination<`all-units-destroyed`>;

export type BuildEvent = BuildAction;
export type LaunchMissileEvent = LaunchMissileAction;
export type RepairEvent = RepairAction;
export type WaitEvent = WaitAction;
export type UnloadNoWaitEvent = UnloadNoWaitAction;
export type UnloadWaitEvent = UnloadWaitAction;

/**
 * A privileged tool's effect, already resolved to concrete values.
 *
 * `kind` rather than `type` because this nests inside {@link DevToolEvent}, whose own `type` is what
 * the event unions discriminate on.
 *
 * Everything here is deterministic on purpose: `chargePower` carries the absolute resulting meter
 * rather than the caller's "fill to max", because max depends on the CO and would otherwise be
 * re-derived at replay time — a different CO version then replays to a different meter.
 */
export type DevEffect =
  | { kind: "addFunds"; playerSlot: PlayerSlot; amount: number }
  | { kind: "chargePower"; playerSlot: PlayerSlot; powerMeter: number }
  | { kind: "teleportUnit"; from: Position; to: Position }
  | { kind: "deleteAnyUnit"; position: Position }
  | { kind: "setDirectCapture"; playerSlot: PlayerSlot; enabled: boolean }
  | { kind: "setFreeProduction"; playerSlot: PlayerSlot; enabled: boolean }
  /** `visualHp: null` clears the lock */
  | { kind: "setHpLock"; playerSlot: PlayerSlot; unitType: UnitType; visualHp: number | null }
  /** `fuel: null` clears the lock */
  | { kind: "setFuelLock"; playerSlot: PlayerSlot; unitType: UnitType; fuel: number | null }
  /** `ammo: null` clears the lock */
  | { kind: "setAmmoLock"; playerSlot: PlayerSlot; unitType: UnitType; ammo: number | null };

/**
 * A dev/admin tool firing. Stored and replayed like any other event — a tool that mutated state
 * directly would make the log replay to a different state than the live match.
 *
 * One event type wrapping an `effect` union, rather than eight sibling event types, keeps the main
 * event union free of dev concerns while still riding the normal store/replay/emit path.
 *
 * `actorName` rides along because dev-tool use is never silent: it's what the in-match log renders.
 */
export type DevToolEvent = {
  type: "devTool";
  actorName: string;
  effect: DevEffect;
};

/**
 * An admin tool firing in a match. Same system as {@link DevToolEvent} — stored, replayed, emitted
 * unfiltered, audited — but a separate event because it answers to a different capability, and
 * because "an admin decided this match" is a materially different thing to read in a log than "a
 * tester gave themselves funds".
 *
 * `forceOutcome` carries the resolved team index rather than a viewer-relative "win/lose": the engine
 * settles by team and has no viewer.
 */
export type AdminEffect = { kind: "forceOutcome"; winnerTeamIndex: number | null };

export type AdminToolEvent = {
  type: "adminTool";
  actorName: string;
  effect: AdminEffect;
};

type MainEventsWithoutMoveEvent =
  | MatchStartEvent
  | UnloadNoWaitEvent
  | PlayerEliminatedEvent
  | COPowerEvent
  | PassTurnEvent
  | BuildEvent
  | DeleteEvent
  | MatchEndEvent
  | DevToolEvent
  | AdminToolEvent;

export type MainEventWithSubEvents = MainEventsWithoutMoveEvent | MoveEventWithSubEvent;

export type MainEventsWithoutSubEvents = MainEventsWithoutMoveEvent | MoveEventWithoutSubEvent;

export type SubEvent =
  | AbilityEvent
  | WaitEvent
  | RepairEvent
  | LaunchMissileEvent
  | UnloadWaitEvent
  | AttackEvent;

type WithDiscoveries = {
  /**
   * `UnitView`, not `WWUnit`: these are already masked for the receiving team (see
   * maskUnitForViewer), so an enemy reveal carries no cargo, no consumables under fog, and no Sonja
   * stats — and each one carries the engine-derived `supply` flag the board badges from.
   */
  discoveredUnits?: UnitView[];
  discoveredProperties?: CapturableTile[];
};

type EmittableAttackParticipantInfo = {
  playerSlot: PlayerSlot;
  powerChargeGained?: number;
  position?: Position;
  HP?: number;
  usedAmmo?: boolean;
  /**
   * Only used for Sasha SCOP
   */
  damageTakenInFunds?: number;
};
export type EmittableAttackEvent = {
  type: "attack";
  attacker?: EmittableAttackParticipantInfo;
  defender?: EmittableAttackParticipantInfo;
  playerUpdate: PlayerInMatch[];
};

/**
 * Dev-tool events go to every team unfiltered — the whole point is that tool use is announced, so
 * there is nothing to hide behind fog. `playerUpdate` carries the resulting player state (funds,
 * meter, modifiers) the same way {@link EmittableAttackEvent} does, so clients don't have to
 * re-derive what a tool changed.
 */
export type EmittableDevToolEvent = DevToolEvent & {
  playerUpdate: PlayerInMatch[];
};

export type EmittableSubEvent =
  | AbilityEvent
  | WaitEvent
  | RepairEvent
  | LaunchMissileEvent
  | UnloadWaitEvent
  | EmittableAttackEvent;

export type EmittableMoveEvent = MoveEventWithoutSubEvent &
  WithDiscoveries & {
    subEvent: EmittableSubEvent;
    /**
     * e.g. for when a unit moves from FoW into vision or when it's unloaded into vision.
     * Masked for the receiving team like `discoveredUnits` above — hence `UnitView`.
     */
    appearingUnit?: UnitView;
  };

export type EmittableEvent = (
  | MatchStartEvent
  | EmittableMoveEvent
  | UnloadNoWaitEvent
  | PlayerEliminatedEvent
  | COPowerEvent
  | PassTurnEvent
  | BuildEvent
  | DeleteEvent
  | MatchEndEvent
  | EmittableDevToolEvent
  | AdminToolEvent
) &
  WithDiscoveries & { teamIndex: number };

export type NonStoredEvent = WithPlayer &
  WithMatchId &
  (
    | {
        type: "player-joined";
      }
    | {
        type: "player-picked-co";
        coId: COID;
      }
    | {
        type: "player-picked-army";
        army: Army;
      }
    | {
        type: "player-picked-slot";
        slot: PlayerSlot;
      }
    | {
        type: "player-left";
      }
    | {
        type: "player-changed-ready-status";
        ready: boolean;
      }
  );

/**
 * v2 lobby/general-picker round events. Unlike {@link NonStoredEvent} these aren't all per-player
 * (a reveal/cancel is match-wide), so they carry their own optional `playerId` rather than the
 * mandatory {@link WithPlayer}. Emitted on the match room once the Match(setup) exists.
 */
export type LobbyMatchEvent = { matchId: string } & (
  | { type: "pick-started"; pickEndsAt: string }
  | { type: "co-locked"; playerId: string }
  | { type: "pick-reveal"; players: { playerId: string; coId: COID }[] }
  | { type: "match-cancelled"; reason: string; leaverIds: string[] }
);

export type Emittable = (EmittableEvent | NonStoredEvent | LobbyMatchEvent) & { matchId: string };
