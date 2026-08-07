import { z } from "zod";
import { gameModeSchema } from "server/core/schemas/game-mode";
import { playerSlotForPropertiesSchema } from "server/core/schemas/player-slot";
import { positionSchema } from "server/core/schemas/position";
import { tileSchema } from "server/core/schemas/tile";
import { unitSchema } from "server/core/schemas/unit";
import { RESIZE_ANCHORS } from "./resize";

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

/** Bounds a map may be built at. Wide enough for the existing pool, bounded so a flood stays cheap. */
export const MAP_MIN_SIDE = 10;
export const MAP_MAX_SIDE = 40;

const sideSchema = z.number().int().min(MAP_MIN_SIDE).max(MAP_MAX_SIDE);

/**
 * Opening the builder. Size is the only thing decided up front — everything else is painted, and
 * the checker reads the rest back off the grid.
 */
export const startDraftSchema = z.object({
  width: sideSchema,
  height: sideSchema,
});

export type StartDraftInput = z.infer<typeof startDraftSchema>;

/**
 * A predeployed unit as the BUILDER sends it: what the author chose, and nothing else.
 *
 * Deliberately not the full `unitSchema`. Fuel, ammo and starting HP are game constants, and
 * `src/frontend/CLAUDE.md` forbids the client holding those — so the client names a unit and the
 * server fills the rest in from the engine's own table (see `UnitDefaults`).
 */
export const draftUnitSchema = z.object({
  type: z.string(),
  playerSlot: playerSlotForPropertiesSchema,
  position: positionSchema,
});

export type DraftUnit = z.infer<typeof draftUnitSchema>;

/** The editable body of a map, with units in the lean authoring shape. */
export const draftMapSchema = z.object({
  name: z.string(),
  tiles: z.array(tileRowSchema).nonempty().max(99),
  predeployedUnits: z.array(draftUnitSchema).max(200),
});

export type DraftMapInput = z.infer<typeof draftMapSchema>;

/**
 * One autosave. `seenAt` is the `updatedAt` the client last received, and the write is conditional
 * on it — two open tabs then collide loudly instead of one quietly overwriting the other.
 */
export const updateDraftSchema = draftMapSchema.extend({
  mapId: z.string(),
  seenAt: z.date(),
});

export type UpdateDraftInput = z.infer<typeof updateDraftSchema>;

export const mapIdSchema = z.object({ mapId: z.string() });

/**
 * Reshaping an existing map. Destructive downward — anything outside the new frame is gone — so the
 * builder confirms before sending it.
 */
export const resizeMapSchema = z.object({
  mapId: z.string(),
  seenAt: z.date(),
  width: sideSchema,
  height: sideSchema,
  anchor: z.enum(RESIZE_ANCHORS),
});

export type ResizeMapInput = z.infer<typeof resizeMapSchema>;
