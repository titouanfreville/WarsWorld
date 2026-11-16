import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import type { EndgameUsecase } from "server/endgame/endgame.usecase";
import { endgameChatHeartbeatSchema, endgameSummarySchema } from "server/endgame/schemas";

/** Transport for the `endgame` feature; the usecase arrives from the composition root. */
export const makeEndgameRouter = (endgameUsecase: EndgameUsecase) =>
  router({
    // Read-only battle report — usable for a finished match's End-Game screen or its history entry.
    // Public: post-game stats aren't secret, and it must work after the match leaves the live store.
    summary: publicBaseProcedure
      .input(endgameSummarySchema)
      .query(({ input }) => endgameUsecase.summary(input.matchId)),

    // Post-game chat presence heartbeat — keeps the match conversation's write window open (FR7).
    chatHeartbeat: playerBaseProcedure
      .input(endgameChatHeartbeatSchema)
      .mutation(({ ctx, input }) =>
        endgameUsecase.chatHeartbeat(input.matchId, ctx.currentPlayer.id),
      ),
  });
