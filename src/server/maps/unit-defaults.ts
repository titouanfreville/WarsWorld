import type { UnitWithVisibleStats } from "server/core/schemas/unit";
import type { DraftUnit } from "./schemas";

/**
 * Turns a unit the author placed into a unit the engine will accept.
 *
 * The builder sends `{type, playerSlot, position}` and nothing more, because starting HP, fuel and
 * ammo are game constants and the frontend is not allowed to hold them. Something has to supply
 * them, and it cannot be `maps` — features never import `engine`. So `maps` declares the need here
 * and the composition root injects an engine-backed implementation, the same way `TerrainAccess`
 * works for terrain.
 */
export type UnitDefaults = {
  /**
   * A complete, schema-valid unit, or `null` when the type is not a real unit.
   *
   * Returning `null` rather than throwing keeps the decision with the caller: an unknown unit type
   * is a validation failure the usecase reports, not an exception from a lookup table.
   */
  build(unit: DraftUnit): UnitWithVisibleStats | null;

  /** Every unit type that may be predeployed, for the builder's palette. */
  types(): string[];

  /**
   * A unit's published stats. The builder shows these; it must never hold a copy of them, so they
   * are read from the engine's own table and sent over the wire like everything else.
   */
  describe(unitType: string): UnitFacts | null;
};

export type UnitFacts = {
  displayName: string;
  cost: number;
  movementPoints: number;
  vision: number;
  /** Where a base/airport/port would build it — also what kind of producer a seat needs. */
  facility: string;
};
