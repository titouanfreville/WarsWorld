import type { PrismaClient } from "@prisma/client";
import { appendEvent } from "server/adapters/event-log";
import { DispatchableError } from "server/engine/dispatchable-error";
import { INITIAL_FUNDS } from "server/engine/constants/funds";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { createMatchStartEvent } from "server/engine/events/handlers/match-start";
import { getCOProperties } from "server/engine/rules/co";
import { type Army, armySchema } from "server/core/schemas/army";
import type { COID } from "server/core/schemas/co";
import type { Position } from "server/core/schemas/position";
import { emit } from "server/emitter/event-emitter";
import { pageMatchIndex } from "server/page-match-index";
import { playerMatchIndex } from "server/player-match-index";
import type { MatchStore } from "server/match-store";
import { logger } from "shared/utils/logger";
import {
  allMatchSlotsReady,
  finishedRowToFrontend,
  matchToFrontend,
  throwIfMatchNotInSetupState,
} from "./lifecycle-helpers";

type SwitchOptionsInput = { selectedCO?: COID; selectedArmy?: Army; selectedSlot?: number };

/**
 * The custom-match setup lifecycle: listing, join/leave, ready-up (which starts the match), and
 * in-setup option switches. All the domain logic that used to live in the match router — slot/army
 * rules, playerState assembly, the match-start event + transaction, and the live emits. The router
 * hands it the request-scoped match/player from ctx and does nothing else.
 */
export class MatchLifecycleUsecase {
  constructor(
    private readonly db: PrismaClient,
    private readonly matchStore: MatchStore,
  ) {}

  // ── Listing ─────────────────────────────────────────────────────────────────

  listPage(pageNumber: number) {
    return pageMatchIndex.getPage(pageNumber).map(matchToFrontend);
  }

  listPlayerMatches(playerId: string) {
    return playerMatchIndex.getPlayerMatches(playerId)?.map(matchToFrontend) ?? [];
  }

  // Finished matches are archived out of the live store (rebuild skips them), so history reads from
  // the DB. Membership lives in the `playerState` JSON, so filter it in memory after fetching.
  /**
   * The viewer's finished matches, each carrying THEIR OWN battle-report headline (grade + the three
   * axes + damage/kills/captures), joined from `MatchPlayerStats` — written once at finalize, so the
   * list never replays an event log. `days`/`durationMs` ride on the row itself.
   *
   * `playerStats` is filtered to the viewer, so a row is exactly what this player did in that match;
   * it's null for matches finished before the stats write landed whose backfill failed (e.g. a log
   * that can't replay — see utils/backfill-match-stats.ts), and the UI degrades to the outcome alone.
   *
   * KNOWN LIMIT — this scans every finished match and filters membership in memory, because there is
   * no queryable index for it: `MatchPlayer` covers only v2 matches, and the implicit `_MatchToPlayer`
   * relation the schema declares is never populated (0 rows). That's also why paging is still the
   * client's job: `skip`/`take` here would page BEFORE the filter and return ragged pages. Fine at
   * this scale, wrong at 500 — fixing it needs a real membership index, not a query tweak.
   */
  async listPlayerFinishedMatches(playerId: string) {
    const rows = await this.db.match.findMany({
      where: { status: "finished" },
      include: { map: true, playerStats: { where: { playerId } } },
      orderBy: { finishedAt: "desc" },
    });

    return rows
      .filter((row) => row.playerState.some((player) => player.id === playerId))
      .map((row) => ({ ...finishedRowToFrontend(row), viewerStats: row.playerStats[0] ?? null }));
  }

  // ── Setup lifecycle ───────────────────────────────────────────────────────────

