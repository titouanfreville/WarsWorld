import { endgameRouter } from "./endgame";
import { honorRouter } from "./honor";
import { lobbyRouter } from "./lobby";
import { mapRouter } from "./maps";
import { matchesRouter } from "./matches";
import { matchmakingRouter } from "./matchmaking";
import { rankingRouter } from "./ranking";
import { router } from "../trpc/trpc-setup";
import { actionRouter } from "./action";
import { matchRouter } from "./match";
import { matchPreviewRouter } from "./match/previews";
import { articleRouter } from "./article";
import { systemRouter } from "./system";
import { userRouter } from "./user";
import { socialRouter } from "./social";

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
