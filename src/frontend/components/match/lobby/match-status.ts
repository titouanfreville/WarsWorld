/**
 * Lobby status derivation — pure, viewer-aware, and decoupled from the engine.
 *
 * The frontend never runs game rules; it only labels a match from the current player's point of
 * view using data the backend already puts on each `FrontendMatch` (`hasCurrentTurn`, per-player
 * `status`, the derived `finished` flag). Types here are intentionally structural so this file
 * imports nothing from `shared/` or the server — see src/frontend/CLAUDE.md.
 */

export type LobbyStatusKind =
  | "your-turn"
  | "their-turn"
  | "setup"
  | "victory"
  | "defeat"
  | "draw"
  | "live"
  | "open"
  | "completed";

type LobbyPlayer = {
  id: string;
  ready?: boolean;
  hasCurrentTurn?: boolean;
  status?: "alive" | "routed" | "captured" | "resigned";
  // Authoritative per-player outcome, stamped by the engine when the match finalizes. Preferred over
  // `status` for a finished match: an admin force-outcome sets `result` but leaves both armies
  // "alive", so deriving win/loss from alive-ness alone would mislabel a forced result.
  result?: "won" | "lost" | "drawn";
};

export type LobbyMatch = {
  id: string;
  map: { numberOfPlayers: number };
  players: LobbyPlayer[];
  state: string;
  turn: number;
  finished?: boolean;
};

export const isFinished = (match: LobbyMatch): boolean =>
  match.finished === true || match.state === "finished";

export const viewerOf = (
  match: LobbyMatch,
  playerId: string | undefined,
): LobbyPlayer | undefined =>
  playerId === undefined ? undefined : match.players.find((player) => player.id === playerId);

export const openSlots = (match: LobbyMatch): number =>
  Math.max(0, match.map.numberOfPlayers - match.players.length);

export const isFull = (match: LobbyMatch): boolean => openSlots(match) === 0;

/** The single status a card shows, from `playerId`'s perspective. */
export function deriveLobbyStatus(
  match: LobbyMatch,
  playerId: string | undefined,
): LobbyStatusKind {
  const viewer = viewerOf(match, playerId);

  if (viewer !== undefined) {
    if (isFinished(match)) {
      // Prefer the authoritative stamped result. A forced outcome (admin) sets `result` while leaving
      // both armies "alive", so the alive-status heuristic below would mislabel it — the winner's
      // opponent would read "victory". `result` is what `deriveGameOver` itself reads for a finished
      // match, so this keeps the card in step with the board.
      if (viewer.result === "won") {
        return "victory";
      }
      if (viewer.result === "lost") {
        return "defeat";
      }
      if (viewer.result === "drawn") {
        return "draw";
      }

      // The viewer has no stamped result. If ANY player does, this is a result-stamped match with an
      // anomalous viewer row — `stampOutcome` writes every player's result in one pass, so it isn't
      // reachable today, but don't fall through to the alive-status heuristic (which would read a
      // still-"alive" forced-loser as a victory). Conservatively: not a win.
      if (match.players.some((player) => player.result !== undefined)) {
        return "defeat";
      }

      // Fallback for genuinely pre-result rows (nobody stamped — finished before the column existed).
      // A draw is what the BE's game-over derivation reports as no winning team (winnerTeamIndex null)
      // — e.g. a simultaneous double-elimination: finished with nobody still "alive". Same test here.
      const anyoneAlive = match.players.some((player) => player.status === "alive");

      if (!anyoneAlive) {
        return "draw";
      }

      // Anything other than "alive" is a defeat — the same test `deriveGameOver` uses to decide a
      // team is out. Keyed off "alive" rather than listing the losing statuses so a newly added one
      // (resigned, and later a timed-out player) can't silently fall through to "victory".
      return viewer.status === "alive" ? "victory" : "defeat";
    }

    if (match.state === "setup") {
      return "setup";
    }

    return viewer.hasCurrentTurn === true ? "your-turn" : "their-turn";
  }

  if (isFinished(match)) {
    return "completed";
  }

  if (match.state === "setup" && openSlots(match) > 0) {
    return "open";
  }

  return "live";
}

/**
 * Presentation for each status: a headline pill and the matching left stripe. Classes are spelled
 * literally so Tailwind's JIT keeps them (the `@` prefix is this project's Tailwind prefix).
 */
export const STATUS_META: Record<
  LobbyStatusKind,
  { label: string; pill: string; stripe: string; pulse?: boolean }
> = {
  "your-turn": {
    label: "Your turn",
    pill: "@bg-amber-400 @text-black",
    stripe: "@bg-amber-400",
    pulse: true,
  },
  "their-turn": {
    label: "Their turn",
    pill: "@bg-bg-tertiary @text-slate-200",
    stripe: "@bg-slate-500",
  },
  setup: { label: "Setup", pill: "@bg-yellow-500 @text-black", stripe: "@bg-yellow-500" },
  victory: {
    label: "Victory",
    pill: "@bg-emerald-600 @text-emerald-50",
    stripe: "@bg-emerald-500",
  },
  defeat: { label: "Defeat", pill: "@bg-red-800 @text-red-100", stripe: "@bg-red-600" },
  draw: { label: "Draw", pill: "@bg-slate-500 @text-slate-100", stripe: "@bg-slate-400" },
  live: {
    label: "Live",
    pill: "@bg-bg-match-live @text-red-100",
    stripe: "@bg-match-live-dot",
    pulse: true,
  },
  open: { label: "Open slot", pill: "@bg-primary @text-black", stripe: "@bg-primary" },
  completed: { label: "Completed", pill: "@bg-slate-600 @text-slate-100", stripe: "@bg-slate-500" },
};

export type MatchActionVariant = "turn" | "primary" | "ghost";

/**
 * The single next step for a card's footer, or `null` when there's no board to open — either the
 * card's own setup controls (join / ready / leave) provide the action, or the match is finished.
 *
 * Finished matches are archived out of the live match store, so the board (`/match2/{id}`) returns
 * NOT_FOUND for them: no link until replay/archived viewing exists. Live matches are spectatable by
 * anyone (the match middleware has no membership gate).
 */
export function matchAction(
  kind: LobbyStatusKind,
): { label: string; variant: MatchActionVariant } | null {
  switch (kind) {
    case "your-turn":
      return { label: "Play turn", variant: "turn" };
    case "their-turn":
      return { label: "Enter match", variant: "ghost" };
    case "live":
      return { label: "Spectate", variant: "ghost" };
    default:
      // setup / open → handled by setup controls; victory / defeat / draw / completed → not openable yet.
      return null;
  }
}