  async join(
    match: MatchWrapper,
    currentPlayer: { id: string; name: string },
    selectedCO: COID,
    playerSlot: number | null,
  ) {
    throwIfMatchNotInSetupState(match);

    if (match.getPlayerById(currentPlayer.id) !== undefined) {
      throw new Error("You've already joined this match!");
    }

    if (playerSlot !== null && match.map.data.numberOfPlayers <= playerSlot) {
      throw new DispatchableError("Invalid player slot given");
    }

    if (playerSlot !== null && match.getPlayerBySlot(playerSlot) !== undefined) {
      throw new DispatchableError("Player slot is occupied");
    }

    this.throwIfCOUnavailable(selectedCO);

    // When there is not a specified slot to join, loop from 0 until an open slot is found.
    let slotToJoin = 0;

    while (match.getPlayerBySlot(slotToJoin) !== undefined) {
      slotToJoin += 1;
    }

    if (match.map.data.numberOfPlayers <= slotToJoin) {
      throw new DispatchableError("Match is full");
    }

    const armiesOccupied = match.getAllPlayers().map((player) => player.data.army as string);
    const availableArmies = Object.keys(armySchema.Values).filter(
      (army) => !armiesOccupied.includes(army),
    );

    const player = match.addUnwrappedPlayer({
      id: currentPlayer.id,
      slot: playerSlot ?? slotToJoin,
      ready: false,
      coId: selectedCO,
      // Players start at zero; income is granted per turn (day 1 in applyMatchStartEvent).
      funds: INITIAL_FUNDS,
      timesPowerUsed: 0,
      powerMeter: 0,
      status: "alive",
      hasCurrentTurn: false,
      army: availableArmies[(Math.random() * availableArmies.length) | 0] as Army,
      COPowerState: "no-power",
      name: currentPlayer.name,
    });

    playerMatchIndex.onPlayerJoin(player);

    // playerState is what the DB holds — basically each PlayerInMatchWrapper's data.
    const newPlayerState = match.teams.flatMap((team) =>
      team.players.map((teamPlayer) =>
        teamPlayer.data.id === player.data.id ? player.data : teamPlayer.data,
      ),
    );

    await this.db.$transaction(async (tx) => {
      await tx.match.update({ where: { id: match.id }, data: { playerState: newPlayerState } });
    });

    //@ts-expect-error emit needs to be updated
    emit({ type: "player-joined", matchId: match.id, playerId: currentPlayer.id });
  }

  async leave(match: MatchWrapper, player: PlayerInMatchWrapper) {
    throwIfMatchNotInSetupState(match);

    const { team: teamToRemoveFrom } = player;

    teamToRemoveFrom.players = teamToRemoveFrom.players.filter(
      (teamPlayer) => teamPlayer.data.slot === player.data.slot,
    );

    if (teamToRemoveFrom.players.length === 0) {
      match.teams = match.teams.filter((team2) => team2 === teamToRemoveFrom);
    }

    playerMatchIndex.onPlayerLeave(player);

    // There is only one player, so we can remove the whole match.
    if (match.teams.length === 1 && match.teams[0].players.length === 1) {
      pageMatchIndex.removeMatch(match);
      this.matchStore.removeMatchFromIndex(match);
      await this.db.match.delete({ where: { id: match.id } });
    } else {
      const newPlayerState = match.teams.flatMap((team) =>
        team.players
          .filter((teamPlayer) => teamPlayer.data.id !== player.data.id)
          .map((teamPlayer) => teamPlayer.data),
      );

      await this.db.match.update({
        where: { id: match.id },
        data: { playerState: newPlayerState },
      });

      match.teams = match.teams.filter((teamToRemove) => teamToRemove.index !== player.team.index);
      //@ts-expect-error emit needs to be updated
      emit({ matchId: match.id, type: "player-left", playerId: player.data.id });
    }
  }

