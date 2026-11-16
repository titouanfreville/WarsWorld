import type { MatchLifecycleUsecase } from "server/matches/match-lifecycle.usecase";
import type { MatchesUsecase } from "server/matches/matches.usecase";
import { makeLifecycleRouter } from "./lifecycle";
import type { AdminToolsUsecase } from "server/admin/admin-tools.usecase";
import type { DevToolsUsecase } from "server/dev-tools/dev-tools.usecase";
import { makeAdminToolsRouter } from "./admin-tools";
import { makeDevToolsRouter } from "./dev-tools";
import { makePickRouter } from "./pick";
import { matchPreviewRouter } from "./previews";
import { mergeRouters, router } from "server/trpc/trpc-setup";

/**
 * The whole match-play feature under one namespace: the lifecycle procedures at `match.*`, plus
 * `match.previews.*` (unit details / combat forecast / turn snapshot) and `match.pick.*`
 * (champ select). The `action.*`
 * event-sourcing pipeline stays a sibling namespace (see ./action).
 *
 * `match.devTools.*` / `match.adminTools.*` are the staff-only game-state tools.
 */
export const makeMatchRouter = (
  matchLifecycleUsecase: MatchLifecycleUsecase,
  matchesUsecase: MatchesUsecase,
  devToolsUsecase: DevToolsUsecase,
  adminToolsUsecase: AdminToolsUsecase,
) =>
  mergeRouters(
    makeLifecycleRouter(matchLifecycleUsecase),
    router({
      previews: matchPreviewRouter,
      pick: makePickRouter(matchesUsecase),
      devTools: makeDevToolsRouter(devToolsUsecase),
      adminTools: makeAdminToolsRouter(adminToolsUsecase),
    }),
  );
