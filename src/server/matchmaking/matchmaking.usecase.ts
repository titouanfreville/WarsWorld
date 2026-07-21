import type { GameMode, PrismaClient, Rank, Ruleset } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { createKeyedLock } from "server/adapters/key-lock";
import { emitLobby } from "server/emitter/lobby-emitter";
import { emitQueue } from "server/emitter/matchmaking-emitter";
import { capacityForMode, DEFAULT_PICK_SECONDS } from "server/matches/layout";
import type { SpawnRequest } from "server/matches/matches.usecase";
import { defaultSkill, type Skill } from "server/ranking/skill";
import { armySchema, type Army } from "server/core/schemas/army";
import type { MatchRules } from "server/core/schemas/match-rules";
import { rankedTimeControl } from "server/core/schemas/rule-presets";
import { logger } from "shared/utils/logger";
import {
  BANS_PER_PLAYER,
  LENIENT_GAP,
  MAP_BAN_SECONDS,
  MAP_POOL_SIZE,
  MAP_REVEAL_SECONDS,
  MAP_VOTE_SECONDS,
  MIN_MAP_POOL_SIZE,
  READY_SECONDS,
  READY_SECONDS_LENIENT,
  REMATCH_LOOKBACK_MS,
  TICK_MS,
} from "./constants";
import {
  banStageComplete,
  canBan,
  canVote,
  defaultRandomInt,
  rollMap,
  type PlayerBanVote,
} from "./map-ban";
import type { Tile, TileType } from "server/core/schemas/tile";
import { cancelLobbyPhase, scheduleLobbyPhase } from "./lobby-phase-timer";
import { MatchQueue, toleranceAt, unfairnessOf, type Ticket } from "./queue";
import type { JoinQueueInput } from "./schemas";

/** The narrow cross-feature contracts matchmaking needs (no direct feature-to-feature imports). */
type MatchSpawner = { spawnFromLobby(req: SpawnRequest): Promise<{ matchId: string }> };
type Rater = {
  /** Skill pools by MODE — a fog duel and a standard duel move the same rating. */
  getSkills(playerIds: string[], mode: GameMode): Promise<Map<string, Skill>>;
  /** The player's settled rank for a mode, or null while placing — bands ranked pairing. */
  rankFor(playerId: string, mode: GameMode): Promise<Rank | null>;
};

/** Fisher–Yates over a copy. */
const shuffled = <T>(items: readonly T[]): T[] => {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
};

/** Distinct cosmetic faction per team (2 for 1v1). */
const rollTeamFactions = (teamCount: number): Army[] =>
  shuffled(armySchema.options).slice(0, teamCount);

/** Sensible default rules for a queue game, with the couple of per-ruleset tweaks that matter. */
const defaultRulesFor = (ruleset: Ruleset): MatchRules => ({
  unitCapPerPlayer: 50,
  fogOfWar: ruleset === "fog",
  fundsPerProperty: ruleset === "highFunds" ? 3000 : 1000,
  labUnitTypes: [],
  bannedUnitTypes: [],
  captureLimit: 50,
  // Day limit + turn clock are the RANKED format and are not negotiable per ruleset — a fog queue
  // and a high-funds queue still play the same time control. One table (rule-presets.ts) so ranked
  // can't drift from what the lobby calls "Normal".
  ...rankedTimeControl(),
  // Ranked queue games always use random weather for variety (custom lobbies let the host choose).
  weatherSetting: "random",
  teamMapping: [], // derived from seats at spawn
  pickSeconds: DEFAULT_PICK_SECONDS,
});

const toPlayerBanVote = (m: {
  playerId: string;
  bannedMapIds: string[] | null;
  votedMapId: string | null;
}): PlayerBanVote => ({
  playerId: m.playerId,
  bannedMapIds: m.bannedMapIds ?? [],
  votedMapId: m.votedMapId,
});

/**
 * The ban/vote state of the members who actually decide. Spectators never ban or vote, so counting
 * them would leave `banStageComplete` false forever and stall the phase to its deadline.
 */
const playerBanVotes = (
  members: {
    playerId: string;
    isSpectator: boolean;
    bannedMapIds: string[] | null;
    votedMapId: string | null;
  }[],
): PlayerBanVote[] => members.filter((m) => !m.isSpectator).map(toPlayerBanVote);

/** Property tile types surfaced in the map dossier's breakdown (mirrors the maps feature). */
const PROPERTY_TILE_TYPES = [
  "city",
  "base",
  "airport",
  "commtower",
  "lab",
  "port",
] satisfies TileType[];

/** Reduce a stored map to what the ban board needs: a terrain grid for the thumbnail + counts. */
const summariseMap = (
  id: string,
  map: { name: string; numberOfPlayers: number; tiles: unknown } | undefined,
) => {
  if (map === undefined) {
    return {
      id,
      name: "Unknown map",
      numberOfPlayers: 0,
      width: 0,
      height: 0,
      terrain: [],
      propertyStats: {},
    };
  }

  const tiles = map.tiles as Tile[][];
  const flat = tiles.flat();

  return {
    id,
    name: map.name,
    numberOfPlayers: map.numberOfPlayers,
    width: tiles[0]?.length ?? 0,
    height: tiles.length,
    // Just the terrain type per cell — the FE colours it into a pixel thumbnail.
    terrain: tiles.map((row) => row.map((tile) => tile.type as string)),
    propertyStats: Object.fromEntries(
      PROPERTY_TILE_TYPES.map((type) => [type, flat.filter((tile) => tile.type === type).length]),
    ) as Record<(typeof PROPERTY_TILE_TYPES)[number], number>,
  };
};

