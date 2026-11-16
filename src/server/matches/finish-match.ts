import type { Prisma } from "@prisma/client";
import type { MatchWrapper } from "server/engine/entities/match";
import type { FinalizeResult } from "server/engine/previews/finalize";
import { emit } from "server/emitter/event-emitter";

/**
 * Persisting + announcing a finished match, shared by every path that can end one: a natural ending
 * from `action.send`, and an admin's forced outcome.
 *
 * Extracted rather than copied because the two must not drift. The write here is not one row — it's
 * the v1 `playerState` blob, the v2 relational `MatchPlayer.result`, the ranking update and the
 * battle report, and a forced ending that skipped any of them would leave a match that reads as
 * finished on one screen and unfinished on another.
 */

/** The cross-feature bits a finished match has to notify. Passed in so this imports no usecase. */
export type FinishMatchDeps = {
  /** Ranked MMR off the results just stamped. Self-guards on `isRanked`/`ratedAt`. */
  applyMatchResult: (tx: Prisma.TransactionClient, matchId: string) => Promise<unknown>;
  /** Battle-report headline + duration. Self-guards on `statsAt`. Reads the event, hence same-tx. */
  persistStats: (tx: Prisma.TransactionClient, matchId: string) => Promise<unknown>;
};

/**
 * Write the outcome. MUST run in the same transaction as the event that caused it: finished matches
 * are archived out of the hot store on reboot (rebuild skips `finished`), so the DB is their only
 * record — a crash between the two writes would strand a decided match as "playing" forever.
 */
export const persistFinishedMatch = async (
  tx: Prisma.TransactionClient,
  match: MatchWrapper,
  finished: FinalizeResult,
  deps: FinishMatchDeps,
): Promise<void> => {
  await tx.match.update({
    where: { id: match.id },
    data: {
      status: "finished",
      winnerTeamIndex: finished.winnerTeamIndex,
      // HOW it ended, alongside who won: a draw on the day limit and a draw by mutual elimination
      // are the same `winnerTeamIndex: null` row otherwise, and the history screen can't tell the
      // player which one they just played.
      endReason: finished.reason,
      finishedAt: new Date(),
      playerState: match.getAllPlayers().map((player) => player.data),
    },
  });

  // v2 relational store: stamp result per seat. `updateMany` (keyed by matchId+playerId) is a no-op
  // for v1 matches, which have no MatchPlayer rows — so this is safe on both paths.
  await Promise.all(
    match.getAllPlayers().map((player) =>
      tx.matchPlayer.updateMany({
        where: { matchId: match.id, playerId: player.data.id },
        data: { result: player.data.result ?? null },
      }),
    ),
  );

  await deps.applyMatchResult(tx, match.id);
  await deps.persistStats(tx, match.id);
};

/**
 * Push the live `matchEnd` so open boards flip to their result screen without a refetch.
 *
 * Call AFTER the outcome is durably committed — announcing a result that a failed transaction then
 * rolled back would leave every client showing a game-over for a match still in progress.
 */
export const emitMatchEnd = (match: MatchWrapper, finished: FinalizeResult): void => {
  const winningTeamPlayerIds =
    finished.winnerTeamIndex === null
      ? null
      : (match.teams
          .find((team) => team.index === finished.winnerTeamIndex)
          ?.players.map((player) => player.data.id) ?? null);

  match.getAllPlayers().forEach((player) => {
    emit(player.data.id, {
      type: "matchEnd",
      winningTeamPlayerIds,
      teamIndex: player.team.index,
      matchId: match.id,
    });
  });
};
