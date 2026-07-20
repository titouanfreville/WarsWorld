import { z } from "zod";
import { adminUsecase } from "server/composition-root";
import { adminBaseProcedure, router } from "server/trpc/trpc-setup";

/**
 * Global (out-of-match) admin transport. Every procedure is on `adminBaseProcedure`, so the
 * `adminTools` capability is enforced before any of this runs — a dev/tester can't reach it.
 *
 * Thin: validate → call the usecase → return. The acting admin's identity (`user.id` for the audit,
 * `currentPlayer.id` + request origin) is read off the context, never trusted from input.
 */

/** The meaningful, settable ranks — cadet is placements (not a real rank), so it's not offered. */
const settableRankSchema = z.enum(["private", "lieutenant", "captain", "marechal"]);
const gameModeSchema = z.enum(["duel", "teams", "ffa"]);

const actorFromCtx = (ctx: {
  user: { id: string };
  currentPlayer: { id: string };
  req?: { socket: { remoteAddress?: string }; headers: { "user-agent"?: string } };
}) => ({
  userId: ctx.user.id,
  playerId: ctx.currentPlayer.id,
  ip: ctx.req?.socket.remoteAddress ?? undefined,
  userAgent: ctx.req?.headers["user-agent"] ?? undefined,
});

export const adminRouter = router({
  searchPlayers: adminBaseProcedure
    .input(z.object({ query: z.string() }))
    .query(({ input }) => adminUsecase.searchPlayers(input.query)),

  forceMatch: adminBaseProcedure
    .input(
      z.object({
        playerAId: z.string().min(1),
        playerBId: z.string().min(1),
        // Optional: the admin picks the map in the setup panel for a custom (non-queue) match.
        mapId: z.string().min(1).optional(),
      }),
    )
    .mutation(({ input, ctx }) =>
      adminUsecase.forceMatch({
        playerAId: input.playerAId,
        playerBId: input.playerBId,
        mapId: input.mapId,
        actor: actorFromCtx(ctx),
      }),
    ),

  modifyRank: adminBaseProcedure
    .input(
      z.object({
        // NOT `playerId` — the base procedure already claims that field for the ACTING admin. This
        // is the player whose rank is being changed.
        targetPlayerId: z.string().min(1),
        mode: gameModeSchema,
        rank: settableRankSchema,
        // 5 (lowest) … 1 (highest); ignored for marechal (no divisions).
        division: z.number().int().min(1).max(5),
      }),
    )
    .mutation(({ input, ctx }) =>
      adminUsecase.modifyRank({
        playerId: input.targetPlayerId,
        mode: input.mode,
        rank: input.rank,
        division: input.division,
        actor: actorFromCtx(ctx),
      }),
    ),
});
