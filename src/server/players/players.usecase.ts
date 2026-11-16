import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";

/**
 * The `players` feature: public reads for the profile page — identity (avatar, real name, handle)
 * and career stats (per-queue ranks, CO usage). Prisma access lives here; the router is a thin
 * transport binding. Ranks are read through the `ranking` feature's ladder reader rather than by
 * touching its tables directly, so this feature owns no ranked logic.
 */

/** The per-mode ladder shape returned by `RankingUsecase.getLadder`. */
export type LadderEntry = {
  mode: string;
  rank: string;
  division: number;
  merit: number;
  peakRank: string | null;
  games: number;
  inPlacements: boolean;
};

type LadderReader = { getLadder(playerId: string): Promise<LadderEntry[]> };

/** The social feature owns the friendship graph; this feature only enriches the ids into cards. */
type FriendReader = { getAcceptedFriendIds(playerId: string): Promise<string[]> };

export type CoStat = {
  co: string;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  /** Whole-percent win rate (0..100). */
  winRate: number;
};

export type MapStat = {
  mapId: string;
  name: string;
  games: number;
  wins: number;
  /** Whole-percent win rate (0..100). */
  winRate: number;
};

/** One row of the per-unit-type career breakdown — engine unit key + summed count (or funds). */
export type UnitTally = { unit: string; count: number };

// A one- or two-game sample makes a meaningless 100% / 0%, so the win-rate ranking needs a floor.
// The played ranking has no floor — every game counts there.
const MIN_GAMES_FOR_WINRATE = 3;

export class PlayersUsecase {
  constructor(
    private readonly db: PrismaClient,
    private readonly ranking: LadderReader,
    private readonly friends: FriendReader,
  ) {}

  /** Identity half of the profile — avatar, real name, handle, favourite CO. */
  async getProfile(name: string) {
    const player = await this.db.player.findUnique({
      where: { name },
      select: { name: true, displayName: true, preferences: true },
    });

    if (player === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found" });
    }

    const preferences = player.preferences;

    return {
      name: player.name,
      displayName: player.displayName,
      avatar: preferences?.avatar ?? null,
      realName: preferences?.realName ?? null,
      favouriteCO: preferences?.favouriteCOs?.[0] ?? null,
    };
  }

  /**
   * Resolve a set of player handles to their display cards (handle + display name + avatar). The
   * batch primitive behind avatars-and-links wherever a player is named — chat, end-game, history.
   * Missing handles are simply omitted. Public.
   */
  async getCards(names: string[]) {
    if (names.length === 0) {
      return [];
    }

    const players = await this.db.player.findMany({
      where: { name: { in: names } },
      select: { name: true, displayName: true, preferences: true },
    });

    return players.map((player) => ({
      name: player.name,
      displayName: player.displayName,
      avatar: player.preferences?.avatar ?? null,
    }));
  }

