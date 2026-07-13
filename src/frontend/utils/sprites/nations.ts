import { armyAsset } from "./skin-source";

/**
 * Nation (army) vocabulary + asset access. FE-local (no `shared` imports) per the frontend boundary.
 * One place maps an army to its label, brand colour, flag, and unit-sprite folder — so components
 * never hardcode `/img/...` paths or hex values.
 */
export const ARMIES = [
  "orange-star",
  "blue-moon",
  "green-earth",
  "yellow-comet",
  "black-hole",
] as const;

export type Army = (typeof ARMIES)[number];

export const ARMY_LABEL: Record<Army, string> = {
  "orange-star": "Orange Star",
  "blue-moon": "Blue Moon",
  "green-earth": "Green Earth",
  "yellow-comet": "Yellow Comet",
  "black-hole": "Black Hole",
};

/** Brand colour per nation, for dynamic inline styling (team accents rolled at runtime). */
export const ARMY_HEX: Record<Army, string> = {
  "orange-star": "#d04038",
  "blue-moon": "#466efe",
  "green-earth": "#37a42a",
  "yellow-comet": "#daa520",
  "black-hole": "#800080",
};

/**
 * Unit-sprite folder per nation. Black Hole has no dedicated sprite folder in the repo (its units
 * live only in the packed atlas), so callers fall back to a default nation for generic unit icons.
 */
const UNIT_DIR: Record<Army, string | null> = {
  "orange-star": "orangeStar",
  "blue-moon": "blueMoon",
  "green-earth": "greenEarth",
  "yellow-comet": "yellowComet",
  "black-hole": null,
};

export const nationUnitDir = (army: Army): string | null => UNIT_DIR[army];

/** Small animated nation flag/crest (DB skin if loaded, else the path convention). */
export const nationFlagUrl = (army: Army): string =>
  armyAsset(army, "flag") ?? `/img/nations/${army}.gif`;
