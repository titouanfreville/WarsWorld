/**
 * Per-player matchmaking event bus for the **pre-lobby** part of the flow — while a player is in the
 * queue or a ready-check they have no match/lobby room to subscribe to, so events are keyed by
 * `playerId` (same shape as `social-emitter`). Once a lobby reaches the map-ban phase the board
 * rides the existing lobby-emitter instead.
 */
export type QueueEvent =
  | { type: "queue-updated"; queueSize: number }
  | {
      type: "ready-check-started";
      lobbyId: string;
      readyEndsAt: string;
      lenient: boolean;
      mmrDiff: number;
    }
  | { type: "map-phase-started"; lobbyId: string }
  | { type: "match-found"; matchId: string }
  | { type: "requeued" }
  | { type: "dismissed" }
  | { type: "left" };

type Listener = (event: QueueEvent) => void;

// playerId -> listeners (a player may have several open tabs)
const listenerMap = new Map<string, Listener[]>();

export const subscribeQueue = (playerId: string, listener: Listener): (() => void) => {
  listenerMap.set(playerId, [...(listenerMap.get(playerId) ?? []), listener]);

  return () => {
    const remaining = (listenerMap.get(playerId) ?? []).filter((l) => l !== listener);

    if (remaining.length > 0) {
      listenerMap.set(playerId, remaining);
    } else {
      listenerMap.delete(playerId);
    }
  };
};

export const emitQueue = (playerId: string, event: QueueEvent): void => {
  listenerMap.get(playerId)?.forEach((listener) => listener(event));
};
