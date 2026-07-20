import { PLAY_MODES } from "frontend/components/matchmaking/play-queues";
import { RANK_META, romanDivision } from "frontend/components/matchmaking/rank-meta";
import { coPortraitUrl } from "frontend/utils/sprites/co";
import { unitSpriteUrl } from "frontend/utils/sprites/units";
import { useState, type ReactNode } from "react";

/**
 * The career-stats half of the profile page, on real `players.stats` data: overall combat record,
 * the CO-played and CO-win-rate rankings (top 3 by default, expandable), and the per-queue ranks.
 *
 * FE-local types, redeclared structurally from the usecase output — the query is inferred, but the
 * component contracts on these so a server shape change surfaces at the call site.
 */

type CoStat = {
  co: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
};

type LadderEntry = {
  mode: string;
  rank: string;
  division: number;
  merit: number;
  peakRank: string | null;
  games: number;
  inPlacements: boolean;
};

type Totals = { games: number; wins: number; losses: number; draws: number; winRate: number };

type MapStat = { mapId: string; name: string; games: number; wins: number; winRate: number };

type Combat = {
  unitsKilled: number;
  unitsLost: number;
  captures: number;
  powersUsed: number;
  damageDealt: number;
};

type MapsData = { played: MapStat[]; favorite: MapStat | null; best: MapStat | null };

type UnitTally = { unit: string; count: number };
type UnitsData = { built: UnitTally[]; lost: UnitTally[]; damage: UnitTally[] };

type Props = {
  ranks: LadderEntry[];
  coPlayed: CoStat[];
  coWinRate: CoStat[];
  maps: MapsData;
  units: UnitsData;
  combat: Combat;
  totals: Totals;
};

const TOP_N = 3;

const prettyCo = (co: string): string =>
  co
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const modeLabel = (mode: string): string =>
  PLAY_MODES.find((entry) => entry.mode === mode)?.label ?? mode;

export function ProfileStats({ ranks, coPlayed, coWinRate, maps, units, combat, totals }: Props) {
  return (
    <div className="@mt-4 @flex @flex-col @gap-4">
      <CombatRecord totals={totals} combat={combat} />

      <div className="@grid @grid-cols-1 @gap-4 laptop:@grid-cols-2">
        <CoRanking title="Most Played" stats={coPlayed} metric="played" />
        <CoRanking title="Highest Win Rate" stats={coWinRate} metric="winRate" />
      </div>

      <UnitBreakdown units={units} />
      <MapStats maps={maps} />
      <RanksPerQueue ranks={ranks} />
    </div>
  );
}

const prettyUnit = (unit: string): string =>
  unit
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (char) => char.toUpperCase())
    .trim();

function UnitBreakdown({ units }: { units: UnitsData }) {
  const hasData = units.built.length > 0 || units.lost.length > 0 || units.damage.length > 0;

  return (
    <Panel title="Units">
      {!hasData ? (
        <p className="@text-sm @text-white/40">
          No per-unit data yet — older matches need the unit-stats backfill.
        </p>
      ) : (
        <div className="@grid @grid-cols-1 @gap-x-8 @gap-y-5 smallscreen:@grid-cols-3">
          <UnitColumn title="Most Built" rows={units.built} />
          <UnitColumn title="Most Lost" rows={units.lost} />
          <UnitColumn title="Top Damage" rows={units.damage} suffix=" funds" />
        </div>
      )}
    </Panel>
  );
}

