import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import type { PowerLaunchPulse } from "pixi/v2/render-power-effects";
import { useEffect, useRef, useState } from "react";

/** The BE's report of a CO power going off, off `match.full`. Public — both players see it. */
type PowerActivation = NonNullable<MatchView["powerActivation"]>;

/**
 * Hold the on-board power set-piece until the CO splash cinematic has essentially finished (its
 * scrim is gone by ~3.2s — see powerSplash.scss / usePowerAnimation), so the board effect isn't
 * dimmed by it.
 */
const POWER_BOARD_DELAY_MS = 3300;

/**
 * Sequences the CO-power board flourish to play AFTER the splash cinematic.
 *
 * On a new activation the report is mapped to the pixi pulse and a timer is armed; when it fires the
 * pulse is stored and `nonce` bumps, which re-runs the scene effect. That effect calls `takePulse()`
 * — it returns the pulse exactly once and then latches, so the within-turn rebuilds that follow
 * don't replay it. Arming is gated on the activation key, so a refetch can't re-arm the same power.
 */
export function usePowerBoardPulse(activation: PowerActivation | null) {
  // The last activation (playerId:timesPowerUsed) we already SCHEDULED, so the timer is armed once.
  const scheduledRef = useRef<string | null>(null);
  const armedPulseRef = useRef<PowerLaunchPulse | null>(null);
  const [nonce, setNonce] = useState(0);
  const lastPlayedNonceRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (activation === null) {
      return;
    }

    const key = `${activation.playerId}:${activation.timesPowerUsed}`;

    if (scheduledRef.current === key) {
      return;
    }

    scheduledRef.current = key;

    const pulse: PowerLaunchPulse = {
      affectedUnits: activation.affectedUnits.map((affected) => ({
        position: [affected.position[0], affected.position[1]] as BoardPosition,
        kind: affected.kind,
      })),
      signature:
        activation.signature === null
          ? null
          : {
              kind: activation.signature.kind,
              epicenters: activation.signature.epicenters.map(
                (epicenter): BoardPosition => [epicenter[0], epicenter[1]],
              ),
            },
    };

    // Drop any still-pending timer from a previous activation before scheduling this one: a second
    // power within POWER_BOARD_DELAY_MS would otherwise leave the first timer to fire on its own (a
    // double pulse, or a setState into a torn-down scene). One pending timer at a time.
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      armedPulseRef.current = pulse;
      setNonce((current) => current + 1);
    }, POWER_BOARD_DELAY_MS);
  }, [activation]);

  // Clear a pending flourish timer on unmount so it can't fire into a torn-down scene.
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    },
    [],
  );

  /** The armed pulse if this render is the first to observe it; `undefined` on every other render. */
  const takePulse = (): PowerLaunchPulse | undefined => {
    if (nonce === lastPlayedNonceRef.current || armedPulseRef.current === null) {
      return undefined;
    }

    lastPlayedNonceRef.current = nonce;

    return armedPulseRef.current;
  };

  return { nonce, takePulse };
}
