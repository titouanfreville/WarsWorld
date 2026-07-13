import { observable } from "@trpc/server/observable";
import { subscribeQueue, type QueueEvent } from "server/emitter/matchmaking-emitter";
import { matchesUsecase } from "server/matches/router";
import { prisma } from "server/prisma/prisma-client";
import { rankingUsecase } from "server/ranking/router";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";
import { MatchmakingUsecase } from "./matchmaking.usecase";
import { joinQueueSchema, mapActionSchema, withLobbyIdSchema } from "./schemas";

/** Composition root for matchmaking; the WS entrypoints import this to start the tick + reschedule. */
export const matchmakingUsecase = new MatchmakingUsecase(prisma, rankingUsecase, matchesUsecase);

export const matchmakingRouter = router({
  join: playerBaseProcedure
    .input(joinQueueSchema)
    .mutation(({ input, ctx }) => matchmakingUsecase.joinQueue(ctx.currentPlayer.id, input)),
  leave: playerBaseProcedure.mutation(({ ctx }) =>
    matchmakingUsecase.leaveQueue(ctx.currentPlayer.id),
  ),
  status: playerBaseProcedure.query(({ ctx }) => matchmakingUsecase.status(ctx.currentPlayer.id)),

  // The per-player pre-lobby channel. Its teardown leaves the queue, so closing the tab / unmounting
  // the global widget removes the player — but page-to-page navigation keeps `_app` (and this
  // subscription) mounted, so browsing while queued does not.
  onQueueEvent: playerBaseProcedure.subscription(({ ctx }) =>
    observable<QueueEvent>((emit) => {
      const unsubscribe = subscribeQueue(ctx.currentPlayer.id, emit.next);

      return () => {
        matchmakingUsecase.leaveQueue(ctx.currentPlayer.id);
        unsubscribe();
      };
    }),
  ),

  acceptReadyCheck: playerBaseProcedure
    .input(withLobbyIdSchema)
    .mutation(({ input, ctx }) =>
      matchmakingUsecase.acceptReadyCheck(input.lobbyId, ctx.currentPlayer.id),
    ),
  declineReadyCheck: playerBaseProcedure
    .input(withLobbyIdSchema)
    .mutation(({ input, ctx }) =>
      matchmakingUsecase.declineReadyCheck(input.lobbyId, ctx.currentPlayer.id),
    ),

  banMap: playerBaseProcedure
    .input(mapActionSchema)
    .mutation(({ input, ctx }) =>
      matchmakingUsecase.banMap(input.lobbyId, ctx.currentPlayer.id, input.mapId),
    ),
  voteMap: playerBaseProcedure
    .input(mapActionSchema)
    .mutation(({ input, ctx }) =>
      matchmakingUsecase.voteMap(input.lobbyId, ctx.currentPlayer.id, input.mapId),
    ),
  mapBanView: playerBaseProcedure
    .input(withLobbyIdSchema)
    .query(({ input }) => matchmakingUsecase.mapBanView(input.lobbyId)),
});
