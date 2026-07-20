import { adminToolsRouter } from "./admin-tools";
import { devToolsRouter } from "./dev-tools";
import { lifecycleRouter } from "./lifecycle";
import { matchPreviewRouter } from "./previews";
import { pickRouter } from "./pick";
import { mergeRouters, router } from "server/trpc/trpc-setup";

/**
 * The whole match-play feature under one namespace: the lifecycle procedures at `match.*`, plus
 * `match.previews.*` (unit details / combat forecast / turn snapshot), `match.pick.*` (champ
 * select) and `match.devTools.*` (staff-only game-state tools). The `action.*` event-sourcing
 * pipeline stays a sibling namespace (see ./action).
 */
export const matchRouter = mergeRouters(
  lifecycleRouter,
  router({
    previews: matchPreviewRouter,
    pick: pickRouter,
    devTools: devToolsRouter,
    adminTools: adminToolsRouter,
  }),
);
