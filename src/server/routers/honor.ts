import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import type { HonorUsecase } from "server/honor/honor.usecase";
import { awardMedalSchema, honorStandingSchema, myAwardSchema } from "server/honor/schemas";

/** Transport for the `honor` feature; the usecase arrives from the composition root. */
export const makeHonorRouter = (honorUsecase: HonorUsecase) =>
  router({
    // A player's medals + prestige — public (standings appear on profiles / lobby / champ-select).
    standing: publicBaseProcedure
      .input(honorStandingSchema)
      .query(({ input }) => honorUsecase.standing(input.playerId)),

    // What the logged-in player already awarded in a match (or null). Viewer-scoped off ctx.
    myAward: playerBaseProcedure
      .input(myAwardSchema)
      .query(({ ctx, input }) => honorUsecase.myAward(ctx.currentPlayer.id, input.matchId)),

    // Award a medal to an opponent. The giver is the logged-in player; the usecase enforces the rules.
    award: playerBaseProcedure
      .input(awardMedalSchema)
      .mutation(({ input, ctx }) =>
        honorUsecase.awardMedal(ctx.currentPlayer.id, input.matchId, input.toPlayerId, input.medal),
      ),
  });
