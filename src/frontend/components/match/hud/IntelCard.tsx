"use client";
import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";
import {
  ARMY_HEX,
  coPortraitUrl,
  spriteNameForUnit,
  unitSpriteUrl,
  type Army,
} from "frontend/utils/sprites";
import { derivePlayerStats } from "./derive-player-stats";
import { PowerMeter } from "./PowerMeter";

/**
 * A general's full intel dossier for the on-map overview — richer than the compact HUD `PlayerBadge`.
 * On top of CO / funds / properties / power gauge it adds a **breakdown of visible units by type**
 * (icon + count). Fog-respecting: it reads the already-fog-filtered `view.units`, so an opponent's
 * breakdown only shows what the viewer can actually see, and enemy funds read `$ ??` only under fog.
 */
type Props = {
  view: MatchView;
  player: MatchPlayer;
  viewerPlayerId: string;
  active: boolean;
};

const fundsLabel = (funds: number | null): string =>
  funds === null ? "$ ??" : `$${funds.toLocaleString()}`;

/** Visible units of this army grouped by wire type, most-numerous first. */
const unitBreakdown = (view: MatchView, slot: number): [string, number][] => {
  const counts = new Map<string, number>();

  for (const unit of view.units) {
    if (unit.playerSlot === slot) {
      counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

// Property vocabulary → short label + accent colour. The label is shown on each chip (a colour dot
// alone isn't decodable), so no separate legend is needed.
const PROPERTY_META: Record<string, { label: string; color: string }> = {
  hq: { label: "HQ", color: "#e6b422" },
  city: { label: "City", color: "#8aa0b6" },
  base: { label: "Factory", color: "#c07a3e" },
  airport: { label: "Airport", color: "#6fb1c9" },
  port: { label: "Port", color: "#4f79b0" },
  commtower: { label: "Tower", color: "#8f6fc0" },
  lab: { label: "Lab", color: "#5fb08a" },
};

/** Owned property tiles of this army grouped by type, most-numerous first. */
const propertyBreakdown = (view: MatchView, slot: number): [string, number][] => {
  const counts = new Map<string, number>();

  for (const tile of view.changeableTiles) {
    if ("playerSlot" in tile && tile.playerSlot === slot) {
      counts.set(tile.type, (counts.get(tile.type) ?? 0) + 1);
    }
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
};

export function IntelCard({ view, player, viewerPlayerId, active }: Props) {
  const army = player.army as Army;
  const accent = ARMY_HEX[army] ?? "#E47220";
  const routed = player.status !== "alive";
  const stats = derivePlayerStats(view, player, viewerPlayerId);
  const name = player.name.replace(/^\[dev\]\s*/, "");
  const units = unitBreakdown(view, player.slot);
  const properties = propertyBreakdown(view, player.slot);

  const fundsClass =
    stats.funds === null
      ? "@text-slate-500"
      : stats.funds < 0
        ? "@text-red-400"
        : "@text-yellow-300 @drop-shadow-[0_0_4px_rgba(250,204,21,0.4)]";

  return (
    <div
      className={`@relative @overflow-hidden @rounded-lg @bg-bg-secondary/95 @p-3 @shadow-xl @shadow-black/50 @backdrop-blur ${
        routed ? "@opacity-50 @grayscale" : ""
      } ${active ? "@ring-2" : "@ring-1 @ring-white/10"}`}
      style={active ? { ["--tw-ring-color" as string]: accent } : undefined}
    >
      <span className="@absolute @inset-y-0 @left-0 @w-1" style={{ backgroundColor: accent }} />

      {/* header: CO, funds, properties, power gauge */}
      <div className="@flex @items-center @gap-2.5">
        <img
          src={coPortraitUrl(player.coId.name)}
          alt={player.coId.name}
          className="@h-11 @w-11 @flex-none @rounded-md @bg-black/40 [image-rendering:pixelated]"
          style={{ boxShadow: `inset 0 0 0 1.5px ${accent}` }}
        />
        <div className="@flex @min-w-0 @flex-1 @flex-col @gap-1">
          <div className="@flex @min-w-0 @items-baseline @gap-1.5">
            <span className="@truncate @font-russoOne @text-sm @uppercase @tracking-wide">
              {name}
            </span>
            <span className="@truncate @text-[10px] @uppercase @tracking-wider @text-slate-400">
              {player.power.coName}
            </span>
          </div>
          <span className={`@font-mono @text-lg @font-bold @leading-none ${fundsClass}`}>
            {fundsLabel(stats.funds)}
          </span>
          <PowerMeter
            current={player.power.currentStars}
            total={player.power.totalStars}
            coStars={player.power.coStars}
            muted={routed}
          />
        </div>
      </div>

      {/* visible-units-by-type breakdown */}
      <div className="@mt-2.5 @border-t @border-white/10 @pt-2">
        <div className="@mb-1.5 @flex @items-center @justify-between @text-[10px] @uppercase @tracking-wider @text-slate-500">
          <span>Units in sight</span>
          <span className="@font-mono @text-slate-300">{stats.unitCount}</span>
        </div>

        {units.length === 0 ? (
          <p className="@py-0 @text-[11px] @italic @text-slate-600">No units in sight</p>
        ) : (
          <div className="@grid @grid-cols-4 @gap-1.5">
            {units.map(([type, count]) => {
              const sprite = spriteNameForUnit(type);

              return (
                <div
                  key={type}
                  className="@flex @items-center @gap-1 @rounded @bg-black/30 @px-1 @py-0.5"
                  title={type}
                >
                  {sprite !== undefined && (
                    <img
                      src={unitSpriteUrl(sprite, army)}
                      alt={type}
                      className="@h-5 @w-5 @flex-none [image-rendering:pixelated]"
                    />
                  )}
                  <span className="@font-mono @text-[11px] @text-slate-200">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* property-by-type breakdown */}
      <div className="@mt-2 @border-t @border-white/10 @pt-2">
        <div className="@mb-1.5 @flex @items-center @justify-between @text-[10px] @uppercase @tracking-wider @text-slate-500">
          <span>Properties</span>
          <span className="@font-mono @text-slate-300">{stats.propertyCount}</span>
        </div>

        {properties.length === 0 ? (
          <p className="@py-0 @text-[11px] @italic @text-slate-600">None</p>
        ) : (
          <div className="@grid @grid-cols-2 @gap-1.5">
            {properties.map(([type, count]) => {
              const meta = PROPERTY_META[type];

              return (
                <div
                  key={type}
                  className="@flex @items-center @gap-1.5 @rounded @bg-black/30 @px-1.5 @py-0.5"
                  title={meta?.label ?? type}
                >
                  <span
                    className="@h-2.5 @w-2.5 @flex-none @rounded-sm"
                    style={{ backgroundColor: meta?.color ?? "#8aa0b6" }}
                  />
                  <span className="@truncate @text-[10px] @uppercase @tracking-wide @text-slate-300">
                    {meta?.label ?? type}
                  </span>
                  <span className="@ml-auto @font-mono @text-[11px] @text-slate-200">{count}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
