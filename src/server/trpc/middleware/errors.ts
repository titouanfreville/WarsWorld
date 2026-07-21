import { TRPCError } from "@trpc/server";
import { EventLogConflictError } from "server/adapters/event-log";
import { DispatchableError } from "server/engine/dispatchable-error";
import { logger } from "shared/utils/logger";
import { t } from "../trpc-init";

/**
 * The one place a typed domain error becomes a `TRPCError`.
 *
 * `src/server/CLAUDE.md` §Errors says the domain throws a typed error and transport maps it — but
 * nothing was doing the mapping. `DispatchableError` exists precisely so its message may reach the
 * client, and `EventLogConflictError`'s own docstring promises "transport maps this to a conflict,
 * not a 500"; both were falling through to tRPC's default handling, which reports an unrecognised
 * throw as INTERNAL_SERVER_ERROR and (in production) discards the message. Every "It's not your
 * turn" was a 500 with no explanation.
 *
 * Sitting in a middleware rather than in each procedure is deliberate: these two classes are
 * cross-cutting — any procedure that touches a match can raise either — and CLAUDE.md's "each
 * procedure owns the errors it can classify" is about errors a *specific* procedure can name, not
 * about re-implementing the same two mappings forty times.
 */
export const errorMappingMiddleware = t.middleware(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    // Already classified by the procedure that threw it — don't second-guess a deliberate code.
    if (error instanceof TRPCError) {
      throw error;
    }

    // Two writers touched one match and the event log's composite key rejected the loser. Nothing
    // about the request was illegal, so this is a CONFLICT the client may retry — not a bug report.
    if (error instanceof EventLogConflictError) {
      logger.warn(`[event-log] append conflict on match ${error.matchId}`);

      throw new TRPCError({
        code: "CONFLICT",
        message: "That match moved on while your action was in flight. Try again.",
        cause: error,
      });
    }

    // An expected, classifiable domain refusal: illegal move, not your turn, not in this match.
    if (error instanceof DispatchableError) {
      throw new TRPCError({ code: "BAD_REQUEST", message: error.message, cause: error });
    }

    throw error;
  }
});
