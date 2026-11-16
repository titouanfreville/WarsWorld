import { createKeyedLock } from "server/adapters/key-lock";

/**
 * A per-match serialization point for everything that mutates a live match.
 *
 * WHY THIS EXISTS. Applying an action is a read-modify-write straddling an `await`: validate against
 * the in-memory `MatchWrapper`, mutate it, emit to both teams, then persist. All the validation
 * happens synchronously up front, but the transaction at the end suspends — and while it is
 * suspended a second writer can walk in on state that is already half-applied.
 *
 * The turn deadline is the writer that made this unavoidable. A non-pass action never re-arms
 * `turnEndsAt`, so a timer armed at the start of the turn can fire while a player's own action is
 * mid-transaction; `forceEndTurn`'s guards all pass (the match is still `playing`, the deadline
 * really has elapsed), and it stacks a full `passTurn` on top of an action that hasn't landed. Both
 * writers then reach `appendEvent`, read the same `_max.index`, and one loses the composite-key race
 * — turning a routine overlap into a 500 and a divergent log. Guards can't fix that: every guard
 * they could add is re-read before the await and stale after it.
 *
 * So mutations queue per match instead. Different matches never wait on each other, which is the
 * only concurrency that matters here — a match is a single-threaded object by nature, and the game
 * is turn-based.
 *
 * NOT A DISTRIBUTED LOCK. This serializes writers inside ONE process, which is exactly the scope of
 * the in-memory `MatchStore` it protects. When the game tier is sharded, two instances that believe
 * they own the same match are still a real conflict — and the event log's composite primary key is
 * what catches it (see `adapters/event-log.ts`). This lock removes the self-inflicted collisions;
 * the fence stays for the ones that mean something.
 */
const lock = createKeyedLock();

/**
 * Run `work` with exclusive access to `matchId`, queued behind anything already running for it.
 *
 * A rejection propagates to the caller that queued it and does NOT poison the chain — the next
 * waiter runs regardless, because one player's failed action must not wedge the match for everyone
 * else.
 */
export const withMatchLock = <T>(matchId: string, work: () => Promise<T>): Promise<T> =>
  lock.withLock(matchId, work);

/** Test seam: drop all queues. */
export const resetMatchLocks = (): void => lock.reset();
