"use client";

import { ARMY_HEX, type Army } from "frontend/utils/sprites";
import { ENGINE_UNIT_KEY, unitLabel, unitSpriteUrl, type UnitType } from "frontend/utils/sprites";
import { AIR_UNITS, SEA_UNITS, UNIT_TYPES } from "frontend/utils/sprites";
import type { inferTRPCOutput } from "frontend/utils/trpc-client";
import { trpc } from "frontend/utils/trpc-client";
import { Fragment, useState } from "react";
import { LineChart, type ChartSeries } from "./LineChart";

/** The end-game summary, inferred from the API (the sanctioned FE↔BE contract — no server import). */
type Summary = NonNullable<inferTRPCOutput<"endgame", "summary">>;
type PlayerStats = Summary["stats"]["players"][number];
type TimelineRow = Summary["stats"]["timeline"][number];
type TurnMetric = "income" | "armyValue" | "properties" | "funds";
type Domain = "infantry" | "vehicle" | "air" | "naval";

const fmt = (value: number): string => Math.round(value).toLocaleString();

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "0%";

const hexToRgba = (hex: string, alpha: number): string => {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const DOMAIN_ORDER: Domain[] = ["infantry", "vehicle", "air", "naval"];
const DOMAIN_LABEL: Record<Domain, string> = {
  infantry: "Infantry",
  vehicle: "Vehicles",
  air: "Air",
  naval: "Naval",
};

// The units that belong to each domain, in build order, with their engine key + sprite base. Built
// once so the sprite sub-rows render in a stable, sensible order.
const AIR = new Set<string>(AIR_UNITS);
const SEA = new Set<string>(SEA_UNITS);
const domainOfSprite = (sprite: UnitType): Domain =>
  sprite === "Infantry" || sprite === "Mech"
    ? "infantry"
    : AIR.has(sprite)
      ? "air"
      : SEA.has(sprite)
        ? "naval"
        : "vehicle";

type UnitRow = { key: string; sprite: UnitType; label: string };
const DOMAIN_UNITS: Record<Domain, UnitRow[]> = { infantry: [], vehicle: [], air: [], naval: [] };

for (const sprite of UNIT_TYPES) {
  DOMAIN_UNITS[domainOfSprite(sprite)].push({
    key: ENGINE_UNIT_KEY[sprite],
    sprite,
    label: unitLabel(sprite),
  });
}

// Property-type → glyph for the capture timeline marks.
const PROPERTY_GLYPH: Record<string, string> = {
  hq: "🏁",
  city: "🏙️",
  base: "🏭",
  factory: "🏭",
  airport: "✈️",
  port: "⚓",
  comTower: "📡",
  tower: "📡",
  lab: "🔬",
};

type ChartTab = { key: string; label: string; metric: TurnMetric; unit: string; step?: boolean };
const CHART_TABS: ChartTab[] = [
  { key: "global", label: "Global", metric: "income", unit: "Income / turn" },
  { key: "military", label: "Military", metric: "armyValue", unit: "Army value on field" },
  { key: "control", label: "Control", metric: "properties", unit: "Properties owned", step: true },
  { key: "economy", label: "Economy", metric: "funds", unit: "Funds banked (idle)" },
];

const UnitCell = ({ row }: { row: UnitRow }) => (
  <span className="egs-an__unitcell">
    <img className="egs-an__u" src={unitSpriteUrl(row.sprite)} alt="" aria-hidden />
    {row.label}
  </span>
);

/**
 * The match-analysis panel on the End-Game screen (Epic 3.3), fed by `endgame.summary`. A tabbed
 * battle report: the four per-turn charts (income / army value / properties / funds — from
 * `stats.timeline`), a both-players damage breakdown with **unit sprites**, the Military built/lost
 * table (sprite sub-rows), a horizontal **capture timeline** (Control) and the Economy income/spend
 * table. Mirrors the eg-mockup. Grade / honor / chat live elsewhere on the screen.
 */
export function MatchAnalysis({ matchId }: { matchId: string }) {
  const query = trpc.endgame.summary.useQuery({ matchId });
  const [tab, setTab] = useState("global");
  // Which unit-class groups are expanded (all open by default) in the Military / Damage tables.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (query.isLoading) {
    return (
      <section className="egs__panel">
        <p className="egs__panel-body">Loading match analysis…</p>
      </section>
    );
  }

  if (query.isError || query.data === undefined || query.data === null) {
    return (
      <section className="egs__panel">
        <p className="egs__panel-body">Match analysis is unavailable for this match.</p>
      </section>
    );
  }

  const { players, stats } = query.data;
  const nameOf = (playerId: string): string =>
    players.find((player) => player.playerId === playerId)?.name ?? "—";

  const armyColorOf = (playerId: string): string => {
    const army = players.find((player) => player.playerId === playerId)?.army;

    return ARMY_HEX[army as Army] ?? "#94a3b8";
  };

  // Net banked = idle funds in the last turn-boundary snapshot (0 if the match ended before a pass).
  const finalRow = stats.timeline[stats.timeline.length - 1];
  const bankedOf = (playerId: string): number =>
    finalRow?.perPlayer.find((p) => p.playerId === playerId)?.funds ?? 0;

  const xTurns = stats.timeline.map((row) => row.turn);

  const seriesFor = (metric: TurnMetric): ChartSeries[] =>
    players.map((player) => {
      const color = ARMY_HEX[player.army as Army] ?? "#94a3b8";
      const valueAt = (row: TimelineRow): number =>
        row.perPlayer.find((p) => p.playerId === player.playerId)?.[metric] ?? 0;

      return {
        label: player.name,
        color,
        fill: hexToRgba(color, 0.12),
        data: stats.timeline.map(valueAt),
      };
    });

  const activeChart = CHART_TABS.find((chartTab) => chartTab.key === tab);

  const damageCell = (row: PlayerStats, value: number, showPct: boolean) => (
    <td key={row.playerId}>
      {fmt(value)}
      {showPct && <span className="egs-an__pct">{pct(value, row.damageDealt)}</span>}
    </td>
  );

  // The unit rows in a domain that any player actually built/lost (Military) or dealt damage with.
  const activeUnits = (
    domain: Domain,
    valueOf: (row: PlayerStats, key: string) => number,
  ): UnitRow[] =>
    DOMAIN_UNITS[domain].filter((unit) => stats.players.some((row) => valueOf(row, unit.key) > 0));

  const builtOrLost = (row: PlayerStats, key: string): number =>
    (row.builtByUnit[key] ?? 0) + (row.lostByUnit[key] ?? 0);

  return (
    <section className="egs__panel egs-an">
      <header className="egs__panel-head">
        <h2 className="egs__panel-title">Match analysis</h2>
        <span className="egs__soon">
          Day {stats.days} · {stats.turns} turns
        </span>
      </header>

      <div className="egs-an__tabs" role="tablist">
        {CHART_TABS.map((chartTab) => (
          <button
            key={chartTab.key}
            type="button"
            role="tab"
            aria-selected={tab === chartTab.key}
            className={`egs-an__tab ${tab === chartTab.key ? "is-active" : ""}`}
            onClick={() => setTab(chartTab.key)}
          >
            {chartTab.label}
          </button>
        ))}
        <button
          type="button"
          role="tab"
          aria-selected={tab === "damage"}
          className={`egs-an__tab ${tab === "damage" ? "is-active" : ""}`}
          onClick={() => setTab("damage")}
        >
          Damage
        </button>
      </div>

      {activeChart !== undefined && (
        <LineChart
          series={seriesFor(activeChart.metric)}
          xTurns={xTurns}
          step={activeChart.step}
          unitLabel={activeChart.unit}
        />
      )}

      {/* Military — units built + lost, grouped by class with unit-sprite sub-rows. */}
      {tab === "military" && (
        <div className="egs-an__scroll">
          <table className="egs-an__table egs-an__gt">
            <thead>
              <tr>
                <th rowSpan={2}>Unit</th>
                {stats.players.map((row) => (
                  <th key={row.playerId} colSpan={2}>
                    {nameOf(row.playerId)}
                  </th>
                ))}
              </tr>
              <tr>
                {stats.players.map((row) => (
                  <Fragment key={row.playerId}>
                    <th>Built</th>
                    <th>Lost</th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {DOMAIN_ORDER.map((domain) => {
                const units = activeUnits(domain, builtOrLost);
                const open = !collapsed.has(`mil-${domain}`);

                return (
                  <Fragment key={domain}>
                    <tr className="egs-an__group" onClick={() => toggle(`mil-${domain}`)}>
                      <td>
                        <span className="egs-an__tw">
                          {units.length === 0 ? "" : open ? "▾" : "▸"}
                        </span>
                        {DOMAIN_LABEL[domain]}
                      </td>
                      {stats.players.map((row) => (
                        <Fragment key={row.playerId}>
                          <td>{fmt(row.builtByDomain[domain])}</td>
                          <td>{fmt(row.lostByDomain[domain])}</td>
                        </Fragment>
                      ))}
                    </tr>
                    {open &&
                      units.map((unit) => (
                        <tr className="egs-an__unit" key={unit.key}>
                          <td>
                            <UnitCell row={unit} />
                          </td>
                          {stats.players.map((row) => (
                            <Fragment key={row.playerId}>
                              <td>{fmt(row.builtByUnit[unit.key] ?? 0)}</td>
                              <td>{fmt(row.lostByUnit[unit.key] ?? 0)}</td>
                            </Fragment>
                          ))}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Control — a horizontal capture timeline (marks positioned by turn, coloured by player). */}
      {tab === "control" && (
        <div className="egs-an__timeline">
          {stats.captureLog.length === 0 ? (
            <p className="egs-an__empty">No properties changed hands.</p>
          ) : (
            (() => {
              const maxTurn = Math.max(1, stats.turns, ...stats.captureLog.map((e) => e.turn));

              return (
                <>
                  <div className="egs-an__tl">
                    <div className="egs-an__tl-line" />
                    {stats.captureLog.map((entry, index) => (
                      <span
                        className="egs-an__tl-mark"
                        key={`${entry.turn}-${entry.playerId}-${index}`}
                        style={{
                          left: `${(entry.turn / maxTurn) * 100}%`,
                          ["--army" as string]: armyColorOf(entry.playerId),
                        }}
                        title={`Turn ${entry.turn} — ${nameOf(entry.playerId)} captured a ${entry.property}`}
                      >
                        {PROPERTY_GLYPH[entry.property] ?? "🏳️"}
                      </span>
                    ))}
                    <span className="egs-an__tl-tick" style={{ left: "0%" }}>
                      T0
                    </span>
                    <span className="egs-an__tl-tick" style={{ left: "100%" }}>
                      T{maxTurn}
                    </span>
                  </div>
                  <div className="egs-an__tl-legend">
                    {players.map((player) => (
                      <span key={player.playerId}>
                        <i style={{ background: armyColorOf(player.playerId) }} />
                        {player.name}
                      </span>
                    ))}
                    <span className="is-muted">{stats.captureLog.length} captures</span>
                  </div>
                </>
              );
            })()
          )}
        </div>
      )}

      {/* Economy — income vs spend, below the idle-funds curve (repairs = property-heal value). */}
      {tab === "economy" && (
        <div className="egs-an__scroll">
          <table className="egs-an__table">
            <thead>
              <tr>
                <th>Income &amp; spend (funds)</th>
                {stats.players.map((row) => (
                  <th key={row.playerId}>{nameOf(row.playerId)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="is-total">
                <td>Income earned</td>
                {stats.players.map((row) => (
                  <td key={row.playerId}>{fmt(row.incomeEarned)}</td>
                ))}
              </tr>
              <tr className="is-section">
                <td colSpan={stats.players.length + 1}>Spend</td>
              </tr>
              <tr className="is-sub">
                <td>Production</td>
                {stats.players.map((row) => (
                  <td key={row.playerId}>{fmt(row.producedFunds)}</td>
                ))}
              </tr>
              <tr className="is-sub">
                <td>Repairs</td>
                {stats.players.map((row) => (
                  <td key={row.playerId}>{fmt(row.healedByProperty)}</td>
                ))}
              </tr>
              <tr className="is-total">
                <td>Net banked</td>
                {stats.players.map((row) => (
                  <td key={row.playerId}>{fmt(bankedOf(row.playerId))}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {tab === "damage" && (
        <div className="egs-an__scroll">
          <table className="egs-an__table egs-an__gt">
            <thead>
              <tr>
                <th>Damage dealt (funds · % of total)</th>
                {stats.players.map((row) => (
                  <th key={row.playerId}>{nameOf(row.playerId)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="is-total">
                <td>Total dealt</td>
                {stats.players.map((row) => damageCell(row, row.damageDealt, false))}
              </tr>
              <tr className="is-sub">
                <td>Direct</td>
                {stats.players.map((row) => damageCell(row, row.damageDirect, true))}
              </tr>
              <tr className="is-sub">
                <td>Indirect</td>
                {stats.players.map((row) => damageCell(row, row.damageIndirect, true))}
              </tr>

              <tr className="is-section">
                <td colSpan={stats.players.length + 1}>By unit class</td>
              </tr>
              {DOMAIN_ORDER.map((domain) => {
                const units = activeUnits(domain, (row, key) => row.damageByUnit[key] ?? 0);
                const open = !collapsed.has(`dmg-${domain}`);

                return (
                  <Fragment key={domain}>
                    <tr className="egs-an__group" onClick={() => toggle(`dmg-${domain}`)}>
                      <td>
                        <span className="egs-an__tw">
                          {units.length === 0 ? "" : open ? "▾" : "▸"}
                        </span>
                        {DOMAIN_LABEL[domain]}
                      </td>
                      {stats.players.map((row) =>
                        damageCell(row, row.damageByDomain[domain], true),
                      )}
                    </tr>
                    {open &&
                      units.map((unit) => (
                        <tr className="egs-an__unit" key={unit.key}>
                          <td>
                            <UnitCell row={unit} />
                          </td>
                          {stats.players.map((row) =>
                            damageCell(row, row.damageByUnit[unit.key] ?? 0, true),
                          )}
                        </tr>
                      ))}
                  </Fragment>
                );
              })}

              <tr className="is-section">
                <td colSpan={stats.players.length + 1}>Damage healed (funds)</td>
              </tr>
              <tr className="is-sub">
                <td>Property repair</td>
                {stats.players.map((row) => damageCell(row, row.healedByProperty, false))}
              </tr>
              <tr className="is-sub">
                <td>CO power</td>
                {stats.players.map((row) => damageCell(row, row.healedByPower, false))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
