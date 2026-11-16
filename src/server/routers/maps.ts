import { publicBaseProcedure, router } from "server/trpc/trpc-setup";
import type { MapsUsecase } from "server/maps/maps.usecase";
import { mapFilterSchema, mapSchema } from "server/maps/schemas";

/** Transport for the `maps` feature; the usecase arrives from the composition root. */
export const makeMapRouter = (maps: MapsUsecase) =>
  router({
    /** The map library. `input` is optional so existing callers keep working unfiltered. */
    getAll: publicBaseProcedure
      .input(mapFilterSchema.optional())
      .query(({ input }) => maps.listMaps(input)),
    save: publicBaseProcedure.input(mapSchema).mutation(({ input }) => maps.createMap(input)),
  });
