import { rankingUsecase } from "server/composition-root";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";
import { z } from "zod";

export const rankingRouter = router({
  /**
   * The current player's ladder — one entry per mode: rank, division, Military Merit, and whether
   * they're still in placements.
   *
   * This is the ONLY ranked read the client gets. The hidden OpenSkill rating (μ/σ) is deliberately
   * absent: no router selects from `PlayerSkill`, because a number players can see is a number they
   * play instead of the game. Replaced `myRatings`, which exposed the raw Elo number.
   */
  myRank: playerBaseProcedure.query(({ ctx }) => rankingUsecase.getLadder(ctx.currentPlayer.id)),

  /**
   * The viewer's Merit movement from one match, for the End-Game screen: `{ delta, rank, division,
   * inPlacements, games }`, or null for a casual/unranked match. Viewer-scoped off `ctx` — a player
   * only reads their own progression.
   */
  matchOutcome: playerBaseProcedure
    .input(z.object({ matchId: z.string() }))
    .query(({ ctx, input }) => rankingUsecase.matchOutcome(ctx.currentPlayer.id, input.matchId)),
});
