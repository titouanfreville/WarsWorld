"use client";
import type { PowerInfo } from "frontend/components/match/turn-snapshot-view";

/**
 * The acting player's CO-power ACTIVATION controls — a button per power (Power / Super), or a status
 * pill while one is live. No meter here: the star meter is rendered once, read-only, in the general's
 * badge (`PowerMeter`). Availability, star cost and state are BE-computed in the turn snapshot;
 * activating buffers a `{ type: "coPower", isSuper }` action whose board effects are BE-resolved.
 * Only rendered for the viewer on their own turn.
 */
type Props = {
  power: PowerInfo;
  onActivate: (isSuper: boolean) => void;
  /** True while a power activation is already buffered (awaiting the BE) — blocks a double-tap. */
  pending: boolean;
};

type Tone = "co" | "super";

// CO power reads amber (a full meter); the Super is the hotter, stronger tier — a fiery orange.
const TONE: Record<Tone, { bg: string; text: string }> = {
  co: { bg: "#daa520", text: "#1a1205" },
  super: { bg: "#e0562a", text: "#1a0a05" },
};

function PowerButton({
  label,
  available,
  tone,
  title,
  onClick,
}: {
  label: string;
  available: boolean;
  tone: Tone;
  title: string;
  onClick: () => void;
}) {
  const palette = TONE[tone];

  // Star cost lives in the meter (its zones) + the tooltip, so the button stays compact: just the
  // label. `available` gets a filled/glowing tone; otherwise it's a muted, obviously-inert chip.
  return (
    <button
      type="button"
      className={`@select-none @rounded @px-2.5 @py-1 @font-russoOne @text-[11px] @uppercase @tracking-wider @transition disabled:@cursor-not-allowed ${
        available ? "@shadow-md hover:@brightness-110" : "@opacity-40"
      }`}
      style={
        available
          ? {
              backgroundColor: palette.bg,
              color: palette.text,
              boxShadow: `0 0 8px ${palette.bg}55`,
            }
          : { backgroundColor: "#2b2f36", color: "#8b94a0" }
      }
      disabled={!available}
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

export function PowerActions({ power, onActivate, pending }: Props) {
  // A CO with no powers at all — nothing to activate.
  if (power.copower === null && power.superCopower === null) {
    return null;
  }

  if (power.state !== "no-power") {
    const label = power.state === "super-co-power" ? "Super CO Power" : "CO Power";

    return (
      <span className="@flex @w-fit @items-center @gap-1 @rounded-lg @bg-yellow-400/15 @px-2.5 @py-1 @font-russoOne @text-[11px] @uppercase @tracking-wider @text-yellow-300 @ring-1 @ring-yellow-400/40">
        <span aria-hidden>★</span> {label} Active
      </span>
    );
  }

  return (
    <div className="@flex @items-center @gap-1.5">
      {power.copower !== null && (
        <PowerButton
          label="Power"
          available={power.copower.available && !pending}
          tone="co"
          title={`${power.copower.name} — ${power.copower.stars}★ (${power.copower.cost} meter)`}
          onClick={() => onActivate(false)}
        />
      )}
      {power.superCopower !== null && (
        <PowerButton
          label="Super"
          available={power.superCopower.available && !pending}
          tone="super"
          title={`${power.superCopower.name} — ${power.superCopower.stars}★ (${power.superCopower.cost} meter)`}
          onClick={() => onActivate(true)}
        />
      )}
    </div>
  );
}
