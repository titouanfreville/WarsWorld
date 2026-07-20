import type { PrismaClient, Role } from "@prisma/client";
import type { DevAction } from "server/core/schemas/dev-action";
import type { MatchWrapper } from "server/engine/entities/match";
import { applyDevToolEvent, devActionToEvent } from "server/engine/events/handlers/dev-tool";
import { mainEventToEmittables } from "server/engine/events/event-to-emittable";
import { emitToTeams } from "server/matches/emit-to-teams";
import { DispatchableError } from "server/engine/dispatchable-error";
import { can } from "server/auth/capabilities";
import { writeAudit } from "server/auth/audit";
import { assertDevToolsAllowed } from "./dev-tools-gate";

/** Who is firing the tool. `userId` — not playerId — is what the audit is keyed on. */
export type DevToolActor = {
  userId: string;
  playerId: string;
  displayName: string;
  roles: readonly Role[];
  ip?: string;
  userAgent?: string;
};

/**
 * Dev tools: authorise → event → apply → emit → persist.
 *
 * Deliberately mirrors the action router's pipeline rather than short-cutting it. Match state is
 * rebuilt from the event log, so the tool's effect has to BE an event or the log replays to a
 * different state than the live match.
 */
export class DevToolsUsecase {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Whether this caller may use dev tools in this match, and which slot they hold.
   *
   * Deliberately answers a boolean rather than shipping the caller's roles to the client: the FE
   * must not evaluate authorisation (root CLAUDE.md — the BE owns every decision), and roles are
   * not the client's business. It also runs the SAME `can` + `assertDevToolsAllowed` pair that
   * `execute` runs, so the menu can never offer a tool the mutation would then refuse.
   *
   * `myPlayerSlot` is here because the panel's tools are slot-scoped (funds, power, the locks) and
   * the client was previously deriving it with a `?? 0` fallback — which silently pinned SLOT 0
   * whenever the lookup missed, so the tools appeared to do nothing while quietly acting on another
   * player. The slot is the server's to state, exactly like `adminTools.availability`'s
   * `myTeamIndex`. Null means "not a seat in this match": there's no own-slot to act on, so the
   * tools are refused rather than defaulted.
   */
  async getAvailability(
    match: MatchWrapper,
    roles: readonly Role[],
    playerId: string,
  ): Promise<{ enabled: boolean; myPlayerSlot: number | null }> {
    const myPlayerSlot = match.getPlayerById(playerId)?.data.slot ?? null;

    if (!can(roles, "devTools")) {
      return { enabled: false, myPlayerSlot };
    }

    const matchRow = await this.prisma.match.findUnique({
      where: { id: match.id },
      select: { isRanked: true },
    });

    if (matchRow === null) {
      return { enabled: false, myPlayerSlot };
    }

    /* Not a seat -> no slot to act on. Fails closed rather than letting the panel pick a slot. */
    if (myPlayerSlot === null) {
      return { enabled: false, myPlayerSlot };
    }

    try {
      assertDevToolsAllowed({ isRanked: matchRow.isRanked, rules: match.rules }, roles);
      return { enabled: true, myPlayerSlot };
    } catch {
      /* The gate throws to REFUSE an action; here the same refusal is just "don't show the menu".
       * Catching keeps one source of truth rather than a second copy of the rules that could drift
       * out of step with `execute` — which is how a UI ends up offering a button that 403s. */
      return { enabled: false, myPlayerSlot };
    }
  }

  async execute(match: MatchWrapper, action: DevAction, actor: DevToolActor): Promise<void> {
    /* Ranked-ness is deliberately absent from MatchWrapper — it's ranking metadata, not match state,
     * so it lives on the Prisma row and off the engine entity (see the MatchWrapper constructor).
     * Read it here rather than widening the engine entity for a non-engine concern. */
    const matchRow = await this.prisma.match.findUnique({
      where: { id: match.id },
      select: { isRanked: true },
    });

    if (matchRow === null) {
      /* Fail closed: unable to prove the match ISN'T ranked is not permission to cheat in it. */
      throw new DispatchableError("Could not verify this match, so dev tools are refused");
    }

    /* The match half of the gate. The user half (`devTools` capability) is enforced by the
     * procedure — neither is sufficient alone: a dev is still refused in a ranked match, and a
     * tester is still refused in a match that didn't opt in. */
    assertDevToolsAllowed({ isRanked: matchRow.isRanked, rules: match.rules }, actor.roles);

    /* Validate + resolve BEFORE applying, so a rejected tool leaves no trace in state or the log. */
    const event = devActionToEvent(match, action, actor.displayName);

    applyDevToolEvent(match, event);

    emitToTeams(match, mainEventToEmittables(match, event));

    /* The Event row and the audit row go together: an effect that replays with no record of who
     * caused it is exactly what the audit exists to prevent. */
    await this.prisma.$transaction(async (tx) => {
      await tx.event.create({
        data: { matchId: match.id, content: event },
      });

      await writeAudit(tx, {
        capability: "devTools",
        tool: action.type,
        payload: action,
        actor,
        matchId: match.id,
      });
    });
  }
}
