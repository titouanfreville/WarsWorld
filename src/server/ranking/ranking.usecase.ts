import type { LeagueType, Prisma, PrismaClient } from "@prisma/client";
import { logger } from "shared/utils/logger";
import { DEFAULT_MMR, nextRating, scoreForResult, type Score } from "./elo";

/** Accepts either the base client or a transaction client, so a caller can stay atomic. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The `ranking` feature: keeps per-league `MMR` live off match outcomes and exposes ratings to the
 * matchmaker. Thin — plain Elo (`elo.ts`) plus persistence. The engine never sees it; it's driven
 * from the finalize transaction.
 */
export class RankingUsecase {
  constructor(private readonly db: PrismaClient) {}

  /** Current rating per player for a league; players with no row yet default to {@link DEFAULT_MMR}. */
  async getRatings(playerIds: string[], leagueType: LeagueType): Promise<Map<string, number>> {
    const ratings = new Map(playerIds.map((id) => [id, DEFAULT_MMR]));

    if (playerIds.length === 0) {
      return ratings;
    }

    const rows = await this.db.mMR.findMany({
      where: { leagueType, playerId: { in: playerIds } },
      select: { playerId: true, mmr: true },
    });

    for (const row of rows) {
      ratings.set(row.playerId, row.mmr);
    }

    return ratings;
  }

  /**
   * Apply Elo deltas for a finished ranked match. Runs in the caller's transaction (`tx`) so rating
   * writes are atomic with the outcome write. No-ops unless the match is ranked and not already
   * rated (`ratedAt` guard — finalize can be reached more than once). Non-1v1 uses team-average
   * ratings; only 1v1 is exercised for now.
   */
  async applyMatchResult(tx: Db, matchId: string): Promise<void> {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      select: { isRanked: true, ratedAt: true, leagueType: true },
    });

    if (match === null || !match.isRanked || match.ratedAt !== null) {
      return;
    }

    const players = await tx.matchPlayer.findMany({
      where: { matchId, isSpectator: false },
      select: { playerId: true, team: true, result: true },
    });

    // Group into teams; every member of a team shares the team's result.
    const teams = new Map<number, { playerIds: string[]; score: Score }>();

    for (const p of players) {
      const team = teams.get(p.team) ?? { playerIds: [], score: scoreForResult(p.result) };
      team.playerIds.push(p.playerId);
      teams.set(p.team, team);
    }

    // A rating game needs at least two opposing sides; otherwise there's nothing to compare.
    if (teams.size < 2) {
      logger.warn(`[ranking] match ${matchId} has < 2 teams; skipping rating.`);
      await tx.match.update({ where: { id: matchId }, data: { ratedAt: new Date() } });
      return;
    }

    const existing = await tx.mMR.findMany({
      where: { leagueType: match.leagueType, playerId: { in: players.map((p) => p.playerId) } },
    });
    const ratingByPlayer = new Map(existing.map((r) => [r.playerId, r.mmr]));
    const topByPlayer = new Map(existing.map((r) => [r.playerId, r.topMmr]));
    const ratingOf = (id: string): number => ratingByPlayer.get(id) ?? DEFAULT_MMR;

    // Average rating per team (equals the single player's rating in 1v1).
    const teamAvg = new Map<number, number>();

    for (const [index, team] of teams) {
      const sum = team.playerIds.reduce((acc, id) => acc + ratingOf(id), 0);
      teamAvg.set(index, sum / team.playerIds.length);
    }

    for (const [index, team] of teams) {
      // Opponent baseline = average of every other team's average (just the one other team in 1v1).
      const others = [...teamAvg].filter(([i]) => i !== index).map(([, avg]) => avg);
      const opponentAvg = others.reduce((a, b) => a + b, 0) / others.length;

      for (const playerId of team.playerIds) {
        const before = ratingOf(playerId);
        const after = nextRating(before, opponentAvg, team.score);
        const top = Math.max(topByPlayer.get(playerId) ?? DEFAULT_MMR, after);

        await tx.mMR.upsert({
          where: { leagueType_playerId: { leagueType: match.leagueType, playerId } },
          create: { leagueType: match.leagueType, playerId, mmr: after, topMmr: top },
          update: { mmr: after, topMmr: top },
        });
      }
    }

    await tx.match.update({ where: { id: matchId }, data: { ratedAt: new Date() } });
    logger.info(`[ranking] rated match ${matchId} (${teams.size} teams, ${match.leagueType}).`);
  }
}
