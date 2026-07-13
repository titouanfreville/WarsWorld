import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";
import { RankingUsecase } from "./ranking.usecase";

/**
 * Shared instance (the composition root for ranking). The finalize transaction and the matchmaker
 * both import this so ratings read/write through one usecase — mirrors how `lobby` imports
 * `matchesUsecase` from `server/matches/router`.
 */
export const rankingUsecase = new RankingUsecase(prisma);

export const rankingRouter = router({
  /** Every league rating the current player holds, for profile / matchmaking display. */
  myRatings: playerBaseProcedure.query(({ ctx }) =>
    prisma.mMR.findMany({
      where: { playerId: ctx.currentPlayer.id },
      select: { leagueType: true, mmr: true, topMmr: true },
    }),
  ),
});
