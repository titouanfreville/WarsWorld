import type { GameMode, PrismaClient, Rank, Ruleset } from "@prisma/client";
import type { RankingUsecase } from "server/ranking/ranking.usecase";
import type { MatchRules } from "server/core/schemas/match-rules";
import { rankedTimeControl } from "server/core/schemas/rule-presets";
import { DispatchableError } from "server/engine/dispatchable-error";
import { writeAudit } from "server/auth/audit";

/** Who fired the tool — `userId` (not playerId) is what the audit is keyed on, as with dev tools. */
export type AdminActor = {
  userId: string;
  playerId: string;
  ip?: string;
  userAgent?: string;
};

/**
 * Narrow cross-feature contracts the admin tools reach other features through (no direct
 * feature-to-feature imports — see src/server/CLAUDE.md). `matchmaking` force-pairs queued players;
 * `lobbies` spawns the admin-hosted custom match. The composition root injects the concrete usecases.
 */
type QueuePairer = {
  isQueued(playerId: string): boolean;
  forcePair(playerAId: string, playerBId: string): Promise<void>;
  /** Drop a player's queue ticket if they hold one; no-op otherwise. */
  dropFromQueue(playerId: string): void;
};

type LobbyForcer = {
  createForcedMatch(args: {
    hostPlayerId: string;
    seatPlayerIds: string[];
    mode: GameMode;
    ruleset: Ruleset;
    isRanked: boolean;
    mapId?: string;
    rules: MatchRules;
  }): Promise<{ id: string }>;
};

/**
 * Out-of-match admin tools — a peer of the in-match `AdminToolsUsecase`, but NOT match-scoped: these
 * act across the app (spawn a match between two players, set a player's rank), which is why they live
 * behind the global admin router rather than the match one.
 *
 * Every mutation is audited to `DevToolAudit` with `capability: "adminTools"`, the same trail dev and
 * in-match admin tools write — a stolen admin account is the threat, so admin actions are recorded
 * with no exemption.
 */

/** Standard duel rules for a forced match — the same shape a custom "standard" lobby spawns with. */
const STANDARD_DUEL_RULES: MatchRules = {
  unitCapPerPlayer: 50,
  fogOfWar: false,
  fundsPerProperty: 1000,
  labUnitTypes: [],
  bannedUnitTypes: [],
  captureLimit: 50,
  // Same time control the ranked queue plays, from the one preset table — a forced match should feel
  // like a normal game, not an untimed outlier.
  ...rankedTimeControl(),
  weatherSetting: "clear",
  teamMapping: [],
};

export class AdminUsecase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ranking: RankingUsecase,
    private readonly matchmaking: QueuePairer,
    private readonly lobbies: LobbyForcer,
  ) {}

  /** Name search for the flyout's player pickers. Case-insensitive, capped — a picker, not a report. */
  async searchPlayers(query: string) {
    return this.prisma.player.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      select: { id: true, name: true, displayName: true },
      orderBy: { name: "asc" },
      take: 20,
    });
  }

  /**
   * Force a match between two players. Two paths, chosen by where the players already are:
   *
   *   - BOTH IN QUEUE → pair them there. They run the normal ready-check → map pick&ban flow, with
   *     only matchmaking's fairness / rank-band / rematch filters bypassed. Returns `kind: "queued"`;
   *     the pairing surfaces on each player's own queue subscription, not to the admin.
   *   - OTHERWISE → spawn a custom match the ADMIN hosts (benched, an organizer) with both players
   *     pre-seated, and hand back its lobby so the admin lands in the setup panel to start it.
   *
   * The old direct-to-`setup` `match.create` is gone: a forced game now always flows through a real
   * matchmaking or lobby surface, so nothing downstream has to special-case an admin-spawned match.
   */
  async forceMatch(args: {
    playerAId: string;
    playerBId: string;
    /** Optional — the admin picks the map in the setup panel (custom path); ignored for queued pairs. */
    mapId?: string;
    actor: AdminActor;
  }): Promise<
    | { kind: "queued"; playerAName: string; playerBName: string }
    | { kind: "lobby"; lobbyId: string }
  > {
    const { playerAId, playerBId, mapId, actor } = args;

    if (playerAId === playerBId) {
      throw new DispatchableError("A match needs two different players");
    }

    const [playerA, playerB] = await Promise.all([
      this.prisma.player.findUnique({ where: { id: playerAId }, select: { id: true, name: true } }),
      this.prisma.player.findUnique({ where: { id: playerBId }, select: { id: true, name: true } }),
    ]);

    if (playerA === null || playerB === null) {
      throw new DispatchableError("One of the chosen players does not exist");
    }

    if (this.matchmaking.isQueued(playerAId) && this.matchmaking.isQueued(playerBId)) {
      await this.matchmaking.forcePair(playerAId, playerBId);

      await writeAudit(this.prisma, {
        capability: "adminTools",
        tool: "forceMatch",
        payload: { playerAId, playerBId, via: "queue" },
        actor,
      });

      return { kind: "queued", playerAName: playerA.name, playerBName: playerB.name };
    }

    // Not both queued → admin-hosted custom match. The map is left unset when the admin didn't pick
    // one; they choose it in the setup panel. `createForcedMatch` seats both players and benches the
    // admin as host, who then configures and starts the match.
    //
    // Drop any live queue ticket FIRST: this branch also fires when only ONE side is queued, and
    // seating that player in a forced lobby while they still hold a ticket would let the pairing tick
    // double-book them into a second ready-check. No-op for an unqueued player.
    this.matchmaking.dropFromQueue(playerAId);
    this.matchmaking.dropFromQueue(playerBId);

    const lobby = await this.lobbies.createForcedMatch({
      hostPlayerId: actor.playerId,
      seatPlayerIds: [playerAId, playerBId],
      mode: "duel",
      ruleset: "standard",
      isRanked: false,
      mapId,
      rules: STANDARD_DUEL_RULES,
    });

    await writeAudit(this.prisma, {
      capability: "adminTools",
      tool: "forceMatch",
      payload: { playerAId, playerBId, mapId, via: "lobby", lobbyId: lobby.id },
      actor,
    });

    return { kind: "lobby", lobbyId: lobby.id };
  }

  /** Set a player's visible rank for a mode. Delegates the ladder write; audits the override. */
  async modifyRank(args: {
    playerId: string;
    mode: GameMode;
    rank: Rank;
    division: number;
    actor: AdminActor;
  }) {
    const { playerId, mode, rank, division, actor } = args;

    const player = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: { id: true },
    });

    if (player === null) {
      throw new DispatchableError("That player does not exist");
    }

    await this.ranking.setLadder(playerId, mode, rank, division);

    await writeAudit(this.prisma, {
      capability: "adminTools",
      tool: "modifyRank",
      payload: { playerId, mode, rank, division },
      actor,
    });
  }
}
