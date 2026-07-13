import type { MedalType, PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { computeStanding, type HonorStanding } from "./honor";

/**
 * Honor feature usecase (Epic 6). Awards post-match medals and reads a player's standing. Enforces
 * the honor rules: matchmaking games only, the match is finished, both are participants, no
 * self-award, and one medal per giver per match. Reading is public (standings show on profiles);
 * awarding requires the logged-in giver.
 */
export class HonorUsecase {
  constructor(private readonly db: PrismaClient) {}

  /** Aggregate a player's received medals into tiers + prestige (see `computeStanding`). */
  async standing(playerId: string): Promise<HonorStanding> {
    const rows = await this.db.commendation.groupBy({
      by: ["medal"],
      where: { toId: playerId },
      _count: { _all: true },
    });

    const counts: Partial<Record<MedalType, number>> = {};

    for (const row of rows) {
      counts[row.medal] = row._count._all;
    }

    return computeStanding(counts);
  }

  async awardMedal(fromId: string, matchId: string, toPlayerId: string, medal: MedalType) {
    if (fromId === toPlayerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can't commend yourself." });
    }

    const match = await this.db.match.findUnique({
      where: { id: matchId },
      include: { matchPlayers: { select: { playerId: true } } },
    });

    if (match === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
    }

    if (match.status !== "finished") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The match isn't finished yet." });
    }

    // Honor is matchmaking-only. `isRanked` is our matchmaking proxy (custom lobbies aren't ranked);
    // the precise signal is the lobby provenance — revisit if custom-ranked matches ever exist.
    if (!match.isRanked) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Honor is only awarded in matchmaking games.",
      });
    }

    // Participants: the v2 relational rows, plus the v1 `playerState` blob for legacy matches.
    const participants = new Set<string>([
      ...match.matchPlayers.map((player) => player.playerId),
      ...match.playerState.map((player) => player.id),
    ]);

    if (!participants.has(fromId) || !participants.has(toPlayerId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Both players must be in this match." });
    }

    // One medal per giver per match (the (matchId, fromId) unique key). Check first for a clean error.
    const existing = await this.db.commendation.findUnique({
      where: { matchId_fromId: { matchId, fromId } },
    });

    if (existing !== null) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "You've already awarded a medal for this match.",
      });
    }

    await this.db.commendation.create({ data: { matchId, fromId, toId: toPlayerId, medal } });

    return { ok: true as const };
  }
}
