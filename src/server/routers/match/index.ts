import { lifecycleRouter } from "./lifecycle";
import { matchPreviewRouter } from "./previews";
import { pickRouter } from "./pick";
import { mergeRouters, router } from "server/trpc/trpc-setup";

/**
 * The whole match-play feature under one namespace: the lifecycle procedures at `match.*`, plus
 * `match.previews.*` (unit details / combat forecast / turn snapshot) and `match.pick.*` (champ
 * select). The `action.*` event-sourcing pipeline stays a sibling namespace (see ./action).
 */
export const matchRouter = mergeRouters(
  lifecycleRouter,
  router({ previews: matchPreviewRouter, pick: pickRouter }),
);
