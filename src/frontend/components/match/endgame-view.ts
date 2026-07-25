import type { MatchView } from "frontend/components/match/match-view";
import type { CoResult } from "frontend/components/match/hud/GameOverOverlay";
import type { EndGamePlayer } from "frontend/components/match/hud/EndGameScreen";
import type { Army } from "frontend/utils/sprites";

/** Viewer-relative outcome, for the End-Game screen's header + theme. */
export type MatchOutcome = "victory" | "defeat" | "draw";

/** The BE-derived game-over flag off `match.full`. The client only renders it, never derives it. */
type GameOver = NonNullable<MatchView["gameOver"]>;

/**
 * Presentation mappings from the authoritative view to the end-of-match screens. Pure and
 * viewer-relative — the outcome itself is the BE's (`gameOver`), we only phrase it for this seat.
 */
export const toOutcome = (gameOver: GameOver): MatchOutcome =>
  gameOver.viewerWon ? "victory" : gameOver.winnerTeamIndex === null ? "draw" : "defeat";

/**
 * The full CO cast for the game-over overlay — every general tagged with how their match ended
 * (from `player.result`) so the overlay can colour winners and grey out losers. The viewer is
 * flagged so their own CO gets a "You" marker.
 */
export const toGameOverCos = (view: MatchView | undefined, viewerId: string): CoResult[] =>
  view?.players.map((player) => ({
    name: player.coId.name,
    result: player.result,
    isViewer: player.id === viewerId,
  })) ?? [];

/** Richer per-seat summary for the End-Game screen (name + army + CO + result). */
export const toEndGamePlayers = (view: MatchView | undefined, viewerId: string): EndGamePlayer[] =>
  view?.players.map((player) => ({
    id: player.id,
    name: player.name,
    army: player.army as Army,
    coName: player.coId.name,
    result: player.result,
    isViewer: player.id === viewerId,
  })) ?? [];
