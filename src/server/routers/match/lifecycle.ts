import { z } from "zod";
import { matchLifecycleUsecase } from "server/composition-root";
import { armySchema } from "server/core/schemas/army";
import { coIdSchema } from "server/core/schemas/co";
import { playerSlotForUnitsSchema } from "server/core/schemas/player-slot";
import { positionSchema } from "server/core/schemas/position";
import { buildMatchFullView } from "server/engine/previews/match-view";
import {
  adminMatchBaseProcedure,
  matchBaseProcedure,
  playerBaseProcedure,
  playerInMatchBaseProcedure,
  publicBaseProcedure,
  router,
} from "server/trpc/trpc-setup";
import { createMatchProcedure } from "./create";

/** Custom-match lifecycle transport: validate → call matchLifecycleUsecase → return. No logic here. */
export const lifecycleRouter = router({
  create: createMatchProcedure,

  getAll: publicBaseProcedure
    .input(z.object({ pageNumber: z.number().int().nonnegative() }))
    .query(({ input }) => matchLifecycleUsecase.listPage(input.pageNumber)),

  getPlayerMatches: playerBaseProcedure.query(({ ctx }) =>
    matchLifecycleUsecase.listPlayerMatches(ctx.currentPlayer.id),
  ),

  getPlayerFinishedMatches: playerBaseProcedure.query(({ ctx }) =>
    matchLifecycleUsecase.listPlayerFinishedMatches(ctx.currentPlayer.id),
  ),

  full: matchBaseProcedure.query(({ ctx: { match, currentPlayer } }) =>
    buildMatchFullView(match, currentPlayer.id),
  ),

  join: matchBaseProcedure
    .input(
      z.object({
        selectedCO: coIdSchema,
        playerSlot: z.number().int().nonnegative().nullable(),
      }),
    )
    .mutation(({ input, ctx: { currentPlayer, match } }) =>
      matchLifecycleUsecase.join(match, currentPlayer, input.selectedCO, input.playerSlot),
    ),

  leave: playerInMatchBaseProcedure.mutation(({ ctx: { match, player } }) =>
    matchLifecycleUsecase.leave(match, player),
  ),

  setReady: playerInMatchBaseProcedure
    .input(z.object({ readyState: z.boolean() }))
    .mutation(({ input, ctx: { match, player } }) =>
      matchLifecycleUsecase.setReady(match, player, input.readyState),
    ),

  switchOptions: playerInMatchBaseProcedure
    .input(
      z.object({
        selectedCO: coIdSchema.optional(),
        selectedArmy: armySchema.optional(),
        selectedSlot: playerSlotForUnitsSchema.optional(),
      }),
    )
    .mutation(({ input, ctx: { match, player } }) =>
      matchLifecycleUsecase.switchOptions(match, player, input),
    ),

  /** Was named "admin" but ran on `matchBaseProcedure` — any player in the match could call it. */
  adminUnwaitUnit: adminMatchBaseProcedure
    .input(z.object({ position: positionSchema }))
    .mutation(({ input, ctx }) => matchLifecycleUsecase.adminUnwaitUnit(ctx.match, input.position)),
});
