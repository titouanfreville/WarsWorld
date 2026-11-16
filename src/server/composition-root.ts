import { DomainEvents } from "server/core/domain-events";
import { HonorUsecase } from "server/honor/honor.usecase";
import { MapsUsecase } from "server/maps/maps.usecase";
import { prisma } from "server/prisma/prisma-client";
import { RankingUsecase } from "server/ranking/ranking.usecase";
import { router } from "server/trpc/trpc-setup";
import { logger } from "shared/utils/logger";
import { makeActionRouter } from "./routers/action";
import { articleRouter } from "./routers/article";
import { makeHonorRouter } from "./routers/honor";
import { makeMapRouter } from "./routers/map";
import { matchRouter } from "./routers/match";
import { matchPreviewRouter } from "./routers/match/previews";
import { makeRankingRouter } from "./routers/ranking";
import { systemRouter } from "./routers/system";
import { userRouter } from "./routers/user";

/**
 * The composition root: the ONE place that knows how the backend is assembled.
 *
 * Everywhere else states what it needs and receives it. Features declare cross-feature needs as
 * ports (`core/ports.ts`) or announce facts as domain events (`core/domain-events.ts`); this file is
 * where a port meets its implementation and a subscriber meets a publisher. That is what keeps
 * `ranking` and match play from importing each other while still cooperating.
 *
 * No DI container on purpose — a container makes the graph implicit again, and the whole point is
 * that you can read the wiring top to bottom.
 */

const domainEvents = new DomainEvents((error, event) =>
  logger.error(`[domain-events] a "${event}" handler threw:`, error),
);

// ── Features ──────────────────────────────────────────────────────────────────────────────────────

const rankingUsecase = new RankingUsecase(prisma);
const mapsUsecase = new MapsUsecase(prisma);
const honorUsecase = new HonorUsecase(prisma);

// ── Cross-feature wiring ──────────────────────────────────────────────────────────────────────────

/**
 * Match finished → rate it. `RankingUsecase` satisfies the `Rater` port, and match play publishes
 * the fact without knowing a rater exists. Deleting this line disables rating and breaks nothing
 * else — which is the test of whether the seam is real.
 */
domainEvents.on("matchFinished", ({ matchId }) => rankingUsecase.rateFinishedMatch(matchId));

// ── Transport ─────────────────────────────────────────────────────────────────────────────────────

export const appRouter = router({
  article: articleRouter,
  match: matchRouter,
  matchPreview: matchPreviewRouter,
  honor: makeHonorRouter(honorUsecase),
  ranking: makeRankingRouter(rankingUsecase),
  map: makeMapRouter(mapsUsecase),
  action: makeActionRouter(domainEvents),
  system: systemRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
