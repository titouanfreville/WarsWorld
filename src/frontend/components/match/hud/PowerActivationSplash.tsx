"use client";

import type { PowerSplash } from "frontend/components/match/usePowerAnimation";
import { ARMY_HEX, coArtUrl } from "frontend/utils/sprites";

/**
 * The AW/DoR-style CO-power activation cinematic overlaid on the board when a power fires: a dark
 * accent-lit scrim, the activating CO's full-body art sweeping in, and a diagonal banner with the
 * power label ("CO POWER" / "SUPER CO POWER") and its name. Plays for BOTH players (activation is
 * public in AW). Purely presentational and non-interactive (pointer-events-none, so it never eats a
 * board click) — driven by the BE via `usePowerAnimation`. It sweeps in, holds, and fades on its own
 * before the hook unmounts it. Reduced-motion falls back to a plain fade (see powerSplash.scss).
 */
export function PowerActivationSplash({ coName, army, isSuper, powerName, isViewer }: PowerSplash) {
  return (
    <div
      className="ww-power @absolute @inset-0 @z-30 @overflow-hidden @pointer-events-none"
      role="status"
      aria-label={`${isViewer ? "Your" : "Enemy"} ${isSuper ? "super CO power" : "CO power"}: ${powerName}`}
      style={{ ["--ww-power-accent" as string]: ARMY_HEX[army] }}
    >
      <div className="ww-power__scrim" />
      <div className="ww-power__rays" aria-hidden="true" />
      <img
        className="ww-power__art"
        src={coArtUrl(coName)}
        alt=""
        aria-hidden="true"
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
      <div className="ww-power__banner">
        <span className="ww-power__kind">{isSuper ? "Super CO Power" : "CO Power"}</span>
        <span className="ww-power__name">{powerName}</span>
        <span className="ww-power__who">
          {isViewer ? "Your orders unleashed" : "Enemy power engaged"}
        </span>
      </div>
    </div>
  );
}
