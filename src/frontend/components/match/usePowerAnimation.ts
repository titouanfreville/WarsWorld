import { useEffect, useRef, useState } from "react";
import type { PowerActivation } from "frontend/components/match/match-view";
import type { Army } from "frontend/utils/sprites";

/** What the CO-power activation splash shows: the activating CO, their army accent, and the power. */
export type PowerSplash = {
  coName: string;
  army: Army;
  isSuper: boolean;
  powerName: string;
  /** Whether the activating player is the viewer (drives "your"/"enemy" framing). */
  isViewer: boolean;
};

type Params = {
  /** The latest activation report from `match.full` (fog-masked positions); null when none this turn. */
  activation: PowerActivation | null;
  /** The activating player's army (looked up by the caller from `activation.playerId`). */
  army: Army | undefined;
  /** The viewer's own player id — decides "your power" vs "enemy power" framing. */
  viewerId: string;
  /** How long the cinematic holds before auto-dismissing. */
  holdSeconds?: number;
};

/**
 * Drives the CO-power activation cinematic. Fires once per activation — keyed on
 * `(playerId, timesPowerUsed)` so the scene's within-turn refetches (the board rebuilds on every
 * action) don't replay it — for BOTH players, since power activation is public in AW. Auto-dismisses
 * after `holdSeconds`. Presentation only; the activation itself is the BE's (see `powerActivationReport`).
 */
export function usePowerAnimation({ activation, army, viewerId, holdSeconds = 3.5 }: Params) {
  const [splash, setSplash] = useState<PowerSplash | null>(null);
  // The last (playerId, timesPowerUsed) we already played, so a within-turn refetch can't re-fire it.
  const playedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (activation === null || army === undefined) {
      return;
    }

    const key = `${activation.playerId}:${activation.timesPowerUsed}`;

    if (playedKeyRef.current === key) {
      return;
    }

    playedKeyRef.current = key;

    setSplash({
      coName: activation.coName,
      army,
      isSuper: activation.isSuper,
      powerName: activation.powerName,
      isViewer: activation.playerId === viewerId,
    });
  }, [activation, army, viewerId]);

  useEffect(() => {
    if (splash === null) {
      return;
    }

    const id = setTimeout(() => setSplash(null), holdSeconds * 1000);

    return () => clearTimeout(id);
  }, [splash, holdSeconds]);

  return { splash, dismiss: () => setSplash(null) };
}
