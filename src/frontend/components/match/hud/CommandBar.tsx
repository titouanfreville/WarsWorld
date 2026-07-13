"use client";
import { BufferIndicator } from "frontend/components/match/BufferIndicator";
import type { MatchView } from "frontend/components/match/match-view";
import { PingIndicator } from "frontend/components/match/PingIndicator";
import type { ActionQueueState } from "frontend/utils/action-queue";
import { hasUnresolvedActions } from "frontend/utils/action-queue";
import type { ShellControls } from "./GameShell";
import { BurgerIcon, FullscreenIcon, IntelIcon, MapIcon, ShellButton } from "./ShellButton";

/**
 * The slim command toolbar above (or beside) the board. Match tempo + turn control only — day number,
 * weather, the sync/ping status, and the primary End Turn action. Everything power-related lives in
 * each general's badge (see `PlayerBadge`/`PowerActions`), so it isn't duplicated here. Lays out as a
 * row when `horizontal`, a stacked column when `vertical` (side dock).
 */
export type CommandBarProps = {
  view: MatchView;
  isMyTurn: boolean;
  queue: ActionQueueState;
  /** Non-null once the match is decided — disables End Turn. */
  gameOver: unknown;
  onPassTurn: () => void;
};

const WEATHER: Record<string, { label: string; icon: string }> = {
  clear: { label: "Clear", icon: "☀" },
  rain: { label: "Rain", icon: "🌧" },
  snow: { label: "Snow", icon: "❄" },
  sandstorm: { label: "Sandstorm", icon: "🌫" },
};

export function CommandBar({
  view,
  isMyTurn,
  queue,
  gameOver,
  onPassTurn,
  orientation = "horizontal",
  controls,
  minimapOpen,
  onToggleMinimap,
}: CommandBarProps & {
  orientation?: "horizontal" | "vertical";
  controls?: ShellControls;
  // Minimap visibility lives with the HUD (the minimap is a HUD panel), not the shell.
  minimapOpen?: boolean;
  onToggleMinimap?: () => void;
}) {
  const vertical = orientation === "vertical";
  const weather = WEATHER[view.currentWeather] ?? { label: view.currentWeather, icon: "•" };
  const blocked = hasUnresolvedActions(queue);
  const canPass = isMyTurn && gameOver === null && !blocked;

  const tempo = (
    <div className="@flex @flex-none @items-center @gap-2">
      {controls !== undefined && (
        <div className="@flex @items-center @gap-1.5">
          <ShellButton onClick={controls.onOpenMenu} title="Menu">
            <BurgerIcon />
          </ShellButton>
          <ShellButton
            onClick={controls.onToggleIntel}
            title={controls.intelOpen ? "Hide intel (Tab)" : "Battlefield intel (Tab)"}
            active={controls.intelOpen}
          >
            <IntelIcon />
          </ShellButton>
          {onToggleMinimap !== undefined && (
            <ShellButton
              onClick={onToggleMinimap}
              title={minimapOpen === true ? "Hide minimap" : "Show minimap"}
              active={minimapOpen === true}
            >
              <MapIcon />
            </ShellButton>
          )}
          <ShellButton
            onClick={controls.onToggleFullscreen}
            title={controls.isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            <FullscreenIcon active={controls.isFullscreen} />
          </ShellButton>
        </div>
      )}
      <span className="@font-russoOne @text-base @uppercase @leading-none @tracking-widest @text-primary">
        Day {view.turn}
      </span>
      <span
        className="@flex @items-center @gap-1 @rounded @bg-black/30 @px-2 @py-1 @text-[11px] @font-semibold @uppercase @tracking-wide @text-slate-300"
        title={`Weather: ${weather.label}`}
      >
        <span aria-hidden>{weather.icon}</span> {weather.label}
      </span>
    </div>
  );

  const endTurn = isMyTurn ? (
    <button
      className={`@rounded-lg @px-5 @py-2 @font-russoOne @text-xs @uppercase @tracking-wider @transition disabled:@cursor-not-allowed disabled:@opacity-40 ${
        vertical ? "@w-full" : ""
      }`}
      style={{
        backgroundColor: canPass ? "#E47220" : "#3a3f46",
        color: canPass ? "#000" : "#8b94a0",
      }}
      disabled={!canPass}
      onClick={onPassTurn}
      title={blocked ? "Waiting for buffered actions to resolve" : "End your turn"}
    >
      End Turn
    </button>
  ) : (
    <span
      className={`@rounded-lg @border @border-white/10 @px-4 @py-2 @font-russoOne @text-xs @uppercase @tracking-wider @text-slate-500 ${
        vertical ? "@w-full @text-center" : ""
      }`}
    >
      Waiting…
    </span>
  );

  const statusCluster = (
    <div className={`@flex @items-center @gap-3 ${vertical ? "@justify-between" : "@flex-none"}`}>
      <PingIndicator />
      <BufferIndicator queue={queue} />
      {endTurn}
    </div>
  );

  return (
    <div
      className={`@flex @rounded-lg @bg-bg-primary/80 @px-3 @py-2 @shadow-lg @shadow-black/40 @outline @outline-1 @outline-white/5 ${
        vertical ? "@flex-col @gap-3" : "@w-full @items-center @justify-between @gap-3"
      }`}
    >
      {tempo}
      {statusCluster}
    </div>
  );
}
