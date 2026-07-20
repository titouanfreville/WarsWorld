import { getCurrentTurnPlayer, getTileAt } from "frontend/components/match/match-view";
import { applyBufferedActions } from "frontend/components/match/optimistic-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import {
  actionQueueReducer,
  initialActionQueueState,
  nextPendingAction,
  optimisticActions,
} from "frontend/utils/action-queue";
import { formatAdminToolEffect, formatDevToolEffect } from "frontend/components/match/dev-actions";
import { createLogger } from "frontend/utils/logger";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

type Params = {
  matchId: string;
  playerId: string;
};

/** Board-scoped logger — uses the logger migration's `createLogger(scope)` convention for the tag. */
const boardLog = createLogger("v2");

/**
 * Data layer for the v2 snapshot board: the match + turn-snapshot queries, the optimistic view
 * (authoritative state + buffered intent), and the action buffer with its drain/reconcile/turn-reset
 * effects. NO client engine, NO `MatchWrapper` — the backend stays authoritative (any event ->
 * refetch), so the client can't desync. See `MatchBoardV2` for the interaction/rendering half.
 */
export function useMatchBoard({ matchId, playerId }: Params) {
  // The unit price table is static within a turn (production doesn't change prices), so latch the
  // last one the BE sent and keep building from it — no round-trip on each producer, and it survives
  // the per-action snapshot refetch. Only the very first turn of the match waits for it once.
  const priceTableRef = useRef<TurnSnapshot["production"]["priceTable"]>([]);

  // Optimistic action buffer (locked design in src/frontend/CLAUDE.md). The board renders
  // `authoritative match + pending intent`; the queue drains one action at a time and reconciles
  // against the BE's authoritative refetch, so it can't desync.
  const [queue, dispatchQueue] = useReducer(actionQueueReducer, initialActionQueueState);
  const queueRef = useRef(queue);
  queueRef.current = queue;
  // clientIds whose submit the BE accepted — dropped from the buffer once the authoritative state
  // that includes them lands (avoids a flicker/double-apply between success and refetch).
  const acknowledgedRef = useRef<Set<string>>(new Set());
  // clientIds currently in flight, so a re-run of the drain effect can't submit the same one twice.
  const inFlightRef = useRef<Set<string>>(new Set());
  // Set when the BE reports a move was trapped (path cut short by a fog-hidden enemy): the tile the
  // unit halted on, so the board can pin an "ambush" label there. `id` bumps each time so a repeat
  // trap on the same tile still re-triggers the label's show/auto-dismiss.
  const [trapNotice, setTrapNotice] = useState<{ position: [number, number]; id: number } | null>(
    null,
  );

  // System lines for dev/admin tool use, shown in chat. Transient — the durable record is the Event
  // log — so a plain capped list, newest last. `id` is a monotonic key for React (no timestamps in
  // the engine's world, and two lines can share a tick).
  const [systemLog, setSystemLog] = useState<{ id: number; text: string }[]>([]);
  const systemLineIdRef = useRef(0);

  const pushSystemLine = (text: string) => {
    systemLineIdRef.current += 1;
    const id = systemLineIdRef.current;
    // Cap the buffer so a long match can't grow it without bound.
    setSystemLog((prev) => [...prev, { id, text }].slice(-50));
  };

  const matchQuery = trpc.match.full.useQuery({ matchId, playerId });
  const match = matchQuery.data;

  const isMyTurn = match !== undefined && getCurrentTurnPlayer(match)?.id === playerId;

  // The subscription callback is created once and would close over a stale `isMyTurn`; read turn
  // ownership through a ref so an opponent-move event is classified against the live turn.
  const isMyTurnRef = useRef(isMyTurn);
  isMyTurnRef.current = isMyTurn;

  // The latest authoritative view, for the subscription callback: an HQ-capture event names the
  // reason but not the destroyed units, so the handler reads the PRE-capture view (still current at
  // event time — the refetch it triggers hasn't landed) to find the eliminated player's units.
  const matchRef = useRef(match);
  matchRef.current = match;

  // Fog-masked paths of opponent moves seen live this refetch cycle, drained by the board on the next
  // authoritative update to slide those units (own moves animate from the optimistic buffer instead).
  // The BE already masks each path per viewer (event-to-emittable's `shownPath`), so this just keeps
  // what it's handed; a fully-hidden move arrives empty and is ignored.
  const opponentMovePathsRef = useRef<[number, number][][]>([]);

  // Tiles where a unit was just destroyed (combat kill or self-destruct), drained by the board on the
  // next authoritative update to play an explosion before the unit vanishes. Unlike moves this isn't
  // turn-gated — a kill is animated whether it was ours or the opponent's — and it's already fog-safe:
  // the BE only sends a dead unit's position when this viewer can see the tile.
  const destroyedPositionsRef = useRef<[number, number][]>([]);

  // Tiles where a capture ability fired, drained by the board on the next authoritative update to play
  // a capture flourish. Over-captures (every infantry/mech/apc/etc. ability lands here) — the board
  // filters to real captures by unit type in the new view, since only infantry/mech capture. Fog-safe:
  // the BE only sends the ability's position when this viewer can see the capturing tile.
  const capturePositionsRef = useRef<[number, number][]>([]);

  const snapshotQuery = trpc.match.previews.turnSnapshot.useQuery(
    { matchId, playerId },
    { enabled: isMyTurn },
  );

  const utils = trpc.useUtils();
  const actionMutation = trpc.action.send.useMutation();

  const snapshot = isMyTurn ? (snapshotQuery.data ?? null) : null;

  if (snapshot !== null && snapshot.production.priceTable.length > 0) {
    priceTableRef.current = snapshot.production.priceTable;
  }

  // The board's rendered truth: authoritative state with the buffered intent applied on top.
  const optimisticView = useMemo(
    () =>
      match === undefined
        ? undefined
        : applyBufferedActions(match, playerId, snapshot, optimisticActions(queue)),
    [match, snapshot, queue, playerId],
  );

  trpc.action.onEvent.useSubscription(
    { playerId, matchId },
    {
      onData(event) {
        // Dev/admin tool use is announced in chat — every player sees what was done, which is the
        // point of it being an event rather than a silent mutation. The line is transient (the
        // durable record is the Event log + DevToolAudit), so it lives in local state, not the DB
        // chat. `actorName` and the resolved `effect` are already on the wire; this only formats.
        if (event.type === "devTool") {
          pushSystemLine(`${event.actorName} (DEV) ${formatDevToolEffect(event.effect)}`);
        } else if (event.type === "adminTool") {
          pushSystemLine(`${event.actorName} (ADMIN) ${formatAdminToolEffect(event.effect)}`);
        }

        // Opponent move seen live: keep its (already fog-masked) path so the board can slide the unit
        // when the refetch below lands. Only off our own turn — our own moves echo back here too, but
        // they already animate from the optimistic buffer, so re-animating them would double up. A
        // single-tile or empty path isn't a visible slide, so there's nothing to keep.
        if (event.type === "move" && !isMyTurnRef.current && event.path.length >= 2) {
          opponentMovePathsRef.current.push(
            event.path.map((position): [number, number] => [position[0], position[1]]),
          );
        }

        // Unit destruction: a combat kill rides on the move event's attack sub-event (attacker and/or
        // defender at HP 0), and a self-destruct is a `delete`. In each case the BE only includes the
        // dead unit's position when this viewer can see the tile, so keeping whatever it sends stays
        // fog-safe. The board plays an explosion there on the refetch that removes the unit.
        if (event.type === "move" && event.subEvent.type === "attack") {
          for (const participant of [event.subEvent.attacker, event.subEvent.defender]) {
            if (participant?.HP === 0 && participant.position !== undefined) {
              destroyedPositionsRef.current.push([
                participant.position[0],
                participant.position[1],
              ]);
            }
          }
        } else if (event.type === "delete") {
          destroyedPositionsRef.current.push([event.position[0], event.position[1]]);
        }

        // Capture flourish (OPPONENT only): an infantry/mech capturing a property fires an `ability`
        // sub-event, and its (fog-masked) final path position is the tile being captured. Other unit
        // abilities (apc supply, black bomb, stealth toggle) also land here — the board discards them by
        // unit type, since only infantry/mech capture. Own captures are driven from the action buffer
        // instead (so the flourish shares its move slide's clock), so ignore our own echoed ability here
        // — off our turn is the opponent's capture. A fully-hidden ability has no shown position.
        if (event.type === "move" && event.subEvent.type === "ability" && !isMyTurnRef.current) {
          const capturePosition = event.path.at(-1);

          if (capturePosition !== undefined) {
            capturePositionsRef.current.push([capturePosition[0], capturePosition[1]]);
          }
        }

        // HQ/lab capture eliminates the captured player and removes ALL their units at once. The event
        // carries the reason but not the positions, so derive them: the captured tile's owner in the
        // pre-capture view is the eliminated player, and every unit of theirs the viewer can currently
        // see blows up (units outside vision are already absent here, so this stays fog-safe).
        if (
          event.type === "move" &&
          event.subEvent.type === "ability" &&
          event.subEvent.eliminationReason === "hq-or-labs-captured"
        ) {
          const previous = matchRef.current;
          const hqPosition = event.path.at(-1);

          if (previous !== undefined && hqPosition !== undefined) {
            const capturedTile = getTileAt(previous, [hqPosition[0], hqPosition[1]]);

            if ("playerSlot" in capturedTile && capturedTile.playerSlot >= 0) {
              for (const unit of previous.units) {
                if (unit.playerSlot === capturedTile.playerSlot) {
                  destroyedPositionsRef.current.push([unit.position[0], unit.position[1]]);
                }
              }
            }
          }
        }

        void utils.match.full.invalidate({ matchId, playerId });
        void utils.match.previews.turnSnapshot.invalidate({ matchId, playerId });
      },
    },
  );

  const onActionError = (label: string) => (error: { message: string }) =>
    boardLog.warn(`${label} rejected by BE:`, error.message);

  // Drain the buffer: submit the earliest pending action, one in flight at a time.
  useEffect(() => {
    const pending = nextPendingAction(queue);

    if (pending === undefined || inFlightRef.current.has(pending.clientId)) {
      return;
    }

    inFlightRef.current.add(pending.clientId);
    dispatchQueue({ type: "sent", clientId: pending.clientId });

    // The buffer stores the pure action; the transport adds the match/player envelope on submit.
    actionMutation.mutate(
      { ...pending.action, playerId, matchId },
      {
        onSuccess(result) {
          // The BE accepted the action but a move can still have been trapped (stopped short by a
          // fog-hidden enemy). Pin an ambush label on the tile the unit halted on.
          if (result?.trapped === true && result.trapPosition !== null) {
            const position = result.trapPosition; // narrowed to [number, number]
            setTrapNotice((prev) => ({ position, id: (prev?.id ?? 0) + 1 }));
          }

          // Keep the optimistic delta until the authoritative refetch lands, then drop it (below).
          acknowledgedRef.current.add(pending.clientId);
          // Force a refetch AFTER acknowledging, so the [match] reconcile effect is guaranteed to run
          // with this id present. Without it, a subscription-driven refetch that landed BEFORE this
          // callback would leave the action stuck at "sent" (no further match change to confirm it).
          void utils.match.full.invalidate({ matchId, playerId });
          void utils.match.previews.turnSnapshot.invalidate({ matchId, playerId });
        },
        onError(error) {
          onActionError(pending.kind)(error);
          // Locked reconciliation rule (src/frontend/CLAUDE.md): apply up to and INCLUDING the first
          // failure, then cancel every action buffered after it — the later ones were built on intent
          // the BE never accepted (e.g. a move blocked by a fog-hidden unit invalidates whatever was
          // queued to follow it). Reject this one, then cancel its followers.
          dispatchQueue({ type: "rejected", clientId: pending.clientId });
          dispatchQueue({ type: "cancelFollowing", clientId: pending.clientId });
        },
        onSettled() {
          inFlightRef.current.delete(pending.clientId);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue]);

  // Reconcile: when fresh authoritative state arrives it already includes every accepted action, so
  // drop those from the buffer (seamless hand-off from optimistic delta to BE truth).
  useEffect(() => {
    if (match === undefined || acknowledgedRef.current.size === 0) {
      return;
    }

    for (const clientId of acknowledgedRef.current) {
      dispatchQueue({ type: "confirmed", clientId });
    }

    acknowledgedRef.current.clear();
  }, [match]);

  // Turn boundary (ours ends / opponent's begins) -> discard the buffer, the BE wins. Structured so
  // a per-turn timer could later drive this same cutover (not implemented yet).
  useEffect(() => {
    dispatchQueue({ type: "reset" });
    acknowledgedRef.current.clear();
    inFlightRef.current.clear();
  }, [match?.turn]);

  return {
    matchQuery,
    optimisticView,
    snapshot,
    isMyTurn,
    queue,
    dispatchQueue,
    queueRef,
    priceTableRef,
    actionMutation,
    onActionError,
    trapNotice,
    systemLog,
    opponentMovePathsRef,
    destroyedPositionsRef,
    capturePositionsRef,
  };
}
