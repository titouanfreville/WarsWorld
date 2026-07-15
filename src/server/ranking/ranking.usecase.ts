import type { GameMode, Prisma, PrismaClient, Rank } from "@prisma/client";
import { logger } from "shared/utils/logger";
import {
  ACTIVE_RANKS,
  RANK_ORDER,
  anchorOrdinalOf,
  applyMerit,
  meritDelta,
  startingLadder,
  type Ladder,
} from "./merit";
import {
  defaultSkill,
  expectedScore,
  inPlacements,
  placementScore,
  rateMatch,
  skillOrdinal,
  type Skill,
} from "./skill";

/** Accepts either the base client or a transaction client, so a caller can stay atomic. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The `ranking` feature. Two numbers, two jobs (plan §1):
 *
 *   - `PlayerSkill` (OpenSkill μ/σ) — pairs opponents, sizes Merit. NEVER leaves the server.
 *   - `PlayerRank` (rank + Military Merit) — progression + identity. What players see.
 *
 * Both are keyed per MODE and POOLED across rulesets: a fog duel and a standard duel move the same
 * `duel` rating and the same `duel` ladder. The playerbase is too small to shard them (plan §1.3) —
 * revisit with data (per-ruleset residuals vs predicted score), not opinion. QUEUES still split by
 * mode × ruleset × ranked; only the rating pools. Don't conflate the two.
 *
 * Driven from the finalize transaction; the engine never sees any of it.
 */
export class RankingUsecase {
  constructor(private readonly db: PrismaClient) {}

  /** Current hidden skill per player for a mode; players with no row yet get the OpenSkill default. */
  async getSkills(playerIds: string[], mode: GameMode): Promise<Map<string, Skill>> {
    const skills = new Map(playerIds.map((id) => [id, defaultSkill()]));

    if (playerIds.length === 0) {
      return skills;
    }

    const rows = await this.db.playerSkill.findMany({
      where: { mode, playerId: { in: playerIds } },
      select: { playerId: true, mu: true, sigma: true },
    });

    for (const row of rows) {
      skills.set(row.playerId, { mu: row.mu, sigma: row.sigma });
    }

    return skills;
  }

  /** The displayed ladder per mode for one player — rank, division, Merit, placement state. */
  async getLadder(playerId: string) {
    const [ranks, skills] = await Promise.all([
      this.db.playerRank.findMany({ where: { playerId } }),
      this.db.playerSkill.findMany({ where: { playerId } }),
    ]);

    const skillByMode = new Map(skills.map((row) => [row.mode, row]));

    return ranks.map((row) => {
      const skill = skillByMode.get(row.mode);
      const provisional = skill === undefined || inPlacements(skill);

      return {
        mode: row.mode,
        // Placements hide the rank entirely — an unsettled estimate isn't a rank yet.
        rank: provisional ? ("cadet" as Rank) : row.rank,
        division: row.division,
        merit: row.merit,
        peakRank: row.peakRank,
        games: skill?.games ?? 0,
        inPlacements: provisional,
      };
    });
  }

