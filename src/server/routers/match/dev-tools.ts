import { devToolsUsecase } from "server/composition-root";
import { devActionSchema } from "server/core/schemas/dev-action";
import { devToolsBaseProcedure, matchBaseProcedure, router } from "server/trpc/trpc-setup";

/**
 * Dev-tool transport: validate → call the usecase → return. No logic here.
 *
 * `devToolsBaseProcedure` carries the `devTools` capability check and, crucially, is built on
 * `matchBaseProcedure` rather than `playerInMatchBaseProcedure` — a tool confined to your own turn
 * would be useless for staging a scenario.
 */
export const devToolsRouter = router({
  /**
   * "May I use dev tools here?" — the HUD asks before offering the DEV entry.
   *
   * On `matchBaseProcedure`, NOT `devToolsBaseProcedure`: an ordinary player must get a plain
   * `false`, not a 403. Gating this one would make every normal player's board log an auth error.
   */
  availability: matchBaseProcedure.query(({ ctx }) =>
    devToolsUsecase.getAvailability(ctx.match, ctx.user.roles, ctx.currentPlayer.id),
  ),

  send: devToolsBaseProcedure.input(devActionSchema).mutation(({ input, ctx }) =>
    devToolsUsecase.execute(ctx.match, input, {
      userId: ctx.user.id,
      playerId: ctx.currentPlayer.id,
      displayName: ctx.currentPlayer.displayName,
      roles: ctx.user.roles,
      ip: ctx.req?.socket.remoteAddress ?? undefined,
      userAgent: ctx.req?.headers["user-agent"] ?? undefined,
    }),
  ),
});
