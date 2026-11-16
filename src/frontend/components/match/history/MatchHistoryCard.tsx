import { coPortraitUrl } from "frontend/utils/sprites/co";
import { formatDuration, formatMatchDate } from "frontend/utils/format-time";
import Link from "next/link";
import { useState } from "react";
import { deriveLobbyStatus } from "../lobby/match-status";
import { modeLabelOf, rulesetLabelOf } from "./history-filters";

/**
 * One row in the match-history list: outcome, grade and headline stats at a glance; the three grade
 * axes on expand.
 *
 * Everything here comes from the LIST query — `viewerStats` is joined from `MatchPlayerStats`, which
 * finalize writes once per match. This row used to lazily fetch `endgame.summary` on expand, because
 * the stats could only be had by replaying the whole event log; that's gone. The full battle report
 * (which needs the per-turn timeline, and so still replays) lives behind the link at /report.
 */

type HistoryPlayer = {
  id: string;
  name: string;
  coId?: { name: string } | null;
};

/** The viewer's own row from `MatchPlayerStats`. Null when a match has no stats (see below). */
type ViewerStats = {
  grade: string;
  tactics: number;
  strength: number;
  economy: number;
  damageDealt: number;
  unitsKilled: number;
  captures: number;
};

/**
 * Structural (not `FrontendMatch`) so both history sources satisfy it — the in-memory
 * `getPlayerMatches` and the DB-backed `getPlayerFinishedMatches`, whose inferred types differ.
 * Assignable to `LobbyMatch`, so `deriveLobbyStatus` takes it directly.
 */
type Props = {
  match: {
    id: string;
    map: { name: string; numberOfPlayers: number };
    players: (HistoryPlayer & {
      status?: "alive" | "routed" | "captured" | "resigned";
      result?: "won" | "lost" | "drawn";
    })[];
    state: string;
    /** Day count. Real for finished rows now that `Match.days` is persisted (was hardcoded 0). */
    turn: number;
    finished?: boolean;
    isRanked?: boolean;
    mode?: string | null;
    ruleset?: string | null;
    finishedAt?: Date | string | null;
    durationMs?: number | null;
    viewerStats?: ViewerStats | null;
  };
  playerId: string | undefined;
};

const RESULT_META = {
  victory: { label: "Victory", edge: "@bg-emerald-500", text: "@text-emerald-400" },
  defeat: { label: "Defeat", edge: "@bg-red-600", text: "@text-red-400" },
  draw: { label: "Draw", edge: "@bg-slate-400", text: "@text-slate-300" },
  completed: { label: "Completed", edge: "@bg-slate-500", text: "@text-slate-300" },
} as const;

/** Grade letters get their own palette — `HonorInsignia` owns bronze→diamond, so no metals here. */
const GRADE_STYLE: Record<string, string> = {
  S: "@text-amber-300 @outline-amber-300/50 @bg-amber-300/10",
  A: "@text-emerald-400 @outline-emerald-400/40 @bg-emerald-400/10",
  B: "@text-sky-300 @outline-sky-300/40 @bg-sky-300/10",
  C: "@text-slate-400 @outline-slate-400/30 @bg-slate-400/5",
};

function CoMug({ co, muted }: { co: string | undefined; muted?: boolean }) {
  if (co === undefined) {
    return (
      <div className="@h-8 @w-8 @flex-none @rounded @bg-bg-secondary @outline @outline-1 @outline-white/10" />
    );
  }

  return (
    <img
      src={coPortraitUrl(co, "small")}
      alt={co}
      title={co}
      className={`@h-8 @w-8 @flex-none @rounded @bg-bg-secondary @object-cover @object-top @outline @outline-1 @outline-white/10 ${
        muted === true ? "@opacity-75" : ""
      }`}
      style={{ imageRendering: "pixelated" }}
    />
  );
}

/**
 * FE-local mirror of the server's `letterOf` (match-grade.ts) — the axis letter is a pure function of
 * its score, so it's derived here rather than widening the stats row to carry three more strings.
 */
const letterOf = (score: number): string =>
  score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : "C";