const LOBBY_MEMBERS = {
  members: { include: { player: { select: { id: true, name: true } } } },
} as const;

/**
 * Serializes everything that mutates one lobby's pick&ban state: both players' bans and votes, and
 * the phase deadline that can fire between any two of their awaits. Different lobbies never wait on
 * each other.
 */
const lobbyLock = createKeyedLock();

/**
 * The `matchmaking` feature: solo-queue ranked 1v1. Holds the in-memory queue, runs a periodic
 * pairing tick, then drives each pair through a ready-check and a map pick&ban — both as Lobby
 * phases — before handing off to `matches.spawnFromLobby`. Ratings come from `ranking`; the engine
 * is never touched here.
 */
export class MatchmakingUsecase {
  private tickStarted = false;
  /** lobbyId → the two tickets that formed it, so a failed ready-check can requeue with the original wait. */
  private readonly pending = new Map<string, { a: Ticket; b: Ticket }>();

  constructor(
    private readonly db: PrismaClient,
    private readonly ranking: Rater,
    private readonly matches: MatchSpawner,
    private readonly queue: MatchQueue = new MatchQueue(),
  ) {}

  // ── Queue entry/exit ──────────────────────────────────────────────────────

  async joinQueue(playerId: string, input: JoinQueueInput) {
    if (this.queue.has(playerId)) {
      throw new TRPCError({ code: "CONFLICT", message: "You're already in the queue" });
    }

    // THE QUEUE ONLY FORMS PAIRS. `MatchQueue.pair` is structurally 1v1 — it greedily matches each
    // ticket to its fairest single partner, cooldowns are keyed per player PAIR, and
    // `createReadyCheck` seats exactly two members.
    //
    // Accepting a 4-seat mode here produced a silently broken match rather than an error: the pool
    // filter correctly selects a 4-player map, a 2-member lobby is created on it, and the spawned
    // match has slots 2 and 3 owning property and armies with no player behind them — so
    // `allMatchSlotsReady` can never be true and the match can never start. Refusing is the honest
    // answer until group matchmaking exists (4-way fairness, skill-balanced team assignment, and a
    // 4-player ready-check/ban phase are a feature, not a flag).
    //
    // 2v2 and FFA remain fully playable through custom lobbies, which do seat four.
    if (capacityForMode(input.mode) !== 2) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "The queue currently only matches 1v1. Create a custom lobby to play 2v2 or free-for-all.",
      });
    }

    // ONE RANKED MATCH AT A TIME — and only ranked.
    //
    // Wars World is correspondence: a turn takes days, and playing several matches at once is the
    // point (Your Games → Live is a list of them). The original build blocked queueing while ANY
    // match was live, custom games included, which contradicted that.
    //
    // But concurrent RANKED games are incoherent for a different reason than rating safety. Rating
    // itself copes fine — `applyMatchResult` loads skill inside the finalize transaction, so
    // simultaneous matches rate sequentially as they finish. The problem is PAIRING: each concurrent
    // ranked game was matched against the same mu, so by the time the second finalizes, the opponent
    // it chose was picked on information the first game has already invalidated. One at a time keeps
    // what we paired on and what we rate on the same thing.
    //
    // Casual games never block anything, and never count toward this.
    if (input.ranked && (await this.activeRankedMatch(playerId)) !== null) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Finish your current ranked match first — casual games don't count.",
      });
    }

    // Skill is per MODE — the ruleset the player queued for doesn't split it. Rank bands ranked
    // pairing, and only ranked pairing: casual carries no rank (null → the band never applies).
    // Recent opponents spread out rematches, both queues.
    const [skills, rank, recentOpponents] = await Promise.all([
      this.ranking.getSkills([playerId], input.mode),
      input.ranked ? this.ranking.rankFor(playerId, input.mode) : Promise.resolve(null),
      this.recentOpponents(playerId, input.mode),
    ]);

    this.queue.add({
      playerId,
      mode: input.mode,
      ruleset: input.ruleset,
      ranked: input.ranked,
      skill: skills.get(playerId) ?? defaultSkill(),
      rank,
      recentOpponents,
      enqueuedAt: Date.now(),
    });

    emitQueue(playerId, { type: "queue-updated", queueSize: this.queue.size() });
    return this.status(playerId);
  }

  leaveQueue(playerId: string): { inQueue: false } {
    if (this.queue.remove(playerId) !== undefined) {
      emitQueue(playerId, { type: "left" });
    }

    return { inQueue: false };
  }

  /** Whether this player currently holds a queue ticket — the admin force-match branch keys on it. */
  isQueued(playerId: string): boolean {
    return this.queue.has(playerId);
  }

  /**
   * Drop a player's queue ticket if they hold one — used when the admin seats a still-queued player
   * into a forced custom lobby instead, so the pairing tick can't also pair them. No-op if not queued.
   */
  dropFromQueue(playerId: string): void {
    this.leaveQueue(playerId);
  }

  /**
   * Admin force-match: pair two ALREADY-QUEUED players against each other, bypassing the pairing
   * algorithm's fairness / rank-band / rematch filters. From here they run the normal ready-check →
   * map pick&ban flow, so nothing downstream is special-cased. Both must hold a ticket AND share the
   * same bucket (mode/ruleset/ranked): the lobby is stamped with A's bucket for both seats, so
   * force-pairing overrides FAIRNESS, never the player's chosen mode or ranked/casual consent.
   */
  async forcePair(playerAId: string, playerBId: string): Promise<void> {
    // A player can't be their own opponent: the two `queue.get` below would return the same ticket,
    // slip past the undefined check, and hand `createReadyCheck` a lobby with two identical seats —
    // a unique-constraint 500 that leaves the player dequeued with no match.
    if (playerAId === playerBId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Can't pair a player against themselves",
      });
    }

    const a = this.queue.get(playerAId);
    const b = this.queue.get(playerBId);

    if (a === undefined || b === undefined) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Both players must be in the queue to force a pairing",
      });
    }

    // Same bucket only. `createReadyCheck` stamps the lobby with A's mode/ruleset/ranked for BOTH
    // seats, so pairing a ranked ticket with a casual one would sign the casual player up for a ranked
    // match (moving their real rating) they never queued for, and bypass the one-ranked-at-a-time
    // invariant `joinQueue` enforces.
    if (a.ranked !== b.ranked || a.mode !== b.mode || a.ruleset !== b.ruleset) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Both players must be queued for the same mode, ruleset and ranked/casual bucket",
      });
    }

    // Remove before creating the ready-check — createReadyCheck owns them now, exactly as the pairing
    // tick hands its pairs over.
    this.queue.remove(playerAId);
    this.queue.remove(playerBId);

    let created: boolean;

    try {
      created = await this.createReadyCheck(a, b);
    } catch (error) {
      // An unexpected failure (e.g. a DB error building the lobby) would otherwise strand both players
      // dequeued with no match. Put their tickets back before surfacing the error so a transient
      // hiccup isn't a lost queue spot.
      this.queue.add(a);
      this.queue.add(b);
      throw error;
    }

    if (!created) {
      // Empty map pool: createReadyCheck already put both tickets back. Report the failure instead of
      // letting `forceMatch` announce a phantom "pair formed" when no ready-check exists.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No eligible maps available right now; both players were returned to the queue",
      });
    }

    logger.info(`[matchmaking] admin forced ready-check: ${playerAId} vs ${playerBId}`);
  }

  /**
   * The live ranked match that blocks a new ranked queue, or null. One at a time (see `joinQueue`) —
   * exposed so the client can grey the ranked buttons out ahead of the click instead of only
   * learning on refusal. Casual matches are invisible to this by design.
   */
  async activeRankedMatch(playerId: string): Promise<string | null> {
    const seat = await this.db.matchPlayer.findFirst({
      where: {
        playerId,
        isSpectator: false,
        match: { isRanked: true, status: { in: ["setup", "playing"] } },
      },
      select: { matchId: true },
    });

    return seat?.matchId ?? null;
  }

  /** What the Play page needs to enable/disable queues before the player commits to one. */
  async eligibility(playerId: string): Promise<{ activeRankedMatchId: string | null }> {
    return { activeRankedMatchId: await this.activeRankedMatch(playerId) };
  }

  /**
   * `opponentId → lastFinishedAt` for everyone this player recently FINISHED a game with in this mode
   * — the snapshot the ticket carries to hold off quick rematches (see `queue.rematchOk`). Keyed on
   * `finishedAt`, not match start: a correspondence game runs for days, so start time would age out
   * of the window before the game even ends. Only finished games in the lookback window are loaded;
   * anything older can't hold anyway.
   */
  private async recentOpponents(playerId: string, mode: GameMode): Promise<Record<string, number>> {
    const seats = await this.db.matchPlayer.findMany({
      where: {
        playerId,
        isSpectator: false,
        match: { mode, finishedAt: { gte: new Date(Date.now() - REMATCH_LOOKBACK_MS) } },
      },
      select: {
        match: {
          select: {
            finishedAt: true,
            matchPlayers: { where: { isSpectator: false }, select: { playerId: true } },
          },
        },
      },
    });

    const recent: Record<string, number> = {};

    for (const seat of seats) {
      const finishedAt = seat.match.finishedAt?.getTime();

      if (finishedAt === undefined) {
        continue;
      }

      for (const other of seat.match.matchPlayers) {
        if (other.playerId !== playerId) {
          recent[other.playerId] = Math.max(recent[other.playerId] ?? 0, finishedAt);
        }
      }
    }

    return recent;
  }

  status(playerId: string) {
    const ticket = this.queue.get(playerId);

    if (ticket === undefined) {
      return { inQueue: false as const };
    }

    const now = Date.now();

    // The hidden rating is deliberately NOT here: it never leaves the server (plan §1). `tolerance`
    // is how lopsided a matchup this ticket will currently accept, in percentage points away from an
    // even 50/50 — a property of the search, not of the player.
    return {
      inQueue: true as const,
      mode: ticket.mode,
      ruleset: ticket.ruleset,
      ranked: ticket.ranked,
      waitedMs: now - ticket.enqueuedAt,
      tolerance: Math.round(toleranceAt(ticket, now) * 100),
      queueSize: this.queue.size(),
    };
  }

  // ── Pairing tick ──────────────────────────────────────────────────────────

  /** Self-rescheduling pairing loop; started once from the WS entrypoints after the store rebuild. */
  startQueueTick(): void {
    if (this.tickStarted) {
      return;
    }

    this.tickStarted = true;

    const loop = (): void => {
      void this.tick().finally(() => {
        const timer = setTimeout(loop, TICK_MS);
        timer.unref?.();
      });
    };

    const first = setTimeout(loop, TICK_MS);
    first.unref?.();
    logger.info(`[matchmaking] queue tick started (every ${TICK_MS}ms)`);
  }

  /** One pairing pass: everything pairable this tick becomes a ready-check. */
  async tick(): Promise<void> {
    for (const { a, b } of this.queue.pair(Date.now())) {
      try {
        await this.createReadyCheck(a, b);
      } catch (error) {
        logger.error(
          `[matchmaking] failed to create ready-check for ${a.playerId}/${b.playerId}:`,
          error instanceof Error ? error.message : error,
        );
        // Put both back so a transient DB error doesn't silently drop players from the queue.
        this.queue.add(a);
        this.queue.add(b);
      }
    }
  }

  // ── Ready-check ─────────────────────────────────────────────────────────────

  /**
   * Returns `true` when a ready-check lobby was created, `false` when an empty map pool forced both
   * tickets back into the queue — the caller decides whether that's a silent retry (the tick) or a
   * reported failure (an admin force-pair).
   */
  private async createReadyCheck(a: Ticket, b: Ticket): Promise<boolean> {
    // Both tickets share a bucket, so a's mode and ranked flag are b's too (enforced when the pair
    // is formed).
    const mapPool = await this.buildMapPool(a.mode, a.ranked);

    // REFUSE anything below the floor — this is a correctness gate, not a quality warning.
    //
    // Bans are blind, so `canBan` cannot reject the ban that empties the pool without leaking what
    // the opponent banned. With fewer than MIN_MAP_POOL_SIZE maps, two players spending every ban
    // can leave zero survivors: `canVote` then refuses every map, neither player can vote, and
    // `onMapPhaseDeadline` flags BOTH as abandoners for doing exactly what the UI asked. Starting a
    // ban phase we know can deadlock is worse than not starting one.
    if (mapPool.length < MIN_MAP_POOL_SIZE) {
      logger.error(
        `[matchmaking] only ${mapPool.length} eligible ${a.ranked ? "ranked" : "casual"} map(s) ` +
          `for ${a.mode} (need exactly ${capacityForMode(a.mode)} players, and at least ` +
          `${MIN_MAP_POOL_SIZE} maps for a ban phase); dropping pair — add eligible maps`,
      );

      // DROP them, don't requeue. Requeueing put the pair straight back into the same bucket to be
      // re-paired on the next tick and fail identically — an invisible loop running every TICK_MS
      // forever, with no event ever reaching either client. Nothing about waiting longer fixes an
      // empty map pool; it needs an operator. So end the wait and say why.
      //
      // This is the failure mode a fresh deployment hits head-on: `rankedModes` is deliberately
      // backfilled empty (balance can't be inferred from seat count), so until maps are vetted for
      // the ladder the ranked pool really is empty.
      for (const ticket of [a, b]) {
        emitQueue(ticket.playerId, {
          type: "unavailable",
          reason:
            `No ${a.ranked ? "ranked" : ""} maps are currently available for ${a.mode}.`.replace(
              /\s+/g,
              " ",
            ),
        });
      }

      return false;
    }

    // How lopsided this pairing is, as |P(win) − 0.5|. Accounts for both players' uncertainty, so a
    // "wide gap" means genuinely one-sided rather than merely distant on some rating scale.
    const unfairness = unfairnessOf(a, b);
    const fairnessGap = Math.round(unfairness * 100);
    // The wide-gap escape hatch is CASUAL-ONLY. Ranked is bounded to a rank band at pairing time, so
    // it can't produce a lopsided game that needs a bail — and ranked is a commitment regardless.
    // (a.ranked === b.ranked: they share the bucket.)
    const lenient = !a.ranked && unfairness > LENIENT_GAP;
    const readySeconds = lenient ? READY_SECONDS_LENIENT : READY_SECONDS;
    const readyEndsAt = new Date(Date.now() + readySeconds * 1000);

    const lobby = await this.db.lobby.create({
      data: {
        hostPlayerId: null,
        // Both tickets share a bucket keyed by (mode, ruleset, ranked), so a's values are b's too.
        mode: a.mode,
        isRanked: a.ranked,
        ruleset: a.ruleset,
        rules: defaultRulesFor(a.ruleset),
        status: "ready_check",
        readyEndsAt,
        readyCheckLenient: lenient,
        fairnessGap,
        mapPool,
        teamFactions: rollTeamFactions(2),
        members: {
          create: [
            { playerId: a.playerId, membership: "active", team: 0, slot: 0 },
            { playerId: b.playerId, membership: "active", team: 1, slot: 0 },
          ],
        },
      },
    });

    this.pending.set(lobby.id, { a, b });
    scheduleLobbyPhase(lobby.id, readyEndsAt, (id) => this.onReadyDeadline(id));

    for (const playerId of [a.playerId, b.playerId]) {
      emitQueue(playerId, {
        type: "ready-check-started",
        lobbyId: lobby.id,
        readyEndsAt: readyEndsAt.toISOString(),
        lenient,
        fairnessGap,
      });
    }

    logger.info(
      `[matchmaking] ready-check ${lobby.id}: ${a.playerId} vs ${b.playerId} ` +
        `(${50 + fairnessGap}/${50 - fairnessGap}${lenient ? ", lenient" : ""})`,
    );

    return true;
  }

  async acceptReadyCheck(lobbyId: string, playerId: string): Promise<{ accepted: true }> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "ready_check") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This ready-check is no longer active" });
    }

    if (!lobby.members.some((m) => m.playerId === playerId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this ready-check" });
    }

    await this.db.playerInLobby.update({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      data: { accepted: true },
    });

    // Compute completion from state re-read AFTER the write. Reading the pre-write snapshot let two
    // simultaneous accepts each miss the other, deferring the transition to the deadline timer.
    const updated = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });
    const allAccepted = updated?.members.every((m) => m.accepted) ?? false;

    if (allAccepted) {
      cancelLobbyPhase(lobbyId);
      await this.enterMapBan(lobbyId);
    }

    return { accepted: true };
  }

  async declineReadyCheck(lobbyId: string, playerId: string): Promise<{ declined: true }> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "ready_check") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This ready-check is no longer active" });
    }

    const member = lobby.members.find((m) => m.playerId === playerId);

    if (member === undefined) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this ready-check" });
    }

    // A penalty-free decline exists ONLY for casual wide-gap matches (`readyCheckLenient`). Every
    // other check — all ranked, and close casual — is a commitment: accept, or let it time out
    // (which flags you). There is no free bail.
    if (!lobby.readyCheckLenient) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This match has to be accepted — it'll time out on its own if you don't.",
      });
    }

    // Once you've accepted you're locked in; you can't back out even on a wide-gap match.
    if (member.accepted) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You've already accepted this match" });
    }

    cancelLobbyPhase(lobbyId);
    // A decline IS a rejection of this matchup — cool the pair down so it isn't re-offered at once.
    await this.failReadyCheck(lobbyId, [playerId], { cooldown: true });
    return { declined: true };
  }

  /** Deadline fired: everyone in → map ban; otherwise fail on the stragglers. */
  private async onReadyDeadline(lobbyId: string): Promise<void> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "ready_check") {
      return;
    }

    const offenders = lobby.members.filter((m) => !m.accepted).map((m) => m.playerId);

    if (offenders.length === 0) {
      await this.enterMapBan(lobbyId);
    } else {
      // A timeout is an AFK, not a rejection — don't cool the pair down, or in a small pool the
      // player who stepped away can never rematch the one opponent who's there. They CAN re-pair the
      // instant the AFK player re-queues.
      await this.failReadyCheck(lobbyId, offenders, { cooldown: false });
    }
  }

  /**
   * Cancel the lobby, flag non-lenient offenders, and requeue the accepters with their original wait.
   * `cooldown` blocks the pair from being re-offered for a while — right for an explicit decline (a
   * rejection of the matchup), wrong for an AFK timeout (the player just wasn't there).
   */
  private async failReadyCheck(
    lobbyId: string,
    offenderIds: string[],
    { cooldown }: { cooldown: boolean },
  ): Promise<void> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "ready_check") {
      return;
    }

    await this.db.$transaction(async (tx) => {
      await tx.lobby.update({ where: { id: lobbyId }, data: { status: "cancelled" } });

      if (!lobby.readyCheckLenient && offenderIds.length > 0) {
        await tx.playerInfraction.createMany({
          data: offenderIds.map((playerId) => ({ playerId, type: "missed_ready_check", lobbyId })),
        });
      }
    });

    const offenders = new Set(offenderIds);
    const accepterIds = lobby.members
      .filter((m) => !offenders.has(m.playerId))
      .map((m) => m.playerId);
    const pend = this.pending.get(lobbyId);
    this.pending.delete(lobbyId);

    if (pend !== undefined) {
      // Requeue accepters from their original ticket (preserves enqueuedAt → their place in line).
      for (const ticket of [pend.a, pend.b]) {
        if (accepterIds.includes(ticket.playerId)) {
          this.queue.add(ticket);
          emitQueue(ticket.playerId, { type: "requeued" });
        }
      }

      if (cooldown) {
        this.queue.addCooldown(pend.a.playerId, pend.b.playerId, Date.now());
      }
    }

    for (const playerId of offenderIds) {
      emitQueue(playerId, { type: "dismissed" });
    }

    logger.info(
      `[matchmaking] ready-check ${lobbyId} failed; offenders: ${offenderIds.join(", ")}`,
    );
  }

  // ── Map pick & ban ──────────────────────────────────────────────────────────

  private async enterMapBan(lobbyId: string): Promise<void> {
    const mapPhaseEndsAt = new Date(Date.now() + MAP_BAN_SECONDS * 1000);

    await this.db.lobby.update({
      where: { id: lobbyId },
      data: { status: "map_ban", mapPhaseEndsAt },
    });

    scheduleLobbyPhase(lobbyId, mapPhaseEndsAt, (id) => this.onMapPhaseDeadline(id));

    const members = await this.db.playerInLobby.findMany({
      where: { lobbyId },
      select: { playerId: true },
    });

    for (const { playerId } of members) {
      emitQueue(playerId, { type: "map-phase-started", lobbyId });
      emitLobby(playerId, { lobbyId, type: "lobby-updated" });
    }
  }

  async banMap(lobbyId: string, playerId: string, mapId: string): Promise<{ ok: true }> {
    // Serialized per lobby: the read → validate → write → re-read → maybe-open-voting sequence is a
    // critical section, and both the opponent's ban and the phase deadline are competing writers.
    // Unserialized, two players landing their last ban together could each observe the stage
    // complete and both call `enterMapVote`, pushing the vote deadline out twice.
    return lobbyLock.withLock(lobbyId, () => this.banMapLocked(lobbyId, playerId, mapId));
  }

  private async banMapLocked(
    lobbyId: string,
    playerId: string,
    mapId: string,
  ): Promise<{ ok: true }> {
    const { lobby, member } = await this.loadMapBanMember(lobbyId, playerId);
    const pool = (lobby.mapPool ?? []) as string[];

    // Blind: validated against this player's own bans only, so the rejection can't leak the
    // opponent's. Concurrent bans need no atomicity either — with a pool of at least
    // MIN_MAP_POOL_SIZE they can't collide into an empty pool (see map-ban.ts).
    if (!canBan(pool, toPlayerBanVote(member), mapId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can't ban that map" });
    }

    await this.db.playerInLobby.update({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      data: { bannedMapIds: [...(member.bannedMapIds ?? []), mapId] },
    });

    await this.notifyLobby(lobbyId);

    // Re-read AFTER the write so two players finishing their bans at once don't each miss the other
    // and stall the reveal to the deadline (same reasoning as the final vote below).
    const updated = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (updated !== null && banStageComplete(playerBanVotes(updated.members))) {
      await this.enterMapVote(lobbyId);
    }

    return { ok: true };
  }

  /**
   * Everyone has spent their bans → the bans reveal and voting opens on a FRESH deadline. The lobby
   * status stays `map_ban` (the stage is derived from the ban counts, so no schema change); only the
   * clock is restarted, so nobody votes on whatever time a slow opponent left them.
   */
  private async enterMapVote(lobbyId: string): Promise<void> {
    const mapPhaseEndsAt = new Date(Date.now() + MAP_VOTE_SECONDS * 1000);

    // Conditional on the lobby still being in `map_ban`. Callers hold the lobby lock, so this can't
    // race a concurrent ban — but a lobby CANCELLED between the ban write and the re-read (a
    // deadline elsewhere, an admin) would otherwise be handed a fresh deadline and a scheduled
    // phase, reviving a dead lobby.
    const { count } = await this.db.lobby.updateMany({
      where: { id: lobbyId, status: "map_ban" },
      data: { mapPhaseEndsAt },
    });

    if (count === 0) {
      return;
    }

    scheduleLobbyPhase(lobbyId, mapPhaseEndsAt, (id) => this.onMapPhaseDeadline(id));
    await this.notifyLobby(lobbyId);

    logger.info(`[matchmaking] lobby ${lobbyId} bans revealed; voting open`);
  }

  async voteMap(lobbyId: string, playerId: string, mapId: string): Promise<{ ok: true }> {
    // Same critical section as `banMap` — concurrent final votes must not both resolve the lobby.
    return lobbyLock.withLock(lobbyId, () => this.voteMapLocked(lobbyId, playerId, mapId));
  }

  private async voteMapLocked(
    lobbyId: string,
    playerId: string,
    mapId: string,
  ): Promise<{ ok: true }> {
    const { lobby } = await this.loadMapBanMember(lobbyId, playerId);
    const pool = (lobby.mapPool ?? []) as string[];
    const players = playerBanVotes(lobby.members);

    // `canVote` below is the AUTHORITATIVE rule and checks this too. Asked separately here only to
    // pick the right message: "spend your bans first" and "that map is gone" are different problems
    // for the player, and a single rejection can't say both. One implementation, two messages.
    if (!banStageComplete(players)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Spend your bans first — voting opens once both players have banned",
      });
    }

    if (!canVote(pool, players, mapId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That map is no longer available" });
    }

    await this.db.playerInLobby.update({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      data: { votedMapId: mapId },
    });

    await this.notifyLobby(lobbyId);

    // Re-read AFTER the write (so concurrent final votes don't each miss the other and stall to the
    // deadline) and ignore spectators — matching onMapPhaseDeadline, which only requires players.
    const updated = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });
    const allVoted =
      updated?.members.filter((m) => !m.isSpectator).every((m) => m.votedMapId !== null) ?? false;

    if (allVoted) {
      await this.resolveMapBan(lobbyId);
    }

    return { ok: true };
  }

  /**
   * Deadline fired for the map phase. Offenders are whoever is behind AT THE CURRENT STAGE: while
   * bans are still open it's the players who didn't spend them, once they're revealed it's the
   * players who didn't vote. Flagging non-voters unconditionally would punish the player who banned
   * on time and was then blocked waiting for a foe who never did.
   */
  private async onMapPhaseDeadline(lobbyId: string): Promise<void> {
    return lobbyLock.withLock(lobbyId, () => this.onMapPhaseDeadlineLocked(lobbyId));
  }

  private async onMapPhaseDeadlineLocked(lobbyId: string): Promise<void> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "map_ban") {
      return;
    }

    // STALE FIRING. The ban timer stays armed while `banMap` does its writes, so the moment the last
    // ban opens voting there are briefly two timers: the old ban deadline and the fresh vote one.
    // If the old one fires here it finds the ban stage complete, switches to the vote predicate,
    // sees nobody has voted — because voting only just opened — and flags BOTH players as
    // abandoners for a vote they were never given time to cast. The persisted deadline is the source
    // of truth: if it is still in the future, this firing belongs to a phase that has already been
    // superseded.
    if (lobby.mapPhaseEndsAt !== null && lobby.mapPhaseEndsAt.getTime() > Date.now()) {
      return;
    }

    const players = playerBanVotes(lobby.members);
    const behind = banStageComplete(players)
      ? (p: PlayerBanVote) => p.votedMapId === null
      : (p: PlayerBanVote) => p.bannedMapIds.length < BANS_PER_PLAYER;
    const offenders = players.filter(behind).map((p) => p.playerId);

    if (offenders.length === 0) {
      await this.resolveMapBan(lobbyId);
    } else {
      await this.failMapBan(lobbyId, offenders);
    }
  }

  /** Cancel a map-ban lobby, flag the players who didn't pick, and requeue anyone who did. */
  private async failMapBan(lobbyId: string, offenderIds: string[]): Promise<void> {
    cancelLobbyPhase(lobbyId);

    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "map_ban") {
      return;
    }

    await this.db.$transaction(async (tx) => {
      await tx.lobby.update({ where: { id: lobbyId }, data: { status: "cancelled" } });

      if (offenderIds.length > 0) {
        await tx.playerInfraction.createMany({
          data: offenderIds.map((playerId) => ({ playerId, type: "abandoned_map_ban", lobbyId })),
        });
      }
    });

    const offenders = new Set(offenderIds);
    const innocentIds = lobby.members
      .filter((m) => !offenders.has(m.playerId))
      .map((m) => m.playerId);
    const pend = this.pending.get(lobbyId);
    this.pending.delete(lobbyId);

    if (pend !== undefined) {
      for (const ticket of [pend.a, pend.b]) {
        if (innocentIds.includes(ticket.playerId)) {
          this.queue.add(ticket);
          emitQueue(ticket.playerId, { type: "requeued" });
        }
      }

      this.queue.addCooldown(pend.a.playerId, pend.b.playerId, Date.now());
    }

    for (const playerId of offenderIds) {
      emitQueue(playerId, { type: "dismissed" });
    }

    for (const m of lobby.members) {
      emitLobby(m.playerId, { lobbyId, type: "lobby-updated" });
    }

    logger.info(`[matchmaking] map-ban ${lobbyId} abandoned; offenders: ${offenderIds.join(", ")}`);
  }

  /** Everyone voted → roll the winning map among the votes and move into the reveal (not the match). */
  private async resolveMapBan(lobbyId: string): Promise<void> {
    cancelLobbyPhase(lobbyId);

    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    // Guard against a double-resolve (both-voted and the deadline racing).
    if (lobby === null || lobby.status !== "map_ban") {
      return;
    }

    const pool = (lobby.mapPool ?? []) as string[];
    const players = playerBanVotes(lobby.members);
    const mapId = rollMap(pool, players, defaultRandomInt);

    await this.enterMapReveal(lobbyId, mapId);
  }

  /** Lock the winning map and give both players {@link MAP_REVEAL_SECONDS} to study it before the CO pick. */
  private async enterMapReveal(lobbyId: string, mapId: string): Promise<void> {
    const revealEndsAt = new Date(Date.now() + MAP_REVEAL_SECONDS * 1000);

    await this.db.lobby.update({
      where: { id: lobbyId },
      data: { status: "map_reveal", mapId, mapPhaseEndsAt: revealEndsAt },
    });

    scheduleLobbyPhase(lobbyId, revealEndsAt, (id) => this.onMapRevealDeadline(id));

    const members = await this.db.playerInLobby.findMany({
      where: { lobbyId },
      select: { playerId: true },
    });

    for (const { playerId } of members) {
      emitLobby(playerId, { lobbyId, type: "lobby-updated" });
    }

    logger.info(`[matchmaking] lobby ${lobbyId} map locked (${mapId}); revealing for study`);
  }

  /** Reveal window elapsed → spawn the match on the locked map and close the lobby. */
  private async onMapRevealDeadline(lobbyId: string): Promise<void> {
    cancelLobbyPhase(lobbyId);

    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "map_reveal" || lobby.mapId === null) {
      return;
    }

    const seats = lobby.members
      .filter((m) => !m.isSpectator && m.team !== null && m.slot !== null)
      .map((m) => ({ playerId: m.playerId, team: m.team!, slotWithinTeam: m.slot! }));

    const { matchId } = await this.matches.spawnFromLobby({
      lobbyId,
      mode: lobby.mode,
      ruleset: lobby.ruleset,
      isRanked: lobby.isRanked,
      mapId: lobby.mapId,
      rules: lobby.rules,
      seats,
      teamFactions: lobby.teamFactions ?? undefined,
    });

    await this.db.lobby.update({ where: { id: lobbyId }, data: { status: "started" } });
    this.pending.delete(lobbyId);

    for (const m of lobby.members) {
      emitQueue(m.playerId, { type: "match-found", matchId });
      emitLobby(m.playerId, { lobbyId, type: "lobby-updated" });
    }

    logger.info(`[matchmaking] lobby ${lobbyId} → match ${matchId} (map ${lobby.mapId})`);
  }

  /**
   * The ban-board view for the FE: each pool map with enough to draw a real thumbnail + a dossier
   * (terrain grid, size, player count, property counts), plus the stage, its deadline, and — once
   * revealing — the locked-in map.
   *
   * VIEWER-AWARE, because the ban and the vote are both blind. Another player's bans are withheld
   * until everyone has banned, and their vote until the map is rolled; all the viewer gets in the
   * meantime is a progress signal (`banCount`, `hasVoted`) so the UI can say "your foe is still
   * choosing" without saying what they chose. Masking happens HERE, on the wire — never in the FE.
   */
  async mapBanView(lobbyId: string, viewerId: string) {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Lobby ${lobbyId} not found` });
    }

    const pool = (lobby.mapPool ?? []) as string[];
    const maps = await this.db.wWMap.findMany({
      where: { id: { in: pool } },
      select: { id: true, name: true, numberOfPlayers: true, tiles: true },
    });
    const byId = new Map(maps.map((m) => [m.id, m]));

    // Bans reveal when everyone has spent them (which is also when voting opens); votes reveal with
    // the rolled map. Past the ban stage the lobby is in `map_reveal`, where both are public.
    const bansRevealed = banStageComplete(playerBanVotes(lobby.members));
    const votesRevealed = lobby.status === "map_reveal";

    return {
      lobbyId: lobby.id,
      status: lobby.status, // "map_ban" | "map_reveal" (| other, defensively)
      // Three stages, not two. Derived from `bansRevealed` alone, this reported "vote" for the whole
      // of `map_reveal` too — the map is already rolled and locked by then, so any consumer reading
      // `stage` on its own would render a voting UI over a decided pick. `MapBanScreen` happens to
      // also check `status`/`chosenMapId`; a view field shouldn't depend on its caller doing that.
      stage: votesRevealed
        ? ("reveal" as const)
        : bansRevealed
          ? ("vote" as const)
          : ("ban" as const),
      bansRevealed,
      votesRevealed,
      mapPhaseEndsAt: lobby.mapPhaseEndsAt?.toISOString() ?? null,
      chosenMapId: lobby.mapId, // set once the reveal starts
      rules: lobby.rules,
      // Preserve pool order so the board layout is stable across refetches.
      pool: pool.map((id) => summariseMap(id, byId.get(id))),
      players: lobby.members.map((m) => {
        const isViewer = m.playerId === viewerId;
        const bans = (m.bannedMapIds ?? []) as string[];

        return {
          playerId: m.playerId,
          name: m.player.name,
          team: m.team,
          // You always see your own picks; someone else's only once they're revealed. The counts
          // stay public throughout — they show progress, not content.
          bannedMapIds: isViewer || bansRevealed ? bans : [],
          banCount: bans.length,
          votedMapId: isViewer || votesRevealed ? m.votedMapId : null,
          hasVoted: m.votedMapId !== null,
        };
      }),
    };
  }

  // ── Boot ────────────────────────────────────────────────────────────────────

  /** Rebuild both lobby-phase deadlines from the DB after a restart (mirrors reschedulePickDeadlines). */
  async rescheduleLobbyPhases(): Promise<void> {
    const readyChecks = await this.db.lobby.findMany({
      where: { status: "ready_check", readyEndsAt: { not: null } },
      select: { id: true, readyEndsAt: true },
    });

    for (const l of readyChecks) {
      if (l.readyEndsAt !== null) {
        scheduleLobbyPhase(l.id, l.readyEndsAt, (id) => this.onReadyDeadline(id));
      }
    }

    const mapBans = await this.db.lobby.findMany({
      where: { status: "map_ban", mapPhaseEndsAt: { not: null } },
      select: { id: true, mapPhaseEndsAt: true },
    });

    for (const l of mapBans) {
      if (l.mapPhaseEndsAt !== null) {
        scheduleLobbyPhase(l.id, l.mapPhaseEndsAt, (id) => this.onMapPhaseDeadline(id));
      }
    }

    const reveals = await this.db.lobby.findMany({
      where: { status: "map_reveal", mapPhaseEndsAt: { not: null } },
      select: { id: true, mapPhaseEndsAt: true },
    });

    for (const l of reveals) {
      if (l.mapPhaseEndsAt !== null) {
        scheduleLobbyPhase(l.id, l.mapPhaseEndsAt, (id) => this.onMapRevealDeadline(id));
      }
    }

    logger.info(
      `[matchmaking] rescheduled ${readyChecks.length} ready-check(s), ` +
        `${mapBans.length} map-ban(s), ${reveals.length} reveal(s)`,
    );
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /**
   * Eligible maps for a bucket's mode and ranked/casual setting.
   *
   * Matched on EXACT seat count, not `gte`: the map's `numberOfPlayers` drives slot iteration
   * downstream, so an oversized map produces slots with no player behind them and a match that can
   * never become ready. `gte: 2` meant a 4-player map could be auto-rolled into a ranked duel.
   *
   * A ranked queue draws only from `rankedModes` — a map may be perfectly playable in a mode and
   * still be unbalanced enough there that it has no business deciding ratings. Casual draws from
   * the wider `supportedModes`.
   */
  private async buildMapPool(mode: GameMode, ranked: boolean): Promise<string[]> {
    const maps = await this.db.wWMap.findMany({
      where: {
        numberOfPlayers: capacityForMode(mode),
        ...(ranked ? { rankedModes: { has: mode } } : { supportedModes: { has: mode } }),
      },
      select: { id: true },
    });
    return shuffled(maps.map((m) => m.id)).slice(0, MAP_POOL_SIZE);
  }

  private async loadMapBanMember(lobbyId: string, playerId: string) {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "map_ban") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No map pick & ban in progress" });
    }

    const member = lobby.members.find((m) => m.playerId === playerId);

    if (member === undefined) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this lobby" });
    }

    return { lobby, member };
  }

  private async notifyLobby(lobbyId: string): Promise<void> {
    const members = await this.db.playerInLobby.findMany({
      where: { lobbyId },
      select: { playerId: true },
    });

    for (const { playerId } of members) {
      emitLobby(playerId, { lobbyId, type: "lobby-updated" });
    }
  }
}
