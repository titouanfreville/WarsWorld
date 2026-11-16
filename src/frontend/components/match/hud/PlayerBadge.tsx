"use client";
import type { MatchPlayer } from "frontend/components/match/match-view";
import type { PowerInfo } from "frontend/components/match/turn-snapshot-view";
import { ARMY_HEX, ARMY_LABEL, coPortraitUrl, type Army } from "frontend/utils/sprites";
import type { PlayerBattleStats } from "./derive-player-stats";
import { PowerActions } from "./PowerActions";
import { PowerMeter } from "./PowerMeter";
import { TurnClock } from "./TurnClock";

/**
 * One army's permanent readout in the command HUD: CO mugshot in an army-accent frame, name, and the
 * live intel line — funds (public outside fog; fogged opponents read `$ ??`), visible unit count, held properties,
 * and the read-only power-star meter. All values come pre-derived from the fog-respecting
 * `derivePlayerStats` + the BE power summary; this component only renders.
 *
 * Everything power-related lives here in the general's own space: the read-only meter for every army,
 * plus — for the viewer, on their own turn — the CO/Super activation controls (`activatablePower`).
 */
type Props = {
  player: MatchPlayer;
  stats: PlayerBattleStats;
  /** Whether it's this army's turn — highlights the badge. */
  active: boolean;
  /** Stretch to fill its container (used when the HUD is a narrow side column). */
  fill?: boolean;
  /** Self, on their own turn: the snapshot power detail to render activation buttons for. */
  activatablePower?: PowerInfo | null;
  onActivatePower?: (isSuper: boolean) => void;
  /** True while a power activation is already buffered — blocks a double-tap. */
  powerPending?: boolean;
  /** Deadline for the turn in progress (epoch ms), for the active army's live clock. */
  turnEndsAt?: number | null;
};

const fundsLabel = (funds: number | null): string =>
  funds === null ? "$ ??" : `$${funds.toLocaleString()}`;

export function PlayerBadge({
  player,
  stats,
  active,
  fill = false,
  activatablePower = null,
  onActivatePower,
  powerPending = false,
  turnEndsAt = null,
}: Props) {
  const army = player.army as Army;
  const accent = ARMY_HEX[army] ?? "#E47220";
  const routed = player.status !== "alive";
  const name = player.name.replace(/^\[dev\]\s*/, "");
  // Funds colour: fogged (enemy) → slate, a genuine deficit → red, otherwise the gold headline.
  const fundsClass =
    stats.funds === null
      ? "@text-slate-500"
      : stats.funds < 0
        ? "@text-red-400"
        : "@text-yellow-300 @drop-shadow-[0_0_4px_rgba(250,204,21,0.4)]";

  return (
    <div
      className={`@relative @flex @items-center @gap-3 @overflow-hidden @rounded-lg @bg-bg-secondary/80 @py-2 @pl-3 @pr-3 @shadow-lg @shadow-black/30 @transition ${
        fill ? "@w-full" : ""
      } ${routed ? "@opacity-40 @grayscale" : ""} ${active ? "@ring-2" : "@ring-1 @ring-white/5"}`}
      style={active ? { ["--tw-ring-color" as string]: accent } : undefined}
    >
      {/* army-accent bar + faint glow */}
      <span className="@absolute @inset-y-0 @left-0 @w-1" style={{ backgroundColor: accent }} />
      {active && (
        <span
          className="@pointer-events-none @absolute @inset-0 @opacity-40"
          style={{
            background: `radial-gradient(120% 80% at 0% 50%, ${accent}22, transparent 70%)`,
          }}
        />
      )}

      <img
        src={coPortraitUrl(player.coId.name)}
        alt={player.coId.name}
        className="@relative @h-12 @w-12 @flex-none @rounded-md @bg-black/40 @object-cover [image-rendering:pixelated]"
        style={{ boxShadow: `inset 0 0 0 1.5px ${accent}` }}
      />

      <div className="@relative @flex @min-w-0 @flex-1 @flex-col @gap-1">
        <div className="@flex @min-w-0 @items-baseline @gap-1.5">
          <span className="@truncate @font-russoOne @text-xs @uppercase @tracking-wide">
            {name}
          </span>
          <span className="@truncate @text-[10px] @uppercase @tracking-wider @text-slate-400">
            {player.power.coName}
          </span>
          {routed && (
            <span className="@ml-auto @flex-none @rounded @bg-red-500/20 @px-1 @text-[9px] @font-bold @uppercase @tracking-wider @text-red-300">
              {player.status === "captured" ? "HQ lost" : "Routed"}
            </span>
          )}
        </div>

        {/* Funds are the headline stat; unit/property counts sit to their right. */}
        <div className="@flex @items-baseline @gap-2.5">
          <span
            className={`@font-mono @text-lg @font-bold @leading-none ${fundsClass}`}
            title={stats.funds === null ? "Enemy funds are hidden" : "Funds"}
          >
            {fundsLabel(stats.funds)}
          </span>
          <div className="@flex @items-center @gap-2.5 @font-mono @text-[10px] @leading-none @text-slate-400">
            <span title="Units in sight">
              <span className="@text-slate-500">⛨</span> {stats.unitCount}
            </span>
            <span title="Properties held">
              <span className="@text-slate-500">⌂</span> {stats.propertyCount}
            </span>
          </div>
          {/* Turn clock, pushed to the right of the intel line. Live for the army on turn, banked
              for everyone else; absent entirely in an untimed match. */}
          <span className="@ml-auto @flex-none">
            <TurnClock bankMs={player.timeBankMs} endsAt={turnEndsAt} active={active} />
          </span>
        </div>

        {/* Meter with activation buttons to its right; wraps to the next line in a narrow side dock
            so the Super button is never clipped. */}
        <div className="@flex @flex-wrap @items-center @gap-x-2.5 @gap-y-1.5">
          <PowerMeter
            current={player.power.currentStars}
            total={player.power.totalStars}
            coStars={player.power.coStars}
            muted={routed}
          />
          {activatablePower !== null && onActivatePower !== undefined && (
            <PowerActions
              power={activatablePower}
              onActivate={onActivatePower}
              pending={powerPending}
            />
          )}
        </div>
      </div>

      <span className="@sr-only">{ARMY_LABEL[army]}</span>
    </div>
  );
}
