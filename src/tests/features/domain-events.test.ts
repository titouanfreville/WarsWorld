import { describe, expect, it, vi } from "vitest";
import { DomainEvents } from "server/core/domain-events";

/**
 * The cross-feature seam. What's locked here is the contract the composition root relies on: that
 * publishing WAITS (the End-Game screen queries the rating it triggered), and that a broken
 * subscriber cannot reach back and fail the player's move that published the event.
 */
describe("DomainEvents", () => {
  const noopOnError = () => undefined;

  it("delivers the payload to a subscriber", async () => {
    const events = new DomainEvents(noopOnError);
    const seen: string[] = [];

    events.on("matchFinished", ({ matchId }) => {
      seen.push(matchId);
    });
    await events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 });

    expect(seen).toEqual(["m1"]);
  });

  it("awaits an async handler before returning", async () => {
    const events = new DomainEvents(noopOnError);
    let settled = false;

    events.on("matchFinished", async () => {
      await Promise.resolve();
      settled = true;
    });

    await events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: null });

    // Without the await in publish, the handler is still pending here and the caller races it.
    expect(settled).toBe(true);
  });

  it("does not propagate a handler's failure to the publisher", async () => {
    const events = new DomainEvents(noopOnError);

    events.on("matchFinished", () => {
      throw new Error("rating exploded");
    });

    // A rejected publish would fail the action mutation that finished the match — losing the
    // player's move because a downstream listener broke.
    await expect(
      events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 }),
    ).resolves.toBeUndefined();
  });

  it("reports a failing handler instead of swallowing it", async () => {
    const onError = vi.fn();
    const events = new DomainEvents(onError);
    const boom = new Error("rating exploded");

    events.on("matchFinished", () => {
      throw boom;
    });
    await events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 });

    expect(onError).toHaveBeenCalledWith(boom, "matchFinished");
  });

  it("still runs later handlers after an earlier one throws", async () => {
    const events = new DomainEvents(noopOnError);
    const seen: string[] = [];

    events.on("matchFinished", () => {
      throw new Error("first listener is broken");
    });
    events.on("matchFinished", () => {
      seen.push("second");
    });
    await events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 });

    expect(seen).toEqual(["second"]);
  });

  it("runs handlers in registration order", async () => {
    const events = new DomainEvents(noopOnError);
    const seen: string[] = [];

    events.on("matchFinished", async () => {
      await Promise.resolve();
      seen.push("first");
    });
    events.on("matchFinished", () => {
      seen.push("second");
    });
    await events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 });

    expect(seen).toEqual(["first", "second"]);
  });

  it("publishing with no subscribers is a no-op", async () => {
    const onError = vi.fn();
    const events = new DomainEvents(onError);

    await expect(
      events.publish("matchFinished", { matchId: "m1", winnerTeamIndex: 0 }),
    ).resolves.toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });
});
