import type { PrismaClient } from "@prisma/client";
import type {
  CoEffect,
  COProfile,
  PhaseProfile,
  UnitModifier,
} from "server/engine/constants/co-profile";
import type { CO } from "server/core/schemas/co";
import type { GameVersion } from "server/core/schemas/game-version";
import type { UnitType } from "server/core/schemas/unit";

/**
 * Adapter: loads commander data from the DB and maps the rows back into the engine's declarative
 * `COProfile` shape — the boundary where Prisma rows become domain entities. Reconstructs SPARSE
 * objects (unset columns omitted, not `null`) so the result is identical to the hand-authored
 * `CO_PROFILES`; `verify-co-roundtrip` pins that equality, and every existing hook/effect test then
 * applies to the DB-sourced data unchanged.
 */

type ModifierRow = {
  unitGroupKey: string | null;
  unitType: { key: string } | null;
  attackPct: number | null;
  defensePct: number | null;
  rangeDelta: number | null;
  movementDelta: number | null;
  visionDelta: number | null;
  buildCostPct: number | null;
  terrainStarsPct: number | null;
  terrainStarsDelta: number | null;
  terrainStarsMult: number | null;
  movementCostAll: number | null;
  onTerrainKey: string | null;
  onProperty: boolean;
  onWeather: string | null;
  notWeather: string | null;
  onFacility: string | null;
  facilityNot: string | null;
  requiresWeapon: boolean;
  vsGroup: string | null;
  scaleStat: string | null;
  scaleVariable: string | null;
  scaleDivisor: number | null;
  scaleFactor: number | null;
};

type EffectRow = { kind: string; params: unknown };

type PhaseRow = {
  phase: string;
  name: string | null;
  stars: number | null;
  description: string;
  luckGood: number | null;
  luckBad: number | null;
  visualKey: string | null;
  modifiers: ModifierRow[];
  effects: EffectRow[];
};

type CoRow = { key: string; gameVersion: string; displayName: string; phases: PhaseRow[] };

const mapModifier = (row: ModifierRow): UnitModifier => {
  const mod: UnitModifier = {};

  if (row.unitGroupKey !== null) {
    mod.group = row.unitGroupKey;
  }

  if (row.unitType !== null) {
    mod.unit = row.unitType.key as UnitType;
  }

  if (row.attackPct !== null) {
    mod.attackPct = row.attackPct;
  }

  if (row.defensePct !== null) {
    mod.defensePct = row.defensePct;
  }

  if (row.rangeDelta !== null) {
    mod.rangeDelta = row.rangeDelta;
  }

  if (row.movementDelta !== null) {
    mod.movementDelta = row.movementDelta;
  }

  if (row.visionDelta !== null) {
    mod.visionDelta = row.visionDelta;
  }

  if (row.buildCostPct !== null) {
    mod.buildCostPct = row.buildCostPct;
  }

  if (row.terrainStarsPct !== null) {
    mod.terrainStarsPct = row.terrainStarsPct;
  }

  if (row.terrainStarsDelta !== null) {
    mod.terrainStarsDelta = row.terrainStarsDelta;
  }

  if (row.terrainStarsMult !== null) {
    mod.terrainStarsMult = row.terrainStarsMult;
  }

  if (row.movementCostAll !== null) {
    mod.movementCostAll = row.movementCostAll;
  }

  if (row.onTerrainKey !== null) {
    mod.onTerrainKey = row.onTerrainKey;
  }

  if (row.onProperty) {
    mod.onProperty = true;
  }

  if (row.onWeather !== null) {
    mod.onWeather = row.onWeather;
  }

  if (row.notWeather !== null) {
    mod.notWeather = row.notWeather;
  }

  if (row.onFacility !== null) {
    mod.onFacility = row.onFacility;
  }

  if (row.facilityNot !== null) {
    mod.facilityNot = row.facilityNot;
  }

  if (row.requiresWeapon) {
    mod.requiresWeapon = true;
  }

  if (row.vsGroup !== null) {
    mod.vsGroup = row.vsGroup;
  }

  if (row.scaleStat !== null) {
    mod.scaleStat = row.scaleStat as UnitModifier["scaleStat"];
  }

  if (row.scaleVariable !== null) {
    mod.scaleVariable = row.scaleVariable as UnitModifier["scaleVariable"];
  }

  if (row.scaleDivisor !== null) {
    mod.scaleDivisor = row.scaleDivisor;
  }

  if (row.scaleFactor !== null) {
    mod.scaleFactor = row.scaleFactor;
  }

  return mod;
};

const mapEffect = (row: EffectRow): CoEffect => {
  const effect: CoEffect = { kind: row.kind };

  if (row.params !== null && row.params !== undefined) {
    effect.params = row.params as Record<string, unknown>;
  }

  return effect;
};

const mapPhase = (row: PhaseRow): PhaseProfile => {
  const phase: PhaseProfile = { description: row.description };

  if (row.name !== null) {
    phase.name = row.name;
  }

  if (row.stars !== null) {
    phase.stars = row.stars;
  }

  if (row.luckGood !== null) {
    phase.luckGood = row.luckGood;
  }

  if (row.luckBad !== null) {
    phase.luckBad = row.luckBad;
  }

  if (row.visualKey !== null) {
    phase.visualKey = row.visualKey;
  }

  if (row.modifiers.length > 0) {
    phase.modifiers = row.modifiers.map(mapModifier);
  }

  if (row.effects.length > 0) {
    phase.effects = row.effects.map(mapEffect);
  }

  return phase;
};

export const mapCoProfile = (row: CoRow): COProfile => {
  const profile: COProfile = {
    key: row.key as CO,
    gameVersion: row.gameVersion as GameVersion,
    displayName: row.displayName,
  };

  for (const phaseRow of row.phases) {
    const phase = mapPhase(phaseRow);

    if (phaseRow.phase === "dayToDay") {
      profile.dayToDay = phase;
    } else if (phaseRow.phase === "coPower") {
      profile.coPower = phase;
    } else if (phaseRow.phase === "superCoPower") {
      profile.superCoPower = phase;
    }
  }

  return profile;
};

/** Load every commander from the DB as declarative `COProfile`s (the CO_PROFILES equivalent). */
export const loadCoProfiles = async (prisma: PrismaClient): Promise<COProfile[]> => {
  const cos = await prisma.co.findMany({
    include: {
      phases: {
        include: {
          modifiers: { include: { unitType: { select: { key: true } } } },
          effects: true,
        },
      },
    },
  });

  return cos.map(mapCoProfile);
};
