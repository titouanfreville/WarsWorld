import { publicBaseProcedure, playerBaseProcedure, router } from "server/trpc/trpc-setup";
import { z } from "zod";
import type { RankingUsecase } from "server/ranking/ranking.usecase";

/**
 * The `ranking` feature's transport. It lives out here, not in the feature, so the feature carries
 * no tRPC import at all and stays callable from anything — a worker, a script, a test.
 *
 * Takes its usecase as an argument instead of importing a ready-made one: a router that reaches out
 * for its own dependency is a service locator wearing an import statement, and it can't be mounted
 * twice or tested without a live Prisma client. The composition root passes the instance in.
 */
export const makeRankingRouter = (rankingUsecase: RankingUsecase) =>
  router({
    /**
     * The ladder definition — code, label, emblem, order, active, hasDivisions.
     *
     * The client renders rank badges from THIS, never from a local copy of the ladder: duplicating
     * labels/emblems on the FE means a reseed silently disagrees with what players see. Public because
     * a rank badge shows on profiles and match cards to signed-out visitors too.
     */
    ranks: publicBaseProcedure.query(() => rankingUsecase.listRanks()),

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
