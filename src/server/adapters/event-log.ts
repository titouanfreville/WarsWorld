import { Prisma } from "@prisma/client";

/**
 * The event log's write seam. Every match mutation ships as an event (see src/server/CLAUDE.md
 * "Event sourcing"), and every one of them goes through here so the per-match sequence has exactly
 * one implementation.
 */

/** The transactional client the callers already hold — appends MUST share their caller's tx. */
type TxClient = Prisma.TransactionClient;

/**
 * Two writers tried to append the same index to one match, and the composite primary key rejected
 * the loser. Distinct from a game-rule rejection: nothing about the action was illegal, the match
 * simply moved under it. Transport maps this to a conflict, not a 500.
 */
export class EventLogConflictError extends Error {
  constructor(readonly matchId: string) {
    super(`Concurrent append to the event log of match ${matchId}`);
    this.name = "EventLogConflictError";
  }
}

/**
 * Append one event to a match's log at the next per-match index, and return that index.
 *
 * `Event.index` is deliberately NOT a database default. It used to be `@default(autoincrement())`,
 * which on Postgres is a GLOBAL sequence: every insert drew a fresh globally-unique value, so the
 * composite primary key `(matchId, index)` could never collide. Ordering worked, but the log had no
 * write fence at all — two writers on the same match would both succeed and silently interleave a
 * divergent history. Deriving the index per match instead makes the primary key do its job: two
 * concurrent transactions read the same max, both attempt the same index, and one loses.
 *
 * That is the point. A conflict here is a real signal — under a single instance it should never
 * fire, and when the game tier is sharded it means two instances briefly believed they owned the
 * same match. Failing loudly is strictly better than a silently forked event log.
 *
 * Indices are per-match but NOT guaranteed contiguous: rows written before this change carry values
 * from the old global sequence, so existing matches simply continue from wherever their max sits.
 * Nothing reads the index except `orderBy` (see MatchStore.rebuild), so sparseness is harmless —
 * which is why no backfill was needed.
 */
export const appendEvent = async (
  tx: TxClient,
  matchId: string,
  content: PrismaJson.PrismaEvent,
): Promise<number> => {
  const { _max } = await tx.event.aggregate({
    where: { matchId },
    _max: { index: true },
  });

  const index = (_max.index ?? 0) + 1;

  try {
    await tx.event.create({ data: { matchId, index, content } });
  } catch (error) {
    // P2002 — unique constraint. The clean case: the loser's INSERT was rejected outright.
    //
    // P2028 — transaction timeout/invalidation. The SAME collision arrives under this code whenever
    // the winner is still uncommitted: Postgres makes the second INSERT WAIT on the primary-key
    // index rather than failing fast, and if the winner's transaction is doing real work behind it
    // (finalize rates the match and writes battle reports) the waiter can exhaust Prisma's
    // interactive-transaction timeout first. Reporting that as a 500 would hide the exact condition
    // this fence exists to name.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2002" || error.code === "P2028")
    ) {
      throw new EventLogConflictError(matchId);
    }

    throw error;
  }

  return index;
};
