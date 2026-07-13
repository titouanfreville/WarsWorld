import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { EndgameUsecase } from "./endgame.usecase";
import { endgameChatHeartbeatSchema, endgameSummarySchema } from "./schemas";

const endgameUsecase = new EndgameUsecase(prisma);

export const endgameRouter = router({
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
