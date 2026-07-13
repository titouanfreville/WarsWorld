import { coAsset } from "./skin-source";

/**
 * Commanding-Officer (general) vocabulary + portrait access. Two art sets ship in the repo:
 * pixelated mugshots (`small`/`full`) and smooth full-body art — the champ-select dossier uses the
 * smooth art for the hero and the pixel mugs for roster tiles.
 */
export const CO_VERSION = "AW2" as const;

/** Every CO with art in the repo (also exists as smooth full-body art), excluding "neutral". */
export const CO_NAMES = [
  "andy",
  "max",
  "sami",
  "olaf",
  "grit",
  "colin",
  "kanbei",
  "sonja",
  "sensei",
  "drake",
  "eagle",
  "hachi",
  "nell",
  "jess",
  "grimm",
  "hawke",
  "lash",
  "adder",
  "flak",
  "sturm",
  "jake",
  "rachel",
  "sasha",
  "javier",
  "jugger",
  "koal",
  "kindle",
  "von-bolt",
] as const;

export type CoName = (typeof CO_NAMES)[number];

/**
 * Generals offered in the picker. The BE re-validates and rejects any CO not implemented for
 * {@link CO_VERSION}, so this stays generous — an unavailable pick surfaces as a lock error.
 */
export const SELECTABLE_COS: readonly CoName[] = CO_NAMES;

/** Pixel mugshot: `small` for compact roster tiles, `full` for a larger portrait (DB skin if loaded). */
export const coPortraitUrl = (name: string, variant: "small" | "full" = "small"): string =>
  coAsset(`${name}:portrait${variant === "small" ? "Small" : "Full"}`) ??
  `/img/CO/pixelated/${name}-${variant}.png`;

/** Smooth full-body art for the champ-select hero / dossier (DB skin if loaded). */
export const coArtUrl = (name: string): string =>
  coAsset(`${name}:art`) ?? `/img/CO/smoothFull/Awds-${name}.webp`;

/**
 * Optional per-outcome CO art for the end-of-match screen — a triumphant "win" pose / a defeated
 * "lose" pose. No such art ships yet (see docs/co-pose-art-spec.md for the authoring spec); until a
 * given CO has it, callers fall back to the neutral {@link coArtUrl} and derive the win/lose feeling
 * in CSS. Resolves a DB skin first (`<co>:artWin` / `<co>:artLose`), then the file convention.
 */
export const coPoseUrl = (name: string, pose: "win" | "lose"): string =>
  coAsset(`${name}:art${pose === "win" ? "Win" : "Lose"}`) ??
  `/img/CO/smoothFull/Awds-${name}-${pose}.webp`;
