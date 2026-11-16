import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "url";
import { unitPropertiesMap } from "server/engine/constants/unit-properties";
import { terrainProperties } from "server/engine/constants/terrain-properties";
import type { UnitType } from "server/core/schemas/unit";

/**
 * Seeds the mechanical game-reference tables (unit groups, units, terrain, movement costs,
 * properties) directly from the engine's code constants, so the DB starts bit-identical to today.
 * COs and skins are seeded separately. Idempotent: clears these tables then re-inserts. Exposed as
 * `seedGameData(prisma)` for `prisma/seed.ts`; runs standalone when invoked directly.
 *
 * Run: `rtk proxy npx tsx prisma/scripts/seed-game-data.ts`
 */

const UNIT_GROUPS = [
  { key: "infantry", displayName: "Infantry" },
  { key: "directVehicle", displayName: "Direct Vehicle" },
  { key: "indirect", displayName: "Indirect" },
  { key: "air", displayName: "Air" },
  { key: "sea", displayName: "Sea" },
  { key: "transport", displayName: "Transport" },
] as const;

/** The engine's `UnitWrapper.isTransport()` set = units with a `loadedUnit` field (cruiser + carrier
 *  carry at runtime too, despite the narrower type signature). Targeted by CO "transport" bonuses. */
const TRANSPORT_UNITS = new Set<UnitType>([
  "apc",
  "transportCopter",
  "blackBoat",
  "lander",
  "cruiser",
  "carrier",
]);

/**
 * Every group whose predicate the unit matches — units belong to SEVERAL (battleship = indirect + sea).
 * Mirrors the engine's independent predicates so a CO's group-targeted modifier hits the same units
 * its hook does. `directVehicle` = "non-foot direct" (what Max buffs: not indirect, not infantry).
 */
const unitGroupKeys = (type: UnitType): string[] => {
  const p = unitPropertiesMap[type];
  const groups: string[] = [];

  const isInfantry = type === "infantry" || type === "mech";
  const isIndirect = "attackRange" in p && p.attackRange[1] > 1;

  if (isInfantry) {
    groups.push("infantry");
  }

  if (isIndirect) {
    groups.push("indirect");
  }

  if (!isInfantry && !isIndirect) {
    groups.push("directVehicle");
  }

  if (p.facility === "airport" || p.movementType === "air") {
    groups.push("air");
  }

  if (p.facility === "port" || p.movementType === "sea" || p.movementType === "lander") {
    groups.push("sea");
  }

  if (TRANSPORT_UNITS.has(type)) {
    groups.push("transport");
  }

  return groups;
};

// Property tile types (subset of terrain) + their stable AW facts. Funds default to the standard
// per-property income; lab/comm-tower produce none. Build/repair facilities are fixed AW rules.
const PROPERTY_META: Record<
  string,
  { fundsPerTurn: number; buildsFacility: string | null; repairsFacility: string | null }
> = {
  hq: { fundsPerTurn: 1000, buildsFacility: null, repairsFacility: "base" },
  city: { fundsPerTurn: 1000, buildsFacility: null, repairsFacility: "base" },
  base: { fundsPerTurn: 1000, buildsFacility: "base", repairsFacility: "base" },
  airport: { fundsPerTurn: 1000, buildsFacility: "airport", repairsFacility: "airport" },
  port: { fundsPerTurn: 1000, buildsFacility: "port", repairsFacility: "port" },
  lab: { fundsPerTurn: 0, buildsFacility: null, repairsFacility: null },
  commtower: { fundsPerTurn: 0, buildsFacility: null, repairsFacility: null },
};

export async function seedGameData(prisma: PrismaClient) {
  // Clear (children first) so re-runs are clean.
  await prisma.terrainMovementCost.deleteMany();
  await prisma.property.deleteMany();
  await prisma.terrainKind.deleteMany();
  await prisma.unitType.deleteMany();
  await prisma.unitGroup.deleteMany();

  // --- Unit groups ---
  await prisma.unitGroup.createMany({ data: UNIT_GROUPS.map((g) => ({ ...g })) });

  // --- Units ---
  for (const key of Object.keys(unitPropertiesMap) as UnitType[]) {
    const p = unitPropertiesMap[key];
    const hasRange = "attackRange" in p;

    await prisma.unitType.create({
      data: {
        key,
        displayName: p.displayName,
        groups: { connect: unitGroupKeys(key).map((k) => ({ key: k })) },
        facility: p.facility,
        movementType: p.movementType,
        movementPoints: p.movementPoints,
        vision: p.vision,
        fuel: p.initialFuel,
        ammo: "initialAmmo" in p ? p.initialAmmo : null,
        cost: p.cost,
        attackRangeMin: hasRange ? p.attackRange[0] : null,
        attackRangeMax: hasRange ? p.attackRange[1] : null,
      },
    });
  }

  // --- Terrain + movement costs + properties ---
  for (const key of Object.keys(terrainProperties)) {
    const t = terrainProperties[key as keyof typeof terrainProperties];
    const isProperty = key in PROPERTY_META;

    const terrain = await prisma.terrainKind.create({
      data: {
        key,
        displayName: key,
        defenseStars: t.defenseStars,
        isProperty,
      },
    });

    const costs = t.movementCosts as Record<string, number | null | undefined>;
    await prisma.terrainMovementCost.createMany({
      data: Object.entries(costs).map(([movementType, cost]) => ({
        terrainId: terrain.id,
        movementType,
        cost: cost ?? null,
      })),
    });

    if (isProperty) {
      const meta = PROPERTY_META[key];
      await prisma.property.create({
        data: {
          terrainId: terrain.id,
          key,
          fundsPerTurn: meta.fundsPerTurn,
          buildsFacility: meta.buildsFacility,
          repairsFacility: meta.repairsFacility,
          vision: 0,
        },
      });
    }
  }

  const [uc, tc, pc] = await Promise.all([
    prisma.unitType.count(),
    prisma.terrainKind.count(),
    prisma.property.count(),
  ]);
  console.log(`Seeded ${uc} units, ${tc} terrain kinds, ${pc} properties.`);
}

// Run standalone (but not when imported by prisma/seed.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient();
  seedGameData(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}
