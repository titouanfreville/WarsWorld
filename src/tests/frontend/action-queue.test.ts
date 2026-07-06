import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import {
  actionQueueReducer,
  initialActionQueueState,
  nextPendingAction,
  optimisticActions,
  type ActionQueueEvent,
  type ActionQueueState,
} from "frontend/utils/action-queue";

const PASS: MainAction = { type: "passTurn" };
const WAIT = (x: number): MainAction => ({
  type: "move",
  path: [[x, 0]],
  subAction: { type: "wait" },
});

const run = (events: ActionQueueEvent[], start = initialActionQueueState): ActionQueueState =>
  events.reduce(actionQueueReducer, start);

describe("action queue reducer", () => {
  it("buffers actions in submit order with a monotonic seq", () => {
    const state = run([
      { type: "enqueue", clientId: "a", action: WAIT(1) },
      { type: "enqueue", clientId: "b", action: PASS },
    ]);

    expect(state.actions.map((a) => [a.clientId, a.seq, a.status])).toEqual([
      ["a", 0, "pending"],
      ["b", 1, "pending"],
    ]);
    expect(state.nextSeq).toBe(2);
  });

  it("ignores a duplicate clientId so a retry can't double-buffer", () => {
    const state = run([
      { type: "enqueue", clientId: "a", action: WAIT(1) },
      { type: "enqueue", clientId: "a", action: WAIT(1) },
    ]);

    expect(state.actions).toHaveLength(1);
  });

  it("drains strictly in order, one in flight at a time", () => {
    let state = run([
      { type: "enqueue", clientId: "a", action: WAIT(1) },
      { type: "enqueue", clientId: "b", action: PASS },
    ]);

    // Earliest pending is 'a'.
    expect(nextPendingAction(state)?.clientId).toBe("a");

    // Once 'a' is sent, nothing else is drained until it resolves.
    state = actionQueueReducer(state, { type: "sent", clientId: "a" });
    expect(nextPendingAction(state)).toBeUndefined();

    // Confirming 'a' drops it and unblocks 'b'.
    state = actionQueueReducer(state, { type: "confirmed", clientId: "a" });
    expect(state.actions.map((a) => a.clientId)).toEqual(["b"]);
    expect(nextPendingAction(state)?.clientId).toBe("b");
  });

  it("keeps a rejected action out of the optimistic preview and out of the drain", () => {
    let state = run([
      { type: "enqueue", clientId: "a", action: WAIT(1) },
      { type: "enqueue", clientId: "b", action: PASS },
      { type: "sent", clientId: "a" },
    ]);

    state = actionQueueReducer(state, { type: "rejected", clientId: "a" });

    // 'a' is no longer previewed; 'b' remains and can now drain.
    expect(optimisticActions(state).map((a) => a.clientId)).toEqual(["b"]);
    expect(nextPendingAction(state)?.clientId).toBe("b");
  });

  it("resets the buffer on a turn change / full resync", () => {
    const state = run([
      { type: "enqueue", clientId: "a", action: WAIT(1) },
      { type: "sent", clientId: "a" },
      { type: "reset" },
    ]);

    expect(state).toEqual(initialActionQueueState);
  });
});
