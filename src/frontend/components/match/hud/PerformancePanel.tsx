"use client";

import type { inferTRPCOutput } from "frontend/utils/trpc-client";
import { trpc } from "frontend/utils/trpc-client";
import { economyNote, strengthNote, tacticsNote } from "./eg-phrases";

type Summary = NonNullable<inferTRPCOutput<"endgame", "summary">>;

/**
 * The Performance panel — the viewer's overall grade + Tactics / Strength / Economy bars, each with a
 * one-line rationale derived from the replay stats (Epic 4 + phrases). Shares the cached
 * `endgame.summary` query with the rest of the screen.
 */
export function PerformancePanel({
  matchId,
  viewerId,
}: {
  matchId: string;
  viewerId: string | undefined;
}) {
  const query = trpc.endgame.summary.useQuery({ matchId });
  const data: Summary | null | undefined = query.data;

  if (data === undefined || data === null) {
    return (
      <section className="egs__panel">
        <p className="egs__panel-body">Scoring your match…</p>
      </section>
    );
  }

  const grade = data.players.find((player) => player.playerId === viewerId)?.grade ?? null;

  if (grade === null) {
    return (
      <section className="egs__panel">
        <header className="egs__panel-head">
          <h2 className="egs__panel-title">Performance</h2>
        </header>
        <p className="egs__panel-body">No grade for this match.</p>
      </section>
    );
  }

  const stats = data.stats.players.find((player) => player.playerId === viewerId);
  const banked =
    data.stats.timeline[data.stats.timeline.length - 1]?.perPlayer.find(
      (player) => player.playerId === viewerId,
    )?.funds ?? 0;

  const axes = [
    {
      label: "Tactics",
      axis: grade.tactics,
      note: stats && tacticsNote(stats.damageDealt, stats.damageTaken),
    },
    {
      label: "Strength",
      axis: grade.strength,
      note: stats && strengthNote(stats.unitsKilled, stats.captures),
    },
    {
      label: "Economy",
      axis: grade.economy,
      note: stats && economyNote(stats.incomeEarned, stats.producedFunds, banked),
    },
  ];

  return (
    <section className="egs__panel">
      <header className="egs__panel-head">
        <h2 className="egs__panel-title">Performance</h2>
        <span className="egs__soon">Your grade</span>
      </header>
      <div className="egs-perf__overall">
        <b>{grade.overall}</b>
        <span>Overall</span>
      </div>
      {axes.map(({ label, axis, note }) => (
        <div className="egs-perf__bar" key={label}>
          <span className="egs-perf__label">{label}</span>
          <div className="egs-perf__track">
            <div className="egs-perf__fill" style={{ width: `${axis.score}%` }} />
          </div>
          <span className="egs-perf__grade">{axis.letter}</span>
          {note !== undefined && <p className="egs-perf__note">{note}</p>}
        </div>
      ))}
    </section>
  );
}
