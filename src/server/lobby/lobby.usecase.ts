import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { emitLobby } from "server/emitter/lobby-emitter";
import { armySchema, type Army } from "server/core/schemas/army";
import { logger } from "shared/utils/logger";
import { capacityForMode, isValidSeat, layoutForMode, type LobbyMode } from "server/matches/layout";
import type { SpawnRequest } from "server/matches/matches.usecase";
import type { CreateLobbyInput } from "./schemas";
import { lobbyToView, type LobbyRow, type LobbyView } from "./views";

/** Roll a distinct random AW faction per team index (cosmetic team identity, shown in the lobby). */
const rollTeamFactions = (teamCount: number): Army[] => {
  const armies: Army[] = [...armySchema.options];

  for (let i = armies.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [armies[i], armies[j]] = [armies[j], armies[i]];
  }

  return armies.slice(0, teamCount);
};

/** The narrow cross-feature contract the lobby needs from `matches` (no direct feature import). */
export type MatchSpawner = {
  spawnFromLobby(req: SpawnRequest): Promise<{ matchId: string }>;
};

const LOBBY_INCLUDE = {
  members: { include: { player: { select: { id: true, name: true } } } },
  match: { select: { id: true } },
} as const;

/**
 * The `lobby` feature: a pre-room that gathers players (host invite; matchmaking is Phase 2) and,
 * on start, spawns the Match's general-picker round via the injected {@link MatchSpawner}. Prisma
 * access is inline (moderate); the engine is never touched here.
 */
export class LobbyUsecase {
  constructor(
    private readonly db: PrismaClient,
    private readonly matches: MatchSpawner,
  ) {}

