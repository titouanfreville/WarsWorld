import type { GameMode, PrismaClient, Ruleset } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { emit } from "server/emitter/event-emitter";
import type { MatchStore } from "server/match-store";
import { pageMatchIndex } from "server/page-match-index";
import { playerMatchIndex } from "server/player-match-index";
import { DispatchableError } from "server/engine/dispatchable-error";
import { getCOProperties } from "server/engine/rules/co";
import { createMatchStartEvent } from "server/engine/events/handlers/match-start";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { armySchema, type Army } from "server/core/schemas/army";
import type { COID } from "server/core/schemas/co";
import type { MatchRules } from "server/core/schemas/match-rules";
import type { LobbyMatchEvent } from "server/engine/types/events";
import type { PlayerSkins } from "server/players/schemas";
import { logger } from "shared/utils/logger";
import { DEFAULT_PICK_SECONDS, layoutForMode, matchSlotFor } from "./layout";
import { cancelPickDeadline, schedulePickDeadline } from "./pick-timer";

/** A confirmed seat handed over by the lobby when it starts: who sits where. */
export type SpawnSeat = { playerId: string; team: number; slotWithinTeam: number };

export type SpawnRequest = {
  lobbyId: string;
  mode: GameMode;
  ruleset: Ruleset;
  isRanked: boolean;
  mapId: string;
  rules: MatchRules;
  seats: SpawnSeat[];
  /** Faction per team, carried from the lobby so it stays stable across the transition. */
  teamFactions?: Army[];
};

/** Fisher–Yates over a copy — used to hand out distinct armies / team factions. */
const shuffled = <T>(items: readonly T[]): T[] => {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
};

/**
 * The `matches` feature (v2). Owns spawning a Match from a lobby, the general-picker round
 * (lock/reveal/cancel), the server-authoritative pick timer, and the CO-hiding pick view. Persists
 * via Prisma and hydrates the in-memory engine wrapper through the match store. Engine rules stay in
 * the engine; this is the feature seam that drives them.
 */
export class MatchesUsecase {
  constructor(
    private readonly db: PrismaClient,
    private readonly store: MatchStore,
  ) {}

  /** Create a Match in `setup` (the general-picker round) from a started lobby. */
  async spawnFromLobby(req: SpawnRequest): Promise<{ matchId: string }> {
    const map = await this.db.wWMap.findUniqueOrThrow({ where: { id: req.mapId } });
    const layout = layoutForMode(req.mode);

    // Distinct faction colour per seat (engine requires unique armies); team labels are a separate
    // cosmetic roll (may reuse any faction).
    const armies = shuffled(armySchema.options);
    const seats = req.seats.map((seat, i) => ({
      ...seat,
      matchSlot: matchSlotFor(req.mode, seat.team, seat.slotWithinTeam),
      army: armies[i],
    }));

    const teamMapping: number[] = [];

    for (const seat of seats) {
      teamMapping[seat.matchSlot] = seat.team;
    }

    const teamFactions =
      req.teamFactions ?? shuffled(armySchema.options).slice(0, layout.teamCount);
    const pickSeconds = req.rules.pickSeconds ?? DEFAULT_PICK_SECONDS;
    const pickEndsAt = new Date(Date.now() + pickSeconds * 1000);
    const rules: MatchRules = { ...req.rules, teamMapping, pickSeconds };

    const created = await this.db.match.create({
      data: {
        status: "setup",
        mode: req.mode,
        ruleset: req.ruleset,
        isRanked: req.isRanked,
        rules,
        teamFactions,
        pickEndsAt,
        map: { connect: { id: req.mapId } },
        lobby: { connect: { id: req.lobbyId } },
        // v1 blob is unused on the v2 path — membership lives in matchPlayers.
        playerState: [],
        matchPlayers: {
          create: seats.map((seat) => ({
            playerId: seat.playerId,
            slot: seat.matchSlot,
            team: seat.team,
            army: seat.army,
            coId: undefined, // not picked yet
            ready: false,
          })),
        },
      },
    });

    // Hydrate the engine wrapper from the relational rows + index it (so board play works at reveal).
    const rows = await this.db.matchPlayer.findMany({
      where: { matchId: created.id },
      include: { player: { select: { id: true, name: true } } },
    });

    this.store.createMatchAndIndex(created, map, rows);

    schedulePickDeadline(created.id, pickEndsAt, (id) => this.onPickDeadline(id));
    this.broadcast(
      rows.map((row) => row.playerId),
      {
        type: "pick-started",
        matchId: created.id,
        pickEndsAt: pickEndsAt.toISOString(),
      },
    );

    return { matchId: created.id };
  }

