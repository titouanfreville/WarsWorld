import { TRPCError } from "@trpc/server";
import { hashPassword } from "server/hashPassword";
import { prisma } from "server/prisma/prisma-client";
import { optionalAuthMiddleware } from "server/trpc/middleware/auth";
import { playerWithoutCurrentMiddleware } from "server/trpc/middleware/player";
import { playerBaseProcedure, publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { signUpSchema } from "server/auth/schemas";
import { preferencesSchema } from "server/players/schemas";
import { z } from "zod";

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
  findFirstUserByName: publicBaseProcedure.input(z.object({ username: z.string() })).query(
    async ({ input }) =>
      await prisma.user.findFirst({
        where: { name: input.username },
      }),
  ),
  registerUser: publicBaseProcedure.input(signUpSchema).mutation(async ({ input }) => {
    // Validation
    const isUserInDB = await prisma.user.count({
      where: { email: input.email },
    });

    if (isUserInDB && isUserInDB > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "There is already a user with that email in the database",
      });
    }
    // TODO: Password validation

    const hashedPassword = await hashPassword(input.password);

    // Write user to the database
    const user = await prisma.user.create({
      data: {
        name: input.name,
        password: hashedPassword,
        email: input.email,
      },
    });

    await prisma.player.create({
      data: {
        name: input.name,
        displayName: input.name,
        user: {
          connect: {
            id: user.id,
          },
        },
      },
    });
  }),
});
