import type { MovementType } from "server/engine/constants/unit-properties";
import type { TileType } from "server/core/schemas/tile";

/**
 * What the fairness checker needs to know about terrain, and nothing more.
 *
 * The `maps` feature may not import `engine` (see src/server/CLAUDE.md — features never import each
 * other, and only `engine` owns game logic), but deciding whether an HQ can actually be reached is
 * meaningless without knowing what a unit can walk on. So `maps` declares the narrow contract and
 * the composition root injects an engine-backed implementation — the same shape as `AdminUsecase`'s
 * `QueuePairer`/`LobbyForcer`.
 *
 * The side benefit is that the checker is testable against a hand-written table, with no engine
 * constants and no Prisma anywhere near it.
 */
export type TerrainAccess = {
  /** Can a unit of this movement type END its movement on this tile? */
  canStand(movement: MovementType, tile: TileType): boolean;

  /**
   * How a unit type gets around, or `undefined` if there is no such unit.
   *
   * Here rather than in a second port because it answers the same question from the other side: a
   * predeployed lander on a mountain is as broken as an HQ nothing can walk to, and both are
   * "who can be where".
   */
  movementOf(unitType: string): MovementType | undefined;

  /** Every tile type the game knows. The builder's terrain palette is built from this. */
  tileTypes(): TileType[];

  /** How much cover a tile gives. A map stat, so it belongs to the backend like every other. */
  defenseStars(tile: TileType): number;
};

/**
 * The movement types that can take property. Only infantry and mech capture, so "can this HQ be
 * reached" is a question about these two and no others — a map whose HQ only a tank can reach is
 * a map nobody can win.
 */
export const CAPTURING_MOVEMENT: MovementType[] = ["foot", "boots"];

/** Movement types used to measure how much ground is open to vehicles. */
export const VEHICLE_MOVEMENT: MovementType[] = ["treads", "tires"];
