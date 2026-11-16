/**
 * FE-local shapes for the map browser.
 *
 * Redeclared structurally rather than inferred from the router: the BE re-validates every input
 * regardless of what the client's type claims, so drift between these and the server schema shows
 * up as a tsc error at the `useQuery`/prop boundary instead of silently at runtime.
 */

// `GameMode` / `GAME_MODES` / `MODE_LABEL` live in `frontend/utils/game-mode` — the lobby needs the
// same three, and one FE-local declaration is the point of FE-local declarations.
export { GAME_MODES, MODE_LABEL, type GameMode } from "frontend/utils/game-mode";

import type { GameMode } from "frontend/utils/game-mode";

export type MapFilter = {
  search?: string;
  mode?: GameMode;
  rankedOnly?: boolean;
  players?: number;
};

/** One row of the library, as `map.getAll` returns it. */
export type MapSummary = {
  id: string;
  name: string;
  author: string;
  numberOfPlayers: number;
  size: { width: number; height: number };
  /** Terrain type per cell, row-major. Fed straight to `MapThumbnail`. */
  terrain: string[][];
  supportedModes: GameMode[];
  rankedModes: GameMode[];
  propertyStats: Record<string, number>;
  created: Date;
};

/** Property types worth showing, in the order a player reads them. */
export const PROPERTY_ORDER = ["city", "base", "airport", "port", "lab", "commtower"] as const;

export const PROPERTY_LABEL: Record<string, string> = {
  city: "Cities",
  base: "Bases",
  airport: "Airports",
  port: "Ports",
  lab: "Labs",
  commtower: "Comm towers",
};
