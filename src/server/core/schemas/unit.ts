import { ZodFirstPartyTypeKind, z } from "zod";
import {
  getLoadedSchema,
  unitInMapSharedProperties as shared,
  withAmmoUnitStats,
  withCapturePoints,
  withHidden,
  withNoAmmoUnitStats,
  withTypeSchema,
} from "./unit-traits";

//LAND UNITS:

const infantrySchema = withTypeSchema("infantry")
  .extend(withNoAmmoUnitStats)
  .extend(withCapturePoints);

const mechSchema = withTypeSchema("mech").extend(withAmmoUnitStats).extend(withCapturePoints);

const APCSchema = withTypeSchema("apc")
  .extend(withNoAmmoUnitStats)
  .extend({
    loadedUnit: getLoadedSchema([infantrySchema, mechSchema]),
  });

const reconSchema = withTypeSchema("recon").extend(withNoAmmoUnitStats);

const otherLandUnitsWithAmmo = z
  .object({
    type: z.enum([
      "artillery",
      "tank",
      "antiAir",
      "missile",
      "rocket",
      "mediumTank",
      "neoTank",
      "megaTank",
    ]),
  })
  .extend(withAmmoUnitStats);

//AIR UNITS:
const transportCopterSchema = withTypeSchema("transportCopter")
  .extend(withNoAmmoUnitStats)
  .extend({
    loadedUnit: getLoadedSchema([infantrySchema, mechSchema]),
  });

const battleCopterSchema = withTypeSchema("battleCopter").extend(withAmmoUnitStats);

const blackBombSchema = withTypeSchema("blackBomb").extend(withNoAmmoUnitStats);

const bomberAndFighterSchema = z
  .object({
    type: z.enum(["bomber", "fighter"]),
  })
  .extend(withAmmoUnitStats);

const stealthSchema = withTypeSchema("stealth").extend(withHidden).extend(withAmmoUnitStats);

const loadableAirUnitSchema = getLoadedSchema([
  transportCopterSchema,
  battleCopterSchema,
  blackBombSchema,
  bomberAndFighterSchema,
  stealthSchema,
]);

//SEA UNITS:
const blackBoatSchema = withTypeSchema("blackBoat")
  .extend(withNoAmmoUnitStats)
  .extend({
    loadedUnit: getLoadedSchema([infantrySchema, mechSchema]),
    loadedUnit2: getLoadedSchema([infantrySchema, mechSchema]),
  });

const landerSchema = withTypeSchema("lander")
  .extend(withNoAmmoUnitStats)
  .extend({
    loadedUnit: getLoadedSchema([
      infantrySchema,
      mechSchema,
      reconSchema,
      APCSchema,
      otherLandUnitsWithAmmo,
    ]),
    loadedUnit2: getLoadedSchema([
      infantrySchema,
      mechSchema,
      reconSchema,
      APCSchema,
      otherLandUnitsWithAmmo,
    ]),
  });

const cruiserSchema = withTypeSchema("cruiser")
  .extend(withAmmoUnitStats)
  .extend({
    loadedUnit: getLoadedSchema([transportCopterSchema, battleCopterSchema]),
    loadedUnit2: getLoadedSchema([transportCopterSchema, battleCopterSchema]),
  });

const battleshipSchema = withTypeSchema("battleship").extend(withAmmoUnitStats);

const subSchema = withTypeSchema("sub").extend(withHidden).extend(withAmmoUnitStats);

const carrierSchema = withTypeSchema("carrier").extend(withAmmoUnitStats).extend({
  loadedUnit: loadableAirUnitSchema,
  loadedUnit2: loadableAirUnitSchema,
});

//PIPE? UNITS:
const pipeRunnerSchema = withTypeSchema("pipeRunner").extend(withAmmoUnitStats);

export const unitSchema = z.discriminatedUnion("type", [
  // this can't be easily mapped
  // because it'd be pushing the limits of zod or typescript i think
  infantrySchema.extend(shared),
  mechSchema.extend(shared),
  reconSchema.extend(shared),
  APCSchema.extend(shared),
  otherLandUnitsWithAmmo.extend(shared),
  transportCopterSchema.extend(shared),
  battleCopterSchema.extend(shared),
  blackBombSchema.extend(shared),
  blackBoatSchema.extend(shared),
  landerSchema.extend(shared),
  cruiserSchema.extend(shared),
  bomberAndFighterSchema.extend(shared),
  stealthSchema.extend(shared),
  battleshipSchema.extend(shared),
  subSchema.extend(shared),
  carrierSchema.extend(shared),
  pipeRunnerSchema.extend(shared),
]);

export type UnitWithVisibleStats = z.infer<typeof unitSchema>;

export type UnitType = UnitWithVisibleStats["type"];

/** not nice to read but the only way to get the type strings as values */
export const unitTypes = unitSchema.options.flatMap((option) => {
  const { _def } = option._def.shape().type;

  if (_def.typeName === ZodFirstPartyTypeKind.ZodLiteral) {
    return _def.value;
  }

  return _def.values;
});

export const unitTypeSchema = z.enum(unitTypes as [UnitType, ...UnitType[]]);

type UnitWithHiddenStats = Omit<UnitWithVisibleStats, "stats"> & {
  stats: "hidden";
};

export type WWUnit = UnitWithHiddenStats | UnitWithVisibleStats;

/**
 * Whether a unit is at or below the low-fuel/low-ammo threshold. Derived by the engine (see
 * engine/rules/supply.ts) and sent as a plain boolean, because the maximums it compares against are
 * engine constants and the client holds none — it renders the flag, it doesn't compute it.
 */
export type SupplyView = { lowFuel: boolean; lowAmmo: boolean };

/**
 * A unit's stats as one viewer reads them: `"hidden"` (a Sonja unit, which conceals life AND
 * resources), HP-only (an enemy under fog, whose consumables are secret but whose health is plainly
 * visible), or the full set. Consumables are OPTIONAL rather than nullable so the unmasked shape
 * stays structurally identical to `WWUnit` and existing readers don't churn.
 */
type ViewStats = "hidden" | { hp: number; fuel?: number; ammo?: number };

/** Distributes over the `WWUnit` union so each unit type keeps its own shape (cargo, hidden, …). */
export type MaskedUnit<T = WWUnit> = T extends { stats: unknown }
  ? Omit<T, "stats"> & { stats: ViewStats }
  : never;

/**
 * A unit as it goes over the wire to ONE viewer: the masked data plus the engine-derived supply
 * flag. This — not `WWUnit` — is what every client-bound path carries, so the redaction can't be
 * skipped by accident. See maskUnitForViewer, the single rule that builds it.
 */
export type UnitView = MaskedUnit & { supply: SupplyView | null };
