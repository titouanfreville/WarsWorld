import { DispatchableError } from "server/engine/dispatchable-error";
import type { COPowerAction } from "server/core/schemas/action";
import type { COPowerEvent, PowerAffectedUnit } from "server/engine/types/events";
import type { MatchWrapper } from "server/engine/entities/match";
import type { COProperties } from "server/engine/rules/co";
import { getCOProperties } from "server/engine/rules/co";
import type { MainActionToEvent } from "server/engine/events/handler-types";

/**
 * Derive which units a power touched, for the FE's per-unit launch blink. Compares unit HP + identity
 * across the instant effect: HP up → repaired (Andy), HP down → damaged (Rachel/Sturm area hits), a
 * unit that didn't exist before → spawned (Sensei). Every other unit the caster owns takes the
 * generic `empowered` blink — the power taking hold on the army (stat/movement buffs like Max/Sami
 * apply via ongoing hooks, not an instant HP change, so they wouldn't otherwise show at launch).
 */
const diffAffectedUnits = (
  match: MatchWrapper,
  casterSlot: number,
  hpBefore: Map<unknown, number>,
  unitsBefore: ReadonlySet<unknown>,
): PowerAffectedUnit[] => {
  const affected: PowerAffectedUnit[] = [];
  const tagged = new Set<string>();
  const keyOf = ([x, y]: readonly [number, number]): string => `${x},${y}`;

  for (const unit of match.units) {
    if (!unitsBefore.has(unit)) {
      affected.push({ position: unit.data.position, kind: "spawned" });
      tagged.add(keyOf(unit.data.position));
      continue;
    }

    const before = hpBefore.get(unit);

    if (before === undefined) {
      continue;
    }

    const now = unit.getVisualHP();

    if (now > before) {
      affected.push({ position: unit.data.position, kind: "repaired" });
      tagged.add(keyOf(unit.data.position));
    } else if (now < before) {
      affected.push({ position: unit.data.position, kind: "damaged" });
      tagged.add(keyOf(unit.data.position));
    }
  }

  // The caster's remaining (untagged) units take the generic power-on blink.
  for (const unit of match.units) {
    if (unit.data.playerSlot !== casterSlot) {
      continue;
    }

    const key = keyOf(unit.data.position);

    if (!tagged.has(key)) {
      affected.push({ position: unit.data.position, kind: "empowered" });
      tagged.add(key);
    }
  }

  return affected;
};

export const coPowerActionToEvent: MainActionToEvent<COPowerAction> = (match, action) => {
  const player = match.getCurrentTurnPlayer();
  const powerType: keyof COProperties["powers"] = action.isSuper ? "superCOPower" : "COPower";

  if (player.data.COPowerState !== "no-power") {
    throw new DispatchableError(`Can't use ${powerType} with a power already active`);
  }

  const coProperties = getCOProperties(player.data.coId);
  const power = coProperties.powers[powerType];

  if (power === undefined) {
    throw new DispatchableError(`Your CO (${coProperties.displayName}) doesn't have ${powerType}`);
  }

  const powerCost = power.stars * player.getPowerStarCost();

  if (powerCost > player.data.powerMeter) {
    throw new DispatchableError(`Not enough power meter for ${powerType}`);
  }

  if (power.calculatePositions !== undefined) {
    return {
      ...action,
      positions: power.calculatePositions(player),
    };
  }

  return action;
};

export const applyCOPowerEvent = (match: MatchWrapper, event: COPowerEvent) => {
  const player = match.getCurrentTurnPlayer();
  const COProperties = getCOProperties(player.data.coId);
  const powerType: keyof COProperties["powers"] = event.isSuper ? "superCOPower" : "COPower";
  const power = COProperties.powers[powerType];

  if (power === undefined) {
    throw new Error(
      `Unexpectedly didn't find power ${powerType} on CO ${COProperties.displayName}`,
    );
  }

  // applying all match rules, read doc of variables for details
  if (player.getVersionProperties().raisePowerCostBeforeUsing) {
    ++player.data.timesPowerUsed;
    player.data.powerMeter -= power.stars * player.getPowerStarCost();
  } else {
    player.data.powerMeter -= power.stars * player.getPowerStarCost();
    ++player.data.timesPowerUsed;
  }

  // Activate the power for the rest of this player's turn — `passTurn` resets it to "no-power" at
  // the start of their NEXT turn. THIS is what makes the ongoing hook-based effects take hold
  // (firepower/defense/movement boosts, Sami's insta-capture, …); without it only the one-shot
  // `instantEffect` below would run and every state-dependent effect would be silently inert.
  player.data.COPowerState = event.isSuper ? "super-co-power" : "co-power";

  // Snapshot HP + unit identity so we can tell the FE exactly which units the power touched (below).
  const hpBefore = new Map<unknown, number>();

  for (const unit of match.units) {
    hpBefore.set(unit, unit.getVisualHP());
  }

  const unitsBefore = new Set<unknown>(match.units);

  //event.positions are for rachel, sturm, von-bolt supers
  power.instantEffect?.(player, event.positions);

  // Record the activation so the FE can play the cinematic + on-board effects. Public in AW (sent to
  // both viewers); the affected units are fog-masked at the view boundary. Cleared at next pass-turn.
  match.powerActivationReport = {
    playerId: player.data.id,
    coName: player.data.coId.name,
    isSuper: event.isSuper,
    powerName: power.name,
    affectedUnits: diffAffectedUnits(match, player.data.slot, hpBefore, unitsBefore),
    // Signature set-piece for powers that declare one: positional strikes (meteor/lightning/missiles)
    // carry their impact tiles; global sweeps (tsunami/blackWave/blizzard) have none. Fog-masked at
    // the view boundary.
    signature:
      power.signatureEffect !== undefined
        ? { kind: power.signatureEffect, epicenters: event.positions ?? [] }
        : null,
    timesPowerUsed: player.data.timesPowerUsed,
  };

  player.team.vision?.recalculateVision(player.team.getUnits()); // justin case
};
