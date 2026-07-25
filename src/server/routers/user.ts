import { TRPCError } from "@trpc/server";
import { Prisma } from "@prisma/client";
import { hashPassword } from "server/hashPassword";
import { prisma } from "server/prisma/prisma-client";
import { optionalAuthMiddleware } from "server/trpc/middleware/auth";
import { playerWithoutCurrentMiddleware } from "server/trpc/middleware/player";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { signUpSchema } from "server/auth/schemas";
import { clientIp } from "server/auth/client-ip";
import { RateLimiter } from "server/auth/throttle";
import { signUpThrottle } from "server/auth/throttle.dbo";
import { preferencesSchema } from "server/players/schemas";

/**
 * Burst guard on sign-up: more than 3 attempts per IP per minute fails — the same ceiling as
 * sign-in, since nobody registers accounts faster than that legitimately either.
 */
const signUpLimiter = new RateLimiter(3, 60_000);

export const userRouter = router({
  /**
   * "Who am I?" — must stay callable ANONYMOUSLY, answering `user: undefined` rather than throwing.
   * The client calls it before it can know whether it's logged in, and `ProvidePlayers` only selects
   * a player when `data.user` is present, so a 401 here costs the user their player selection
   * entirely: no name, no history, no playerId to start a game.
   */
  me: publicBaseProcedure
    .use(optionalAuthMiddleware)
    .use(playerWithoutCurrentMiddleware)
    .query(({ ctx }) => {
      return {
        user: ctx.user,
        ownedPlayers: ctx.ownedPlayers,
      };
    }), // TODO session exposed in FE dangerous? 😳
  updatePreferences: playerBaseProcedure.input(preferencesSchema).mutation(
    async ({ input, ctx }) =>
      await prisma.player.update({
        data: {
          preferences: input,
        },
        where: {
          id: ctx.currentPlayer.id,
        },
      }),
  ),
  /*
   * REMOVED: `findFirstUserByName`.
   *
   * It was a PUBLIC procedure returning the raw `User` row with no `select`, so any anonymous
   * caller could ask for a username and get back that account's bcrypt hash, email, roles and
   * state — username enumeration plus a hash to crack offline. It had no callers anywhere.
   *
   * Public information about a user belongs to the `players` feature, which already projects
   * exactly that and nothing else: `player.profile` (handle, display name, avatar, real name,
   * favourite CO), `player.stats`, `player.cards`. Add fields there, never by widening a `User`
   * read. The password hash leaves the database ONLY for `authorize()` in `authOptions.ts`.
   */
  registerUser: publicBaseProcedure.input(signUpSchema).mutation(async ({ input, ctx }) => {
    const now = new Date();
    const ip = clientIp(ctx.req);

    // Sign-up is throttled per source, since here there's no account to key on yet. The burst
    // limiter caps the rate; the DB backoff makes a rejected run cost more each time.
    signUpLimiter.prune(now.getTime());

    if (!signUpLimiter.take(ip, now.getTime())) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: "Too many sign-up attempts. Please wait a minute and try again.",
      });
    }

    const lockedFor = await signUpThrottle.remainingLock(ip, now);

    if (lockedFor !== null) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Too many sign-up attempts. Try again in ${lockedFor} seconds.`,
      });
    }

    // BOTH identifiers must be free. Checking only the email is what let an attacker register a
    // second account under someone else's name — sign-in resolves an account BY NAME, so the
    // duplicate either locked the victim out or, once row order shifted, took over their players.
    const [emailTaken, nameTaken] = await Promise.all([
      prisma.user.count({ where: { email: input.email } }),
      prisma.user.count({ where: { name: input.name } }),
    ]);

    if (emailTaken > 0 || nameTaken > 0) {
      await signUpThrottle.recordFailure(ip, now);

      // One message for both cases: saying which field collided turns sign-up into an oracle for
      // "does this account exist", the same leak we just closed on the read side.
      throw new TRPCError({
        code: "CONFLICT",
        message: "That username or email is already taken.",
      });
    }

    const hashedPassword = await hashPassword(input.password);

    // One transaction: the user and their first player are created together or not at all.
    // Sequentially, a failure on the player (its name is unique too) left a committed user with no
    // player and burned that email for good — an account that can sign in and do nothing.
    //
    // The unique constraints are still the real authority here: the checks above race, and two
    // simultaneous sign-ups for one name both pass them. The transaction is what turns that race
    // into a clean rollback instead of half an account.
    try {
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            password: hashedPassword,
            email: input.email,
          },
        });

        await tx.player.create({
          data: {
            name: input.name,
            displayName: input.name,
            user: { connect: { id: user.id } },
          },
        });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await signUpThrottle.recordFailure(ip, now);

        throw new TRPCError({
          code: "CONFLICT",
          message: "That username or email is already taken.",
        });
      }

      throw error;
    }
  }),
});
