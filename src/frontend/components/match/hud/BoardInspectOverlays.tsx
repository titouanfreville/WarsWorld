"use client";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { useAttackForecast } from "frontend/components/match/useAttackForecast";
import type { useUnitInspect } from "frontend/components/match/useUnitInspect";
import { CombatForecastCard } from "./CombatForecastCard";
import { UnitDetailCard } from "./UnitDetailCard";

type Props = {
  forecast: ReturnType<typeof useAttackForecast>;
  inspect: ReturnType<typeof useUnitInspect>;
  spritesheetDataByArmy: SpritesheetDataByArmy;
};

/**
 * The two BE-fed readouts the board raises about whatever the cursor is on: the floating combat
 * forecast for an engagement being eyed, and the stat card for a right-clicked unit.
 *
 * Grouped because they're the same concern from the player's side — "tell me about this tile" — and
 * both are pure renderings of a BE preview query. Neither computes anything: damage, ranges and unit
 * stats all come from `match.previews`.
 */
export function BoardInspectOverlays({ forecast, inspect, spritesheetDataByArmy }: Props) {
  return (
    <>
      {forecast.focus !== null && (
        <CombatForecastCard
          targetPosition={forecast.focus.targetPosition}
          forecast={forecast.forecast}
        />
      )}
      {inspect.position !== null && (
        <UnitDetailCard
          position={inspect.position}
          army={inspect.army}
          details={inspect.details}
          spritesheetDataByArmy={spritesheetDataByArmy}
          terrainArmy={inspect.terrainArmy}
          onClose={inspect.close}
        />
      )}
    </>
  );
}
