"use client";
import { useEffect, useState } from "react";
import { formatCountdown } from "frontend/utils/format-time";

/**
 * One army's turn clock in the command HUD.
 *
 * The ACTIVE player's clock counts down live from the BE's `turnEndsAt`; everyone else shows their
 * banked time, frozen. Purely a readout: the server decides what happens at zero (it force-ends the
 * turn), so a client whose tab was throttled, whose clock is skewed, or that simply sat at 0:00 can
 * neither buy time nor lose it. Both players' clocks are shown — the pressure your opponent is under
 * is part of a timed game.
 *
 * Renders nothing in an untimed match (`bankMs === null`), which is every match created before the
 * clock existed and any custom game that opted out.
 */
type Props = {
  /** This player's banked time in ms; null in an untimed match. */
  bankMs: number | null;
  /** Deadline for the turn in progress (epoch ms) — only meaningful for the active player. */
  endsAt: number | null;
  /** Whether this is the army currently on turn (drives the live countdown). */
  active: boolean;
};

/** Ticks per second while a clock is live — a wall clock that jumps 2s at a time reads as broken. */
const TICK_MS = 250;

export function TurnClock({ bankMs, endsAt, active }: Props) {
  // Re-render on a tick only while this clock is actually running; a frozen bank needs no timer.
  const live = active && endsAt !== null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!live) {
      return;
    }

    const id = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(id);
  }, [live]);

  if (bankMs === null) {
    return null; // untimed match
  }

  const remaining = live ? Math.max(0, (endsAt ?? 0) - now) : bankMs;
  // Colour is a warning, not a rule: under a minute reads red, under three amber. The BE is what
  // actually ends the turn.
  const tone =
    remaining <= 60_000
      ? "@text-red-400"
      : remaining <= 180_000
        ? "@text-amber-300"
        : active
          ? "@text-slate-100"
          : "@text-slate-400";

  return (
    <span
      className={`@font-mono @text-[11px] @leading-none @tabular-nums ${tone}`}
      title={active ? "Time left this turn" : "Banked time"}
      // Announced only when it's the viewer's concern; a per-second live region would be unusable.
      aria-label={`${formatCountdown(remaining)} ${active ? "left this turn" : "banked"}`}
    >
      <span className="@text-slate-500" aria-hidden>
        ⏱
      </span>{" "}
      {formatCountdown(remaining)}
    </span>
  );
}
