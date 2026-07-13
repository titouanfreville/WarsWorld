import { nationUnitDir, type Army } from "./nations";
import { armyAsset } from "./skin-source";

/**
 * Unit vocabulary + sprite access. Values are the on-disk file bases in `public/img/units/<nation>/`
 * (e.g. `Anti-Air-0.png`); grouped by domain so callers can render a themed legend.
 */
export const LAND_UNITS = [
  "Infantry",
  "Mech",
  "Recon",
  "Tank",
  "MdTank",
  "NeoTank",
  "MegaTank",
  "APC",
  "Artillery",
  "Rocket",
  "Anti-Air",
  "Missile",
  "PipeRunner",
] as const;

export const AIR_UNITS = [
  "B-Copter",
  "T-Copter",
  "Fighter",
  "Bomber",
  "Stealth",
  "BlackBomb",
] as const;

export const SEA_UNITS = [
  "Battleship",
  "Cruiser",
  "Lander",
  "Sub",
  "Carrier",
  "BlackBoat",
] as const;

export const UNIT_TYPES = [...LAND_UNITS, ...AIR_UNITS, ...SEA_UNITS] as const;

export type UnitType = (typeof UNIT_TYPES)[number];

/** Human labels where the file base isn't already presentable. */
export const UNIT_LABEL: Partial<Record<UnitType, string>> = {
  MdTank: "Md. Tank",
  NeoTank: "Neotank",
  MegaTank: "Mega Tank",
  APC: "APC",
  "Anti-Air": "Anti-Air",
  "B-Copter": "B-Copter",
  "T-Copter": "T-Copter",
  BlackBomb: "Black Bomb",
  BlackBoat: "Black Boat",
  PipeRunner: "Pipe Runner",
};

export const unitLabel = (unit: UnitType): string => UNIT_LABEL[unit] ?? unit;

/**
 * Sprite-base → engine unit key. The sprite names are on-disk file bases (`MdTank`, `B-Copter`);
 * the backend keys everything by the canonical `UnitType` enum (`mediumTank`, `battleCopter`). This
 * FE-owned map bridges the two so API payloads keyed by engine unit (e.g. the codex `forces` grid)
 * can be looked up from a sprite name.
 */
export const ENGINE_UNIT_KEY: Record<UnitType, string> = {
  Infantry: "infantry",
  Mech: "mech",
  Recon: "recon",
  Tank: "tank",
  MdTank: "mediumTank",
  NeoTank: "neoTank",
  MegaTank: "megaTank",
  APC: "apc",
  Artillery: "artillery",
  Rocket: "rocket",
  "Anti-Air": "antiAir",
  Missile: "missile",
  PipeRunner: "pipeRunner",
  "B-Copter": "battleCopter",
  "T-Copter": "transportCopter",
  Fighter: "fighter",
  Bomber: "bomber",
  Stealth: "stealth",
  BlackBomb: "blackBomb",
  Battleship: "battleship",
  Cruiser: "cruiser",
  Lander: "lander",
  Sub: "sub",
  Carrier: "carrier",
  BlackBoat: "blackBoat",
};

export const engineUnitKey = (unit: UnitType): string => ENGINE_UNIT_KEY[unit];

/** Reverse of {@link ENGINE_UNIT_KEY}: a WIRE unit key (`mediumTank`) → its sprite base (`MdTank`). */
const SPRITE_BY_ENGINE_KEY: Record<string, UnitType> = Object.fromEntries(
  (Object.entries(ENGINE_UNIT_KEY) as [UnitType, string][]).map(([sprite, key]) => [key, sprite]),
);

/** Sprite base for a wire unit type, for React `<img>` unit icons (e.g. an intel legend). */
export const spriteNameForUnit = (wireType: string): UnitType | undefined =>
  SPRITE_BY_ENGINE_KEY[wireType];

/**
 * Idle sprite for a unit in a nation's colours (frame 0). Black Hole has no sprite folder, so its
 * generic icon renders in the default nation's colours (see nations.ts).
 */
export const unitSpriteUrl = (unit: UnitType, army: Army = "orange-star"): string => {
  const fromDb = armyAsset(army, ENGINE_UNIT_KEY[unit]);

  if (fromDb !== undefined) {
    return fromDb;
  }

  const dir = nationUnitDir(army) ?? "orangeStar";
  return `/img/units/${dir}/${unit}-0.png`;
};
