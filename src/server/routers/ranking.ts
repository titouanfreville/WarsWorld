import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";

export const rankingRouter = router({
  /** Every league rating the current player holds, for profile / matchmaking display. */
  myRatings: playerBaseProcedure.query(({ ctx }) =>
    prisma.mMR.findMany({
      where: { playerId: ctx.currentPlayer.id },
      select: { leagueType: true, mmr: true, topMmr: true },
    }),
  ),
});
