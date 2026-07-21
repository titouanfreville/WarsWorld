import { useEffect, useRef, useState } from "react";
import type { Army } from "frontend/utils/sprites";

/** What the start-of-turn banner shows: whose CO is up, the day, and (own turn only) upkeep + funds. */
export type TurnBanner = {
  /**
   * A monotonic id bumped every time the banner (re)fires — used as the React `key` at the render
   * site so a new turn-start REMOUNTS the component. Without a key change React reconciles the same
   * element and its CSS entrance animation (`animation-fill-mode: both`, ending at opacity 0) never
   * replays, leaving the banner stuck invisible when turns arrive faster than the auto-dismiss.
   */
  nonce: number;
  day: number;
  coName: string;
  army: Army;
  /** Whether the acting player is the viewer (drives "your turn" framing + showing upkeep/funds). */
  isViewer: boolean;
  repaired: number;
  refuelled: number;
  /** Own units lost to running out of fuel this upkeep — the one bad-news line on the banner. */
  crashed: number;
  /**
   * The funds movement to animate (own turn only; null under fog on the opponent's turn): banked
   * `before` → `peak` after income → `after` once repairs are paid.
   */
  funds: { before: number; peak: number; after: number } | null;
};

/** The fog-safe start-of-turn report from `match.full` (own units only). Null outside the viewer's turn. */
type TurnStart = {
  day: number;
  repaired: readonly unknown[];
  refuelled: readonly unknown[];
  crashed: readonly unknown[];
  income: number;
  repairSpent: number;
  fundsAfter: number;
} | null;

type Params = {
  /** The current day counter (`view.turn`). */
  turn: number | undefined;
  /** The player whose turn it now is (`getCurrentTurnPlayer`) + their CO/army. */
  actingPlayerId: string | undefined;
  actingCoName: string | undefined;
  actingArmy: Army | undefined;
  /** The viewer's own player id — decides "your turn" framing + whether upkeep is shown. */
  viewerId: string;
  /** The viewer's fog-safe upkeep report for this turn; null on the opponent's turn. */
  turnStart: TurnStart;
  /** How long the banner holds before auto-dismissing. */
  holdSeconds?: number;
};

/**
 * Drives the "start of round" banner: fires once each time the acting player changes (a new
 * `turn`+player combination) — for BOTH players, so you see whose CO is up. On the viewer's own turn
 * it also shows the upkeep summary (units the BE repaired/refuelled); on the opponent's turn it shows
 * just their CO + day (their upkeep is fog-hidden). CO identity is public, so this leaks nothing.
 * Auto-dismisses after `holdSeconds`. Presentation only — the acting player + report are the BE's.
 */
export function useTurnBanner({
  turn,
  actingPlayerId,
  actingCoName,
  actingArmy,
  viewerId,
  turnStart,
  holdSeconds = 3,
}: Params) {
  const [banner, setBanner] = useState<TurnBanner | null>(null);
  // The last (turn, player) we already showed the banner for, so a within-turn refetch doesn't
  // re-trigger it. Keyed on the player too, so a viewer→opponent handover fires even if `turn` is
  // unchanged between them.
  const shownKeyRef = useRef<string | null>(null);
  // Bumped on every fire so the render can key on it and force a fresh mount each turn (see TurnBanner.nonce).
  const nonceRef = useRef(0);

  useEffect(() => {
    if (
      turn === undefined ||
      actingPlayerId === undefined ||
      actingCoName === undefined ||
      actingArmy === undefined
    ) {
      return;
    }

    const key = `${turn}:${actingPlayerId}`;

    if (shownKeyRef.current === key) {
      return;
    }

    shownKeyRef.current = key;
    nonceRef.current += 1;

    const isViewer = actingPlayerId === viewerId;
    // Funds are the viewer's own (fog-hidden for the opponent). Sequence: banked `before` → up by
    // income to `peak` → down by repair spend to `after`.
    const funds =
      isViewer && turnStart !== null
        ? {
            before: turnStart.fundsAfter - turnStart.income + turnStart.repairSpent,
            peak: turnStart.fundsAfter + turnStart.repairSpent,
            after: turnStart.fundsAfter,
          }
        : null;
    setBanner({
      nonce: nonceRef.current,
      day: turnStart?.day ?? turn,
      coName: actingCoName,
      army: actingArmy,
      isViewer,
      repaired: isViewer ? (turnStart?.repaired.length ?? 0) : 0,
      refuelled: isViewer ? (turnStart?.refuelled.length ?? 0) : 0,
      crashed: isViewer ? (turnStart?.crashed.length ?? 0) : 0,
      funds,
    });
  }, [turn, actingPlayerId, actingCoName, actingArmy, viewerId, turnStart]);

  useEffect(() => {
    if (banner === null) {
      return;
    }

    const id = setTimeout(() => setBanner(null), holdSeconds * 1000);

    return () => clearTimeout(id);
  }, [banner, holdSeconds]);

  return { banner, dismiss: () => setBanner(null) };
}
