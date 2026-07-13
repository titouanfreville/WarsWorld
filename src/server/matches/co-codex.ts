import { CO_BIOS } from "server/engine/constants/co-bios";
import { CO_PROFILES } from "server/engine/constants/co-profiles";
import type {
  COProfile,
  PhaseProfile,
  UnitModifierSummary,
} from "server/engine/constants/co-profile";
import { unitDayToDayModifiers } from "server/engine/constants/co-profile";
import type { CO } from "server/core/schemas/co";
import type { GameVersion } from "server/core/schemas/game-version";
import { unitTypeSchema } from "server/core/schemas/unit";
import type { UnitType } from "server/core/schemas/unit";

type CodexPower = { name: string; stars: number; description: string };

/** Reference data for one general, for the champ-select dossier (server-authoritative game knowledge). */
export type CoCodexEntry = {
  name: CO;
  displayName: string;
  /** One-line flavour blurb (personality/nation/role) for the dossier Overview. */
  bio: string;
  /** Day-to-day passive description (empty when the CO has no passive). */
  description: string;
  coPower: CodexPower | null;
  superCoPower: CodexPower | null;
  /** Flat day-to-day modifier per unit type it actually changes, for the ▲▼ grid. Keyed by unit
   *  name; units the CO leaves unchanged are omitted. Context-conditional bonuses live in `description`. */
  forces: Record<string, UnitModifierSummary>;
};

const UNIT_TYPES = unitTypeSchema.options as readonly UnitType[];

const toPower = (power: PhaseProfile | undefined): CodexPower | null =>
  power === undefined
    ? null
    : { name: power.name ?? "", stars: power.stars ?? 0, description: power.description };

const hasChange = (m: UnitModifierSummary): boolean =>
  m.attackPct !== 0 || m.defensePct !== 0 || m.rangeDelta !== 0 || m.movementDelta !== 0;

/** Per-unit day-to-day modifiers, keeping only units the CO actually changes. */
const buildForces = (dayToDay: PhaseProfile | undefined): Record<string, UnitModifierSummary> => {
  const forces: Record<string, UnitModifierSummary> = {};

  for (const type of UNIT_TYPES) {
    const summary = unitDayToDayModifiers(dayToDay, type);

    if (hasChange(summary)) {
      forces[type] = summary;
    }
  }

  return forces;
};

/**
 * Build the codex for a game version from declarative CO profiles: every CO implemented for that
 * version, its passive + power descriptions, and its per-unit day-to-day modifier grid. `profiles`
 * defaults to the bundled `CO_PROFILES`; the router passes the DB-sourced profiles so the endpoint
 * reads live game data (the two are proven identical by `verify-co-roundtrip`).
 */
export const buildCoCodex = (
  version: GameVersion,
  profiles: COProfile[] = CO_PROFILES,
): CoCodexEntry[] =>
  profiles
    .filter((profile) => profile.gameVersion === version)
    .map((profile) => ({
      name: profile.key,
      displayName: profile.displayName,
      bio: CO_BIOS[profile.key] ?? "",
      description: profile.dayToDay?.description ?? "",
      coPower: toPower(profile.coPower),
      superCoPower: toPower(profile.superCoPower),
      forces: buildForces(profile.dayToDay),
    }));
