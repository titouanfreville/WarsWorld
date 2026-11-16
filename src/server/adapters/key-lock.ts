/**
 * A keyed mutex: work queued under the same key runs one at a time, different keys never wait on
 * each other.
 *
 * Exists because the same bug shape keeps recurring — a read-modify-write straddling an `await`,
 * where a second writer walks in on half-applied state. Guards don't fix it: anything they check
 * before the await can be stale after it. The two current users are a live match (a player's action
 * vs. the firing turn deadline) and a matchmaking lobby (a ban vs. the ban-phase deadline).
 *
 * SINGLE PROCESS ONLY. This serializes writers inside one Node process, which is the same scope as
 * the in-memory state it protects. Cross-instance conflicts are a different problem and are caught
 * where they matter — the event log's composite primary key (see `event-log.ts`).
 */
export type KeyedLock = {
  withLock: <T>(key: string, work: () => Promise<T>) => Promise<T>;
  /** Test seam: drop all queues. */
  reset: () => void;
};

export const createKeyedLock = (): KeyedLock => {
  /** The tail of each key's queue. Absent means nothing is in flight for that key. */
  const chains = new Map<string, Promise<unknown>>();

  const withLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();

    // Swallow the predecessor's rejection HERE (not in the caller's chain) so that whether the
    // previous holder succeeded has no bearing on whether we get to run.
    const run = previous.then(work, work);

    // Park a settled-either-way link as the new tail, so the next caller queues behind this one
    // without inheriting its rejection.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );

    chains.set(key, tail);

    try {
      return await run;
    } finally {
      // Last one out cleans up, so the map doesn't grow by one entry per key forever. Compare by
      // IDENTITY: if someone queued behind us, the tail has moved on and is not ours to delete.
      if (chains.get(key) === tail) {
        chains.delete(key);
      }
    }
  };

  return { withLock, reset: () => chains.clear() };
};
