import { router } from "../trpc/trpc-setup";
import { actionRouter } from "./match/action";
import { matchRouter } from "./match";
import { matchmakingRouter } from "./matchmaking";
import { lobbyRouter } from "./lobby";
import { rankingRouter } from "./ranking";
import { endgameRouter } from "./endgame";
import { honorRouter } from "./honor";
import { socialRouter } from "./social";
import { mapRouter } from "./maps";
import { articleRouter } from "./article";
import { systemRouter } from "./system";
import { userRouter } from "./user";

export const appRouter = router({
  // Match play: lifecycle at `match.*`, previews at `match.previews.*`, champ-select at `match.pick.*`.
  match: matchRouter,
  action: actionRouter, // the event-sourcing action pipeline (its own namespace)
  matchmaking: matchmakingRouter,
  lobby: lobbyRouter,
  ranking: rankingRouter,
  endgame: endgameRouter,
  honor: honorRouter,
  social: socialRouter,
  map: mapRouter,
  article: articleRouter,
  system: systemRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
