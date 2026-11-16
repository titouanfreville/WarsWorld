import { DomainEvents } from "server/core/domain-events";
import type { MatchSpawner } from "server/core/ports";
import { EndgameUsecase } from "server/endgame/endgame.usecase";
import { HonorUsecase } from "server/honor/honor.usecase";
import { LobbyUsecase } from "server/lobby/lobby.usecase";
import { MatchmakingUsecase } from "server/matchmaking/matchmaking.usecase";
import { PlayersUsecase } from "server/players/players.usecase";
import { SocialUsecase } from "server/social/social.usecase";
import { MatchActionUsecase } from "server/matches/match-action.usecase";
import { MatchLifecycleUsecase } from "server/matches/match-lifecycle.usecase";
import { MatchesUsecase } from "server/matches/matches.usecase";
import { matchStore } from "server/match-store";
import { MapsUsecase } from "server/maps/maps.usecase";
import { prisma } from "server/prisma/prisma-client";
import { RankingUsecase } from "server/ranking/ranking.usecase";
import { router } from "server/trpc/trpc-setup";
import { logger } from "shared/utils/logger";
import { articleRouter } from "./routers/article";
import { makeEndgameRouter } from "./routers/endgame";
import { makeHonorRouter } from "./routers/honor";
import { makeLobbyRouter } from "./routers/lobby";
import { makeMatchmakingRouter } from "./routers/matchmaking";
import { makePlayersRouter } from "./routers/players";
import { makeSocialRouter } from "./routers/social";
import { makeMapRouter } from "./routers/maps";
import { makeMatchRouter } from "./routers/match";
import { makeActionRouter } from "./routers/match/action";
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
const endgameUsecase = new EndgameUsecase(prisma);
const socialUsecase = new SocialUsecase(prisma);

/**
 * Profiles READ the ladder and the friend graph, both through narrow interfaces the feature
 * declares for itself. `players` and `social` genuinely need each other — a profile shows friends,
 * a friend list shows profile cards — and this is where that knot is tied without either importing
 * the other.
 */
const playersUsecase = new PlayersUsecase(prisma, rankingUsecase, socialUsecase);

/**
 * Match play. `MatchActionUsecase` takes `FinalizeHooks` rather than the ranking/endgame usecases:
 * finishing a match has to rate it and write its battle report atomically, but match play must not
 * import either feature. Adapting the two is this file's job.
 */
const matchActionUsecase = new MatchActionUsecase(
  prisma,
  {
    rate: (tx, matchId) => rankingUsecase.applyMatchResult(tx, matchId),
    persistStats: (tx, matchId) => endgameUsecase.persistStats(tx, matchId),
  },
  matchStore,
);
const matchLifecycleUsecase = new MatchLifecycleUsecase(prisma, matchStore);
const matchesUsecase = new MatchesUsecase(prisma, matchStore, {
  plan: (match) => matchActionUsecase.planTurnClock(match),
  commit: (match, endsAt) => matchActionUsecase.commitTurnClock(match, endsAt),
});

// ── Cross-feature wiring ──────────────────────────────────────────────────────────────────────────

/**
 * Match finished → rate it. `RankingUsecase` satisfies the `Rater` port, and match play publishes
 * the fact without knowing a rater exists. Deleting this line disables rating and breaks nothing
 * else — which is the test of whether the seam is real.
 */
domainEvents.on("matchFinished", ({ matchId }) => rankingUsecase.rateFinishedMatch(matchId));

/**
 * `matchesUsecase` is the `MatchSpawner` implementation declared in `core/ports.ts`; the lobby is
 * its first consumer. Naming the port here is what keeps implementation and contract in step.
 */
const matchSpawner: MatchSpawner = matchesUsecase;

/** The lobby assembles seats, then hands them to match play through the port — never by import. */
const lobbyUsecase = new LobbyUsecase(prisma, matchSpawner);

/**
 * Matchmaking READS rating through `SkillSource` and spawns through `MatchSpawner`. It gets no
 * handle that could write a rating — a queue able to move ratings is a queue able to rig them.
 */
const matchmakingUsecase = new MatchmakingUsecase(prisma, rankingUsecase, matchSpawner);

// ── Transport ─────────────────────────────────────────────────────────────────────────────────────

export const appRouter = router({
  article: articleRouter,
  match: makeMatchRouter(matchLifecycleUsecase, matchesUsecase),
  endgame: makeEndgameRouter(endgameUsecase),
  honor: makeHonorRouter(honorUsecase),
  lobby: makeLobbyRouter(lobbyUsecase),
  matchmaking: makeMatchmakingRouter(matchmakingUsecase),
  players: makePlayersRouter(playersUsecase),
  social: makeSocialRouter(socialUsecase),
  ranking: makeRankingRouter(rankingUsecase),
  map: makeMapRouter(mapsUsecase),
  action: makeActionRouter(matchActionUsecase),
  system: systemRouter,
  user: userRouter,
});

export type AppRouter = typeof appRouter;
