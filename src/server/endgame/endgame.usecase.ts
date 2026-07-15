import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { egPresentPlayers, markEgPresent } from "server/adapters/eg-presence";
import { buildMatchWrapper } from "server/match-store";
import { computeGrades } from "server/engine/previews/match-grade";
import { buildMatchStats } from "server/engine/previews/match-stats";

/**
 * End-game feature usecase (see .ai/plans/end-game-screen-plan.md, Epic 3.2). Its one job: given a
 * match id, produce the battle-report summary the End-Game screen renders — each player's identity +
 * result, and the full replay-derived analysis (`buildMatchStats`).
 *
 * Works for a FINISHED match (archived out of the live store, read from the DB) and an in-progress
 * one alike: it rebuilds a fresh seed from the DB rows exactly as `MatchStore` does, then replays the
 * event log onto that throwaway seed — never touching the hot match. Server-authoritative + engine-
 * derived; the router stays thin (validate → call this → return).
 */
export class EndgameUsecase {
  constructor(private readonly db: PrismaClient) {}

  async summary(matchId: string) {
    const raw = await this.db.match.findUnique({
      where: { id: matchId },
      include: {
        map: true,
        // Replay order is the per-match event `index` (see MatchStore.rebuild) — SQL leaves relation
        // order undefined without this, which would scramble the replay.
        Event: { orderBy: { index: "asc" } },
        matchPlayers: { include: { player: { select: { id: true, name: true } } } },
      },
    });

    if (raw === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
    }

    const hasRelationalPlayers = raw.matchPlayers.length > 0;

    // A fresh, unreplayed seed + the ordered log → the same replay MatchStore does, but throwaway.
    const seed = buildMatchWrapper(
      raw,
      raw.map,
      hasRelationalPlayers ? raw.matchPlayers : undefined,
    );
    const events = raw.Event.map((event) => event.content);
    const stats = buildMatchStats(seed, events);

    // Wall-clock duration. A finished match has `finishedAt`; for one that never formally finished
    // (e.g. cancelled after play), fall back to the last event's timestamp so a real duration still
    // shows instead of a blank.
    const endedAt = raw.finishedAt ?? raw.Event[raw.Event.length - 1]?.createdAt ?? raw.createdAt;
    const durationMs = Math.max(0, endedAt.getTime() - raw.createdAt.getTime());

    // Per-player letter grade (Tactics/Strength/Economy → overall), derived from the stats.
    const gradeById = new Map(computeGrades(stats).map((grade) => [grade.playerId, grade]));

    // Player identity + result: prefer the v2 relational rows, fall back to the v1 `playerState` blob.
    const players = hasRelationalPlayers
      ? raw.matchPlayers.map((matchPlayer) => ({
          playerId: matchPlayer.playerId,
          name: matchPlayer.player.name,
          army: matchPlayer.army,
          coName: (matchPlayer.coId as { name: string } | null)?.name ?? null,
          result: matchPlayer.result,
          team: matchPlayer.team,
          grade: gradeById.get(matchPlayer.playerId) ?? null,
        }))
      : raw.playerState.map((player) => ({
          playerId: player.id,
          name: player.name,
          army: player.army as string,
          coName: player.coId.name,
          result: player.result ?? null,
          team: null,
          grade: gradeById.get(player.id) ?? null,
        }));

    return {
      matchId: raw.id,
      status: raw.status,
      winnerTeamIndex: raw.winnerTeamIndex,
      finishedAt: raw.finishedAt,
      isRanked: raw.isRanked,
      // Match meta for the End-Game hero (map · mode · fog · duration).
      mapName: raw.map.name,
      fog: raw.rules.fogOfWar,
      createdAt: raw.createdAt,
      durationMs,
      players,
      stats,
    };
  }

  /**
   * Post-game chat presence heartbeat (Epic 5, FR7). While a participant sits on the End-Game screen
   * the client beats every few seconds; this marks them present so the match conversation stays
   * writable, and returns who else is still here. Once every participant's heartbeat lapses, the chat
   * drains to read-only (enforced in `social.sendMessage`). Participants only — no self-registration
   * by outsiders.
   */
  async chatHeartbeat(matchId: string, playerId: string) {
    const participant = await this.db.matchPlayer.findFirst({
      where: { matchId, playerId },
      select: { playerId: true },
    });

    if (participant === null) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Not a participant of this match." });
    }

    markEgPresent(matchId, playerId);

    return { writable: true, present: egPresentPlayers(matchId) };
  }
}
