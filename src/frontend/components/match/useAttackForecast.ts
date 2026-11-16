import { toTuple } from "frontend/components/match/match-view";
import { trpc } from "frontend/utils/trpc-client";
import type { AttackForecastFocus } from "pixi/v2/board-controller";
import { useState } from "react";

type Params = {
  matchId: string;
  playerId: string;
};

/**
 * The engagement the player is currently eyeing on the board, and the BE's forecast for it —
 * min/max damage both ways plus defence stars. Combat is NEVER previewed on the client: the query
 * only runs while a target is focused, and the disabled-state input is a harmless placeholder.
 *
 * `setFocus` is handed to the pixi controller as `onAttackTargetFocus`.
 */
export function useAttackForecast({ matchId, playerId }: Params) {
  const [focus, setFocus] = useState<AttackForecastFocus | null>(null);

  const query = trpc.match.previews.combatForecast.useQuery(
    {
      matchId,
      playerId,
      attackerPosition: focus === null ? [0, 0] : toTuple(focus.attackerPosition),
      toPosition: focus === null ? [0, 0] : toTuple(focus.toPosition),
      targetPosition: focus === null ? [0, 0] : toTuple(focus.targetPosition),
    },
    { enabled: focus !== null },
  );

  return { focus, setFocus, forecast: query.data };
}
