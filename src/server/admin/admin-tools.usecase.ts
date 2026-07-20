import type { Prisma, PrismaClient, Role } from "@prisma/client";
import type { AdminAction } from "server/core/schemas/admin-action";
import type { MatchWrapper } from "server/engine/entities/match";
import { adminActionToEvent, applyAdminToolEvent } from "server/engine/events/handlers/admin-tool";
import { mainEventToEmittables } from "server/engine/events/event-to-emittable";
import { emitToTeams } from "server/matches/emit-to-teams";
import { DispatchableError } from "server/engine/dispatchable-error";
import { devToolsConfig } from "server/core/config/dev-tools-config";
import { emitMatchEnd, persistFinishedMatch } from "server/matches/finish-match";
import { writeAudit } from "server/auth/audit";

/** Who is firing the tool. `userId` — not playerId — is what the audit is keyed on. */
export type AdminActor = {
  userId: string;
  playerId: string;
  displayName: string;
  roles: readonly Role[];
  ip?: string;
  userAgent?: string;
};

/** The cross-feature notifications a finished match owes, injected rather than imported. */
export type AdminToolsDeps = {
  applyMatchResult: (tx: Prisma.TransactionClient, matchId: string) => Promise<unknown>;
  persistStats: (tx: Prisma.TransactionClient, matchId: string) => Promise<unknown>;
};

/**
 * In-match admin tools — same system as the dev tools: authorise → event → apply → emit → persist +
 * audit. The capability (`adminTools`) is enforced by the procedure; this owns the rest.
 */
export class AdminToolsUsecase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: AdminToolsDeps,
  ) {}

  async execute(match: MatchWrapper, action: AdminAction, actor: AdminActor): Promise<void> {
    /* Same ranked guard as the dev tools, and for the same reason: forcing an outcome on a rated
     * match moves real ratings. Ranked-ness lives on the Prisma row, not the engine entity. Fails
     * closed — unable to prove a match ISN'T ranked is not permission to decide it. */
    const matchRow = await this.prisma.match.findUnique({
      where: { id: match.id },
      select: { isRanked: true },
    });

    if (matchRow === null) {
      throw new DispatchableError("Could not verify this match, so admin tools are refused");
    }

    if (matchRow.isRanked && !devToolsConfig.allowInRankedMatches) {
      throw new DispatchableError("Admin match tools are disabled in ranked matches");
    }

    /* Validate BEFORE applying, so a rejected tool leaves no trace in state or the log. */
    const event = adminActionToEvent(match, action, actor.displayName);

    applyAdminToolEvent(match, event);

    /* The outcome the event just imposed. Read off the match rather than re-derived: the board is
     * usually still contested — that's the whole point of forcing — so `finalizeIfGameOver` would
     * say "nothing to do" and the result would never reach the DB. */
    const finished =
      action.type === "forceOutcome" ? { winnerTeamIndex: action.winnerTeamIndex } : null;

    emitToTeams(match, mainEventToEmittables(match, event));

    await this.prisma.$transaction(async (tx) => {
      await tx.event.create({ data: { matchId: match.id, content: event } });

      if (finished !== null) {
        /* The same writes a natural ending performs — shared, not copied. */
        await persistFinishedMatch(tx, match, finished, this.deps);
      }

      await writeAudit(tx, {
        capability: "adminTools",
        tool: action.type,
        payload: action,
        actor,
        matchId: match.id,
      });
    });

    /* Only after the outcome is durably committed — announcing a result a failed transaction rolled
     * back would leave every client on a game-over screen for a live match. */
    if (finished !== null) {
      emitMatchEnd(match, finished);
    }
  }

  /**
   * Whether this caller may use in-match admin tools here, and which team they're on.
   *
   * `myTeamIndex` comes from the server because the FE's match view carries no team at all — and it
   * must not derive one from `teamMapping`, which would be rules logic on the client. The panel
   * needs it to offer "force MY team's win" without computing anything.
   */
  async getAvailability(
    match: MatchWrapper,
    playerId: string,
  ): Promise<{ enabled: boolean; myTeamIndex: number | null; teamIndexes: number[] }> {
    const matchRow = await this.prisma.match.findUnique({
      where: { id: match.id },
      select: { isRanked: true },
    });

    const myTeamIndex = match.getPlayerById(playerId)?.team.index ?? null;
    /* The real teams, so the panel can name a winner without assuming a duel. Neutral (index < 0) is
     * a pseudo-team and can't win anything. */
    const teamIndexes = match.teams.map((team) => team.index).filter((index) => index >= 0);

    if (matchRow === null) {
      return { enabled: false, myTeamIndex, teamIndexes };
    }

    return {
      enabled:
        match.status === "playing" && (!matchRow.isRanked || devToolsConfig.allowInRankedMatches),
      myTeamIndex,
      teamIndexes,
    };
  }
}
