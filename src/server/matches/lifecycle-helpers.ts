import type { Match, WWMap } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import type { MapWrapper } from "server/engine/entities/map";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";

export const throwIfMatchNotInSetupState = (match: MatchWrapper) => {
  if (match.status !== "setup") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This action requires the match to be in 'setup' state, but it isn't",
    });
  }
};

const mapToFrontend = (map: MapWrapper) => ({
  id: map.data.id,
  name: map.data.name,
  numberOfPlayers: map.data.numberOfPlayers,
});

export const matchToFrontend = (match: MatchWrapper) => ({
  id: match.id,
  map: mapToFrontend(match.map),
  players: match.getAllPlayers().map((player) => player.data),
  state: match.status,
  turn: match.turn,
  // Authoritative now: finalizeIfGameOver flips status="finished" both on the deciding action and on
  // rebuild, so the outcome no longer needs re-deriving on every read.
  finished: match.status === "finished",
  // Same labels the history list keys off, so a match that finished THIS session (still in the
  // in-memory list) tags identically to its archived row. `isRanked` has no counterpart here — it's
  // ranking metadata, not match state, so it isn't on `MatchWrapper` and stays DB-only; the history
  // dedupe prefers the DB row, which carries it.
  mode: match.mode,
  ruleset: match.ruleset,
});

/**
 * Map a persisted DB row to the same shape as `matchToFrontend`. Used for finished matches, which are
 * archived out of the in-memory store (`match-store.rebuild` skips `finished`) and so must be read
 * straight from the DB.
 *
 * `turn` used to be hardcoded to 0 here, rationalised as "the history UI keys off the result, not the
 * day count" — that was a bug wearing a design's clothes, and it's why the day never rendered.
 * `Match.days` is now persisted at finalize, so the real count is available without replaying the
 * log. It stays null on rows that finished before that landed and were never backfilled.
 *
 * `mode`/`ruleset`/`isRanked`/`finishedAt` ride along so the history list can label and filter a row
 * without a per-row `endgame.summary` call — that one replays the whole event log.
 */
export const finishedRowToFrontend = (row: Match & { map: WWMap }) => ({
  id: row.id,
  map: { id: row.map.id, name: row.map.name, numberOfPlayers: row.map.numberOfPlayers },
  players: row.playerState as PlayerInMatch[],
  state: row.status,
  turn: row.days ?? 0,
  finished: true,
  mode: row.mode,
  ruleset: row.ruleset,
  isRanked: row.isRanked,
  finishedAt: row.finishedAt,
  durationMs: row.durationMs,
});

export function allMatchSlotsReady(match: MatchWrapper) {
  for (let i = 0; i < match.map.data.numberOfPlayers; i++) {
    if (match.getPlayerBySlot(i)?.data.ready !== true) {
      return false;
    }
  }

  return true;
}

export function getNextAvailableSlot(match: MatchWrapper) {
  for (let i = 0; i < match.map.data.numberOfPlayers; i++) {
    if (match.getPlayerBySlot(i) !== undefined) {
      return i;
    }
  }

  throw new Error("No player slots available (game full)");
}
