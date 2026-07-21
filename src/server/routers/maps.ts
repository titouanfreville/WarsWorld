import { prisma } from "server/prisma/prisma-client";
import { publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { MapsUsecase } from "server/maps/maps.usecase";
import { mapFilterSchema, mapSchema } from "server/maps/schemas";

const maps = new MapsUsecase(prisma);

export const mapRouter = router({
  /** The map library. `input` is optional so existing callers keep working unfiltered. */
  getAll: publicBaseProcedure
    .input(mapFilterSchema.optional())
    .query(({ input }) => maps.listMaps(input)),
  save: publicBaseProcedure.input(mapSchema).mutation(({ input }) => maps.createMap(input)),
});
