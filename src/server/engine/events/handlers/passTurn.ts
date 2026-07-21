import { getRandomWeather, getRandomWeatherDurationDays } from "server/engine/rules/weather";
import type { PassTurnAction } from "server/core/schemas/action";
import type { Position } from "server/core/schemas/position";
import type { PassTurnEvent, Turn, TurnStartReport } from "server/engine/types/events";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { UnitWrapper } from "server/engine/entities/unit";
import type { ApplyEvent, MainActionToEvent } from "server/engine/events/handler-types";
import { getTurnFuelConsumption } from "server/engine/events/handlers/passTurn/consumeFuelAndCrash";
import { propertyRepairAndResupply } from "server/engine/events/handlers/passTurn/propertyRepairAndResupply";
import { updateWeather } from "server/engine/events/handlers/passTurn/updateWeather";
import { releaseHoldings } from "server/engine/rules/elimination";
import { creditIncrementOnTurnStart, settleBankOnTurnEnd } from "server/engine/rules/turn-clock";

type NewWeather = Pick<Turn, "newWeather" | "newWeatherDays">;

function getNewWeather(nextTurnPlayer: PlayerInMatchWrapper): NewWeather {
  const { match } = nextTurnPlayer;

  if (match.playerToRemoveWeatherEffect !== null) {
    if (
      match.playerToRemoveWeatherEffect.data.slot === nextTurnPlayer.data.slot &&
      match.weatherDaysLeft - 1 <= 0
    ) {
      // the active weather effect has run its course: force clear. Rolling resumes next turn since
      // setWeather("clear") releases the removal state.
      return { newWeather: "clear" };
    }

    // weather stays the same while an effect is active (no new roll until it clears)
    return { newWeather: null };
  }

  // currently clear with no active effect: roll for new random weather (once it's non-clear it locks
  // for a whole number of days, so it lasts equally for every player whatever turn it started on)
  if (match.rules.weatherSetting === "random") {
    const weather = getRandomWeather(match);

    if (weather === "clear") {
      return { newWeather: null };
    }

    return { newWeather: weather, newWeatherDays: getRandomWeatherDurationDays() };
  }

  return { newWeather: null };
}

export const passTurnActionToEvent: MainActionToEvent<PassTurnAction> = (match, action) => {
  const turns: Turn[] = [];

  turnLoop: while (true) {
    const nextTurnPlayer = match.getCurrentTurnPlayer().getNextAlivePlayer();

    if (nextTurnPlayer === null) {
      throw new Error("No next alive player");
    }

    unitLoop: for (const unit of nextTurnPlayer.getUnits()) {
      if (unit.properties.facility === "base") {
        // land units can't crash
        continue unitLoop;
      }

      const tile = unit.getTile();

      const isInRepairFacility = unit.properties.facility === tile.type;

      // if units are on top of a repair property, they can't crash
      if (!isInRepairFacility || !unit.player.owns(tile)) {
        const fuelConsumption = getTurnFuelConsumption(unit);
        const fuelAfterConsumption = unit.getFuel() - fuelConsumption;
        const willCrash = fuelAfterConsumption <= 0;

        if (willCrash && nextTurnPlayer.getUnits().length === 0) {
          // i'm pretty sure even on a turn where a player gets eliminated due to crashing
          // the game still generates a random weather first and sets it if applicable.
          turns.push({
            ...getNewWeather(nextTurnPlayer),
            eliminationReason: "all-units-crashed",
          });

          const singleTeamAlive =
            match.teams.filter((t) => t.players.some((p) => p.data.status === "alive")).length <= 1;

          if (singleTeamAlive) {
            break turnLoop; // TODO not quite sure what should happen then. some MatchEndEvent logic i guess. maybe another field on PassTurnEvent?
          }

          continue turnLoop;
        }
      }
    }

    turns.push(getNewWeather(nextTurnPlayer));
    break turnLoop;
  }

  return {
    ...action,
    turns,
    // Snapshot the ending player's remaining clock INTO the event, alongside the weather roll above.
    // `match.turnEndsAt` is the deadline the orchestrator armed when this turn began; what's left of
    // it is what they bank. Untimed matches record nothing. This is the only place the wall clock is
    // read — everything downstream (apply, replay) works off the recorded number.
    ...(match.turnEndsAt === null
      ? {}
      : { bankRemainingMs: Math.max(0, match.turnEndsAt - Date.now()) }),
  };
};

