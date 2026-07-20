import { TRPCError } from "@trpc/server";
import { t } from "../trpc-init";
import { can, type Capability } from "server/auth/capabilities";

/**
 * Requires an authenticated user and exposes their roles.
 *
 * This previously passed `ctx.session?.user` through unconditionally, under a "big security gap"
 * TODO. That was survivable only because nothing ever read the user's role. Privileged tools read it
 * now, so the pass-through is gone: anonymous callers are rejected here rather than deeper in.
 *
 * `roles` comes from the session, populated from the DB by the `jwt`/`session` callbacks — never
 * from client input.
 */
export const authMiddleware = t.middleware(({ next, ctx }) => {
  const user = ctx.session?.user;

  if (user?.name == undefined) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({
    ctx: {
      user: {
        ...user,
        name: user.name,
        roles: user.roles ?? [],
      },
    },
  });
});

/**
 * Exposes the session user WITHOUT requiring one — for endpoints whose job is to answer "who am I,
 * if anyone", where "nobody" is a valid answer rather than an error.
 *
 * `user.me` is the only such endpoint: the client calls it before it can possibly know whether it's
 * logged in, and `ProvidePlayers` reads `data.user` to pick the active player. Making it throw for an
 * anonymous caller (as `authMiddleware` does) doesn't secure anything — the caller learns nothing
 * they didn't already have — it just turns "logged out" into a failed query, which leaves the client
 * with no player selected at all: no player name, no match history, and no playerId to start a game.
 *
 * This grants NO access: it exposes the caller's own session back to them and nothing else. Owned
 * players still come from `playerWithoutCurrentMiddleware`, which matches on the session's user name
 * and returns `[]` when there isn't one.
 */
export const optionalAuthMiddleware = t.middleware(({ next, ctx }) => {
  const user = ctx.session?.user;

  return next({
    ctx: {
      user: user === undefined ? undefined : { ...user, roles: user.roles ?? [] },
    },
  });
});

/**
 * Gates a procedure on a capability.
 *
 * Reads roles off the session rather than off `ctx.user`, so it stands on its own instead of
 * silently depending on `authMiddleware` having run first: no session means no roles means denied.
 * It is the same source `authMiddleware` reads, so the two can never disagree.
 *
 * FORBIDDEN rather than NOT_FOUND: these endpoints aren't secret, and a truthful 403 is easier to
 * debug than a fake 404 for tooling only staff can reach.
 */
export const requireCapability = (capability: Capability) =>
  t.middleware(({ next, ctx }) => {
    if (!can(ctx.session?.user?.roles ?? [], capability)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `This action requires the ${capability} capability.`,
      });
    }

    return next({ ctx });
  });
