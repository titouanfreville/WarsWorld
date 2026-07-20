import { adminToolsUsecase } from "server/composition-root";
import { adminActionSchema } from "server/core/schemas/admin-action";
import { adminMatchBaseProcedure, matchBaseProcedure, router } from "server/trpc/trpc-setup";
import { can } from "server/auth/capabilities";

/**
 * In-match admin transport: validate → call the usecase → return. No logic here.
 *
 * `adminMatchBaseProcedure` carries the `adminTools` capability — a separate gate from the dev
 * tools', so no `dev`/`tester` can decide a match.
 */
export const adminToolsRouter = router({
  /**
   * "May I use admin match tools here?" — on `matchBaseProcedure` so an ordinary player gets a plain
   * `false` rather than a 403 on every board load, exactly as with the dev-tools query.
   */
  availability: matchBaseProcedure.query(async ({ ctx }) => {
    if (!can(ctx.user.roles, "adminTools")) {
      return { enabled: false, myTeamIndex: null, teamIndexes: [] };
    }

    return adminToolsUsecase.getAvailability(ctx.match, ctx.currentPlayer.id);
  }),

  send: adminMatchBaseProcedure.input(adminActionSchema).mutation(({ input, ctx }) =>
    adminToolsUsecase.execute(ctx.match, input, {
      userId: ctx.user.id,
      playerId: ctx.currentPlayer.id,
      displayName: ctx.currentPlayer.displayName,
      roles: ctx.user.roles,
      ip: ctx.req?.socket.remoteAddress ?? undefined,
      userAgent: ctx.req?.headers["user-agent"] ?? undefined,
    }),
  ),
});
