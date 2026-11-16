"use client";

import type { TurnBanner } from "frontend/components/match/useTurnBanner";
import { ARMY_HEX, ARMY_LABEL, coPortraitUrl } from "frontend/utils/sprites";
import { useEffect, useState } from "react";

const UP_MS = 650;
const HOLD_MS = 130;
const DOWN_MS = 500;

/**
 * The funds counter for the viewer's own turn: rolls up from `before` by income to `peak`, then down
 * by the repair spend to `after` — digits flipping to the final balance. Green while rising, red
 * while falling, gold once settled. Driven by rAF; remounts with the banner so it replays per turn.
 */
function AnimatedFunds({ before, peak, after }: { before: number; peak: number; after: number }) {
  const [value, setValue] = useState(before);
  const [phase, setPhase] = useState<"up" | "down" | "done">("up");

  useEffect(() => {
    let raf = 0;
    let start: number | null = null;

    const step = (ts: number) => {
      start ??= ts;
      const t = ts - start;

      if (t < UP_MS) {
        setValue(Math.round(before + (peak - before) * (t / UP_MS)));
        setPhase("up");
      } else if (t < UP_MS + HOLD_MS) {
        setValue(peak);
        setPhase("up");
      } else if (t < UP_MS + HOLD_MS + DOWN_MS) {
        setValue(Math.round(peak + (after - peak) * ((t - UP_MS - HOLD_MS) / DOWN_MS)));
        setPhase("down");
      } else {
        setValue(after);
        setPhase("done");
        return;
      }

      raf = requestAnimationFrame(step);
    };

    raf = requestAnimationFrame(step);

    return () => cancelAnimationFrame(raf);
  }, [before, peak, after]);

  return (
    <span className={`ww-turn__funds is-${phase}`}>
      <span className="ww-turn__funds-num">{value.toLocaleString("en-US")}</span>
      <span className="ww-turn__funds-unit">G</span>
    </span>
  );
}

/**
 * The ADW-style "start of turn" banner overlaid on the board when a turn begins: a horizontal strip
 * with the acting CO's mugshot + an army-accent bar, then "DAY N" over a details line — the upkeep
 * summary (repaired/refuelled) on the viewer's own turn, or "<Army> — enemy turn" on the opponent's.
 * The CO is conveyed by the portrait alone (no name text). Purely presentational and non-interactive
 * (pointer-events-none, so it never eats a board click) — driven by the BE via `useTurnBanner`. It
 * slides in, holds, and fades on its own before the hook unmounts it. Reduced-motion falls back to a
 * plain fade (see turnBanner.scss).
 */
export function TurnStartBanner({
  day,
  coName,
  army,
  isViewer,
  repaired,
  refuelled,
  crashed,
  funds,
}: TurnBanner) {
  const upkeep: string[] = [];

  if (repaired > 0) {
    upkeep.push(`${repaired} repaired`);
  }

  if (refuelled > 0) {
    upkeep.push(`${refuelled} refuelled`);
  }

  // Losses are called out separately rather than joined into the upkeep list — they're the opposite
  // news, and burying "2 lost to fuel" between "3 repaired" and "1 refuelled" reads as an upside.
  const losses = crashed > 0 ? `${crashed} lost to fuel` : null;

  return (
    <div
      className="ww-turn @absolute @inset-0 @z-20 @flex @items-center @justify-center @pointer-events-none"
      role="status"
      aria-label={`Day ${day}, ${isViewer ? "your turn" : "enemy turn"}`}
      style={{ ["--ww-turn-accent" as string]: ARMY_HEX[army] }}
    >
      <div className="ww-turn__card">
        <img
          className="ww-turn__portrait"
          src={coPortraitUrl(coName, "full")}
          alt=""
          aria-hidden="true"
          onError={(event) => {
            event.currentTarget.style.visibility = "hidden";
          }}
        />
        <div className="ww-turn__text">
          <span className="ww-turn__day">
            <span className="ww-turn__day-word">Day</span>
            {day}
          </span>
          {isViewer && funds !== null ? (
            <>
              <AnimatedFunds before={funds.before} peak={funds.peak} after={funds.after} />
              {upkeep.length > 0 && <span className="ww-turn__note">{upkeep.join(" · ")}</span>}
              {losses !== null && (
                <span className="ww-turn__note ww-turn__note--loss">{losses}</span>
              )}
            </>
          ) : (
            <span className="ww-turn__sub">
              {isViewer ? "Your orders, Commander" : `${ARMY_LABEL[army]} — enemy turn`}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
