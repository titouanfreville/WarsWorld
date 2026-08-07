import { mapsUsecase } from "server/composition-root";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import {
  draftMapSchema,
  mapFilterSchema,
  mapIdSchema,
  mapSchema,
  resizeMapSchema,
  startDraftSchema,
  updateDraftSchema,
} from "server/maps/schemas";

export const mapRouter = router({
  /** The map library. `input` is optional so existing callers keep working unfiltered. */
  getAll: publicBaseProcedure
    .input(mapFilterSchema.optional())
    .query(({ input }) => mapsUsecase.listMaps(input)),

  /**
   * Writing a map requires an account.
   *
   * This was `publicBaseProcedure`, which made map creation an unauthenticated write — anyone who
   * could reach the endpoint could insert rows into the library that the lobby and matchmaking then
   * offer to real players. It is a hole today and an open door once the builder ships, so the guard
   * comes first and independently of the rest of the feature.
   */
  save: playerBaseProcedure.input(mapSchema).mutation(({ input }) => mapsUsecase.createMap(input)),

  /**
   * Is this map playable, and is it fair? Stateless — it rules on a candidate that need not exist
   * in the database yet, which is what lets the builder show a live verdict while you paint.
   *
   * A `mutation` even though it writes nothing, because it is the only shape that works: tRPC
   * serialises query input into the URL, and a 40x40 grid is far past what a URL can carry. This
   * one has to travel in a POST body.
   *
   * The client debounces it; see `useMapDraft`. Authenticated because it is a compute endpoint:
   * each call runs several floods over the grid.
   */
  evaluate: playerBaseProcedure
    .input(draftMapSchema)
    .mutation(({ input }) => mapsUsecase.evaluate(input)),

  /**
   * Everything the builder needs to know about the game: the terrain and property rosters, which
   * tiles join to which, every placeable unit with its stats and the tiles it may start on, and
   * what a blank cell is.
   *
   * Served rather than hardcoded in the client. The frontend is not allowed to embed game constants
   * (`src/frontend/CLAUDE.md`), and a client-side copy of any of this would drift the moment a tile
   * or unit was added. Static per deploy, so it caches hard.
   */
  vocabulary: publicBaseProcedure.query(() => mapsUsecase.vocabulary()),

  /** Open the builder. Creates the draft row up front so autosave is only ever an update. */
  startDraft: playerBaseProcedure
    .input(startDraftSchema)
    .mutation(({ ctx, input }) => mapsUsecase.startDraft(ctx.currentPlayer.id, input)),

  /** One autosave. Conditional on `seenAt`, and returns the fresh verdict. */
  updateDraft: playerBaseProcedure
    .input(updateDraftSchema)
    .mutation(({ ctx, input }) => mapsUsecase.updateDraft(ctx.currentPlayer.id, input)),

  /** Reshape a map. Destructive downward, so the builder confirms before calling it. */
  resize: playerBaseProcedure
    .input(resizeMapSchema)
    .mutation(({ ctx, input }) => mapsUsecase.resize(ctx.currentPlayer.id, input)),

  /** Into the public library. Re-evaluated server-side; refuses an unplayable map. */
  publish: playerBaseProcedure
    .input(mapIdSchema)
    .mutation(({ ctx, input }) => mapsUsecase.publish(ctx.currentPlayer.id, input.mapId)),

  /** Into the ranked review queue. Re-evaluated server-side; refuses an uneven map. */
  submitForRanked: playerBaseProcedure
    .input(mapIdSchema)
    .mutation(({ ctx, input }) => mapsUsecase.submitForRanked(ctx.currentPlayer.id, input.mapId)),

  /** The caller's own maps, drafts included — the "come back to it later" list. */
  listMine: playerBaseProcedure.query(({ ctx }) => mapsUsecase.listMine(ctx.currentPlayer.id)),

  /** One of the caller's own maps, loaded into the builder. */
  getForEdit: playerBaseProcedure
    .input(mapIdSchema)
    .query(({ ctx, input }) => mapsUsecase.getForEdit(ctx.currentPlayer.id, input.mapId)),
});
