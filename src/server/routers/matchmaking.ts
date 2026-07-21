import { observable } from "@trpc/server/observable";
import { matchmakingUsecase } from "server/composition-root";
import { subscribeQueue, type QueueEvent } from "server/emitter/matchmaking-emitter";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";
import { joinQueueSchema, mapActionSchema, withLobbyIdSchema } from "server/matchmaking/schemas";

export const matchmakingRouter = router({
  join: playerBaseProcedure
    .input(joinQueueSchema)
    .mutation(({ input, ctx }) => matchmakingUsecase.joinQueue(ctx.currentPlayer.id, input)),
  leave: playerBaseProcedure.mutation(({ ctx }) =>
    matchmakingUsecase.leaveQueue(ctx.currentPlayer.id),
  ),
  status: playerBaseProcedure.query(({ ctx }) => matchmakingUsecase.status(ctx.currentPlayer.id)),

  // Pre-flight for the Play page: is a ranked queue currently allowed? Lets the ranked cards disable
  // themselves before the click. The join guard re-checks server-side, so this is a hint, not a gate.
  eligibility: playerBaseProcedure.query(({ ctx }) =>
    matchmakingUsecase.eligibility(ctx.currentPlayer.id),
  ),

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
  // The viewer is taken from the session, never from the input: it decides whose bans and votes are
  // unmasked, so a client must not be able to name someone else.
  mapBanView: playerBaseProcedure
    .input(withLobbyIdSchema)
    .query(({ input, ctx }) => matchmakingUsecase.mapBanView(input.lobbyId, ctx.currentPlayer.id)),
});
