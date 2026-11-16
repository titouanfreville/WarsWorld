import type { Prisma } from "@prisma/client";

/**
 * What finalizing a match needs from features that are NOT match play.
 *
 * Declared here, by the consumer, rather than imported from `ranking`/`endgame`: match play must not
 * depend on either, and neither may depend on match play. The composition root is what adapts the
 * real usecases onto this shape — see `src/server/CLAUDE.md` § "When two features need each other".
 *
 * Both hooks take the caller's transaction, because rating and the battle report have to land
 * atomically with the outcome itself. A match that reads as finished but unrated — or rated twice —
 * is the failure this shape exists to prevent, so the implementations must also be idempotent.
 */
export type FinalizeHooks = {
  /** Move ladders/skill for a finished ranked match. No-op for an unranked or already-rated one. */
  rate: (tx: Prisma.TransactionClient, matchId: string) => Promise<void>;
  /** Write the per-player battle report. Runs for EVERY finished match, ranked or not. */
  persistStats: (tx: Prisma.TransactionClient, matchId: string) => Promise<void>;
};