  /**
   * The player's accepted friends as profile cards (handle + avatar), for the friends panel. Public,
   * by name. Social decides who the friends are; this resolves them into displayable cards.
   */
  async getFriends(name: string) {
    const player = await this.db.player.findUnique({ where: { name }, select: { id: true } });

    if (player === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found" });
    }

    const friendIds = await this.friends.getAcceptedFriendIds(player.id);

    if (friendIds.length === 0) {
      return [];
    }

    const friends = await this.db.player.findMany({
      where: { id: { in: friendIds } },
      select: { name: true, displayName: true, preferences: true },
    });

    return friends
      .map((friend) => ({
        name: friend.name,
        displayName: friend.displayName,
        avatar: friend.preferences?.avatar ?? null,
        favouriteCO: friend.preferences?.favouriteCOs?.[0] ?? null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Career stats: per-queue ranks, the CO-played and CO-win-rate rankings, and the overall record.
   * Aggregated from finished-match seats (`MatchPlayer` rows carrying a `result`) — the CO a player
   * used lives in `coId`, so this groups in memory rather than via `groupBy` on a JSON column.
   */
  async getStats(name: string) {
    const player = await this.db.player.findUnique({ where: { name }, select: { id: true } });

    if (player === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found" });
    }

    const [ranks, seats, combatSum, unitRows] = await Promise.all([
      this.ranking.getLadder(player.id),
      this.db.matchPlayer.findMany({
        where: { playerId: player.id, isSpectator: false, result: { not: null } },
        select: {
          coId: true,
          result: true,
          match: { select: { mapId: true, map: { select: { name: true } } } },
        },
      }),
      // Per-match aggregate stats summed into a career total (units destroyed/lost, captures, …).
      this.db.matchPlayerStats.aggregate({
        where: { playerId: player.id },
        _sum: {
          unitsKilled: true,
          unitsLost: true,
          captures: true,
          powersUsed: true,
          damageDealt: true,
        },
      }),
      // The per-unit-type breakdown JSON (aggregate can't sum JSON), reduced in memory below.
      // Nulls (matches finalized before the column existed) are skipped in the reduce.
      this.db.matchPlayerStats.findMany({
        where: { playerId: player.id },
        select: { unitBreakdown: true },
      }),
    ]);

    const byCo = new Map<string, CoStat>();
    const byMap = new Map<string, MapStat>();
    let games = 0;
    let wins = 0;
    let losses = 0;
    let draws = 0;

    for (const seat of seats) {
      const won = seat.result === "won";
      const lost = seat.result === "lost";
      const drawn = seat.result === "drawn";

      games += 1;

      if (won) {
        wins += 1;
      } else if (lost) {
        losses += 1;
      } else if (drawn) {
        draws += 1;
      }

      const co = seat.coId?.name;

      if (co !== undefined) {
        const stat = byCo.get(co) ?? { co, games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
        stat.games += 1;

        if (won) {
          stat.wins += 1;
        } else if (lost) {
          stat.losses += 1;
        } else if (drawn) {
          stat.draws += 1;
        }

        byCo.set(co, stat);
      }

      const map = byMap.get(seat.match.mapId) ?? {
        mapId: seat.match.mapId,
        name: seat.match.map.name,
        games: 0,
        wins: 0,
        winRate: 0,
      };
      map.games += 1;

      if (won) {
        map.wins += 1;
      }

      byMap.set(seat.match.mapId, map);
    }

    const withWinRate = <T extends { games: number; wins: number; winRate: number }>(rows: T[]) => {
      for (const row of rows) {
        row.winRate = row.games === 0 ? 0 : Math.round((row.wins / row.games) * 100);
      }

      return rows;
    };

    const coStats = withWinRate([...byCo.values()]);
    const coPlayed = [...coStats].sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const coWinRate = coStats
      .filter((stat) => stat.games >= MIN_GAMES_FOR_WINRATE)
      .sort((a, b) => b.winRate - a.winRate || b.games - a.games);

    const mapStats = withWinRate([...byMap.values()]);
    const mapsPlayed = [...mapStats].sort((a, b) => b.games - a.games || b.winRate - a.winRate);
    const favorite = mapsPlayed[0] ?? null;
    const bestMap =
      mapStats
        .filter((map) => map.games >= MIN_GAMES_FOR_WINRATE)
        .sort((a, b) => b.winRate - a.winRate || b.games - a.games)[0] ?? null;

    // Sum the per-unit-type tallies across every match into career totals (built / lost / damage).
    const builtByUnit = new Map<string, number>();
    const lostByUnit = new Map<string, number>();
    const damageByUnit = new Map<string, number>();

    const addTally = (into: Map<string, number>, tally: Record<string, number> | undefined) => {
      for (const [unit, amount] of Object.entries(tally ?? {})) {
        into.set(unit, (into.get(unit) ?? 0) + amount);
      }
    };

    for (const { unitBreakdown } of unitRows) {
      if (unitBreakdown === null) {
        continue;
      }

      addTally(builtByUnit, unitBreakdown.built);
      addTally(lostByUnit, unitBreakdown.lost);
      addTally(damageByUnit, unitBreakdown.damage);
    }

    const toTallies = (map: Map<string, number>): UnitTally[] =>
      [...map.entries()]
        .map(([unit, count]) => ({ unit, count: Math.round(count) }))
        .filter((row) => row.count > 0)
        .sort((a, b) => b.count - a.count);

    return {
      ranks,
      coPlayed,
      coWinRate,
      maps: { played: mapsPlayed, favorite, best: bestMap },
      units: {
        built: toTallies(builtByUnit),
        lost: toTallies(lostByUnit),
        damage: toTallies(damageByUnit),
      },
      combat: {
        unitsKilled: combatSum._sum.unitsKilled ?? 0,
        unitsLost: combatSum._sum.unitsLost ?? 0,
        captures: combatSum._sum.captures ?? 0,
        powersUsed: combatSum._sum.powersUsed ?? 0,
        damageDealt: combatSum._sum.damageDealt ?? 0,
      },
      totals: {
        games,
        wins,
        losses,
        draws,
        winRate: games === 0 ? 0 : Math.round((wins / games) * 100),
      },
    };
  }
}
