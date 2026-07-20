import type { Prisma, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { egPresentPlayers, markEgPresent } from "server/adapters/eg-presence";
import { buildMatchWrapper } from "server/match-store";
import { computeGrades } from "server/engine/previews/match-grade";
import { buildMatchStats } from "server/engine/previews/match-stats";

/** Accepts the base client or a transaction client, so `persistStats` can join finalize's tx. */
type Db = PrismaClient | Prisma.TransactionClient;

const MATCH_INCLUDE = {
  map: true,
  // Replay order is the per-match event `index` (see MatchStore.rebuild) — SQL leaves relation
  // order undefined without this, which would scramble the replay.
  Event: { orderBy: { index: "asc" } },
  matchPlayers: { include: { player: { select: { id: true, name: true } } } },
} as const;

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

  /**
   * The replay: seed a throwaway match from the DB rows exactly as `MatchStore` does, run the event
   * log onto it, and derive the stats + grades. Shared by `summary` (which needs the full analysis,
   * timeline included) and `persistStats` (which keeps only the per-player headline).
   *
   * This is the expensive bit — it reads and replays every event — which is exactly why the history
   * list must never call it per row.
   */
  private async analyse(db: Db, matchId: string) {
    const raw = await db.match.findUnique({ where: { id: matchId }, include: MATCH_INCLUDE });

    if (raw === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Match not found" });
    }

    const hasRelationalPlayers = raw.matchPlayers.length > 0;
    const seed = buildMatchWrapper(
      raw,
      raw.map,
      hasRelationalPlayers ? raw.matchPlayers : undefined,
    );
    const stats = buildMatchStats(
      seed,
      raw.Event.map((event) => event.content),
    );

    // Wall-clock duration. A finished match has `finishedAt`; for one that never formally finished
    // (e.g. cancelled after play), fall back to the last event's timestamp so a real duration still
    // shows instead of a blank.
    const endedAt = raw.finishedAt ?? raw.Event[raw.Event.length - 1]?.createdAt ?? raw.createdAt;
    const durationMs = Math.max(0, endedAt.getTime() - raw.createdAt.getTime());

    return { raw, hasRelationalPlayers, stats, durationMs };
  }

  /**
   * Write the per-player battle-report headline + day/duration. Called from finalize's transaction,
   * so a finished match carries its grade without anyone replaying the log again.
   *
   * Guarded by `Match.statsAt` — its own marker, NOT `ratedAt`: stats are written for every finished
   * match, ranked or not. The guard skips the replay entirely on a repeat (finalize is reachable
   * more than once), and the upsert makes a partial write self-heal.
   */
  async persistStats(tx: Db, matchId: string): Promise<void> {
    const existing = await tx.match.findUnique({
      where: { id: matchId },
      select: { statsAt: true },
    });

    if (existing === null || existing.statsAt !== null) {
      return;
    }

    const { stats, durationMs } = await this.analyse(tx, matchId);
    const gradeById = new Map(computeGrades(stats).map((grade) => [grade.playerId, grade]));

    for (const player of stats.players) {
      const grade = gradeById.get(player.playerId);

      if (grade === undefined) {
        continue;
      }

      const row = {
        grade: grade.overall,
        tactics: grade.tactics.score,
        strength: grade.strength.score,
        economy: grade.economy.score,
        damageDealt: Math.round(player.damageDealt),
        damageTaken: Math.round(player.damageTaken),
        unitsKilled: player.unitsKilled,
        unitsLost: player.unitsLost,
        captures: player.captures,
        producedFunds: Math.round(player.producedFunds),
        incomeEarned: Math.round(player.incomeEarned),
        powersUsed: player.powersUsed,
        // The per-unit-type sub-rows the EG review already computed — kept for career aggregation.
        unitBreakdown: {
          built: player.builtByUnit,
          lost: player.lostByUnit,
          damage: player.damageByUnit,
        },
      };

      await tx.matchPlayerStats.upsert({
        where: { matchId_playerId: { matchId, playerId: player.playerId } },
        create: { matchId, playerId: player.playerId, ...row },
        update: row,
      });
    }

    await tx.match.update({
      where: { id: matchId },
      data: { days: stats.days, durationMs, statsAt: new Date() },
    });
  }

  /**
   * Backfill the per-unit breakdown onto already-finalized matches (rows written before the column
   * existed). Re-runs the same replay and updates ONLY `unitBreakdown` — it does not touch the guarded
   * `statsAt` or any scalar, so it's safe to run repeatedly. Used by the unit-stats backfill script.
   */
  async backfillUnitBreakdown(matchId: string): Promise<void> {
    const { stats } = await this.analyse(this.db, matchId);

    for (const player of stats.players) {
      await this.db.matchPlayerStats.updateMany({
        where: { matchId, playerId: player.playerId },
        data: {
          unitBreakdown: {
            built: player.builtByUnit,
            lost: player.lostByUnit,
            damage: player.damageByUnit,
          },
        },
      });
    }
  }

  async summary(matchId: string) {
    const { raw, hasRelationalPlayers, stats, durationMs } = await this.analyse(this.db, matchId);

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
