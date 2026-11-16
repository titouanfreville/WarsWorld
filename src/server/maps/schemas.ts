import { z } from "zod";
import { gameModeSchema } from "server/core/schemas/game-mode";
import { tileSchema } from "server/core/schemas/tile";
import { unitSchema } from "server/core/schemas/unit";

const tileRowSchema = z.array(tileSchema).nonempty().max(99);

export const mapSchema = z.object({
  name: z.string(),
  tiles: z.array(tileRowSchema).nonempty().max(99),
  predeployedUnits: z.array(unitSchema),
});

export type CreatableMap = z.infer<typeof mapSchema>;

/**
 * What the map browser can narrow the library by. Filtering is server-side because the map list is
 * the BE's to own — the client sends intent, not a predicate — and because the library grows past
 * what is sensible to ship to the browser in one payload.
 */
export const mapFilterSchema = z.object({
  /** Free-text match on the map name, case-insensitive. */
  search: z.string().trim().max(100).optional(),
  /** Only maps playable in this mode. */
  mode: gameModeSchema.optional(),
  /** Only maps that are ranked-legal in `mode` (or in any mode when `mode` is absent). */
  rankedOnly: z.boolean().optional(),
  players: z.number().int().min(2).max(4).optional(),
});

export type MapFilter = z.infer<typeof mapFilterSchema>;
