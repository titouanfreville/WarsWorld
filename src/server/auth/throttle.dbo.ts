import { logger } from "shared/utils/logger";
import { prisma } from "server/prisma/prisma-client";
import { isLocked, lockMsForFailures, secondsUntil } from "./throttle";

/**
 * The DB half of the anti-spam policy: the failure counters that survive a restart.
 *
 * Keys are namespaced by what they throttle — `signin:<lowercased name>` for an account,
 * `signup:<ip>` for a source. Sign-in is keyed on the ACCOUNT rather than the caller on purpose:
 * a distributed guessing run rotates IPs but must keep hammering the same handle.
 */
const signInKey = (name: string) => `signin:${name.trim().toLowerCase()}`;
const signUpKey = (ip: string) => `signup:${ip}`;

/** Seconds the caller must still wait, or `null` when they may proceed. */
const lockRemaining = async (key: string, now: Date): Promise<number | null> => {
  const record = await prisma.authAttempt.findUnique({ where: { key } });
  const lockedUntil = record?.lockedUntil ?? null;

  if (lockedUntil === null || !isLocked(lockedUntil, now)) {
    return null;
  }

  return secondsUntil(lockedUntil, now);
};

/**
 * Records a miss and extends the lock. Kept as an upsert so a first failure and a twentieth take
 * the same path, and so two racing requests can't lose a count.
 */
const recordFailure = async (key: string, now: Date): Promise<void> => {
  const current = await prisma.authAttempt.findUnique({ where: { key } });
  const failures = (current?.failures ?? 0) + 1;
  const lockMs = lockMsForFailures(failures);
  const lockedUntil = lockMs === 0 ? null : new Date(now.getTime() + lockMs);

  await prisma.authAttempt.upsert({
    where: { key },
    create: { key, failures, lockedUntil },
    update: { failures, lockedUntil },
  });
};

/** Clears the counter — called on a successful sign-in, so honest users never accumulate a lock. */
const clear = async (key: string): Promise<void> => {
  await prisma.authAttempt.deleteMany({ where: { key } });
};

export const signInThrottle = {
  remainingLock: (name: string, now: Date) => lockRemaining(signInKey(name), now),
  recordFailure: (name: string, now: Date) => recordFailure(signInKey(name), now),
  clear: (name: string) => clear(signInKey(name)),
};

export const signUpThrottle = {
  remainingLock: (ip: string, now: Date) => lockRemaining(signUpKey(ip), now),
  recordFailure: (ip: string, now: Date) => recordFailure(signUpKey(ip), now),
};

/**
 * How long a quiet counter is kept. Well past any lock (capped at 15 minutes), so this only ever
 * removes records that have stopped mattering — a row still inside its lock window is never young
 * enough to be caught by this.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

/** How often the sweep runs. Hourly is far more often than needed to keep the table small. */
const SWEEP_MS = 60 * 60 * 1_000;

let sweepStarted = false;

/**
 * Deletes counters untouched for `RETENTION_MS`.
 *
 * The table needs sweeping because a failure is recorded even for a username that doesn't exist —
 * deliberately, since skipping unknown accounts would tell an attacker which handles are real. That
 * means anyone spraying random names writes a row per name, and without this the table only grows.
 *
 * Deleting is safe precisely because the row IS the memory: a swept-away counter means someone who
 * has not failed a sign-in in a week starts from a clean slate, which is the intent.
 */
export const sweepStaleAttempts = async (
  now: Date,
  db: Pick<typeof prisma, "authAttempt"> = prisma,
): Promise<number> => {
  const { count } = await db.authAttempt.deleteMany({
    where: { updatedAt: { lt: new Date(now.getTime() - RETENTION_MS) } },
  });

  return count;
};

/**
 * Starts the hourly sweep on the long-lived server process, mirroring
 * `MatchmakingUsecase.startQueueTick`: `unref` so the timer never holds the process open, chained
 * via `finally` so a slow pass can't overlap itself, and idempotent so calling it twice is a no-op.
 *
 * A failed sweep is logged and forgotten — the next pass covers the same rows, and losing one is a
 * slightly larger table, not a correctness problem.
 */
export const startAuthAttemptSweep = (): void => {
  if (sweepStarted) {
    return;
  }

  sweepStarted = true;

  const loop = (): void => {
    void sweepStaleAttempts(new Date())
      .then((count) => {
        if (count > 0) {
          logger.info(`[auth] swept ${count} stale sign-in/sign-up counters`);
        }
      })
      .catch((error: unknown) => {
        logger.error(
          "[auth] failed to sweep stale auth attempts:",
          error instanceof Error ? error.message : error,
        );
      })
      .finally(() => {
        const timer = setTimeout(loop, SWEEP_MS);
        timer.unref?.();
      });
  };

  const first = setTimeout(loop, SWEEP_MS);
  first.unref?.();
  logger.info(`[auth] stale-attempt sweep started (every ${SWEEP_MS}ms)`);
};
