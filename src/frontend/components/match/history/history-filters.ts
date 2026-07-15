/**
 * Match-history filtering + paging — pure, FE-local, engine-free. Types are structural so this file
 * imports nothing from `shared/` or the server (see src/frontend/CLAUDE.md); drift against the
 * server's `finishedRowToFrontend` surfaces as a tsc error at the `your-games.tsx` call site.
 *
 * Filters deliberately key off `isRanked` + `leagueType` only — the two facts the list query
 * actually carries. Mode chips (1v1 / 2v2 / FFA) are NOT possible yet: `Match` has no `mode` column
 * (it lives on `Lobby`, and `lobbyId` is null for v1 matches), so they arrive with the mode × ruleset
 * taxonomy refactor rather than being faked from `map.numberOfPlayers` — which can't tell 2v2 from
 * FFA-4 anyway.
 */

/** Structural mirror of the league values the server sends (Prisma `LeagueType`). */
export type LeagueKind =
  | "standard"
  | "fog"
  | "highFunds"
  | "dualLeague"
  | "standardTeams"
  | "broken";

/** Only what a filter needs to decide — kept minimal so callers can pass richer rows. */
export type HistoryFilterable = {
  isRanked?: boolean;
  leagueType?: string | null;
};

export type HistoryFilter = {
  key: string;
  label: string;
  accepts: (match: HistoryFilterable) => boolean;
};

export const HISTORY_FILTERS: HistoryFilter[] = [
  { key: "all", label: "All", accepts: () => true },
  { key: "ranked", label: "Ranked", accepts: (match) => match.isRanked === true },
  { key: "casual", label: "Casual", accepts: (match) => match.isRanked !== true },
  { key: "standard", label: "Standard", accepts: (match) => match.leagueType === "standard" },
  { key: "fog", label: "Fog", accepts: (match) => match.leagueType === "fog" },
  { key: "highFunds", label: "High funds", accepts: (match) => match.leagueType === "highFunds" },
];

/** Rows per page in the history list. */
export const HISTORY_PAGE_SIZE = 10;

/** Human label for a league value; unknown/missing reads as "Custom" (v1 rows carry no league). */
export const LEAGUE_LABEL: Record<string, string> = {
  standard: "Standard",
  fog: "Fog",
  highFunds: "High funds",
  dualLeague: "Dual",
  standardTeams: "Teams",
  broken: "Broken",
};

export const leagueLabelOf = (leagueType: string | null | undefined): string =>
  leagueType === null || leagueType === undefined
    ? "Custom"
    : (LEAGUE_LABEL[leagueType] ?? leagueType);

/** Total pages for `count` rows, never less than 1 (an empty list still has a page to show). */
export const pageCountOf = (count: number): number =>
  Math.max(1, Math.ceil(count / HISTORY_PAGE_SIZE));

/** The rows on `page` (0-indexed), clamped so a stale page never renders an empty list. */
export function pageOf<T>(rows: T[], page: number): T[] {
  const safePage = Math.min(Math.max(0, page), pageCountOf(rows.length) - 1);

  return rows.slice(safePage * HISTORY_PAGE_SIZE, safePage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE);
}
