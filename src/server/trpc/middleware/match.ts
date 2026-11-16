import { TRPCError } from "@trpc/server";
import { withMatchIdSchema } from "server/core/schemas/match-id";
import { t } from "../trpc-init";
import { matchStore } from "server/match-store";

export const matchMiddleware = t.middleware(async ({ ctx, input, next }) => {
  const parseResult = withMatchIdSchema.safeParse(input);

  if (!parseResult.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No matchId specified",
    });
  }

  const { matchId } = parseResult.data;

  const match = matchStore.get(matchId);

  if (match === undefined) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Match with id ${matchId} not found`,
    });
  }

  return next({
    ctx: {
      ...ctx,
      match,
    },
  });
});