function UnitColumn({
  title,
  rows,
  suffix,
}: {
  title: string;
  rows: UnitTally[];
  suffix?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? rows : rows.slice(0, 4);
  const max = rows[0]?.count ?? 1;

  return (
    <div>
      <p className="@mb-2 @text-[10px] @font-bold @uppercase @tracking-[0.2em] @text-primary/70">
        {title}
      </p>
      {rows.length === 0 ? (
        <p className="@text-xs @text-white/30">—</p>
      ) : (
        <ol className="@flex @flex-col @gap-2">
          {shown.map((row) => (
            <li key={row.unit} className="@flex @items-center @gap-2">
              <img
                src={unitSpriteUrl(row.unit as Parameters<typeof unitSpriteUrl>[0])}
                alt={prettyUnit(row.unit)}
                className="@h-6 @w-6 @shrink-0 @object-contain [image-rendering:pixelated]"
              />
              <div className="@min-w-0 @flex-1">
                <div className="@flex @items-baseline @justify-between @gap-1">
                  <span className="@truncate @text-xs @text-white/85">{prettyUnit(row.unit)}</span>
                  <span className="@shrink-0 @font-russoOne @text-xs @text-primary">
                    {row.count.toLocaleString()}
                    {suffix ?? ""}
                  </span>
                </div>
                <div className="@mt-1 @h-1 @overflow-hidden @rounded-full @bg-white/10">
                  <div
                    className="@h-full @rounded-full @bg-primary/70"
                    style={{ width: `${Math.round((row.count / max) * 100)}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {rows.length > 4 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="@mt-2 @text-[10px] @font-bold @uppercase @tracking-widest @text-primary-light @transition-colors hover:@text-primary"
        >
          {expanded ? "Show less" : `Show all ${rows.length}`}
        </button>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="@overflow-hidden @border @border-primary/25 @bg-black/60 [clip-path:polygon(0_0,100%_0,100%_100%,1.5%_100%,0_94%)]">
      <div className="@flex @items-center @gap-2 @border-b @border-primary/20 @bg-gradient-to-r @from-bg-secondary/60 @to-transparent @px-4 @py-2.5">
        <span className="@h-3 @w-1 @bg-primary" />
        <h3 className="@font-russoOne @text-sm @uppercase @tracking-wider @text-white">{title}</h3>
      </div>
      <div className="@p-4">{children}</div>
    </section>
  );
}

function CombatRecord({ totals, combat }: { totals: Totals; combat: Combat }) {
  return (
    <Panel title="Combat Record">
      {totals.games === 0 ? (
        <p className="@text-sm @text-white/40">No finished matches yet.</p>
      ) : (
        <>
          <div className="@flex @flex-wrap @items-center @gap-x-8 @gap-y-4">
            <Stat label="Games" value={totals.games} />
            <Stat label="Win rate" value={`${totals.winRate}%`} accent />
            <div className="@flex @items-center @gap-4 @font-russoOne">
              <span className="@text-green-earth">{totals.wins}W</span>
              <span className="@text-orange-star">{totals.losses}L</span>
              <span className="@text-white/50">{totals.draws}D</span>
            </div>
            <div className="@min-w-40 @flex-1">
              <WinBar winRate={totals.winRate} />
            </div>
          </div>

          {/* Career combat totals, summed across every finished match's battle report. */}
          <div className="@mt-5 @grid @grid-cols-2 @gap-4 @border-t @border-white/10 @pt-4 smallscreen:@grid-cols-4">
            <MiniStat label="Units destroyed" value={combat.unitsKilled} />
            <MiniStat label="Units lost" value={combat.unitsLost} />
            <MiniStat label="Captures" value={combat.captures} />
            <MiniStat label="Powers used" value={combat.powersUsed} />
          </div>
        </>
      )}
    </Panel>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="@font-russoOne @text-lg @leading-none @text-white">{value.toLocaleString()}</p>
      <p className="@mt-1 @text-[10px] @uppercase @tracking-[0.15em] @text-white/40">{label}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div>
      <p
        className={`@font-russoOne @text-2xl @leading-none ${accent ? "@text-primary" : "@text-white"}`}
      >
        {value}
      </p>
      <p className="@mt-1 @text-[10px] @uppercase @tracking-[0.2em] @text-white/40">{label}</p>
    </div>
  );
}

function WinBar({ winRate }: { winRate: number }) {
  return (
    <div className="@h-2 @w-full @overflow-hidden @rounded-full @bg-orange-star/30">
      <div
        className="@h-full @rounded-full @bg-gradient-to-r @from-primary @to-green-earth"
        style={{ width: `${winRate}%` }}
      />
    </div>
  );
}

function CoRanking({
  title,
  stats,
  metric,
}: {
  title: string;
  stats: CoStat[];
  metric: "played" | "winRate";
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? stats : stats.slice(0, TOP_N);

  return (
    <Panel title={title}>
      {stats.length === 0 ? (
        <p className="@text-sm @text-white/40">
          {metric === "winRate" ? "Not enough games on any CO yet." : "No CO games recorded yet."}
        </p>
      ) : (
        <>
          <ol className="@flex @flex-col @gap-2.5">
            {shown.map((stat, index) => (
              <li key={stat.co} className="@flex @items-center @gap-3">
                <span className="@w-4 @text-center @font-russoOne @text-sm @text-primary-light">
                  {index + 1}
                </span>
                <img
                  src={coPortraitUrl(stat.co, "small")}
                  alt={prettyCo(stat.co)}
                  className="@h-8 @w-8 @shrink-0 @border @border-white/10 @object-cover [image-rendering:pixelated]"
                />
                <div className="@min-w-0 @flex-1">
                  <div className="@flex @items-baseline @justify-between @gap-2">
                    <span className="@truncate @text-sm @text-white">{prettyCo(stat.co)}</span>
                    <span className="@shrink-0 @font-russoOne @text-sm @text-primary">
                      {metric === "played" ? `${stat.games}` : `${stat.winRate}%`}
                    </span>
                  </div>
                  <div className="@mt-1 @flex @items-center @gap-2">
                    <WinBar winRate={stat.winRate} />
                    <span className="@shrink-0 @text-[10px] @tracking-wide @text-white/40">
                      {metric === "played" ? `${stat.winRate}% WR` : `${stat.games} gp`}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {stats.length > TOP_N && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="@mt-3 @text-[10px] @font-bold @uppercase @tracking-widest @text-primary-light @transition-colors hover:@text-primary"
            >
              {expanded ? "Show less" : `Show all ${stats.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function MapStats({ maps }: { maps: MapsData }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? maps.played : maps.played.slice(0, TOP_N);

  return (
    <Panel title="Maps">
      {maps.played.length === 0 ? (
        <p className="@text-sm @text-white/40">No maps played yet.</p>
      ) : (
        <>
          <div className="@mb-4 @grid @grid-cols-1 @gap-3 smallscreen:@grid-cols-2">
            {maps.favorite && (
              <MapHighlight
                label="Favourite"
                name={maps.favorite.name}
                note={`${maps.favorite.games} games`}
              />
            )}
            {maps.best && (
              <MapHighlight
                label="Best win rate"
                name={maps.best.name}
                note={`${maps.best.winRate}% · ${maps.best.games} gp`}
              />
            )}
          </div>

          <ol className="@flex @flex-col @gap-2.5">
            {shown.map((map, index) => (
              <li key={map.mapId} className="@flex @items-center @gap-3">
                <span className="@w-4 @text-center @font-russoOne @text-sm @text-primary-light">
                  {index + 1}
                </span>
                <div className="@min-w-0 @flex-1">
                  <div className="@flex @items-baseline @justify-between @gap-2">
                    <span className="@truncate @text-sm @text-white">{map.name}</span>
                    <span className="@shrink-0 @font-russoOne @text-sm @text-primary">
                      {map.winRate}%
                    </span>
                  </div>
                  <div className="@mt-1 @flex @items-center @gap-2">
                    <WinBar winRate={map.winRate} />
                    <span className="@shrink-0 @text-[10px] @tracking-wide @text-white/40">
                      {map.games} gp
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          {maps.played.length > TOP_N && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="@mt-3 @text-[10px] @font-bold @uppercase @tracking-widest @text-primary-light @transition-colors hover:@text-primary"
            >
              {expanded ? "Show less" : `Show all ${maps.played.length}`}
            </button>
          )}
        </>
      )}
    </Panel>
  );
}

function MapHighlight({ label, name, note }: { label: string; name: string; note: string }) {
  return (
    <div className="@border @border-primary/25 @bg-primary/5 @px-3 @py-2">
      <p className="@text-[10px] @uppercase @tracking-[0.2em] @text-primary/70">{label}</p>
      <p className="@mt-0.5 @truncate @font-russoOne @text-sm @text-white">{name}</p>
      <p className="@text-[10px] @tracking-wide @text-white/40">{note}</p>
    </div>
  );
}

function RanksPerQueue({ ranks }: { ranks: LadderEntry[] }) {
  return (
    <Panel title="Ranks">
      {ranks.length === 0 ? (
        <p className="@text-sm @text-white/40">Unranked — no ladder games played yet.</p>
      ) : (
        <div className="@flex @flex-wrap @gap-3">
          {ranks.map((entry) => (
            <RankChip key={entry.mode} entry={entry} />
          ))}
        </div>
      )}
    </Panel>
  );
}

function RankChip({ entry }: { entry: LadderEntry }) {
  const meta = RANK_META[entry.inPlacements ? "cadet" : entry.rank] ?? RANK_META.cadet;
  const showDivision = !entry.inPlacements && meta.divisions;

  return (
    <div className="@flex @min-w-36 @items-center @gap-3 @border @border-white/10 @bg-black/40 @px-3 @py-2">
      <div
        className={`@grid @h-10 @w-10 @shrink-0 @place-items-center @rounded-full @bg-black/40 @font-russoOne @text-sm @outline @outline-2 ${meta.emblem}`}
      >
        {entry.inPlacements ? "?" : showDivision ? romanDivision(entry.division) : "★"}
      </div>
      <div className="@min-w-0">
        <p className="@text-[10px] @uppercase @tracking-[0.2em] @text-white/40">
          {modeLabel(entry.mode)}
        </p>
        <p className="@truncate @font-russoOne @text-sm @text-white">
          {entry.inPlacements ? "Placements" : meta.label}
          {showDivision && ` ${romanDivision(entry.division)}`}
        </p>
      </div>
    </div>
  );
}
