import { getCoProfiles } from "server/adapters/game-data/game-data-cache";
import { matchesUsecase } from "server/composition-root";
import { prisma } from "server/prisma/prisma-client";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { buildCoCodex } from "./co-codex";
import { lockCoSchema, pickViewSchema } from "./schemas";

export const matchesRouter = router({
  // General reference data for the champ-select dossier (AW2 rules for now), read from DB game data.
  coCodex: publicBaseProcedure.query(async () => buildCoCodex("AW2", await getCoProfiles(prisma))),
  pickView: playerBaseProcedure
    .input(pickViewSchema)
    .query(({ input, ctx }) => matchesUsecase.pickView(input.matchId, ctx.currentPlayer.id)),
  lockCo: playerBaseProcedure
    .input(lockCoSchema)
    .mutation(({ input, ctx }) =>
      matchesUsecase.lockCo(input.matchId, ctx.currentPlayer.id, input.coId, input.skins),
    ),
});
