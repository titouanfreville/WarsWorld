import { describe, expect, it } from "vitest";
import {
  GRACE_ATTEMPTS,
  RateLimiter,
  isLocked,
  lockMsForFailures,
  secondsUntil,
} from "server/auth/throttle";
import { clientIp } from "server/auth/client-ip";
import { sweepStaleAttempts } from "server/auth/throttle.dbo";

describe("sign-in backoff", () => {
  it("costs an honest typo nothing — no lock inside the grace allowance", () => {
    for (let failures = 0; failures <= GRACE_ATTEMPTS; failures++) {
      expect(lockMsForFailures(failures)).toBe(0);
    }
  });

  it("doubles the wait with each miss past the allowance", () => {
    expect(lockMsForFailures(GRACE_ATTEMPTS + 1)).toBe(1_000);
    expect(lockMsForFailures(GRACE_ATTEMPTS + 2)).toBe(2_000);
    expect(lockMsForFailures(GRACE_ATTEMPTS + 3)).toBe(4_000);
    expect(lockMsForFailures(GRACE_ATTEMPTS + 4)).toBe(8_000);
  });

  it("caps at 15 minutes so an account can't be bricked forever", () => {
    expect(lockMsForFailures(GRACE_ATTEMPTS + 40)).toBe(15 * 60 * 1_000);
    expect(lockMsForFailures(10_000)).toBe(15 * 60 * 1_000);
  });

  it("stays finite for absurd counts — a 2**n overflow would poison the lock date", () => {
    expect(Number.isFinite(lockMsForFailures(Number.MAX_SAFE_INTEGER))).toBe(true);
  });

  it("reports a lock as live only until it expires", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    expect(isLocked(new Date("2026-01-01T00:00:10Z"), now)).toBe(true);
    expect(isLocked(new Date("2025-12-31T23:59:59Z"), now)).toBe(false);
    expect(isLocked(null, now)).toBe(false);
    expect(isLocked(undefined, now)).toBe(false);
  });

  it("rounds the remaining wait up, so '0 seconds' never means 'still locked'", () => {
    const now = new Date("2026-01-01T00:00:00Z");

    expect(secondsUntil(new Date("2026-01-01T00:00:01.200Z"), now)).toBe(2);
    expect(secondsUntil(new Date("2025-12-31T23:00:00Z"), now)).toBe(0);
  });
});

describe("burst rate limiter", () => {
  // The configured auth setting: more than 3 tries per minute fails, on sign-in and sign-up alike.
  it("allows 3 tries in a minute and fails the fourth", () => {
    const limiter = new RateLimiter(3, 60_000);

    expect(limiter.take("1.2.3.4", 0)).toBe(true);
    expect(limiter.take("1.2.3.4", 10)).toBe(true);
    expect(limiter.take("1.2.3.4", 20)).toBe(true);
    expect(limiter.take("1.2.3.4", 30)).toBe(false);
    expect(limiter.take("1.2.3.4", 59_999)).toBe(false);
  });

  it("counts each caller separately", () => {
    const limiter = new RateLimiter(1, 60_000);

    expect(limiter.take("1.2.3.4", 0)).toBe(true);
    expect(limiter.take("1.2.3.4", 1)).toBe(false);
    expect(limiter.take("5.6.7.8", 1)).toBe(true);
  });

  it("reopens once the window rolls over", () => {
    const limiter = new RateLimiter(1, 1_000);

    expect(limiter.take("1.2.3.4", 0)).toBe(true);
    expect(limiter.take("1.2.3.4", 500)).toBe(false);
    expect(limiter.take("1.2.3.4", 1_000)).toBe(true);
  });

  it("prunes expired windows so cycling keys can't grow the map without bound", () => {
    const limiter = new RateLimiter(1, 1_000);

    for (let i = 0; i < 100; i++) {
      limiter.take(`10.0.0.${i}`, 0);
    }

    limiter.prune(2_000);

    // Every pruned key starts a fresh window rather than being remembered as over-limit.
    expect(limiter.take("10.0.0.5", 2_000)).toBe(true);
  });
});

describe("stale-counter sweep", () => {
  const captureCutoff = () => {
    const calls: Date[] = [];
    const db = {
      authAttempt: {
        deleteMany: (args: { where: { updatedAt: { lt: Date } } }) => {
          calls.push(args.where.updatedAt.lt);

          return Promise.resolve({ count: 0 });
        },
      },
    } as unknown as Parameters<typeof sweepStaleAttempts>[1];

    return { db, calls };
  };

  it("deletes counters older than the 7-day retention and nothing newer", async () => {
    const { db, calls } = captureCutoff();
    const now = new Date("2026-07-25T12:00:00Z");

    await sweepStaleAttempts(now, db);

    // `lt` the cutoff, so a row touched 6 days ago survives and one from 8 days ago does not.
    expect(calls).toHaveLength(1);
    expect(calls[0].toISOString()).toBe("2026-07-18T12:00:00.000Z");
  });

  it("keeps the cutoff far behind the longest possible lock, so an active lock is never swept", () => {
    const now = new Date("2026-07-25T12:00:00Z");
    const longestLockMs = lockMsForFailures(Number.MAX_SAFE_INTEGER);
    const retentionMs = now.getTime() - new Date("2026-07-18T12:00:00.000Z").getTime();

    expect(retentionMs).toBeGreaterThan(longestLockMs);
  });
});

describe("caller address", () => {
  it("prefers the proxy header and takes the original client from the chain", () => {
    expect(clientIp({ headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" } })).toBe(
      "203.0.113.7",
    );
  });

  it("falls back to the socket when there is no proxy header", () => {
    expect(clientIp({ socket: { remoteAddress: "198.51.100.9" } })).toBe("198.51.100.9");
  });

  it("degrades to a constant rather than throwing when nothing identifies the caller", () => {
    expect(clientIp(undefined)).toBe("unknown");
    expect(clientIp({ headers: { "x-forwarded-for": "" } })).toBe("unknown");
  });
});