  /**
   * Rate a finished ranked match and move its players' ladders. Runs in the caller's transaction so
   * rating writes are atomic with the outcome. No-ops unless the match is ranked and not already
   * rated (`ratedAt` — finalize is reachable more than once).
   *
   * Teams are rated as teams: OpenSkill splits credit inside a 2v2 by rating rather than moving both
   * members identically, which is the team-average hack this used to apologise for.
   */
  async applyMatchResult(tx: Db, matchId: string): Promise<void> {
    const match = await tx.match.findUnique({
      where: { id: matchId },
      // `mode` only — the rating pools across rulesets, so `ruleset` is irrelevant here.
      select: { isRanked: true, ratedAt: true, mode: true },
    });

    if (match === null || !match.isRanked || match.ratedAt !== null) {
      return;
    }

    const seats = await tx.matchPlayer.findMany({
      where: { matchId, isSpectator: false },
      select: { playerId: true, team: true, result: true },
    });

    // Group into teams; every member of a team shares the team's result.
    const byTeam = new Map<number, { playerIds: string[]; result: string | null }>();

    for (const seat of seats) {
      const team = byTeam.get(seat.team) ?? { playerIds: [], result: seat.result };
      team.playerIds.push(seat.playerId);
      byTeam.set(seat.team, team);
    }

    // A rating game needs at least two opposing sides; otherwise there's nothing to compare.
    if (byTeam.size < 2) {
      logger.warn(`[ranking] match ${matchId} has < 2 teams; skipping rating.`);
      await tx.match.update({ where: { id: matchId }, data: { ratedAt: new Date() } });
      return;
    }

    const playerIds = seats.map((seat) => seat.playerId);
    const skills = await this.loadSkills(tx, playerIds, match.mode);
    const ladders = await this.loadLadders(tx, playerIds, match.mode);

    const teams = [...byTeam.values()];
    const teamSkills = teams.map((team) => team.playerIds.map((id) => skills.get(id)!));
    // 1-based finishing places; equal values mean a draw, which is how OpenSkill expresses one.
    const places = teams.map((team) =>
      team.result === "won" ? 1 : team.result === "drawn" ? 1 : 2,
    );

    const rated = rateMatch(teamSkills, places);

    for (const [teamIndex, team] of teams.entries()) {
      // Everyone on a side shares its outcome, so E and S are per-team, not per-player.
      const expected = expectedScore(teamSkills, teamIndex);
      const score = placementScore(places[teamIndex], teams.length);

      for (const [memberIndex, playerId] of team.playerIds.entries()) {
        const after = rated[teamIndex][memberIndex];

        await tx.playerSkill.upsert({
          where: { playerId_mode: { playerId, mode: match.mode } },
          create: { playerId, mode: match.mode, mu: after.mu, sigma: after.sigma, games: 1 },
          update: { mu: after.mu, sigma: after.sigma, games: { increment: 1 } },
        });

        // Merit is sized off the rating BEFORE this game (what we predicted), and the ladder position
        // the player is climbing from — not the post-game numbers.
        const ladder = ladders.get(playerId) ?? startingLadder();
        const gap = skillOrdinal(skills.get(playerId)!) - anchorOrdinalOf(ladder);
        const delta = meritDelta(expected, score, gap);
        const next = this.promote(applyMerit(ladder, delta), ladder);

        await tx.playerRank.upsert({
          where: { playerId_mode: { playerId, mode: match.mode } },
          create: {
            playerId,
            mode: match.mode,
            rank: next.rank,
            division: next.division,
            merit: next.merit,
            peakRank: next.rank,
          },
          update: {
            rank: next.rank,
            division: next.division,
            merit: next.merit,
            peakRank: next.peak,
          },
        });

        await tx.meritEvent.upsert({
          where: { matchId_playerId: { matchId, playerId } },
          create: {
            matchId,
            playerId,
            delta,
            rankAfter: next.rank,
            divisionAfter: next.division,
          },
          update: { delta, rankAfter: next.rank, divisionAfter: next.division },
        });
      }
    }

    await tx.match.update({ where: { id: matchId }, data: { ratedAt: new Date() } });
    logger.info(`[ranking] rated match ${matchId} (${teams.length} teams, ${match.mode}).`);
  }

  // ── internals ───────────────────────────────────────────────────────────────────────────────────

  private async loadSkills(
    tx: Db,
    playerIds: string[],
    mode: GameMode,
  ): Promise<Map<string, Skill>> {
    const rows = await tx.playerSkill.findMany({
      where: { mode, playerId: { in: playerIds } },
      select: { playerId: true, mu: true, sigma: true },
    });
    const skills = new Map(playerIds.map((id) => [id, defaultSkill()]));

    for (const row of rows) {
      skills.set(row.playerId, { mu: row.mu, sigma: row.sigma });
    }

    return skills;
  }

  private async loadLadders(
    tx: Db,
    playerIds: string[],
    mode: GameMode,
  ): Promise<Map<string, Ladder>> {
    const rows = await tx.playerRank.findMany({ where: { mode, playerId: { in: playerIds } } });

    return new Map(
      rows.map((row) => [
        row.playerId,
        { rank: row.rank, division: row.division, merit: row.merit },
      ]),
    );
  }

  /**
   * Keep a player out of dormant ranks, and track their peak.
   *
   * `applyMerit` works on the climbable ladder, so it can only land on an ACTIVE rank already — this
   * guards the case where a rank is switched off between seasons and a stored row still names it.
   */
  private promote(next: Ladder, before: Ladder): Ladder & { peak: Rank } {
    const landed = ACTIVE_RANKS.includes(next.rank) ? next : before;
    const peak =
      RANK_ORDER.indexOf(landed.rank) >= RANK_ORDER.indexOf(before.rank)
        ? landed.rank
        : before.rank;

    return { ...landed, peak };
  }
}