  /** A player locks their general (and optional per-match skins). All locked → reveal. */
  async lockCo(matchId: string, playerId: string, coId: COID, skins?: PlayerSkins): Promise<void> {
    const match = this.store.get(matchId);

    if (match === undefined) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Match ${matchId} not found` });
    }

    if (match.status !== "setup") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Generals can only be locked during the pick phase",
      });
    }

    this.assertCOAvailable(coId);

    const wrapperPlayer = match.getPlayerById(playerId);

    if (wrapperPlayer === undefined) {
      throw new TRPCError({ code: "FORBIDDEN", message: "You are not in this match" });
    }

    await this.db.matchPlayer.update({
      where: { matchId_playerId: { matchId, playerId } },
      data: { coId, ready: true, skins: skins ?? undefined },
    });

    wrapperPlayer.data.coId = coId;
    wrapperPlayer.data.ready = true;

    const rows = await this.db.matchPlayer.findMany({ where: { matchId } });
    // Only the fact that this player locked in is broadcast — never which CO (still hidden).
    this.broadcast(
      rows.map((row) => row.playerId),
      { type: "co-locked", matchId, playerId },
    );

    if (rows.every((row) => row.ready)) {
      await this.reveal(matchId);
    }
  }

  /**
   * The pick-phase view, with enemy generals hidden until reveal: an opposing team's `coId` is
   * nulled while `revealedAt` is null; allies and yourself always see the pick.
   */
  async pickView(matchId: string, viewerId: string) {
    const match = await this.db.match.findUnique({
      where: { id: matchId },
      include: { matchPlayers: { include: { player: { select: { id: true, name: true } } } } },
    });

    if (match === null) {
      throw new TRPCError({ code: "NOT_FOUND", message: `Match ${matchId} not found` });
    }

    const revealed = match.revealedAt !== null;
    const viewerTeam = match.matchPlayers.find((p) => p.playerId === viewerId)?.team;

    return {
      matchId: match.id,
      status: match.status,
      pickEndsAt: match.pickEndsAt?.toISOString() ?? null,
      revealed,
      teamFactions: match.teamFactions,
      players: match.matchPlayers.map((p) => {
        const isAllyOrSelf = viewerTeam !== undefined && p.team === viewerTeam;
        const showCo = revealed || isAllyOrSelf;

        return {
          playerId: p.playerId,
          name: p.player.name,
          team: p.team,
          slot: p.slot,
          army: p.army,
          ready: p.ready,
          coId: showCo ? p.coId : null,
          skins: p.skins,
        };
      }),
    };
  }

  /** Deadline fired: everyone ready → reveal; otherwise cancel and flag the stragglers. */
  async onPickDeadline(matchId: string): Promise<void> {
    const match = this.store.get(matchId);

    if (match === undefined || match.status !== "setup") {
      return;
    }

    const rows = await this.db.matchPlayer.findMany({ where: { matchId } });

    if (rows.every((row) => row.ready)) {
      await this.reveal(matchId);
      return;
    }

    const leaverIds = rows.filter((row) => !row.ready).map((row) => row.playerId);
    await this.cancelMatch(matchId, "abandoned_pick", leaverIds);
  }

  /** Reschedule pending pick deadlines from the DB on boot (called after match-store rebuild). */
  async reschedulePickDeadlines(): Promise<void> {
    const rows = await this.db.match.findMany({
      where: { status: "setup", pickEndsAt: { not: null } },
      select: { id: true, pickEndsAt: true },
    });

    for (const row of rows) {
      if (row.pickEndsAt !== null) {
        schedulePickDeadline(row.id, row.pickEndsAt, (id) => this.onPickDeadline(id));
      }
    }
  }

  /** Lock the picks in, flip to `playing`, and kick off the match (day-1 income via matchStart). */
  private async reveal(matchId: string): Promise<void> {
    const match = this.store.get(matchId);

    if (match === undefined || match.status !== "setup") {
      return;
    }

    cancelPickDeadline(matchId);
    match.status = "playing";
    const matchStartEvent = createMatchStartEvent(match);

    await this.db.$transaction(async (tx) => {
      await tx.event.create({ data: { content: matchStartEvent, matchId } });
      await tx.match.update({
        where: { id: matchId },
        data: { status: "playing", revealedAt: new Date() },
      });
    });

    // Bring the in-memory match to what a rebuild would produce from the event log.
    applyMainEventToMatch(match, matchStartEvent);

    const rows = await this.db.matchPlayer.findMany({ where: { matchId } });
    const playerIds = rows.map((row) => row.playerId);
    this.broadcast(playerIds, {
      type: "pick-reveal",
      matchId,
      players: rows.map((row) => ({ playerId: row.playerId, coId: row.coId! })),
    });

    for (const id of playerIds) {
      //@ts-expect-error emit's event union doesn't yet carry the stored-event discovery fields
      emit(id, { ...matchStartEvent, matchId });
    }
  }

  /** Cancel a setup match and record an infraction for each player who didn't lock in. */
  async cancelMatch(matchId: string, reason: string, offenderIds: string[]): Promise<void> {
    cancelPickDeadline(matchId);

    // Gather the full roster before we tear the match down, so everyone hears it was cancelled.
    const allPlayerIds = (
      await this.db.matchPlayer.findMany({ where: { matchId }, select: { playerId: true } })
    ).map((row) => row.playerId);

    await this.db.$transaction(async (tx) => {
      await tx.match.update({ where: { id: matchId }, data: { status: "cancelled" } });

      if (offenderIds.length > 0) {
        await tx.playerInfraction.createMany({
          data: offenderIds.map((playerId) => ({ playerId, type: reason, matchId })),
        });
      }
    });

    const match = this.store.get(matchId);

    if (match !== undefined) {
      match.status = "cancelled";
      this.store.removeMatchFromIndex(match);
      pageMatchIndex.removeMatch(match);

      for (const player of match.getAllPlayers()) {
        playerMatchIndex.onPlayerLeave(player);
      }
    }

    this.broadcast(allPlayerIds, {
      type: "match-cancelled",
      matchId,
      reason,
      leaverIds: offenderIds,
    });
    logger.info(`[matches] cancelled match ${matchId} (${reason}); leavers: ${offenderIds.length}`);
  }

  /** Deliver a lobby/pick event to each player's match subscription (the emitter is per-player). */
  private broadcast(playerIds: string[], event: LobbyMatchEvent): void {
    for (const playerId of playerIds) {
      emit(playerId, event);
    }
  }

  private assertCOAvailable(coId: COID): void {
    try {
      getCOProperties(coId);
    } catch (error) {
      logger.warn(
        `[matches.lockCo] getCOProperties failed for ${coId.name}/${coId.version}:`,
        error instanceof Error ? error.message : error,
      );

      throw new DispatchableError(
        `CO "${coId.name}" is not available in game version ${coId.version}.`,
      );
    }
  }
}
