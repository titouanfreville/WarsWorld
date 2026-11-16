"use client";
import {
  damageRangeLabel,
  type CombatForecast,
} from "frontend/components/match/combat-forecast-view";
import type { BoardPosition } from "frontend/components/match/match-view";
import { tileSizeCss, tileTopLeftCss } from "./board-overlay-geometry";

/**
 * Floating AW-style combat box, anchored beside the enemy target the player is eyeing. Shows the
 * RANGE OF DAMAGE each side would take (as a percentage), plus the target tile's terrain defense
 * stars — the "applied def modifier" already baked into the damage the BE returned. It shows damage,
 * NOT resulting HP: that keeps it correct against masked-HP units (e.g. Sonja's) and leaks nothing.
 * Purely presentational: every number comes from the `combatForecast` query.
 */
type Props = {
  /** The target tile — used only to position the box next to it. */
  targetPosition: BoardPosition;
  /** BE forecast; `undefined` while the query is in flight. */
  forecast: CombatForecast | undefined;
};

/** One combatant row: type label and the % damage this unit would take from the engagement. */
function CombatantRow({ type, damage }: { type: string; damage: { min: number; max: number } }) {
  return (
    <div className="@flex @items-baseline @justify-between @gap-3 @font-mono @text-xs">
      <span className="@uppercase @tracking-wide @text-slate-200">{type}</span>
      <span className="@font-bold @text-white">-{damageRangeLabel(damage)}</span>
    </div>
  );
}

export function CombatForecastCard({ targetPosition, forecast }: Props) {
  const anchor = tileTopLeftCss(targetPosition);

  return (
    <div
      className="@pointer-events-none @absolute @z-30 @w-40 @rounded-md @border @border-white/15 @bg-bg-secondary/95 @p-2 @shadow-xl @shadow-black/50 @backdrop-blur"
      // Sits just to the right of the target tile; translate up so it doesn't cover the unit sprite.
      style={{ left: anchor.left + tileSizeCss + 6, top: anchor.top - tileSizeCss / 2 }}
    >
      <div className="@mb-1 @text-[9px] @font-semibold @uppercase @tracking-[0.2em] @text-slate-500">
        Combat
      </div>

      {forecast === undefined ? (
        <div className="@py-2 @text-center @font-mono @text-xs @text-slate-500">…</div>
      ) : (
        <>
          {/* The attacker LOSES `defenderDamage` (the counter); the defender loses `attackerDamage`. */}
          <CombatantRow type={forecast.attacker.type} damage={forecast.defenderDamage} />
          <div className="@my-1 @text-center @text-[9px] @uppercase @tracking-wider @text-slate-600">
            vs
          </div>
          <CombatantRow type={forecast.defender.type} damage={forecast.attackerDamage} />
          <div className="@mt-1.5 @flex @items-center @justify-between @border-t @border-white/10 @pt-1 @text-[10px]">
            <span className="@uppercase @tracking-wider @text-slate-500">Def</span>
            <span
              className="@font-mono @text-amber-300"
              title={`${forecast.defenseStars} defense stars`}
            >
              {"★".repeat(forecast.defenseStars)}
              {"☆".repeat(Math.max(0, 4 - forecast.defenseStars))}
            </span>
            <span className="@truncate @text-slate-400">{forecast.terrainType}</span>
          </div>
        </>
      )}
    </div>
  );
}
