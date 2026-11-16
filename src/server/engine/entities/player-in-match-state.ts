import type { COPowerState } from "server/engine/rules/co";
import type { Army } from "server/core/schemas/army";
import type { COID } from "server/core/schemas/co";
import type { PlayerSlot } from "server/core/schemas/player-slot";
import type { UnitType } from "server/core/schemas/unit";

/**
 * Dev-tool modifiers in force for this player. Absent/empty on every normal match.
 *
 * Lives here — on player state — rather than on the units it affects, because the unit schema
 * doubles as `PrismaUnits`, the stored shape of a map's `predeployedUnits`; a dev flag there would
 * leak into map-authoring vocabulary. Keying the locks by unit type also sidesteps units having no
 * stable id (their identity is position + playerSlot, which changes as they move).
 *
 * Set only by `devTool` events, so it rebuilds correctly on event-log replay.
 */
export type DevModifiers = {
  /** captures complete in one action, exactly like Sami's super CO power */
  directCapture?: boolean;
  /** units cost nothing to build */
  freeProduction?: boolean;
  /** unit type → pinned VISUAL hp (1–10). Units of that type sit at this value and take 0 damage. */
  hpLocks?: Partial<Record<UnitType, number>>;
  /** unit type → pinned fuel. Units of that type sit at this value and never drain. */
  fuelLocks?: Partial<Record<UnitType, number>>;
  /** unit type → pinned ammo. Units of that type sit at this value; no-ammo types ignore it. */
  ammoLocks?: Partial<Record<UnitType, number>>;
};

export type PlayerInMatch = {
  slot: PlayerSlot;
  hasCurrentTurn?: boolean;
  id: string;
  name: string;
  ready?: boolean;
  coId: COID;
  /**
   * How the player stands in the match. Anything other than `alive` means they're out for good, and
   * `deriveGameOver` reads exactly that — a team with no `alive` player is eliminated, whatever the
   * reason. `resigned` is kept distinct from `routed` so the battle report can say they conceded
   * rather than implying they were wiped off the board.
   */
  status: "alive" | "routed" | "captured" | "resigned";
  /** Persisted match result for this player, set once when the match is finalized. */
  result?: "won" | "lost" | "drawn";
  funds: number;
  powerMeter: number;
  timesPowerUsed: number;
  army: Army;
  COPowerState: COPowerState;
  /**
   * Whether this player has PRODUCED (built) a unit since the game started — predeployed/starting
   * units don't count. Gates the "no units left = defeat" rule: a player only loses from having zero
   * units once they've built at least one (so an empty round-one board isn't an instant loss). Set in
   * the build apply step so it survives event-log replay.
   */
  hasBuiltUnit?: boolean;
  /** Dev-tool modifiers. Undefined on every normal match — see {@link DevModifiers}. */
  devModifiers?: DevModifiers;
  /**
   * Remaining turn-clock time in ms. Undefined means "not started their first turn yet" (resolves to
   * the match's starting bank) or an untimed match — see engine/rules/turn-clock.ts. Written only by
   * the pass-turn apply step, from time recorded ON the event, so it rebuilds exactly on replay.
   */
  timeBankMs?: number;
};

export const createNeutralPlayerInMatch: () => PlayerInMatch = () => {
  return {
    slot: -1,
    hasCurrentTurn: false,
    id: "Neutral",
    name: "Neutral",
    ready: true,
    coId: { name: "adder", version: "AW2" },
    status: "alive",
    funds: 0,
    powerMeter: 0,
    timesPowerUsed: 0,
    army: "black-hole",
    COPowerState: "no-power",
  };
};
