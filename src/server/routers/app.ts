import { endgameRouter } from "../endgame/router";
import { honorRouter } from "../honor/router";
import { lobbyRouter } from "../lobby/router";
import { mapRouter } from "../maps/router";
import { matchesRouter } from "../matches/router";
import { matchmakingRouter } from "../matchmaking/router";
import { rankingRouter } from "../ranking/router";
import { router } from "../trpc/trpc-setup";
import { actionRouter } from "./action";
import { matchRouter } from "./match";
import { matchPreviewRouter } from "./match/previews";
import { articleRouter } from "./article";
import { systemRouter } from "./system";
import { userRouter } from "./user";
import { socialRouter } from "../social/router";

export const appRouter = router({
  article: articleRouter,
  match: matchRouter,
  matchPreview: matchPreviewRouter,
  matches: matchesRouter,
  lobby: lobbyRouter,
  matchmaking: matchmakingRouter,
  ranking: rankingRouter,
  map: mapRouter,
  action: actionRouter,
  endgame: endgameRouter,
  honor: honorRouter,
  system: systemRouter,
  user: userRouter,
  social: socialRouter,
});

export type AppRouter = typeof appRouter;
