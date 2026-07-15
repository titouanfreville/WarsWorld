import { matchStore } from "server/match-store";
import { prisma } from "server/prisma/prisma-client";
import { mapMiddleware } from "server/trpc/middleware/map";
import { playerBaseProcedure } from "server/trpc/trpc-setup";
import { INITIAL_FUNDS } from "server/engine/constants/funds";
import { matchRulesSchema } from "server/core/schemas/match-rules";
import { z } from "zod";
import { matchToFrontend } from "server/matches/lifecycle-helpers";

export const createMatchProcedure = playerBaseProcedure
  .input(
    z.object({
      rules: matchRulesSchema,
      mapId: z.string(),
    }),
  )
  .use(mapMiddleware)
  .mutation(async ({ input, ctx }) => {
    const matchOnDB = await prisma.match.create({
      data: {
        status: "setup",
        // v1 create path: always a standard duel. The lobby path (v2) carries real values through.
        mode: "duel",
        ruleset: "standard",
        playerState: [
          {
            slot: 0,
            hasCurrentTurn: true,
            id: ctx.currentPlayer.id,
            name: ctx.currentPlayer.name,
            ready: false,
            coId: {
              name: "andy",
              version: "AW2",
            },
            status: "alive",
            // Players start at zero; income is granted per turn (day 1 in applyMatchStartEvent).
            funds: INITIAL_FUNDS,
            powerMeter: 0,
            timesPowerUsed: 0,
            army: "orange-star",
            COPowerState: "no-power",
          },
        ],
        map: {
          connect: {
            id: ctx.map.id,
          },
        },
        rules: input.rules,
      },
    });

    const match = matchStore.createMatchAndIndex(matchOnDB, ctx.map);
    return matchToFrontend(match);
  });
