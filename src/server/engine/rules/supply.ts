import type { UnitWrapper } from "server/engine/entities/unit";

/**
 * The fraction of a unit's maximum fuel/ammo at or below which it reads as "low on supply" and the
 * board badges it. Scaled per unit type rather than a flat cutoff, so a Fighter (99 fuel) and a
 * Tank (70) warn at a proportionate point in their life rather than at the same absolute number.
 *
 * Evaluated HERE and shipped to the client as a boolean (see maskUnitForViewer's `supply`), because
 * the maximums are engine constants and the frontend is not allowed to hold game constants or derive
 * rule outcomes — it renders the flag, it doesn't compute it.
 */
const LOW_SUPPLY_FRACTION = 1 / 3;

export const isLowFuel = (unit: UnitWrapper): boolean =>
  unit.getFuel() <= unit.properties.initialFuel * LOW_SUPPLY_FRACTION;

/**
 * `getAmmo()` returns null for units that carry no ammo at all (infantry, APC, recon) — they can
 * never be "low", so they never badge.
 */
export const isLowAmmo = (unit: UnitWrapper): boolean => {
  const ammo = unit.getAmmo();

  if (ammo === null || !("initialAmmo" in unit.properties)) {
    return false;
  }

  return ammo <= unit.properties.initialAmmo * LOW_SUPPLY_FRACTION;
};
