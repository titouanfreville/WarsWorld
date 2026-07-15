import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";

export const rankingRouter = router({
  /**
   * Every rating the current player holds — one per mode, pooled across rulesets.
   *
   * This exposes the raw number today. Once the Merit ladder lands (plan phase 5) the hidden rating
   * stops leaving the server entirely and this becomes `ranking.myRank` (rank + division + Merit):
   * a number players can see is a number they play instead of the game.
   */
  myRatings: playerBaseProcedure.query(({ ctx }) =>
    prisma.mMR.findMany({
      where: { playerId: ctx.currentPlayer.id },
      select: { mode: true, mmr: true, topMmr: true },
    }),
  ),
});
