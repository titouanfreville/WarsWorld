"use client";

import { PlayerLink } from "frontend/components/PlayerLink";
import { ARMY_HEX, ARMY_LABEL, type Army } from "frontend/utils/sprites";
import { coPortraitUrl } from "frontend/utils/sprites";
import type { inferTRPCOutput } from "frontend/utils/trpc-client";
import { trpc } from "frontend/utils/trpc-client";
import { deciderPhrase, formatDuration } from "./eg-phrases";
import { EndGameChat } from "./EndGameChat";
import { HonorPanel } from "./HonorPanel";
import { MatchAnalysis } from "./MatchAnalysis";
import { MeritOutcome } from "./MeritOutcome";
import { PerformancePanel } from "./PerformancePanel";

/** One seat's end-of-match summary. Grade + match meta are enriched from `endgame.summary`. */
export type EndGamePlayer = {
  id: string;
  name: string;
  army: Army;
  coName: string;
  result?: "won" | "lost" | "drawn";
  isViewer: boolean;
};

type Outcome = "victory" | "defeat" | "draw";
type Summary = NonNullable<inferTRPCOutput<"endgame", "summary">>;

const HEADLINE: Record<Outcome, string> = {
  victory: "Victory",
  defeat: "Defeat",
  draw: "Draw",
};

const RESULT_LABEL: Record<NonNullable<EndGamePlayer["result"]>, string> = {
  won: "Won",
  lost: "Lost",
  drawn: "Drew",
};

const rankOf = (result?: EndGamePlayer["result"]): number =>
  result === "won" ? 0 : result === "lost" ? 2 : 1;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Winner / loser / draw + the HQ-capture and wipe signals that describe how the match was decided. */
const deciderFor = (data: Summary): string => {
  const winner = data.players.find((player) => player.result === "won");
  const loser = data.players.find((player) => player.result === "lost");
  const finalRow = data.stats.timeline[data.stats.timeline.length - 1];
  const hqCapture = data.stats.captureLog
    .filter((entry) => entry.property === "hq" && entry.playerId === winner?.playerId)
    .at(-1);

  return deciderPhrase({
    isDraw: data.winnerTeamIndex === null || winner === undefined,
    winnerName: winner?.name,
    loserName: loser?.name,
    hqCaptureTurn: hqCapture?.turn,
    loserWiped:
      loser !== undefined &&
      finalRow?.perPlayer.find((p) => p.playerId === loser.playerId)?.armyValue === 0,
  });
};

function PlayerCard({ player, grade }: { player: EndGamePlayer; grade: string | null }) {
  const result = player.result ?? "drawn";

  return (
    <article
      className={`egs__player is-${result}`}
      style={{ ["--army" as string]: ARMY_HEX[player.army] }}
    >
      <div className="egs__player-portrait">
        <img src={coPortraitUrl(player.coName, "full")} alt={player.coName} />
      </div>
      <div className="egs__player-meta">
        <p className="egs__player-name">
          <PlayerLink name={player.name} hideAvatar />
          {player.isViewer && <span className="egs__you">You</span>}
        </p>
        <p className="egs__player-army">{ARMY_LABEL[player.army]}</p>
      </div>
      <div className="egs__player-right">
        <div className={`egs__result is-${result}`}>{RESULT_LABEL[result]}</div>
        {grade !== null && <div className="egs__player-grade">{grade}</div>}
      </div>
    </article>
  );
}

/** The Summary panel — match stat tiles + a one-line headline pointing at the analysis below. */
function SummaryPanel({ data }: { data: Summary }) {
  const powers = data.stats.players.reduce((sum, player) => sum + player.powersUsed, 0);
  const captures = data.stats.players.reduce((sum, player) => sum + player.captures, 0);
  const built = data.stats.players.reduce((sum, player) => sum + player.built, 0);

  return (
    <section className="egs__panel">
      <header className="egs__panel-head">
        <h2 className="egs__panel-title">Summary</h2>
        <span className="egs__soon">Both players</span>
      </header>
      <div className="egs-sum__tiles">
        <div className="egs-sum__tile">
          <b>{data.stats.days}</b>
          <span>Days</span>
        </div>
        <div className="egs-sum__tile">
          <b>{data.stats.turns}</b>
          <span>Turns</span>
        </div>
        <div className="egs-sum__tile">
          <b>{formatDuration(data.durationMs)}</b>
          <span>Duration</span>
        </div>
        <div className="egs-sum__tile">
          <b>{powers}</b>
          <span>Powers</span>
        </div>
      </div>
      <p className="egs-sum__headline">{deciderFor(data)}</p>
      <p className="egs-sum__headline">
        <b>{built}</b> units built · <b>{captures}</b> captures ·{" "}
        <b>{data.fog ? "Fog" : "Clear"}</b> skies.
      </p>
      <p className="egs-sum__headline is-muted">Full breakdowns in the Match analysis below ↓</p>
    </section>
  );
}

