/**
 * Rank presentation — FE-local mirror of the server's `Rank` enum + `merit.ts` constants.
 *
 * The palette is deliberately NON-METAL. `HonorInsignia` owns bronze → diamond and renders on the
 * same surfaces a rank badge does (profile · lobby · champ-select · in-game), so a gold "Captain"
 * disc beside a gold medal disc would read as one system. Honor is metals + stars, earned from your
 * opponent for conduct; the ladder is military titles + a green→orange ramp, earned by winning.
 *
 * `Maréchal` is accented here and ASCII (`marechal`) in the enum — the same split `MEDAL_META` uses
 * for "Médaille Militaire". The other ranks stay English: the UI is English, and Private is a common
 * noun, not a title.
 */

export const MERIT_PER_DIVISION = 100;

export type RankMeta = { label: string; emblem: string; divisions: boolean };

export const RANK_META: Record<string, RankMeta> = {
  cadet: { label: "Cadet", emblem: "@text-slate-500 @outline-slate-500/40", divisions: false },
  private: { label: "Private", emblem: "@text-green-400 @outline-green-400/50", divisions: true },
  sergeant: { label: "Sergeant", emblem: "@text-teal-300 @outline-teal-300/50", divisions: true },
  lieutenant: {
    label: "Lieutenant",
    emblem: "@text-blue-400 @outline-blue-400/50",
    divisions: true,
  },
  captain: { label: "Captain", emblem: "@text-violet-400 @outline-violet-400/50", divisions: true },
  major: { label: "Major", emblem: "@text-fuchsia-400 @outline-fuchsia-400/50", divisions: true },
  colonel: { label: "Colonel", emblem: "@text-rose-400 @outline-rose-400/50", divisions: true },
  marechal: { label: "Maréchal", emblem: "@text-primary @outline-primary", divisions: false },
};

const ROMAN = ["", "I", "II", "III", "IV", "V"];

/** Divisions count DOWN — V is the bottom of a rank, I the top. */
export const romanDivision = (division: number): string => ROMAN[division] ?? String(division);
