import { prisma } from "server/prisma/prisma-client";
import { publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { MapsUsecase } from "server/maps/maps.usecase";
import { mapSchema } from "server/maps/schemas";

const maps = new MapsUsecase(prisma);

export const mapRouter = router({
  getAll: publicBaseProcedure.query(() => maps.listMaps()),
  save: publicBaseProcedure.input(mapSchema).mutation(({ input }) => maps.createMap(input)),
});
