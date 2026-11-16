import type { RouterOutput } from "frontend/utils/trpc-client";

/**
 * The BE combat forecast for an engagement — min/max HP each side would lose, plus the context the
 * floating combat box renders (each side's current HP + type, and the target tile's terrain defense
 * stars). Typed by tRPC inference; the client only renders it (it never runs the damage math).
 */
export type CombatForecast = NonNullable<RouterOutput["match"]["previews"]["combatForecast"]>;

/**
 * The range of damage an attack does, as a PERCENTAGE label (e.g. `70-80%`, or `75%` when exact).
 * The engine already returns damage on a 0–100 scale, which reads directly as a percentage — this is
 * the "damage done", NOT the target's resulting HP (which the box must not show: it would be wrong
 * against a masked-HP unit like Sonja's, and reveal the hidden value).
 */
export const damageRangeLabel = (damage: { min: number; max: number }): string =>
  damage.min === damage.max ? `${damage.max}%` : `${damage.min}-${damage.max}%`;
