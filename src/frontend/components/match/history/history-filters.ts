/**
 * Match-history filtering + paging — pure, FE-local, engine-free. Types are structural so this file
 * imports nothing from `shared/` or the server (see src/frontend/CLAUDE.md); drift against the
 * server's `finishedRowToFrontend` surfaces as a tsc error at the `your-games.tsx` call site.
 */

/** FE-local mirror of the server's `GameMode`. Identifiers, not labels — see MODE_LABEL. */
export type GameMode = "duel" | "teams" | "ffa";

/** FE-local mirror of the server's `Ruleset`. */
export type Ruleset = "standard" | "fog" | "highFunds" | "broken";

/** Only what a filter needs to decide — kept minimal so callers can pass richer rows. */
export type HistoryFilterable = {
  isRanked?: boolean;
  mode?: string | null;
  ruleset?: string | null;
};

export type HistoryFilter = {
  key: string;
  label: string;
  accepts: (match: HistoryFilterable) => boolean;
};

/**
 * Two independent axes, flattened into one chip row because that's how players think ("show me my
 * ranked games", "show me my 2v2s") — not because they're the same kind of thing.
 */
export const HISTORY_FILTERS: HistoryFilter[] = [
  { key: "all", label: "All", accepts: () => true },
  { key: "ranked", label: "Ranked", accepts: (match) => match.isRanked === true },
  { key: "duel", label: "1v1", accepts: (match) => match.mode === "duel" },
  { key: "teams", label: "2v2", accepts: (match) => match.mode === "teams" },
  { key: "ffa", label: "FFA", accepts: (match) => match.mode === "ffa" },
  { key: "fog", label: "Fog", accepts: (match) => match.ruleset === "fog" },
];

/** Rows per page in the history list. */
export const HISTORY_PAGE_SIZE = 10;

/** Prisma enum values are identifiers (they can't start with a digit); these are what players read. */
export const MODE_LABEL: Record<string, string> = {
  duel: "1v1",
  teams: "2v2",
  ffa: "FFA",
};

export const RULESET_LABEL: Record<string, string> = {
  standard: "Standard",
  fog: "Fog",
  highFunds: "High funds",
  broken: "Broken",
};

const labelFrom = (labels: Record<string, string>, value: string | null | undefined): string =>
  value === null || value === undefined ? "—" : (labels[value] ?? value);

export const modeLabelOf = (mode: string | null | undefined): string => labelFrom(MODE_LABEL, mode);

export const rulesetLabelOf = (ruleset: string | null | undefined): string =>
  labelFrom(RULESET_LABEL, ruleset);

/** Total pages for `count` rows, never less than 1 (an empty list still has a page to show). */
export const pageCountOf = (count: number): number =>
  Math.max(1, Math.ceil(count / HISTORY_PAGE_SIZE));

/** The rows on `page` (0-indexed), clamped so a stale page never renders an empty list. */
export function pageOf<T>(rows: T[], page: number): T[] {
  const safePage = Math.min(Math.max(0, page), pageCountOf(rows.length) - 1);

  return rows.slice(safePage * HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);
}
