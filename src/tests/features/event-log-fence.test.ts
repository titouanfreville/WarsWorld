import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { appendEvent, EventLogConflictError } from "server/adapters/event-log";
import { resetMatchLocks, withMatchLock } from "server/matches/match-lock";

/**
 * The event log's write fence: `Event.index` is derived per match rather than drawn from a global
 * sequence, so the composite primary key `(matchId, index)` rejects a second writer on the same
 * match instead of silently interleaving a divergent history.
 *
 * The fence had no test at all — the thing the whole change was built for was the one thing nothing
 * exercised.
 */

/** The transaction client `appendEvent` expects, narrowed to what it actually touches. */
type Tx = Parameters<typeof appendEvent>[0];

/** One cast, here, so no call site needs one. */
const asTx = (fake: { event: Record<string, unknown> }): Tx => fake as unknown as Tx;

/** A fake `tx` whose `event.create` fails the way Postgres does for the given Prisma error code. */
const txThatConflictsWith = (code: string): Tx =>
  asTx({
    event: {
      aggregate: () => Promise.resolve({ _max: { index: 4 } }),
      create: () =>
        Promise.reject(
          new Prisma.PrismaClientKnownRequestError("conflict", { code, clientVersion: "test" }),
        ),
    },
  });

const txThatAccepts = (maxIndex: number | null, seen: { index?: number }): Tx =>
  asTx({
    event: {
      aggregate: () => Promise.resolve({ _max: { index: maxIndex } }),
      create: ({ data }: { data: { index: number } }) => {
        seen.index = data.index;

        return Promise.resolve(data);
      },
    },
  });

/** The event payload's shape is irrelevant here — the fence is about indices, not content. */
const anyEvent = { type: "wait" } as unknown as Parameters<typeof appendEvent>[2];

describe("event log write fence", () => {
  it("appends at max+1 for the match", async () => {
    const seen: { index?: number } = {};

    const index = await appendEvent(txThatAccepts(7, seen), "m1", anyEvent);

    expect(index).toBe(8);
    expect(seen.index).toBe(8);
  });

  it("starts at 1 on a match with no events yet", async () => {
    const seen: { index?: number } = {};

    const index = await appendEvent(txThatAccepts(null, seen), "m1", anyEvent);

    expect(index).toBe(1);
  });

  it("turns a unique-constraint rejection into a typed conflict, not a raw 500", async () => {
    await expect(appendEvent(txThatConflictsWith("P2002"), "m1", anyEvent)).rejects.toBeInstanceOf(
      EventLogConflictError,
    );
  });

  it("ALSO classifies a transaction timeout as a conflict", async () => {
    // The loser doesn't always fail fast: Postgres blocks it on the primary-key index until the
    // winner commits, so a slow winner (finalize rates the match) makes the same collision surface
    // as P2028. Reported raw, the fence's own case would read as an unexplained 500.
    await expect(appendEvent(txThatConflictsWith("P2028"), "m1", anyEvent)).rejects.toBeInstanceOf(
      EventLogConflictError,
    );
  });

  it("re-throws anything it can't classify", async () => {
    await expect(
      appendEvent(txThatConflictsWith("P1001"), "m1", anyEvent),
    ).rejects.not.toBeInstanceOf(EventLogConflictError);
  });
});

describe("per-match lock", () => {
  it("serializes writers on one match, so two appends can't read the same max", async () => {
    resetMatchLocks();

    const order: string[] = [];

    const slowThenFast = async (name: string, delayMs: number) => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      order.push(`${name}:end`);
    };

    await Promise.all([
      withMatchLock("m1", () => slowThenFast("a", 20)),
      withMatchLock("m1", () => slowThenFast("b", 0)),
    ]);

    // b must not start until a has finished — that overlap is exactly the window in which an action
    // and a firing turn deadline both read `_max.index` and collide.
    expect(order).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("does NOT serialize different matches", async () => {
    resetMatchLocks();

    const order: string[] = [];

    await Promise.all([
      withMatchLock("m1", async () => {
        order.push("m1:start");
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push("m1:end");
      }),
      withMatchLock("m2", async () => {
        order.push("m2:start");
        await new Promise((resolve) => setTimeout(resolve, 0));
        order.push("m2:end");
      }),
    ]);

    // m2 runs while m1 is still working — a match is single-threaded, the server is not.
    expect(order).toEqual(["m1:start", "m2:start", "m2:end", "m1:end"]);
  });

  it("a thrown action doesn't wedge the match for the next writer", async () => {
    resetMatchLocks();

    const failed = withMatchLock("m1", () => Promise.reject(new Error("boom")));

    await expect(failed).rejects.toThrow("boom");

    // One player's failed action must not cost everyone else the match.
    await expect(withMatchLock("m1", () => Promise.resolve("ok"))).resolves.toBe("ok");
  });
});
