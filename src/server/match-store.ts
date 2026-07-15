import type { Match, WWMap } from "@prisma/client";
import { prisma } from "server/prisma/prisma-client";
import { MatchWrapper } from "server/engine/entities/match";
import { logger } from "shared/utils/logger";
import { pageMatchIndex } from "./page-match-index";
import { playerMatchIndex } from "./player-match-index";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import { willBeChangeableTile } from "server/core/schemas/tile";
import {
  applyMainEventToMatch,
  applySubEventToMatch,
} from "server/engine/events/apply-event-to-match";
import { UnitWrapper } from "server/engine/entities/unit";
import { finalizeIfGameOver } from "server/engine/previews/finalize";
import { matchPlayerToRuntime, type MatchPlayerRow } from "./matches/match-player";

const getChangeableTilesFromMap = (map: WWMap): ChangeableTile[] => {
  const changeableTiles: ChangeableTile[] = [];

  for (let y = 0; y < map.tiles.length; y++) {
    for (let x = 0; x < map.tiles[y].length; x++) {
      const tile = map.tiles[y][x];

      if (willBeChangeableTile(tile)) {
        if (tile.type === "unusedSilo") {
          changeableTiles.push({
            type: tile.type,
            position: [x, y],
            fired: false,
          });
        } else if (tile.type === "pipeSeam") {
          changeableTiles.push({
            type: tile.type,
            position: [x, y],
            hp: 99,
          });
        } else {
          changeableTiles.push({
            type: tile.type,
            position: [x, y],
            playerSlot: tile.playerSlot,
          });
        }
      }
    }
  }

  return changeableTiles;
};

/**
 * Build a fresh, UNREPLAYED match wrapper (turn 0) from its DB rows — the seed both `MatchStore`
 * indexes for the live game and one-off consumers (e.g. the end-game stats aggregator) replay the
 * event log onto. v2 matches seed from relational `MatchPlayer` rows; v1 from the `playerState` blob.
 * Pure: it indexes nothing and starts no timers, so callers can throw the result away after replay.
 */
export const buildMatchWrapper = (
  rawMatch: Match,
  rawMap: WWMap,
  matchPlayers?: MatchPlayerRow[],
): MatchWrapper => {
  const players =
    matchPlayers !== undefined && matchPlayers.length > 0
      ? matchPlayers.map(matchPlayerToRuntime)
      : rawMatch.playerState;

  return new MatchWrapper(
    rawMatch.id,
    rawMatch.mode,
    rawMatch.ruleset,
    getChangeableTilesFromMap(rawMap),
    rawMatch.rules,
    rawMatch.status,
    rawMap,
    players,
    rawMap.predeployedUnits,
    UnitWrapper,
    0,
  );
};

export class MatchStore {
  private index = new Map<Match["id"], MatchWrapper>();

  /**
   * Build and index a match wrapper. Two hydration sources coexist:
   * - **v2 path** — when relational `MatchPlayer` rows are supplied, the runtime player seed is
   *   derived from them (identity/team/CO/army). `rules.teamMapping` is persisted at spawn, so the
   *   wrapper's team resolution is unchanged.
   * - **v1 path** — otherwise the seed comes from the legacy `playerState` JSON blob, untouched.
   * Either way the volatile runtime (funds, power, turn) is re-derived by replaying the event log.
   */
  createMatchAndIndex(rawMatch: Match, rawMap: WWMap, matchPlayers?: MatchPlayerRow[]) {
    const match = buildMatchWrapper(rawMatch, rawMap, matchPlayers);

    this.index.set(match.id, match);

    for (const player of match.getAllPlayers()) {
      playerMatchIndex.onPlayerJoin(player);
    }

    pageMatchIndex.addMatch(match);

    return match;
  }

  async rebuild() {
    logger.info("Rebuilding server state...");

    const rawMatches = await prisma.match.findMany({
      where: {
        status: {
          not: "finished",
        },
      },
      include: {
        map: true,
        // MUST be replayed strictly in `index` order (the per-match event sequence). Prisma adds NO
        // implicit ORDER BY for an `include`, and SQL leaves relation row order undefined without one —
        // so events could come back shuffled and replay out of order, scrambling turn state. Because a
        // built unit's owner is derived from getCurrentTurnPlayer() at apply time, an out-of-order
        // build/passTurn silently reassigns units to the wrong player on reboot ("units change hands").
        Event: { orderBy: { index: "asc" } },
        // v2 relational membership; empty for v1 matches (which hydrate from playerState instead).
        matchPlayers: { include: { player: { select: { id: true, name: true } } } },
      },
    });

    for (const rawMatch of rawMatches) {
      const match = this.createMatchAndIndex(rawMatch, rawMatch.map, rawMatch.matchPlayers);

      // Replay strictly in order. A single bad event must not crash the whole server on boot (that
      // would take down every match at once) — but it must ALSO not be silently skipped while later
      // events keep applying: that corrupts state (turn/ownership scramble) invisibly. So on the
      // first failure we HALT this match's replay and log loudly, leaving it at its last consistent
      // point. Stale-but-consistent is recoverable; silently scrambled is not. (CO-version validation
      // now prevents the usual trigger — an unimplemented CO throwing mid-replay.)
      for (const dbEvent of rawMatch.Event) {
        try {
          applyMainEventToMatch(match, dbEvent.content);

          if (dbEvent.content.type === "move") {
            applySubEventToMatch(match, dbEvent.content);
          }
        } catch (error) {
          logger.error(
            `[rebuild] match ${rawMatch.id}: event #${dbEvent.index} failed to replay — quarantining ` +
              `this match (removed from all indices) to avoid serving divergent state:`,
            error instanceof Error ? error.message : error,
          );
          // Halting alone isn't enough: a truncated match left in the indices would still be served
          // and WRITABLE, permanently diverging from the DB event log. Pull it out of every index so
          // it's invisible until a clean redeploy/replay rebuilds it from scratch.
          this.quarantineMatch(match);
          break;
        }
      }

      // Replay reproduces elimination status but never re-flips match.status, so a match that was
      // decided (but whose finished-snapshot predates this feature, or whose finalize write was lost
      // to a crash) would come back as "playing". Re-derive here so the in-memory status matches what
      // a fresh finalize would produce; the DB snapshot is reconciled by the backfill script.
      finalizeIfGameOver(match);
    }

    logger.info("Rebuilding server state done.");
  }

  get(matchId: Match["id"]) {
    return this.index.get(matchId);
  }

  getAllMatches() {
    return [...this.index.values()];
  }

  removeMatchFromIndex(match: MatchWrapper) {
    this.index.delete(match.id);
  }

  /**
   * Remove a match from every index (store + page listing + per-player listing). Used when a match
   * fails to fully replay on boot: serving a half-applied match would diverge from its event log, so
   * we make it invisible instead. `createMatchAndIndex` always registers it in all three indices
   * before replay, so each removal is guaranteed to find it.
   */
  private quarantineMatch(match: MatchWrapper) {
    this.removeMatchFromIndex(match);
    pageMatchIndex.removeMatch(match);

    for (const player of match.getAllPlayers()) {
      playerMatchIndex.onPlayerLeave(player);
    }
  }
}

export const matchStore = new MatchStore();