  async setReady(match: MatchWrapper, player: PlayerInMatchWrapper, readyState: boolean) {
    throwIfMatchNotInSetupState(match);

    const newPlayerData: PlayerInMatch = { ...player.data, ready: readyState };

    const newPlayerState = match.teams.flatMap((team) =>
      team.players.map((teamPlayer) =>
        teamPlayer.data.id === player.data.id ? newPlayerData : teamPlayer.data,
      ),
    );

    player.data.ready = readyState;

    if (allMatchSlotsReady(match)) {
      match.status = "playing";
      const matchStartEvent = createMatchStartEvent(match);

      let eventIndex: number | undefined = undefined;
      await this.db.$transaction(async (tx) => {
        eventIndex = await appendEvent(tx, match.id, matchStartEvent);

        // Persist the pre-start snapshot (funds still at INITIAL_FUNDS). Day-1 income is applied by
        // the matchStart event below and re-derived by replaying it on rebuild, so it must NOT be
        // baked into this snapshot or it would be granted twice.
        await tx.match.update({
          where: { id: match.id },
          data: { playerState: newPlayerState, status: "playing" },
        });
      });

      // Bring the in-memory match to the same state a rebuild would produce from the event log:
      // grant the starting player their first turn's income.
      applyMainEventToMatch(match, matchStartEvent);

      if (eventIndex !== undefined) {
        //@ts-expect-error emit needs to be updated
        emit({ ...matchStartEvent, matchId: match.id });
      }
    } else {
      // Update the DB first; if that succeeds, memory is already consistent.
      await this.db.match.update({
        where: { id: match.id },
        data: { playerState: newPlayerState },
      });

      //@ts-expect-error emit needs to be updated
      emit({
        type: "player-changed-ready-status",
        matchId: match.id,
        playerId: player.data.id,
        ready: readyState,
      });
    }
  }

  async switchOptions(
    match: MatchWrapper,
    player: PlayerInMatchWrapper,
    input: SwitchOptionsInput,
  ) {
    throwIfMatchNotInSetupState(match);

    if (input.selectedCO !== undefined) {
      this.throwIfCOUnavailable(input.selectedCO);
    }

    const newPlayerData: PlayerInMatch = { ...player.data };
    newPlayerData.coId = input.selectedCO ?? newPlayerData.coId;
    newPlayerData.army = input.selectedArmy ?? newPlayerData.army;
    newPlayerData.slot = input.selectedSlot ?? newPlayerData.slot;

    const armiesOccupied = match.getAllPlayers().map((p) => p.data.army as string);
    const slotsOccupied = match.getAllPlayers().map((p) => p.data.slot);

    if (input.selectedArmy !== undefined && armiesOccupied.includes(input.selectedArmy)) {
      throw new DispatchableError("Army is already picked by another player");
    }

    if (input.selectedSlot !== undefined && slotsOccupied.includes(input.selectedSlot)) {
      throw new DispatchableError("Slot is already picked by another player");
    }

    const newPlayerState = match.teams.flatMap((team) =>
      team.players.map((teamPlayer) =>
        teamPlayer.data.id === player.data.id ? newPlayerData : teamPlayer.data,
      ),
    );

    // Update the DB first; if that succeeds, update memory.
    await this.db.match.update({ where: { id: match.id }, data: { playerState: newPlayerState } });
    player.data = newPlayerData;

    if (input.selectedCO !== undefined) {
      //@ts-expect-error emit needs to be updated
      emit({
        type: "player-picked-co",
        coId: input.selectedCO,
        matchId: match.id,
        playerId: player.data.id,
      });
    }

    if (input.selectedArmy !== undefined) {
      //@ts-expect-error emit needs to be updated
      emit({
        type: "player-picked-army",
        army: input.selectedArmy,
        matchId: match.id,
        playerId: player.data.id,
      });
    }

    if (input.selectedSlot !== undefined) {
      //@ts-expect-error emit needs to be updated
      emit({
        type: "player-picked-slot",
        slot: input.selectedSlot,
        matchId: match.id,
        playerId: player.data.id,
      });
    }
  }

  adminUnwaitUnit(match: MatchWrapper, position: Position) {
    const unit = match.getUnitOrThrow(position);

    if (unit.data.isReady) {
      throw new DispatchableError("Unit is already ready (unwaited)");
    }

    unit.data.isReady = true;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /**
   * Reject a CO that isn't implemented for its game version (e.g. von-bolt only exists in AWDS). If
   * it slips through, `getCOProperties` throws deep in the engine and takes down that player's whole
   * turn snapshot. Validate at selection so the bad combo never persists.
   */
  private throwIfCOUnavailable(selectedCO: COID): void {
    try {
      getCOProperties(selectedCO);
    } catch (error) {
      logger.warn(
        `[throwIfCOUnavailable] getCOProperties failed for ${selectedCO.name}/${selectedCO.version}:`,
        error instanceof Error ? error.message : error,
      );

      throw new DispatchableError(
        `CO "${selectedCO.name}" is not available in game version ${selectedCO.version}.`,
      );
    }
  }
}
