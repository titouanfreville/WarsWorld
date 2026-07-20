import { DispatchableError } from "server/engine/dispatchable-error";
import type { DevAction } from "server/core/schemas/dev-action";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { DevEffect, DevToolEvent } from "server/engine/types/events";
import type { DevModifiers } from "server/engine/entities/player-in-match-state";
import { isSamePosition } from "server/core/schemas/position";

/**
 * Dev tools, as events.
 *
 * They ride the normal store → replay → emit path rather than mutating state directly: match state
 * is rebuilt from the event log, so a side-channel write would replay to a different state than the
 * live match — silent desync, which is the opposite of what a testing tool is for.
 *
 * Authorisation is NOT here. Whether the caller may use these at all is decided before we arrive
 * (`requireCapability("devTools")` on the procedure, `assertDevToolsAllowed` for the match).
 */

/** `getPlayerBySlot` answers with the neutral pseudo-player for slot < 0 rather than undefined. */
const getRealPlayerOrThrow = (match: MatchWrapper, playerSlot: number): PlayerInMatchWrapper => {
  const player = match.getPlayerBySlot(playerSlot);

  if (player === undefined || player.data.slot < 0) {
    throw new DispatchableError(`No player in slot ${playerSlot}`);
  }

  return player;
};

const getModifiers = (player: PlayerInMatchWrapper): DevModifiers =>
  (player.data.devModifiers ??= {});

/**
 * Re-pin every unit of a type after its lock changed. Setting a lock has to sweep the units that
 * already exist — a pin only means "all infantry are at 7HP" if the ones already on the board move
 * too, not just the ones built afterwards.
 */
const repinUnitsOfType = (player: PlayerInMatchWrapper, unitType: string): void => {
  player
    .getUnits()
    .filter((unit) => unit.data.type === unitType)
    .forEach((unit) => unit.applyDevPins());
};

export const devActionToEvent = (
  match: MatchWrapper,
  action: DevAction,
  actorName: string,
): DevToolEvent => {
  const effect = ((): DevEffect => {
    switch (action.type) {
      case "addFunds": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return { kind: "addFunds", playerSlot: action.playerSlot, amount: action.amount };
      }

      case "chargePower": {
        const player = getRealPlayerOrThrow(match, action.playerSlot);
        /* Resolve "fill to max" to a concrete meter HERE, not at apply time: max depends on the CO,
         * so a null carried into the log would re-derive differently on replay. */
        const powerMeter = action.amount ?? player.getMaxPowerMeter();

        return {
          kind: "chargePower",
          playerSlot: action.playerSlot,
          powerMeter: Math.max(0, Math.min(powerMeter, player.getMaxPowerMeter())),
        };
      }

      case "teleportUnit": {
        if (match.getUnit(action.from) === undefined) {
          throw new DispatchableError("There is no unit to teleport at that position");
        }

        if (isSamePosition(action.from, action.to)) {
          throw new DispatchableError("The unit is already there");
        }

        /* Refused rather than resolved into a join/load: those are real game mechanics with their
         * own rules, and quietly reinterpreting a teleport as one would surprise the tester. */
        if (match.getUnit(action.to) !== undefined) {
          throw new DispatchableError("There is already a unit at the destination");
        }

        if (match.getTile(action.to) === undefined) {
          throw new DispatchableError("The destination is not on the map");
        }

        return { kind: "teleportUnit", from: action.from, to: action.to };
      }

      case "deleteAnyUnit": {
        if (match.getUnit(action.position) === undefined) {
          throw new DispatchableError("There is no unit to delete at that position");
        }

        return { kind: "deleteAnyUnit", position: action.position };
      }

      case "setDirectCapture": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return {
          kind: "setDirectCapture",
          playerSlot: action.playerSlot,
          enabled: action.enabled,
        };
      }

      case "setFreeProduction": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return {
          kind: "setFreeProduction",
          playerSlot: action.playerSlot,
          enabled: action.enabled,
        };
      }

      case "setHpLock": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return {
          kind: "setHpLock",
          playerSlot: action.playerSlot,
          unitType: action.unitType,
          visualHp: action.visualHp,
        };
      }

      case "setFuelLock": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return {
          kind: "setFuelLock",
          playerSlot: action.playerSlot,
          unitType: action.unitType,
          fuel: action.fuel,
        };
      }

      case "setAmmoLock": {
        getRealPlayerOrThrow(match, action.playerSlot);
        return {
          kind: "setAmmoLock",
          playerSlot: action.playerSlot,
          unitType: action.unitType,
          ammo: action.ammo,
        };
      }
    }
  })();

  return { type: "devTool", actorName, effect };
};

export const applyDevToolEvent = (match: MatchWrapper, event: DevToolEvent): void => {
  const { effect } = event;

  switch (effect.kind) {
    case "addFunds": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      /* Floored at 0: negative funds are not a state the rest of the engine expects (build guards
       * against overspending precisely to keep them non-negative). */
      player.data.funds = Math.max(0, player.data.funds + effect.amount);
      break;
    }

    case "chargePower": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      /* Set directly rather than via `gainPowerCharge`, which no-ops while a power is active — the
       * exact state a tester is most likely to be poking at. */
      player.data.powerMeter = effect.powerMeter;
      break;
    }

    case "teleportUnit": {
      const unit = match.getUnit(effect.from);

      if (unit === undefined) {
        throw new DispatchableError("There is no unit to teleport at that position");
      }

      /* Same remove→move→add dance as a real move (`updateMoveVision`): vision is a per-tile
       * counter, so the unit must give up its old tiles BEFORE the position changes and claim the
       * new ones after. `recalculateVision` would be wrong here — it skips discovery tracking. */
      unit.player.team.vision?.removeUnitVision(unit);
      unit.data.position = effect.to;
      unit.player.team.vision?.addUnitVision(unit);
      break;
    }

    case "deleteAnyUnit": {
      match.getUnit(effect.position)?.remove();
      break;
    }

    case "setDirectCapture": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      getModifiers(player).directCapture = effect.enabled;
      break;
    }

    case "setFreeProduction": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      getModifiers(player).freeProduction = effect.enabled;
      break;
    }

    case "setHpLock": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      const modifiers = getModifiers(player);

      modifiers.hpLocks ??= {};

      if (effect.visualHp === null) {
        delete modifiers.hpLocks[effect.unitType];
      } else {
        modifiers.hpLocks[effect.unitType] = effect.visualHp;
        repinUnitsOfType(player, effect.unitType);
      }

      break;
    }

    case "setFuelLock": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      const modifiers = getModifiers(player);

      modifiers.fuelLocks ??= {};

      if (effect.fuel === null) {
        delete modifiers.fuelLocks[effect.unitType];
      } else {
        modifiers.fuelLocks[effect.unitType] = effect.fuel;
        repinUnitsOfType(player, effect.unitType);
      }

      break;
    }

    case "setAmmoLock": {
      const player = getRealPlayerOrThrow(match, effect.playerSlot);
      const modifiers = getModifiers(player);

      modifiers.ammoLocks ??= {};

      if (effect.ammo === null) {
        delete modifiers.ammoLocks[effect.unitType];
      } else {
        modifiers.ammoLocks[effect.unitType] = effect.ammo;
        repinUnitsOfType(player, effect.unitType);
      }

      break;
    }
  }
};
