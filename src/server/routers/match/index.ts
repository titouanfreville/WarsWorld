import type { MatchLifecycleUsecase } from "server/matches/match-lifecycle.usecase";
import type { MatchesUsecase } from "server/matches/matches.usecase";
import { makeLifecycleRouter } from "./lifecycle";
import { makePickRouter } from "./pick";
import { matchPreviewRouter } from "./previews";
import { mergeRouters, router } from "server/trpc/trpc-setup";

/**
 * The whole match-play feature under one namespace: the lifecycle procedures at `match.*`, plus
 * `match.previews.*` (unit details / combat forecast / turn snapshot) and `match.pick.*`
 * (champ select). The `action.*`
 * event-sourcing pipeline stays a sibling namespace (see ./action).
 *
 * The staff tool namespaces land with their own features.
 */
export const makeMatchRouter = (
  matchLifecycleUsecase: MatchLifecycleUsecase,
  matchesUsecase: MatchesUsecase,
) =>
  mergeRouters(
    makeLifecycleRouter(matchLifecycleUsecase),
    router({
      previews: matchPreviewRouter,
      pick: makePickRouter(matchesUsecase),
    }),
  );