  async createLobby(hostPlayerId: string, input: CreateLobbyInput): Promise<LobbyView> {
    const map = await this.db.wWMap.findUnique({ where: { id: input.mapId } });

    if (map === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Map not found" });
    }

    const capacity = capacityForMode(input.mode);

    if (map.numberOfPlayers < capacity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Map supports ${map.numberOfPlayers} players but ${input.mode} needs ${capacity}`,
      });
    }

    const lobby = await this.db.lobby.create({
      data: {
        hostPlayerId,
        mode: input.mode,
        leagueType: input.leagueType,
        isRanked: input.isRanked,
        mapId: input.mapId,
        rules: input.rules,
        // Rolled now so the lobby can show faction team names/colours before the match spawns.
        teamFactions: rollTeamFactions(layoutForMode(input.mode).teamCount),
        members: {
          create: { playerId: hostPlayerId, membership: "active" },
        },
      },
      include: LOBBY_INCLUDE,
    });

    return lobbyToView(lobby);
  }

  async getLobby(lobbyId: string): Promise<LobbyView> {
    return lobbyToView(await this.loadOrThrow(lobbyId));
  }

  async joinLobby(lobbyId: string, playerId: string): Promise<LobbyView> {
    const lobby = await this.loadOrThrow(lobbyId);
    this.assertAssembling(lobby);

    const existing = lobby.members.find((m) => m.playerId === playerId);

    if (existing !== undefined) {
      // An outstanding invite is accepted by joining; an active member is a no-op.
      if (existing.membership === "invited") {
        await this.db.playerInLobby.update({
          where: { lobbyId_playerId: { lobbyId, playerId } },
          data: { membership: "active" },
        });
      }

      await this.notifyLobby(lobbyId);
      return this.getLobby(lobbyId);
    }

    // Seats beyond capacity default to spectator (e.g. FFA overflow).
    const activeSeated = lobby.members.filter(
      (m) => m.membership === "active" && !m.isSpectator,
    ).length;
    const isSpectator = activeSeated >= capacityForMode(lobby.mode as LobbyMode);

    await this.db.playerInLobby.create({
      data: { lobbyId, playerId, membership: "active", isSpectator },
    });

    await this.notifyLobby(lobbyId);
    return this.getLobby(lobbyId);
  }

  /** Self-assign switchboard: drop onto a team (auto-slot) / a specific slot, or the bench (null). */
  async assignTeam(
    lobbyId: string,
    playerId: string,
    team: number | null,
    slotWithinTeam?: number,
  ): Promise<LobbyView> {
    const lobby = await this.loadOrThrow(lobbyId);
    this.assertAssembling(lobby);

    const member = lobby.members.find((m) => m.playerId === playerId);

    if (member === undefined || member.membership !== "active") {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this lobby" });
    }

    if (team === null) {
      await this.db.playerInLobby.update({
        where: { lobbyId_playerId: { lobbyId, playerId } },
        data: { team: null, slot: null, isSpectator: false },
      });

      await this.notifyLobby(lobbyId);
      return this.getLobby(lobbyId);
    }

    const mode = lobby.mode as LobbyMode;
    const { slotsPerTeam } = layoutForMode(mode);
    const takenSlots = lobby.members
      .filter((m) => m.playerId !== playerId && m.team === team && m.slot !== null)
      .map((m) => m.slot!);

    let slot = slotWithinTeam;

    if (slot === undefined) {
      slot = Array.from({ length: slotsPerTeam }, (_, i) => i).find((s) => !takenSlots.includes(s));

      if (slot === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "That team is full" });
      }
    }

    if (!isValidSeat(mode, team, slot)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid team/slot for this mode" });
    }

    if (takenSlots.includes(slot)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "That seat is taken" });
    }

    await this.db.playerInLobby.update({
      where: { lobbyId_playerId: { lobbyId, playerId } },
      data: { team, slot, isSpectator: false },
    });

    await this.notifyLobby(lobbyId);
    return this.getLobby(lobbyId);
  }

  async invite(lobbyId: string, hostId: string, usernames: string[]): Promise<LobbyView> {
    const lobby = await this.loadOrThrow(lobbyId);
    this.assertHost(lobby, hostId);
    this.assertAssembling(lobby);

    // Match on the handle or the display name so the host doesn't have to know which is which.
    const players = await this.db.player.findMany({
      where: { OR: [{ name: { in: usernames } }, { displayName: { in: usernames } }] },
      select: { id: true, name: true, displayName: true },
    });

    // Tell the host exactly which names didn't resolve, instead of silently inviting nobody.
    const matched = new Set(players.flatMap((p) => [p.name, p.displayName]));
    const missing = usernames.filter((u) => !matched.has(u));

    if (missing.length > 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `No player found for: ${missing.join(", ")}`,
      });
    }

    const alreadyIn = new Set(lobby.members.map((m) => m.playerId));
    const toInvite = players.filter((p) => !alreadyIn.has(p.id));

    if (toInvite.length > 0) {
      await this.db.playerInLobby.createMany({
        data: toInvite.map((p) => ({ lobbyId, playerId: p.id, membership: "invited" as const })),
      });
    }

    await this.notifyLobby(lobbyId);
    return this.getLobby(lobbyId);
  }

  /** Lobbies this player has been invited to (their invitee-side list). */
  async listInvites(playerId: string): Promise<LobbyView[]> {
    const lobbies = await this.db.lobby.findMany({
      where: { status: "assembling", members: { some: { playerId, membership: "invited" } } },
      include: LOBBY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return lobbies.map(lobbyToView);
  }

  /** Open lobbies this player isn't in and that still have a free seat — joinable without an invite. */
  async listOpen(playerId: string): Promise<LobbyView[]> {
    const lobbies = await this.db.lobby.findMany({
      where: { status: "assembling", members: { none: { playerId } } },
      include: LOBBY_INCLUDE,
      orderBy: { createdAt: "desc" },
    });

    return lobbies
      .map(lobbyToView)
      .filter(
        (l) =>
          l.members.filter((m) => m.membership === "active" && !m.isSpectator).length < l.capacity,
      );
  }

  async respondInvite(lobbyId: string, playerId: string, accept: boolean): Promise<LobbyView> {
    const lobby = await this.loadOrThrow(lobbyId);
    const member = lobby.members.find((m) => m.playerId === playerId);

    if (member === undefined || member.membership !== "invited") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No pending invite for you" });
    }

    if (accept) {
      await this.db.playerInLobby.update({
        where: { lobbyId_playerId: { lobbyId, playerId } },
        data: { membership: "active" },
      });
    } else {
      await this.db.playerInLobby.delete({
        where: { lobbyId_playerId: { lobbyId, playerId } },
      });
    }

    await this.notifyLobby(lobbyId, [playerId]);
    return this.getLobby(lobbyId);
  }

  async kick(lobbyId: string, hostId: string, playerId: string): Promise<LobbyView> {
    const lobby = await this.loadOrThrow(lobbyId);
    this.assertHost(lobby, hostId);

    if (playerId === hostId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "The host can't kick themselves" });
    }

    await this.db.playerInLobby.deleteMany({ where: { lobbyId, playerId } });

    await this.notifyLobby(lobbyId, [playerId]);
    return this.getLobby(lobbyId);
  }

  /** Leave the lobby. If the host leaves (or it empties), the lobby is cancelled. */
  async leaveLobby(lobbyId: string, playerId: string): Promise<{ cancelled: boolean }> {
    const lobby = await this.loadOrThrow(lobbyId);

    await this.db.playerInLobby.deleteMany({ where: { lobbyId, playerId } });

    const remaining = lobby.members.filter(
      (m) => m.playerId !== playerId && m.membership === "active",
    );

    if (lobby.hostPlayerId === playerId || remaining.length === 0) {
      await this.db.lobby.update({ where: { id: lobbyId }, data: { status: "cancelled" } });
      await this.notifyLobby(lobbyId, [playerId]);
      return { cancelled: true };
    }

    await this.notifyLobby(lobbyId, [playerId]);
    return { cancelled: false };
  }

  /** Host starts the match: validate a full roster, then spawn the general-picker round. */
  async startLobby(lobbyId: string, hostId: string): Promise<{ matchId: string }> {
    const lobby = await this.loadOrThrow(lobbyId);
    this.assertHost(lobby, hostId);
    this.assertAssembling(lobby);

    if (lobby.mapId === null) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "No map selected" });
    }

    const mode = lobby.mode as LobbyMode;
    const { teamCount, slotsPerTeam } = layoutForMode(mode);
    const capacity = capacityForMode(mode);

    const seated = lobby.members.filter(
      (m) => m.membership === "active" && !m.isSpectator && m.team !== null && m.slot !== null,
    );

    if (seated.length !== capacity) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `All ${capacity} seats must be filled before starting`,
      });
    }

    // Every team must be exactly full with distinct seats.
    for (let team = 0; team < teamCount; team++) {
      const slots = seated.filter((m) => m.team === team).map((m) => m.slot);
      const distinct = new Set(slots);

      if (slots.length !== slotsPerTeam || distinct.size !== slotsPerTeam) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Team ${team} is not correctly filled`,
        });
      }
    }

    const { matchId } = await this.matches.spawnFromLobby({
      lobbyId,
      mode,
      leagueType: lobby.leagueType,
      isRanked: lobby.isRanked,
      mapId: lobby.mapId,
      rules: lobby.rules,
      teamFactions: lobby.teamFactions ?? undefined,
      seats: seated.map((m) => ({
        playerId: m.playerId,
        team: m.team!,
        slotWithinTeam: m.slot!,
      })),
    });

    await this.db.lobby.update({ where: { id: lobbyId }, data: { status: "started" } });
    logger.info(`[lobby] ${lobbyId} started -> match ${matchId}`);

    // Tells every member the room started so their lobby view redirects into the pick phase.
    await this.notifyLobby(lobbyId);
    return { matchId };
  }

  /**
   * Signal every member (plus any just-removed player) to refetch. `extraPlayerIds` covers the
   * kicked/left/declined player, whose row is already gone from the fresh member query but who still
   * needs to hear the room changed.
   */
  private async notifyLobby(lobbyId: string, extraPlayerIds: string[] = []): Promise<void> {
    const members = await this.db.playerInLobby.findMany({
      where: { lobbyId },
      select: { playerId: true },
    });

    const ids = new Set([...members.map((m) => m.playerId), ...extraPlayerIds]);

    for (const id of ids) {
      emitLobby(id, { lobbyId, type: "lobby-updated" });
    }
  }

  private async loadOrThrow(lobbyId: string): Promise<LobbyRow> {
    const lobby = await this.db.lobby.findUnique({
      where: { id: lobbyId },
      include: LOBBY_INCLUDE,
    });

    if (lobby === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Lobby ${lobbyId} not found` });
    }

    return lobby;
  }

  private assertAssembling(lobby: LobbyRow): void {
    if (lobby.status !== "assembling") {
      throw new TRPCError({ code: "BAD_REQUEST", message: "This lobby is no longer open" });
    }
  }

  private assertHost(lobby: LobbyRow, playerId: string): void {
    if (lobby.hostPlayerId !== playerId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Only the host can do that" });
    }
  }
}
