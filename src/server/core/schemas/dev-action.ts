import { z } from "zod";
import { positionSchema } from "./position";
import { playerSlotForUnitsSchema } from "./player-slot";
import { unitTypeSchema } from "./unit";

/**
 * Privileged "fabricate game state" actions.
 *
 * Deliberately a SEPARATE union from `mainActionSchema` rather than extra variants inside it. Two
 * reasons, both load-bearing:
 *   1. A dev action can never arrive on the normal action path, which is gated on "it's your turn"
 *      but not on any capability — merging the unions would put cheats one payload field away from
 *      every player.
 *   2. Dev actions must never surface in available-actions/previews, which are computed over the
 *      main union and shipped to the client.
 */

/**
 * Add (or, with a negative amount, remove) funds.
 *
 * `playerSlotForUnitsSchema` (0–7), not the properties variant (-1–7), because -1 is the neutral
 * pseudo-player: `getPlayerBySlot(-1)` returns it rather than `undefined`, so a -1 slot would
 * quietly credit funds to neutral instead of failing. Same reasoning for `chargePower`.
 */
const addFundsActionSchema = z.object({
  type: z.literal("addFunds"),
  playerSlot: playerSlotForUnitsSchema,
  /**
   * Bounded rather than unconstrained: an unbounded amount silently overflows the funds display and
   * makes build costs meaningless. Negative is allowed — testing a bankrupt state is a real case.
   */
  amount: z.number().int().gte(-999_999).lte(999_999),
});

/** Set the CO power meter. The engine clamps to the CO's real maximum. */
const chargePowerActionSchema = z.object({
  type: z.literal("chargePower"),
  playerSlot: playerSlotForUnitsSchema,
  /** null = fill to max, the common case when testing a power. */
  amount: z.number().int().nonnegative().nullable(),
});

/** Move a unit anywhere, ignoring movement range, terrain cost, fuel and intervening units. */
const teleportUnitActionSchema = z.object({
  type: z.literal("teleportUnit"),
  from: positionSchema,
  to: positionSchema,
});

/** Remove any unit, including an enemy's. */
const deleteAnyUnitActionSchema = z.object({
  type: z.literal("deleteAnyUnit"),
  position: positionSchema,
});

/**
 * ── One-shot effects ────────────────────────────────────────────────────────
 * Everything above mutates state once and replays deterministically.
 */

/**
 * ── Persistent modifiers ────────────────────────────────────────────────────
 *
 * These are toggles, not one-shot effects: every later action has to consult them. They are still
 * events (the toggle itself is the event), but what they write is a flag that the rules read.
 */

/**
 * Captures complete in a single action, exactly like Sami's super CO power.
 *
 * Deliberately a modifier rather than a "capture this tile now" one-shot. It plugs into
 * `willCaptureTile` (`events/handlers/ability.ts:10`) alongside the existing Sami SCOP branch, so
 * the *real* capture path still runs — which means HQ-capture elimination and the capture-limit
 * victory check keep working. A tool that flipped tile ownership directly would silently skip both.
 */
const setDirectCaptureActionSchema = z.object({
  type: z.literal("setDirectCapture"),
  playerSlot: playerSlotForUnitsSchema,
  enabled: z.boolean(),
});

/** Units cost nothing to build; the funds check and the debit are both skipped. */
const setFreeProductionActionSchema = z.object({
  type: z.literal("setFreeProduction"),
  playerSlot: playerSlotForUnitsSchema,
  enabled: z.boolean(),
});

/**
 * Pin every unit of one type to a fixed HP: "lock infantry at 7HP" puts all of that player's
 * infantry at 7HP and holds them there, taking 0 damage.
 *
 * A pin, not a freeze — it *sets* the value as well as holding it, which is what makes it useful for
 * staging a scenario. Applies to units built later too, so the type stays pinned without re-issuing.
 *
 * Keyed by unit type on the player, NOT by unit:
 *   1. Units carry no stable id — identity is position + playerSlot — so a per-unit flag would have
 *      to live on the unit record itself.
 *   2. …and it can't: the unit schema doubles as `PrismaUnits`, the stored shape of a map's
 *      `predeployedUnits`. A dev-tool flag there would leak into map-authoring vocabulary.
 *
 * `visualHp` is the 1–10 HP the player sees, not the 0–100 internal precision (`unit.setHp` takes
 * precise; `entities/unit.ts:144` shows the ×10 relationship). 0 is excluded: that would mean
 * "pinned dead", and killing units is `deleteAnyUnit`'s job.
 */
const setHpLockActionSchema = z.object({
  type: z.literal("setHpLock"),
  playerSlot: playerSlotForUnitsSchema,
  unitType: unitTypeSchema,
  /** null clears the lock and lets the type take damage normally again. */
  visualHp: z.number().int().min(1).max(10).nullable(),
});

/**
 * Same idea for fuel: pin every unit of one type to a fuel value and stop it draining.
 *
 * Separate from the HP lock rather than a shared `{ lock, value }` pair because the ranges are
 * unrelated — fuel's ceiling is the unit type's `initialFuel`, so the engine clamps on apply where
 * it knows the type's properties.
 */
const setFuelLockActionSchema = z.object({
  type: z.literal("setFuelLock"),
  playerSlot: playerSlotForUnitsSchema,
  unitType: unitTypeSchema,
  /** null clears the lock. Clamped to the type's `initialFuel` on apply. */
  fuel: z.number().int().nonnegative().nullable(),
});

/**
 * Same idea for ammo. Units of a type that carries no ammo (e.g. infantry) silently ignore the pin —
 * `setAmmo` no-ops for them — so the lock is harmless to set on any type.
 */
const setAmmoLockActionSchema = z.object({
  type: z.literal("setAmmoLock"),
  playerSlot: playerSlotForUnitsSchema,
  unitType: unitTypeSchema,
  /** null clears the lock. Clamped to the type's `initialAmmo` on apply. */
  ammo: z.number().int().nonnegative().nullable(),
});

export const devActionSchema = z.discriminatedUnion("type", [
  addFundsActionSchema,
  chargePowerActionSchema,
  teleportUnitActionSchema,
  deleteAnyUnitActionSchema,
  setDirectCaptureActionSchema,
  setFreeProductionActionSchema,
  setHpLockActionSchema,
  setFuelLockActionSchema,
  setAmmoLockActionSchema,
]);

export type DevAction = z.infer<typeof devActionSchema>;
export type AddFundsAction = z.infer<typeof addFundsActionSchema>;
export type ChargePowerAction = z.infer<typeof chargePowerActionSchema>;
export type TeleportUnitAction = z.infer<typeof teleportUnitActionSchema>;
export type DeleteAnyUnitAction = z.infer<typeof deleteAnyUnitActionSchema>;
export type SetDirectCaptureAction = z.infer<typeof setDirectCaptureActionSchema>;
export type SetFreeProductionAction = z.infer<typeof setFreeProductionActionSchema>;
export type SetHpLockAction = z.infer<typeof setHpLockActionSchema>;
export type SetFuelLockAction = z.infer<typeof setFuelLockActionSchema>;
export type SetAmmoLockAction = z.infer<typeof setAmmoLockActionSchema>;