export const applyPassTurnEvent: ApplyEvent<PassTurnEvent> = (match, event) => {
  /**
   * Things that probably need to be done here (ordered by best effort)
   *
   * - day limit tracking if the turns have looped back around (= "next day") and maybe ending the match
   * - (done) unwait all current player units
   * - (done) disable other player CO powers
   * - random weather or d2d weather influence (use getRandomWeather!!)
   * - (done) active power weather removal
   * - (done) funds
   * - (done) repairs
   * - (done) fuel drain
   * - (done) refuel (property + apc/blackboat)
   */

  // A turn change consumes the last power activation: the cinematic/one-shot flourish belongs to the
  // turn it fired in. Clearing it here bounds the report to that turn so a reconnect can't replay a
  // stale splash (the ongoing power effects live on via COPowerState, not this report).
  match.powerActivationReport = null;

  // Bank what the ENDING player had left, before the loop moves the turn on. Read off the event, so
  // this replays to the same number every time (see engine/rules/turn-clock.ts).
  settleBankOnTurnEnd(match.getCurrentTurnPlayer(), event.bankRemainingMs);

  for (const turn of event.turns) {
    // TODO when we pass multiple turns, getCurrentTurnPlayer relies on the just eliminated / previous player still having a turn
    // i'm just marking this in case this doesn't work as planned.
    const lastTurnPlayer = match.getCurrentTurnPlayer();

    unwaitUnits(lastTurnPlayer);

    // A player who ENDS their turn with no units — having produced at least one earlier — is
    // eliminated. Losing your last unit isn't an instant loss (you may self-destruct to deny a power
    // charge and rebuild the same turn); the check happens at the turn boundary and only once you've
    // built a unit. Set status here in the apply step so it survives replay, like combat/crash
    // elimination. (Fuel-out crashes are handled below via `eliminationReason`.)
    if (
      lastTurnPlayer.data.hasBuiltUnit === true &&
      lastTurnPlayer.data.status === "alive" &&
      lastTurnPlayer.getUnits().length === 0
    ) {
      lastTurnPlayer.data.status = "routed";
      releaseHoldings(match, lastTurnPlayer, null);
    }

    lastTurnPlayer.data.hasCurrentTurn = false;

    const nextTurnPlayer = lastTurnPlayer.getNextAlivePlayer();

    if (nextTurnPlayer === null) {
      throw new Error("No next alive player");
    }

    // A new day begins whenever the turn order wraps back to a player at or before the one who just
    // played (getNextAlivePlayer walks slots modulo numberOfPlayers). Day 1 is set at match start;
    // this advances it once per full round, skipping eliminated slots correctly.
    if (nextTurnPlayer.data.slot <= lastTurnPlayer.data.slot) {
      match.turn += 1;
    }

    nextTurnPlayer.data.hasCurrentTurn = true;
    nextTurnPlayer.data.COPowerState = "no-power";

    updateWeather(nextTurnPlayer, turn.newWeather, turn.newWeatherDays);

    // Capture the funds movement so the FE can animate it at turn start: income is added now, repair
    // cost is deducted inside `propertyRepairAndResupply` below (refuel/resupply is free), so the
    // spend is the drop from (banked + income) to the funds left after the upkeep loop.
    const fundsBeforeUpkeep = nextTurnPlayer.data.funds;
    const income = nextTurnPlayer.getFundsPerTurn();
    nextTurnPlayer.data.funds += income;

    // Snapshot fuel/visual-HP before upkeep so we can report which units the engine actually
    // repaired/refuelled this turn (property repair, property/APC resupply). Net deltas are what the
    // FE animates: fuel that ended higher = refuelled, HP that ended higher = repaired. Units that
    // crash (removed below) simply drop out of the after-pass.
    const upkeepBefore = new Map<UnitWrapper, { fuel: number; hp: number }>();

    for (const unit of nextTurnPlayer.getUnits()) {
      upkeepBefore.set(unit, { fuel: unit.getFuel(), hp: unit.getVisualHP() });
    }

    // Where each fuel-out happened. Recorded as it happens because a crashed unit is removed from the
    // match immediately below — the diff pass that builds `repaired`/`refuelled` can't see it.
    const crashed: Position[] = [];

    // update units
    for (const unit of nextTurnPlayer.getUnits()) {
      const tile = unit.getTile();

      const isInRepairFacility =
        unit.properties.facility === tile.type ||
        (unit.properties.facility === "base" && (tile.type === "city" || tile.type === "hq"));

      // if units are on top of a repair property, they can't crash
      if (isInRepairFacility && unit.player.owns(tile)) {
        propertyRepairAndResupply(unit);
      } else {
        const fuelConsumed = getTurnFuelConsumption(unit);
        unit.drainFuel(fuelConsumed);

        if (unit.properties.facility !== "base" && unit.getFuel() <= 0) {
          // unit crashes
          // (has to be done here cause eagle copters consume 0 fuel per turn, but still crash if they start turn at 0 fuel)
          crashed.push(unit.data.position);
          unit.remove();
        }
      }

      APCresupply(unit);
    }

    // A player whose units all crashed this turn (0 left after fuel-out) is eliminated. Set the
    // status here — in the apply step — so it survives an event-log replay, like combat elimination.
    if (turn.eliminationReason === "all-units-crashed") {
      nextTurnPlayer.data.status = "routed";
      releaseHoldings(match, nextTurnPlayer, null);
    }

    // Record what the upkeep did to the player-now-on-turn's units, for the start-round animation.
    // Overwritten each loop iteration (a multi-turn pass only happens on crash-eliminations); the
    // final surviving player's report is the one that sticks. See MatchWrapper.turnStartReport.
    const repaired: TurnStartReport["repaired"] = [];
    const refuelled: TurnStartReport["refuelled"] = [];

    for (const unit of nextTurnPlayer.getUnits()) {
      const before = upkeepBefore.get(unit);

      if (before === undefined) {
        continue;
      }

      const hpGained = unit.getVisualHP() - before.hp;

      if (hpGained > 0) {
        repaired.push({ position: unit.data.position, hp: hpGained });
      }

      if (unit.getFuel() > before.fuel) {
        refuelled.push(unit.data.position);
      }
    }

    match.turnStartReport = {
      day: match.turn,
      playerId: nextTurnPlayer.data.id,
      repaired,
      refuelled,
      crashed,
      income,
      repairSpent: fundsBeforeUpkeep + income - nextTurnPlayer.data.funds,
      fundsAfter: nextTurnPlayer.data.funds,
    };
  }

  // Credit the incoming player's increment — at the START of their turn, so the clock they watch
  // already includes it, and a player who just flagged begins the next turn with exactly the
  // increment rather than nothing at all.
  creditIncrementOnTurnStart(match.getCurrentTurnPlayer());

  for (const team of match.teams) {
    // TODO improve this. maybe later. not prioritary
    team.vision?.recalculateVision(team.getUnits());
  }
};

function unwaitUnits(player: PlayerInMatchWrapper) {
  for (const unit of player.getUnits()) {
    unit.data.isReady = true;
  }
}

function APCresupply(unit: UnitWrapper) {
  if (unit.data.type === "apc") {
    for (const neighbourUnit of unit.getNeighbouringUnits()) {
      if (unit.player.owns(neighbourUnit)) {
        neighbourUnit.resupply();
      }
    }
  }
}
