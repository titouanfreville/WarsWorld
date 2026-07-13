import { matchStore } from "server/match-store";
import { prisma } from "server/prisma/prisma-client";
import { EndgameUsecase } from "server/endgame/endgame.usecase";
import { HonorUsecase } from "server/honor/honor.usecase";
import { LobbyUsecase } from "server/lobby/lobby.usecase";
import { MatchesUsecase } from "server/matches/matches.usecase";
import { MatchmakingUsecase } from "server/matchmaking/matchmaking.usecase";
import { RankingUsecase } from "server/ranking/ranking.usecase";

/**
 * The single startup composition root: construct every feature usecase once, in explicit
 * dependency order, and hand each router its instance from here. Features depend on the narrow
 * cross-feature interfaces (`Rater`, `MatchSpawner`) — this file is the only place that knows the
 * concrete wiring, so no router imports a sibling router's singleton (see src/server/CLAUDE.md
 * "Explicit wiring": compose once, don't stash module singletons on shared mutable state).
 */
export const rankingUsecase = new RankingUsecase(prisma);
export const matchesUsecase = new MatchesUsecase(prisma, matchStore);
export const matchmakingUsecase = new MatchmakingUsecase(prisma, rankingUsecase, matchesUsecase);
export const lobbyUsecase = new LobbyUsecase(prisma, matchesUsecase);
export const endgameUsecase = new EndgameUsecase(prisma);
export const honorUsecase = new HonorUsecase(prisma);
