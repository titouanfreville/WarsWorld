import { publicBaseProcedure, router } from "server/trpc/trpc-setup";
import type { MapsUsecase } from "server/maps/maps.usecase";
import { mapSchema } from "server/maps/schemas";

/** See `makeRankingRouter` — transport lives out here, and the usecase arrives already built. */
export const makeMapRouter = (maps: MapsUsecase) =>
  router({
    getAll: publicBaseProcedure.query(() => maps.listMaps()),
    save: publicBaseProcedure.input(mapSchema).mutation(({ input }) => maps.createMap(input)),
  });
