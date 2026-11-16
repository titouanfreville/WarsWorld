import type { MatchLifecycleUsecase } from "server/matches/match-lifecycle.usecase";
import { makeLifecycleRouter } from "./lifecycle";
import { matchPreviewRouter } from "./previews";
import { mergeRouters, router } from "server/trpc/trpc-setup";

/**
 * The whole match-play feature under one namespace: the lifecycle procedures at `match.*`, plus
 * `match.previews.*` (unit details / combat forecast / turn snapshot). The `action.*`
 * event-sourcing pipeline stays a sibling namespace (see ./action).
 *
 * `match.pick.*` (champ select) and the staff tool namespaces land with their own features.
 */
export const makeMatchRouter = (matchLifecycleUsecase: MatchLifecycleUsecase) =>
  mergeRouters(
    makeLifecycleRouter(matchLifecycleUsecase),
    router({
      previews: matchPreviewRouter,
    }),
  );
