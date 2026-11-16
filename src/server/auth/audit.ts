import type { Prisma, PrismaClient } from "@prisma/client";
import type { Capability } from "server/auth/capabilities";

/** Who fired a privileged tool. `userId` is what the trail is keyed on; the rest is request origin. */
export type AuditActor = {
  userId: string;
  playerId: string;
  ip?: string;
  userAgent?: string;
};

/**
 * Write one privileged-action audit row — the single shape every dev/admin tool records through, so a
 * field can't silently drop on a hand-copied path.
 *
 * `client` is load-bearing, not incidental: the in-match tools pass their `$transaction` `tx` so an
 * effect can never persist without its audit row, while the out-of-match admin tools pass the plain
 * client. The helper takes whichever it's handed rather than closing over one. It imports no feature
 * usecase — auditing is a cross-cutting concern, not any one feature's.
 */
export const writeAudit = (
  client: Prisma.TransactionClient | PrismaClient,
  entry: {
    capability: Capability;
    tool: string;
    payload: Prisma.InputJsonValue;
    actor: AuditActor;
    /** Set for match-scoped tools; omit for global ones (e.g. modify rank). */
    matchId?: string;
  },
): Promise<unknown> =>
  client.devToolAudit.create({
    data: {
      userId: entry.actor.userId,
      playerId: entry.actor.playerId,
      matchId: entry.matchId,
      capability: entry.capability,
      tool: entry.tool,
      payload: entry.payload,
      ip: entry.actor.ip,
      userAgent: entry.actor.userAgent,
    },
  });
