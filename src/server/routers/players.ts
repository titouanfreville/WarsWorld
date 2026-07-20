import { playersUsecase } from "server/composition-root";
import { publicBaseProcedure, router } from "server/trpc/trpc-setup";
import { z } from "zod";

/**
 * Public profile-page reads. Both are anonymous — anyone can view any player's profile. Identity is
 * `profile`; career stats (ranks + CO usage) are `stats`. Thin transport: validate → call usecase.
 */
export const playersRouter = router({
  profile: publicBaseProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => playersUsecase.getProfile(input.name)),
  stats: publicBaseProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => playersUsecase.getStats(input.name)),
  friends: publicBaseProcedure
    .input(z.object({ name: z.string() }))
    .query(({ input }) => playersUsecase.getFriends(input.name)),
  // Batch handle → card (display name + avatar) for names shown in chat / end-game / history.
  cards: publicBaseProcedure
    .input(z.object({ names: z.array(z.string()).max(64) }))
    .query(({ input }) => playersUsecase.getCards(input.names)),
});
