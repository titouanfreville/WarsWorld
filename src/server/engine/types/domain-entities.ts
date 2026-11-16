import type { Tile } from "server/core/schemas/tile";
import type { UnitWithVisibleStats } from "server/core/schemas/unit";

/**
 * Engine-owned entity types. They mirror the persisted (Prisma) shapes, but the engine defines
 * them itself so `src/shared` stays framework-free — no `@prisma/client` in domain code. Adapters
 * map DB rows to/from these at the boundary. See the migration map in the root CLAUDE.md.
 */

export type MatchStatus = "setup" | "playing" | "finished" | "cancelled";

// `mode`/`ruleset` (which replaced the flat `LeagueType`) are game VOCABULARY, so they live in the
// kernel — `server/core/schemas/game-mode` — not here. The engine imports them from there.

/** The map data the engine consumes (mirror of the persisted `WWMap` row). */
export type WWMap = {
  id: string;
  name: string;
  numberOfPlayers: number;
  tiles: Tile[][];
  predeployedUnits: UnitWithVisibleStats[];
  createdAt: Date;
};
