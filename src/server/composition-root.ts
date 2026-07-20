import { matchStore } from "server/match-store";
import { prisma } from "server/prisma/prisma-client";
import { EndgameUsecase } from "server/endgame/endgame.usecase";
import { HonorUsecase } from "server/honor/honor.usecase";
import { LobbyUsecase } from "server/lobby/lobby.usecase";
import { MatchesUsecase } from "server/matches/matches.usecase";
import { MatchActionUsecase } from "server/matches/match-action.usecase";
import { MatchLifecycleUsecase } from "server/matches/match-lifecycle.usecase";
import { MatchmakingUsecase } from "server/matchmaking/matchmaking.usecase";
import { PlayersUsecase } from "server/players/players.usecase";
import { RankingUsecase } from "server/ranking/ranking.usecase";
import { SocialUsecase } from "server/social/social.usecase";
import { DevToolsUsecase } from "server/dev-tools/dev-tools.usecase";
import { AdminToolsUsecase } from "server/admin/admin-tools.usecase";
import { AdminUsecase } from "server/admin/admin.usecase";

/**
 * The single startup composition root: construct every feature usecase once, in explicit
 * dependency order, and hand each router its instance from here. Features depend on the narrow
 * cross-feature interfaces (`Rater`, `MatchSpawner`) — this file is the only place that knows the
 * concrete wiring, so no router imports a sibling router's singleton (see src/server/CLAUDE.md
 * "Explicit wiring": compose once, don't stash module singletons on shared mutable state).
 */
export const rankingUsecase = new RankingUsecase(prisma);
export const matchesUsecase = new MatchesUsecase(prisma, matchStore);
export const matchLifecycleUsecase = new MatchLifecycleUsecase(prisma, matchStore);
export const matchmakingUsecase = new MatchmakingUsecase(prisma, rankingUsecase, matchesUsecase);
export const lobbyUsecase = new LobbyUsecase(prisma, matchesUsecase);
export const endgameUsecase = new EndgameUsecase(prisma);
export const honorUsecase = new HonorUsecase(prisma);
export const socialUsecase = new SocialUsecase(prisma);
// Profile-page reads: identity, career stats, friends. Reads ranks through the ranking usecase and
// the friendship graph through the social usecase, so it owns neither ranked nor social logic.
export const playersUsecase = new PlayersUsecase(prisma, rankingUsecase, socialUsecase);
export const devToolsUsecase = new DevToolsUsecase(prisma);
export const adminToolsUsecase = new AdminToolsUsecase(prisma, {
  // Same notifications a natural ending performs, injected so the admin feature imports no sibling.
  applyMatchResult: (tx, matchId) => rankingUsecase.applyMatchResult(tx, matchId),
  persistStats: (tx, matchId) => endgameUsecase.persistStats(tx, matchId),
});
// Global (out-of-match) admin tools: force a match between two players, modify a visible rank.
// Force-match reaches matchmaking (pair queued players) and lobby (spawn an admin-hosted custom
// match) through their narrow contracts, so it owns neither queue nor lobby logic.
export const adminUsecase = new AdminUsecase(
  prisma,
  rankingUsecase,
  matchmakingUsecase,
  lobbyUsecase,
);
// Declared after ranking/endgame: playing an action can END the match, and finalizing it rates the
// players and writes their battle report — so this one depends on both being built already.
export const matchActionUsecase = new MatchActionUsecase(prisma, rankingUsecase, endgameUsecase);
