/**
 * FE-local mirror of the server `GameMode` enum, plus its player-facing labels.
 *
 * Redeclared structurally rather than inferred from the router — the BE re-validates every input
 * regardless of what the client's type claims, so drift shows up as a tsc error at the typed
 * boundary instead of silently at runtime.
 *
 * Lives in `utils` because two unrelated features need it (the lobby room and the map browser) and
 * each had declared its own identical copy — same union, same label map, same explanatory comment,
 * in the same change. FE-local redeclaration is the rule; redeclaring it twice inside the frontend
 * is just duplication.
 */

/** Identifiers, not labels — see `MODE_LABEL` for display. */
export type GameMode = "duel" | "teams" | "ffa";

export const GAME_MODES: GameMode[] = ["duel", "teams", "ffa"];

/** The UI never shows the identifiers: a Prisma enum member can't start with a digit. */
export const MODE_LABEL: Record<GameMode, string> = {
  duel: "1v1",
  teams: "2v2",
  ffa: "FFA",
};