/**
 * The End-Game screen — a full-screen battle-report scoreboard that loads after the victory/defeat
 * moment. Mirrors the eg-mockup: a 3-column hero (match meta · outcome · rank stamp), 2-up player
 * cards with per-player grade, then the Performance / Summary / analysis / Honor / Chat panels. It
 * does NOT auto-advance away — the player leaves via Rematch / Back to lobby.
 */
export function EndGameScreen({
  matchId,
  outcome,
  players,
  onBackToLobby,
}: {
  matchId: string;
  outcome: Outcome;
  players: EndGamePlayer[];
  onBackToLobby: () => void;
}) {
  const summary = trpc.endgame.summary.useQuery({ matchId });
  const data = summary.data ?? null;

  const lineup = [...players].sort((a, b) => rankOf(a.result) - rankOf(b.result));
  const viewerId = players.find((player) => player.isViewer)?.id;

  const gradeOf = (playerId: string | undefined): string | null =>
    data?.players.find((player) => player.playerId === playerId)?.grade?.overall ?? null;

  const viewerGrade = gradeOf(viewerId);

  const metaMode =
    data === null
      ? ""
      : `${data.isRanked ? "Ranked" : "Custom"} · ${players.length === 2 ? "1v1" : `${players.length}P`} · Fog ${data.fog ? "on" : "off"}`;
  const duration = data === null ? "—" : formatDuration(data.durationMs);
  const metaCount =
    data === null
      ? ""
      : `${plural(data.stats.days, "day")} · ${plural(data.stats.turns, "turn")}${
          duration !== "—" ? ` · ${duration}` : ""
        }`;

  return (
    <div
      className={`egs is-${outcome}`}
      role="dialog"
      aria-label={`${HEADLINE[outcome]} — match report`}
    >
      <div className="egs__sheet">
        <header className="egs__hero">
          <div className="egs__meta">
            {data !== null && <div className="egs__meta-map">{data.mapName}</div>}
            <div>{metaMode}</div>
            <div>{metaCount}</div>
          </div>
          <div className="egs__title">
            <p className="egs__eyebrow">Match report</p>
            <h1 className="egs__headline">{HEADLINE[outcome]}</h1>
            <MeritOutcome matchId={matchId} viewerId={viewerId} />
          </div>
          <div className={`egs__stamp${viewerGrade !== null ? " is-graded" : ""}`}>
            <span className="egs__stamp-glyph">{viewerGrade ?? "—"}</span>
            <span className="egs__stamp-label">Your rank</span>
          </div>
        </header>

        <section className="egs__players" aria-label="Players">
          {lineup.map((player) => (
            <PlayerCard key={player.id} player={player} grade={gradeOf(player.id)} />
          ))}
        </section>

        <div className="egs__grid">
          <PerformancePanel matchId={matchId} viewerId={viewerId} />
          {data !== null ? (
            <SummaryPanel data={data} />
          ) : (
            <section className="egs__panel">
              <p className="egs__panel-body">Loading summary…</p>
            </section>
          )}
        </div>

        <MatchAnalysis matchId={matchId} />

        <div className="egs__grid">
          <HonorPanel matchId={matchId} viewerId={viewerId} players={players} />
          <EndGameChat
            matchId={matchId}
            viewerId={viewerId}
            players={players.map((player) => ({ id: player.id, name: player.name }))}
          />
        </div>

        <footer className="egs__actions">
          <button type="button" className="egs__btn is-ghost" disabled title="Coming soon">
            Rematch
          </button>
          <button type="button" className="egs__btn is-primary" onClick={onBackToLobby}>
            Back to lobby
          </button>
        </footer>
      </div>
    </div>
  );
}
