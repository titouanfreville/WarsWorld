import { GameOverOverlay, type CoResult } from "frontend/components/match/hud/GameOverOverlay";
import type { NextPageWithLayout } from "frontend/types/page";
import { CO_NAMES } from "frontend/utils/sprites";
import { useEffect, useMemo, useState } from "react";

/**
 * DEV-ONLY playground for the victory/defeat "moment" (Epic 1 — {@link GameOverOverlay}), so the
 * animation and the per-CO win/lose poses can be checked in any combination without driving a real
 * match to its finish. Pick the cast, each general's result, who the viewer is, and replay. Not linked
 * anywhere; safe to delete. For the full End-Game screen (stats/grade) use /eg-preview?matchId=…, which
 * reads real BE data — this page renders the animation only (pure presentation, no backend).
 */

type Result = "won" | "lost" | "drawn";
type PreviewPlayer = { name: string; result: Result; isViewer: boolean };

const RESULTS: Result[] = ["won", "lost", "drawn"];

// Board backdrops to inspect the poses against — the real navy board plus checks for edge/alpha review.
const BACKDROPS: Record<string, string> = {
  "Board navy": "#000b2c",
  Black: "#000000",
  Grey: "#4b5563",
  White: "#ffffff",
  Checker: "repeating-conic-gradient(#334155 0% 25%, #1e293b 0% 50%) 50% / 32px 32px",
};

const PRESETS: Record<string, PreviewPlayer[]> = {
  "1v1 — you win": [
    { name: "olaf", result: "won", isViewer: true },
    { name: "sturm", result: "lost", isViewer: false },
  ],
  "1v1 — you lose": [
    { name: "sturm", result: "won", isViewer: false },
    { name: "olaf", result: "lost", isViewer: true },
  ],
  Draw: [
    { name: "nell", result: "drawn", isViewer: true },
    { name: "rachel", result: "drawn", isViewer: false },
  ],
  "2v2": [
    { name: "sami", result: "won", isViewer: true },
    { name: "max", result: "won", isViewer: false },
    { name: "lash", result: "lost", isViewer: false },
    { name: "sonja", result: "lost", isViewer: false },
  ],
  "FFA (4)": [
    { name: "sasha", result: "won", isViewer: false },
    { name: "sensei", result: "lost", isViewer: true },
    { name: "von-bolt", result: "lost", isViewer: false },
    { name: "rachel", result: "lost", isViewer: false },
  ],
};

/** Force a single viewer: selecting one clears the flag on the others. */
const withViewer = (players: PreviewPlayer[], index: number): PreviewPlayer[] =>
  players.map((player, i) => ({ ...player, isViewer: i === index }));

/**
 * Renders the overlay and (optionally) ticks the pre-EG countdown. Remounted by a `key` at the call
 * site so every replay / config change restarts the animation from the first frame. Unlike the real
 * flow, the overlay never auto-dismisses — this is an inspection tool, so the poses stay on screen;
 * the countdown just ticks to 0 and "Continue" re-runs the moment.
 */
