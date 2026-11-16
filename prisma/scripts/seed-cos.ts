import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "url";
import { CO_PROFILES } from "server/engine/constants/co-profiles";
import type { CoEffect, COProfile, UnitModifier } from "server/engine/constants/co-profile";

/**
 * Seeds the commander tables (Co / CoPhase / CoModifier / CoPhaseEffect) from the declarative
 * `CO_PROFILES` — the same data the engine and champ-select already read. Idempotent: clears the Co
 * rows (cascades to phases/modifiers/effects) then re-inserts. Requires the unit tables to be seeded
 * first (per-unit modifier rows FK to UnitType). Run after `seed-game-data.ts`:
 *
 *   rtk proxy npx tsx prisma/scripts/seed-cos.ts
 */

const PHASE_KEYS = ["dayToDay", "coPower", "superCoPower"] as const;

const resolveUnitId = (
  unit: string | undefined,
  unitIdByKey: Record<string, string>,
): string | null => {
  if (unit === undefined) {
    return null;
  }

  const id = unitIdByKey[unit];

  if (id === undefined) {
    throw new Error(`seed-cos: unknown unit key "${unit}" in a CO modifier`);
  }

  return id;
};

const modifierRow = (mod: UnitModifier, unitIdByKey: Record<string, string>) => ({
  unitGroupKey: mod.group ?? null,
  unitTypeId: resolveUnitId(mod.unit, unitIdByKey),
  attackPct: mod.attackPct ?? null,
  defensePct: mod.defensePct ?? null,
  rangeDelta: mod.rangeDelta ?? null,
  movementDelta: mod.movementDelta ?? null,
  visionDelta: mod.visionDelta ?? null,
  buildCostPct: mod.buildCostPct ?? null,
  terrainStarsPct: mod.terrainStarsPct ?? null,
  terrainStarsDelta: mod.terrainStarsDelta ?? null,
  terrainStarsMult: mod.terrainStarsMult ?? null,
  movementCostAll: mod.movementCostAll ?? null,
  onTerrainKey: mod.onTerrainKey ?? null,
  onProperty: mod.onProperty ?? false,
  onWeather: mod.onWeather ?? null,
  notWeather: mod.notWeather ?? null,
  onFacility: mod.onFacility ?? null,
  facilityNot: mod.facilityNot ?? null,
  requiresWeapon: mod.requiresWeapon ?? false,
  vsGroup: mod.vsGroup ?? null,
  scaleStat: mod.scaleStat ?? null,
  scaleVariable: mod.scaleVariable ?? null,
  scaleDivisor: mod.scaleDivisor ?? null,
  scaleFactor: mod.scaleFactor ?? null,
});

const effectRow = (effect: CoEffect) => ({
  kind: effect.kind,
  params: effect.params,
});

const phaseRows = (profile: COProfile, unitIdByKey: Record<string, string>) =>
  PHASE_KEYS.flatMap((phaseKey) => {
    const phase = profile[phaseKey];

    if (phase === undefined) {
      return [];
    }

    return [
      {
        phase: phaseKey,
        name: phase.name ?? null,
        stars: phase.stars ?? null,
        description: phase.description,
        luckGood: phase.luckGood ?? null,
        luckBad: phase.luckBad ?? null,
        visualKey: phase.visualKey ?? null,
        modifiers: { create: (phase.modifiers ?? []).map((m) => modifierRow(m, unitIdByKey)) },
        effects: { create: (phase.effects ?? []).map(effectRow) },
      },
    ];
  });

export async function seedCos(prisma: PrismaClient) {
  const units = await prisma.unitType.findMany({ select: { id: true, key: true } });

  if (units.length === 0) {
    throw new Error("No UnitType rows — run seed-game-data.ts first.");
  }

  const unitIdByKey = Object.fromEntries(units.map((u) => [u.key, u.id]));

  await prisma.co.deleteMany(); // cascades to phases → modifiers/effects

  for (const profile of CO_PROFILES) {
    await prisma.co.create({
      data: {
        key: profile.key,
        gameVersion: profile.gameVersion,
        displayName: profile.displayName,
        phases: { create: phaseRows(profile, unitIdByKey) },
      },
    });
  }

  const [cos, phases, mods, effects] = await Promise.all([
    prisma.co.count(),
    prisma.coPhase.count(),
    prisma.coModifier.count(),
    prisma.coPhaseEffect.count(),
  ]);
  console.log(`Seeded ${cos} COs, ${phases} phases, ${mods} modifiers, ${effects} effects.`);
}

// Run standalone (but not when imported by prisma/seed.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient();
  seedCos(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}
