import type { MainAction } from "shared/schemas/action";

/**
 * Client action queue + reconciliation (see `src/frontend/CLAUDE.md`).
 *
 * The backend is authoritative and validates every action, so the client cannot know an action
 * "succeeded" until the BE confirms it. This queue lets the player keep acting (buffering intent)
 * across round-trips and dropped connections while the FE shows an optimistic preview, then
 * reconciles against the BE's authoritative result.
 *
 * It is a PURE reducer over plain data — no engine, no network, no React. The transport layer
 * drains it (submits `pending` actions), and feeds outcomes back in via `confirm`/`reject`. It is
 * deliberately turn-scoped: `reset` clears it on a turn change or a full resync.
 *
 * `MainAction` is a tRPC-inferred input type (the API contract), not engine logic — importing it
 * here does not couple the client to the engine.
 */

export type QueuedActionStatus =
  /** Buffered locally, not yet sent to the BE. */
  | "pending"
  /** Sent to the BE, awaiting its authoritative outcome. */
  | "sent"
  /** The BE accepted it; it is now reflected in authoritative state. */
  | "confirmed"
  /** The BE rejected it (illegal/stale); the optimistic preview must roll back. */
  | "rejected";

export type QueuedAction = {
  /** Idempotency key — lets the BE (and resync) dedupe a re-sent action. */
  clientId: string;
  /** Monotonic order within the current turn's buffer. */
  seq: number;
  action: MainAction;
  status: QueuedActionStatus;
};

export type ActionQueueState = {
  actions: QueuedAction[];
  nextSeq: number;
};

/** How the player-facing reconciliation banner should read after applying an event. */
export type ReconcileSignal =
  | { type: "none" }
  /** We are refetching authoritative state after (re)connecting. */
  | { type: "resyncing" }
  /** A submitted action was corrected/undone by the BE; the board jumped to the BE's truth. */
  | { type: "action-corrected"; clientId: string };

export type ActionQueueEvent =
  | { type: "enqueue"; clientId: string; action: MainAction }
  | { type: "sent"; clientId: string }
  | { type: "confirmed"; clientId: string }
  | { type: "rejected"; clientId: string }
  /** Turn change / full resync: drop everything and start clean. */
  | { type: "reset" };

export const initialActionQueueState: ActionQueueState = { actions: [], nextSeq: 0 };

/**
 * The next action the transport should submit: the earliest still-`pending` one. Turn-based play
 * means we drain strictly in order — one in flight at a time — so a rejection can't leave later
 * optimistic actions built on an outcome the BE never accepted.
 */
export const nextPendingAction = (state: ActionQueueState): QueuedAction | undefined => {
  const hasInFlight = state.actions.some((a) => a.status === "sent");

  if (hasInFlight) {
    return undefined;
  }

  return [...state.actions].sort((a, b) => a.seq - b.seq).find((a) => a.status === "pending");
};

/** Actions to render as an optimistic preview: everything not yet rejected, in submit order. */
export const optimisticActions = (state: ActionQueueState): QueuedAction[] =>
  state.actions.filter((a) => a.status !== "rejected").sort((a, b) => a.seq - b.seq);

const setStatus = (
  state: ActionQueueState,
  clientId: string,
  status: QueuedActionStatus,
): ActionQueueState => ({
  ...state,
  actions: state.actions.map((a) => (a.clientId === clientId ? { ...a, status } : a)),
});

export const actionQueueReducer = (
  state: ActionQueueState,
  event: ActionQueueEvent,
): ActionQueueState => {
  switch (event.type) {
    case "enqueue": {
      // Ignore a duplicate clientId so a retried enqueue can't double-buffer the same intent.
      if (state.actions.some((a) => a.clientId === event.clientId)) {
        return state;
      }

      return {
        actions: [
          ...state.actions,
          { clientId: event.clientId, seq: state.nextSeq, action: event.action, status: "pending" },
        ],
        nextSeq: state.nextSeq + 1,
      };
    }
    case "sent": {
      return setStatus(state, event.clientId, "sent");
    }
    case "confirmed": {
      // Drop confirmed actions: authoritative state now includes them, so there's nothing left to
      // preview or reconcile.
      return {
        ...state,
        actions: state.actions.filter((a) => a.clientId !== event.clientId),
      };
    }
    case "rejected": {
      return setStatus(state, event.clientId, "rejected");
    }
    case "reset": {
      return initialActionQueueState;
    }
  }
};
