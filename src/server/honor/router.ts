import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { HonorUsecase } from "./honor.usecase";
import { awardMedalSchema, honorStandingSchema } from "./schemas";

const honorUsecase = new HonorUsecase(prisma);

export const honorRouter = router({
  // A player's medals + prestige — public (standings appear on profiles / lobby / champ-select).
  standing: publicBaseProcedure
    .input(honorStandingSchema)
    .query(({ input }) => honorUsecase.standing(input.playerId)),

  // Award a medal to an opponent. The giver is the logged-in player; the usecase enforces the rules.
  award: playerBaseProcedure
    .input(awardMedalSchema)
    .mutation(({ input, ctx }) =>
      honorUsecase.awardMedal(ctx.currentPlayer.id, input.matchId, input.toPlayerId, input.medal),
    ),
});
