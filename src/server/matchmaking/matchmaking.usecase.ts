import type { GameMode, PrismaClient, Ruleset } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { emitLobby } from "server/emitter/lobby-emitter";
import { emitQueue } from "server/emitter/matchmaking-emitter";
import { DEFAULT_PICK_SECONDS } from "server/matches/layout";
import type { SpawnRequest } from "server/matches/matches.usecase";
import { defaultSkill, type Skill } from "server/ranking/skill";
import { armySchema, type Army } from "server/core/schemas/army";
import type { MatchRules } from "server/core/schemas/match-rules";
import { logger } from "shared/utils/logger";
import {
  LENIENT_GAP,
  MAP_PHASE_SECONDS,
  MAP_POOL_SIZE,
  MAP_REVEAL_SECONDS,
  MIN_MAP_POOL_SIZE,
  READY_SECONDS,
  READY_SECONDS_LENIENT,
  TICK_MS,
} from "./constants";
import { canBan, canVote, defaultRandomInt, rollMap, type PlayerBanVote } from "./map-ban";
import type { Tile, TileType } from "server/core/schemas/tile";
import { cancelLobbyPhase, scheduleLobbyPhase } from "./lobby-phase-timer";
import { MatchQueue, toleranceAt, unfairnessOf, type Ticket } from "./queue";
import type { JoinQueueInput } from "./schemas";

/** The narrow cross-feature contracts matchmaking needs (no direct feature-to-feature imports). */
type MatchSpawner = { spawnFromLobby(req: SpawnRequest): Promise<{ matchId: string }> };
type Rater = {
  /** Skill pools by MODE — a fog duel and a standard duel move the same rating. */
  getSkills(playerIds: string[], mode: GameMode): Promise<Map<string, Skill>>;
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
  dayLimit: 50,
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

    const active = await this.db.matchPlayer.findFirst({
      where: { playerId, match: { status: { in: ["setup", "playing"] } } },
      select: { matchId: true },
    });

    if (active !== null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Finish your current match first" });
    }

    // Skill is per MODE — the ruleset the player queued for doesn't split it.
    const skills = await this.ranking.getSkills([playerId], input.mode);

    this.queue.add({
      playerId,
      mode: input.mode,
      ruleset: input.ruleset,
      ranked: input.ranked,
      skill: skills.get(playerId) ?? defaultSkill(),
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

  private async createReadyCheck(a: Ticket, b: Ticket): Promise<void> {
    const mapPool = await this.buildMapPool();

    if (mapPool.length === 0) {
      logger.error("[matchmaking] no eligible 2-player maps; requeueing pair");
      this.queue.add(a);
      this.queue.add(b);
      return;
    }

    if (mapPool.length < MIN_MAP_POOL_SIZE) {
      // Playable — the last-survivor guard in `canBan` stops the pool being emptied — but this small
      // a pool means the ban phase is degenerate. Signals too few eligible 2-player maps in the DB.
      logger.warn(
        `[matchmaking] map pool of ${mapPool.length} is below MIN_MAP_POOL_SIZE ` +
          `(${MIN_MAP_POOL_SIZE}); ban phase will be degenerate — add more eligible maps`,
      );
    }

    // How lopsided this pairing is, as |P(win) − 0.5|. Accounts for both players' uncertainty, so a
    // "wide gap" means genuinely one-sided rather than merely distant on some rating scale.
    const unfairness = unfairnessOf(a, b);
    const fairnessGap = Math.round(unfairness * 100);
    const lenient = unfairness > LENIENT_GAP;
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

    // Declining is only offered for wide-gap matches. A normal ranked check is a commitment: accept,
    // or let it time out (which flags you) — there is no penalty-free bail.
    if (!lobby.readyCheckLenient) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You can't decline a ranked match — accept, or it will time out.",
      });
    }

    // Once you've accepted you're locked in; you can't back out even on a wide-gap match.
    if (member.accepted) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You've already accepted this match" });
    }

    cancelLobbyPhase(lobbyId);
    await this.failReadyCheck(lobbyId, [playerId]);
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
      await this.failReadyCheck(lobbyId, offenders);
    }
  }

  /** Cancel the lobby, flag non-lenient offenders, and requeue the accepters with their original wait. */
  private async failReadyCheck(lobbyId: string, offenderIds: string[]): Promise<void> {
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

      this.queue.addCooldown(pend.a.playerId, pend.b.playerId, Date.now());
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
    const mapPhaseEndsAt = new Date(Date.now() + MAP_PHASE_SECONDS * 1000);

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
    const { lobby, member } = await this.loadMapBanMember(lobbyId, playerId);
    const pool = (lobby.mapPool ?? []) as string[];
    const players = lobby.members.map(toPlayerBanVote);

    if (!canBan(pool, players, toPlayerBanVote(member), mapId)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can't ban that map" });
    }

    // TODO(review): this is a read-check-write with no atomicity. Two simultaneous bans of the two
    // last survivors both pass canBan on stale state and empty the pool, defeating the last-survivor
    // guard (both players then get flagged as abandoners at the deadline). A race-safe fix needs an
    // atomicity decision — serializable isolation + retry, or an app-level per-lobby lock. Deferred.
    await this.db.playerInLobby.update({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      data: { bannedMapIds: [...(member.bannedMapIds ?? []), mapId] },
    });

    await this.notifyLobby(lobbyId);
    return { ok: true };
  }

  async voteMap(lobbyId: string, playerId: string, mapId: string): Promise<{ ok: true }> {
    const { lobby } = await this.loadMapBanMember(lobbyId, playerId);
    const pool = (lobby.mapPool ?? []) as string[];
    const players = lobby.members.map(toPlayerBanVote);

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
   * Deadline fired for the map phase: if anyone still hasn't voted they abandoned the pick — cancel
   * and flag them (same treatment as a non-lenient missed ready-check). Everyone voted → resolve.
   */
  private async onMapPhaseDeadline(lobbyId: string): Promise<void> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_MEMBERS,
    });

    if (lobby === null || lobby.status !== "map_ban") {
      return;
    }

    const offenders = lobby.members
      .filter((m) => !m.isSpectator && m.votedMapId === null)
      .map((m) => m.playerId);

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
    const players = lobby.members.map(toPlayerBanVote);
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
   * (terrain grid, size, player count, property counts), plus everyone's bans/votes, the phase, its
   * deadline, and — once revealing — the locked-in map.
   */
  async mapBanView(lobbyId: string) {
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

    return {
      lobbyId: lobby.id,
      status: lobby.status, // "map_ban" | "map_reveal" (| other, defensively)
      mapPhaseEndsAt: lobby.mapPhaseEndsAt?.toISOString() ?? null,
      chosenMapId: lobby.mapId, // set once the reveal starts
      rules: lobby.rules,
      // Preserve pool order so the board layout is stable across refetches.
      pool: pool.map((id) => summariseMap(id, byId.get(id))),
      players: lobby.members.map((m) => ({
        playerId: m.playerId,
        name: m.player.name,
        team: m.team,
        bannedMapIds: (m.bannedMapIds ?? []) as string[],
        votedMapId: m.votedMapId,
      })),
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

  private async buildMapPool(): Promise<string[]> {
    const maps = await this.db.wWMap.findMany({
      where: { numberOfPlayers: { gte: 2 } },
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
