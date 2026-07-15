import { coPortraitUrl } from "frontend/utils/sprites/co";
import { formatDuration, formatMatchDate } from "frontend/utils/format-time";
import { trpc } from "frontend/utils/trpc-client";
import { useState } from "react";
import { deriveLobbyStatus } from "../lobby/match-status";
import { leagueLabelOf } from "./history-filters";

/**
 * One row in the match-history list: the outcome at a glance, both COs, and — once expanded — the
 * battle report's headline stats and the per-axis grade.
 *
 * The stats are NOT on the collapsed row on purpose. `endgame.summary` rebuilds a throwaway match
 * and replays the whole event log to derive them; that's fine for one match, but ten of them on
 * every page load is not. So the query is gated on `open` (the codebase's established `enabled:`
 * pattern) and each row pays for itself only when the player asks. Putting the grade on the
 * collapsed row wants the stats denormalised at finalize instead — a backend change, not a UI one.
 */

type HistoryPlayer = {
  id: string;
  name: string;
  coId?: { name: string } | null;
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
    players: (HistoryPlayer & { status?: "alive" | "routed" | "captured" })[];
    state: string;
    turn: number;
    finished?: boolean;
    isRanked?: boolean;
    leagueType?: string | null;
    finishedAt?: Date | string | null;
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

function Axis({ name, score, letter }: { name: string; score: number; letter: string }) {
  return (
    <div>
      <div className="@mb-1 @flex @justify-between @text-xs">
        <span className="@font-semibold @uppercase @tracking-wide @text-slate-500">{name}</span>
        <span className="@text-slate-300">
          {score} · {letter}
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

  // Gated on `open` — see the note above: this replays the match's whole event log.
  const summary = trpc.endgame.summary.useQuery({ matchId: match.id }, { enabled: open });

  const status = deriveLobbyStatus(match, playerId);
  const meta =
    status === "victory" || status === "defeat" || status === "draw"
      ? RESULT_META[status]
      : RESULT_META.completed;

  const viewer = match.players.find((player) => player.id === playerId);
  const opponent = match.players.find((player) => player.id !== playerId);

  const grade = summary.data?.players.find((player) => player.playerId === playerId)?.grade ?? null;
  const stats = summary.data?.stats.players.find((player) => player.playerId === playerId) ?? null;

  return (
    <div className="@relative @overflow-hidden @rounded-lg @bg-bg-primary @outline @outline-2 @outline-black">
      <div className={`@absolute @bottom-0 @left-0 @top-0 @w-1.5 ${meta.edge}`} />

      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="@grid @w-full @grid-cols-[auto_auto_1fr_auto] @items-center @gap-4 @py-3 @pl-5 @pr-4 @text-left"
      >
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
              {leagueLabelOf(match.leagueType)}
            </span>
            {match.finishedAt !== null && match.finishedAt !== undefined && (
              <span>{formatMatchDate(match.finishedAt)}</span>
            )}
          </span>
        </span>

        <span className={`@text-xs @text-slate-500 @transition ${open ? "@rotate-90" : ""}`}>
          ▶
        </span>
      </button>

      {open && (
        <div className="@border-t @border-bg-tertiary/30 @px-4 @pb-4 @pl-5">
          {summary.isLoading && (
            <p className="@py-4 @text-center @text-xs @text-slate-500">Loading battle report…</p>
          )}

          {summary.isError && (
            <p className="@py-4 @text-center @text-xs @text-red-400">
              Couldn&apos;t load this battle report.
            </p>
          )}

          {summary.data !== undefined && summary.data !== null && (
            <>
              <div className="@flex @flex-wrap @items-center @justify-between @gap-4 @py-3">
                <div className="@flex @items-center @gap-3">
                  {grade !== null && (
                    <div
                      className={`@grid @h-9 @w-9 @place-items-center @rounded-md @font-russoOne @text-lg @outline @outline-1 ${
                        GRADE_STYLE[grade.overall] ?? GRADE_STYLE.C
                      }`}
                      title={`Overall grade: ${grade.overall}`}
                    >
                      {grade.overall}
                    </div>
                  )}
                  <div className="@text-xs @text-slate-500">
                    Day {summary.data.stats.days} · {formatDuration(summary.data.durationMs)}
                  </div>
                </div>

                {stats !== null && (
                  <div className="@flex @gap-5">
                    <Stat
                      value={`${Math.round(stats.damageDealt / 100) / 10}k`}
                      label="Damage"
                      accent
                    />
                    <Stat value={stats.unitsKilled} label="Kills" />
                    <Stat value={stats.captures} label="Caps" />
                  </div>
                )}
              </div>

              {grade !== null && (
                <div className="@grid @gap-4 @py-2 laptop:@grid-cols-3">
                  <Axis name="Tactics" score={grade.tactics.score} letter={grade.tactics.letter} />
                  <Axis
                    name="Strength"
                    score={grade.strength.score}
                    letter={grade.strength.letter}
                  />
                  <Axis name="Economy" score={grade.economy.score} letter={grade.economy.letter} />
                </div>
              )}

              {/* Finished matches are archived out of the live store, so there's no board to open.
                  Replay/archived viewing is a follow-up. */}
              <span
                className="@mt-3 @inline-block @cursor-not-allowed @select-none @rounded @border @border-dashed @border-bg-tertiary/50 @px-3 @py-1 @text-xs @font-semibold @text-slate-600"
                title="Replays aren't available yet"
              >
                Replay — not available yet
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