function Stage({
  gameOver,
  cos,
  showCountdown,
  holdSeconds,
  onContinue,
}: {
  gameOver: { viewerWon: boolean; winnerTeamIndex: number | null };
  cos: CoResult[];
  showCountdown: boolean;
  holdSeconds: number;
  onContinue: () => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(holdSeconds);

  useEffect(() => {
    if (!showCountdown) {
      return;
    }

    let remaining = holdSeconds;
    setSecondsLeft(remaining);

    const id = setInterval(() => {
      remaining -= 1;
      setSecondsLeft(remaining);

      if (remaining <= 0) {
        clearInterval(id);
      }
    }, 1000);

    return () => clearInterval(id);
  }, [showCountdown, holdSeconds]);

  return (
    <GameOverOverlay
      gameOver={gameOver}
      cos={cos}
      secondsLeft={showCountdown ? Math.max(0, secondsLeft) : undefined}
      onContinue={showCountdown ? onContinue : undefined}
    />
  );
}

const panel: React.CSSProperties = {
  width: 340,
  flex: "0 0 340px",
  height: "100vh",
  overflowY: "auto",
  padding: 16,
  background: "#0d1428",
  color: "#e2e8f0",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
  boxSizing: "border-box",
};
const label: React.CSSProperties = { display: "block", margin: "14px 0 6px", opacity: 0.75 };
const btn: React.CSSProperties = {
  padding: "5px 10px",
  margin: "0 6px 6px 0",
  borderRadius: 6,
  border: "1px solid #334155",
  background: "#1e293b",
  color: "#e2e8f0",
  cursor: "pointer",
  fontSize: 12,
};
const input: React.CSSProperties = {
  background: "#111a30",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 5,
  padding: "3px 6px",
};

const GameOverPreviewPage: NextPageWithLayout = () => {
  const [players, setPlayers] = useState<PreviewPlayer[]>(PRESETS["1v1 — you win"]);
  const [showCountdown, setShowCountdown] = useState(true);
  const [holdSeconds, setHoldSeconds] = useState(20);
  const [backdrop, setBackdrop] = useState("Board navy");
  const [nonce, setNonce] = useState(0);

  const replay = () => setNonce((n) => n + 1);

  const viewer = players.find((player) => player.isViewer) ?? players[0];
  const gameOver = {
    viewerWon: viewer?.result === "won",
    winnerTeamIndex: viewer?.result === "drawn" ? null : 0,
  };
  const cos: CoResult[] = players.map((player) => ({
    name: player.name,
    result: player.result,
    isViewer: player.isViewer,
  }));

  // Remount the stage whenever the config or the replay nonce changes → animation restarts.
  const stageKey = useMemo(
    () => `${JSON.stringify(players)}|${showCountdown}|${holdSeconds}|${nonce}`,
    [players, showCountdown, holdSeconds, nonce],
  );

  const setPlayer = (index: number, patch: Partial<PreviewPlayer>) =>
    setPlayers((prev) => prev.map((player, i) => (i === index ? { ...player, ...patch } : player)));

  const compareOneCo = (name: string) =>
    setPlayers([
      { name, result: "won", isViewer: true },
      { name, result: "lost", isViewer: false },
    ]);

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <div style={panel}>
        <h1 style={{ fontSize: 16, margin: "0 0 4px", fontFamily: "RussoOne, sans-serif" }}>
          Game-Over Moment — Preview
        </h1>
        <p style={{ opacity: 0.6, margin: 0, fontSize: 12 }}>
          Dev-only. Drives the real victory/defeat overlay + CO poses. No backend.
        </p>

        <label style={label}>Presets</label>
        <div>
          {Object.keys(PRESETS).map((name) => (
            <button key={name} type="button" style={btn} onClick={() => setPlayers(PRESETS[name])}>
              {name}
            </button>
          ))}
        </div>

        <label style={label}>Compare one CO — win vs lose</label>
        <select
          style={{ ...input, width: "100%" }}
          value=""
          onChange={(event) => event.target.value !== "" && compareOneCo(event.target.value)}
        >
          <option value="">Pick a CO…</option>
          {CO_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <label style={label}>Cast ({players.length})</label>
        {players.map((player, index) => (
          <div
            key={index}
            style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}
          >
            <select
              style={{ ...input, flex: 1 }}
              value={player.name}
              onChange={(event) => setPlayer(index, { name: event.target.value })}
            >
              {CO_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              style={input}
              value={player.result}
              onChange={(event) => setPlayer(index, { result: event.target.value as Result })}
            >
              {RESULTS.map((result) => (
                <option key={result} value={result}>
                  {result}
                </option>
              ))}
            </select>
            <button
              type="button"
              title="Set as viewer (the 'You' tag + stamp perspective)"
              style={{
                ...btn,
                margin: 0,
                background: player.isViewer ? "#fbbf24" : "#1e293b",
                color: player.isViewer ? "#0b1020" : "#e2e8f0",
              }}
              onClick={() => setPlayers((prev) => withViewer(prev, index))}
            >
              You
            </button>
            <button
              type="button"
              title="Remove"
              style={{ ...btn, margin: 0 }}
              disabled={players.length <= 1}
              onClick={() =>
                setPlayers((prev) => {
                  const next = prev.filter((_, i) => i !== index);
                  return next.some((p) => p.isViewer) ? next : withViewer(next, 0);
                })
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          style={btn}
          onClick={() =>
            setPlayers((prev) => [
              ...prev,
              { name: CO_NAMES[prev.length % CO_NAMES.length], result: "lost", isViewer: false },
            ])
          }
        >
          + Add CO
        </button>

        <label style={label}>Countdown</label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={showCountdown}
            onChange={(event) => setShowCountdown(event.target.checked)}
          />
          Show “Results in Ns / Continue →”
        </label>
        {showCountdown && (
          <div style={{ marginTop: 6 }}>
            hold&nbsp;
            <input
              type="number"
              min={1}
              max={60}
              value={holdSeconds}
              style={{ ...input, width: 60 }}
              onChange={(event) => setHoldSeconds(Number(event.target.value) || 1)}
            />
            &nbsp;s
          </div>
        )}

        <label style={label}>Backdrop</label>
        <div>
          {Object.keys(BACKDROPS).map((name) => (
            <button
              key={name}
              type="button"
              style={{ ...btn, outline: backdrop === name ? "2px solid #fbbf24" : "none" }}
              onClick={() => setBackdrop(name)}
            >
              {name}
            </button>
          ))}
        </div>

        <button
          type="button"
          style={{
            ...btn,
            marginTop: 16,
            width: "100%",
            padding: "9px 0",
            background: "#fbbf24",
            color: "#0b1020",
            fontWeight: 700,
            fontSize: 14,
          }}
          onClick={replay}
        >
          ▶ Replay
        </button>

        <p style={{ opacity: 0.55, fontSize: 11, marginTop: 16, lineHeight: 1.5 }}>
          Winners lift + glow in colour, losers grey + slump — all via CSS. A CO with dedicated pose
          art (<code>Awds-&lt;co&gt;-win/lose.webp</code>) shows it; the rest fall back to neutral
          art. Full End-Game screen: <code>/eg-preview?matchId=…</code>.
        </p>
      </div>

      <div
        style={{ position: "relative", flex: 1, height: "100vh", background: BACKDROPS[backdrop] }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Stage
            key={stageKey}
            gameOver={gameOver}
            cos={cos}
            showCountdown={showCountdown}
            holdSeconds={holdSeconds}
            onContinue={replay}
          />
        </div>
      </div>
    </div>
  );
};

// Dev tool: no global navbar/footer — the stage fills the viewport so the bottom-aligned CO cast is
// fully visible (mirrors the immersive match view).
GameOverPreviewPage.getLayout = (page) => page;

export default GameOverPreviewPage;