function Axis({ name, score }: { name: string; score: number }) {
  return (
    <div>
      <div className="@mb-1 @flex @justify-between @text-xs">
        <span className="@font-semibold @uppercase @tracking-wide @text-slate-500">{name}</span>
        <span className="@text-slate-300">
          {score} · {letterOf(score)}
        </span>
      </div>
      <div className="@h-1.5 @overflow-hidden @rounded @bg-bg-tertiary/50">
        <div className="@h-full @rounded @bg-primary" style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function Stat({
  value,
  label,
  accent,
}: {
  value: string | number;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="@text-right">
      <div className={`@font-russoOne @text-sm ${accent === true ? "@text-primary-light" : ""}`}>
        {value}
      </div>
      <div className="@text-[0.6rem] @font-semibold @uppercase @tracking-wide @text-slate-500">
        {label}
      </div>
    </div>
  );
}

export default function MatchHistoryCard({ match, playerId }: Props) {
  const [open, setOpen] = useState(false);

  const status = deriveLobbyStatus(match, playerId);
  const meta =
    status === "victory" || status === "defeat" || status === "draw"
      ? RESULT_META[status]
      : RESULT_META.completed;

  const viewer = match.players.find((player) => player.id === playerId);
  const opponent = match.players.find((player) => player.id !== playerId);
  const stats = match.viewerStats ?? null;

  return (
    <div className="@relative @overflow-hidden @rounded-lg @bg-bg-primary @outline @outline-2 @outline-black">
      <div className={`@absolute @bottom-0 @left-0 @top-0 @w-1.5 ${meta.edge}`} />

      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="@grid @w-full @grid-cols-[auto_auto_auto_1fr_auto_auto] @items-center @gap-4 @py-3 @pl-5 @pr-4 @text-left"
      >
        {/* The "match note". Null only when a match has no stats row — a pre-stats match whose
            backfill failed (an event log that can't replay). Reserve the width either way so rows
            don't jag. */}
        <span
          className={`@grid @h-9 @w-9 @flex-none @place-items-center @rounded-md @font-russoOne @text-lg @outline @outline-1 ${
            stats === null
              ? "@text-slate-700 @outline-slate-700/30"
              : (GRADE_STYLE[stats.grade] ?? GRADE_STYLE.C)
          }`}
          title={
            stats === null ? "No battle report for this match" : `Overall grade: ${stats.grade}`
          }
        >
          {stats?.grade ?? "–"}
        </span>

        <span className={`@w-[4.5rem] @text-lg @font-bold @uppercase @tracking-wide ${meta.text}`}>
          {meta.label}
        </span>

        <span className="@hidden @items-center @gap-1 tablet:@flex">
          <CoMug co={viewer?.coId?.name} />
          <span className="@text-[0.6rem] @font-semibold @text-slate-500">VS</span>
          <CoMug co={opponent?.coId?.name} muted />
        </span>

        <span className="@min-w-0">
          <span className="@block @truncate @text-sm @font-semibold">
            {match.map.name}
            {opponent !== undefined && (
              <span className="@font-normal @text-slate-400"> vs {opponent.name}</span>
            )}
          </span>
          <span className="@mt-0.5 @flex @flex-wrap @items-center @gap-1.5 @text-[0.65rem] @text-slate-500">
            <span
              className={`@rounded @px-1.5 @py-0.5 @font-semibold ${
                match.isRanked === true
                  ? "@bg-primary/20 @text-primary-light"
                  : "@bg-bg-tertiary/50 @text-slate-300"
              }`}
            >
              {match.isRanked === true ? "Ranked" : "Casual"}
            </span>
            <span className="@rounded @bg-bg-tertiary/50 @px-1.5 @py-0.5 @font-semibold @text-slate-300">
              {modeLabelOf(match.mode)}
            </span>
            <span className="@rounded @bg-bg-tertiary/50 @px-1.5 @py-0.5 @font-semibold @text-slate-300">
              {rulesetLabelOf(match.ruleset)}
            </span>
            {match.turn > 0 && <span>Day {match.turn}</span>}
            {match.durationMs !== null && match.durationMs !== undefined && (
              <span>{formatDuration(match.durationMs)}</span>
            )}
            {match.finishedAt !== null && match.finishedAt !== undefined && (
              <span>{formatMatchDate(match.finishedAt)}</span>
            )}
          </span>
        </span>

        {/* Headline stats, straight from the list query — no per-row replay. */}
        {stats !== null && (
          <span className="@hidden @gap-5 laptop:@flex">
            <Stat value={`${Math.round(stats.damageDealt / 100) / 10}k`} label="Damage" accent />
            <Stat value={stats.unitsKilled} label="Kills" />
            <Stat value={stats.captures} label="Caps" />
          </span>
        )}

        <span className={`@text-xs @text-slate-500 @transition ${open ? "@rotate-90" : ""}`}>
          ▶
        </span>
      </button>

      {open && (
        <div className="@border-t @border-bg-tertiary/30 @px-4 @pb-4 @pl-5">
          {stats === null ? (
            <p className="@py-4 @text-xs @text-slate-500">
              No battle report for this match — it finished before reports were recorded, and its
              event log can&apos;t be replayed to rebuild one.
            </p>
          ) : (
            <>
              {/* Narrow screens hide the headline row above, so repeat it here. */}
              <div className="@flex @gap-5 @py-3 laptop:@hidden">
                <Stat
                  value={`${Math.round(stats.damageDealt / 100) / 10}k`}
                  label="Damage"
                  accent
                />
                <Stat value={stats.unitsKilled} label="Kills" />
                <Stat value={stats.captures} label="Caps" />
              </div>

              <div className="@grid @gap-4 @py-2 laptop:@grid-cols-3">
                <Axis name="Tactics" score={stats.tactics} />
                <Axis name="Strength" score={stats.strength} />
                <Axis name="Economy" score={stats.economy} />
              </div>
            </>
          )}

          <div className="@mt-3 @flex @flex-wrap @items-center @gap-2">
            <Link
              href={`/report/${match.id}`}
              className="@rounded @bg-primary @px-3 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @text-black @transition hover:@brightness-110"
            >
              Full battle report
            </Link>

            {/* Finished matches are archived out of the live store, so there's no board to
                re-open. Replay is a follow-up; the report above is the read-only substitute. */}
            <span
              className="@cursor-not-allowed @select-none @rounded @border @border-dashed @border-bg-tertiary/50 @px-3 @py-1.5 @text-xs @font-semibold @text-slate-600"
              title="Replays aren't available yet"
            >
              Replay — not available yet
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
