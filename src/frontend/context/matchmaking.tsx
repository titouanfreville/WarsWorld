import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * FE-local mirror of the server's `Ruleset` (the BE re-validates, so drift surfaces as a tsc error
 * at the `join` call below). The old flat six-league list is gone: `standardTeams` was a seat shape
 * and `dualLeague` a format, neither a ruleset — they decomposed into mode × ruleset.
 */
export const RULESETS = ["standard", "fog", "highFunds", "broken"] as const;
export type Ruleset = (typeof RULESETS)[number];

export const RULESET_LABEL: Record<Ruleset, string> = {
  standard: "Standard",
  fog: "Fog of War",
  highFunds: "High Funds",
  broken: "Broken",
};

/** Mirror of the server's `GameMode`. Enum values are identifiers; these are the labels. */
export const MODE_LABEL: Record<GameMode, string> = {
  duel: "1v1",
  teams: "2v2",
  ffa: "FFA",
};

export type GameMode = "duel" | "teams" | "ffa";

/**
 * What the player queued for. A queue is (mode × ruleset × ranked) — all three, not a single league:
 * Ranked Standard and casual Standard are different queues that happen to share a ruleset.
 */
export type QueueChoice = { mode: GameMode; ruleset: Ruleset; ranked: boolean };

/** The client-side view of where this player is in the matchmaking flow. */
type QueueState =
  | { phase: "idle" }
  | ({ phase: "searching"; since: number } & QueueChoice)
  | { phase: "ready"; lobbyId: string; readyEndsAt: string; lenient: boolean; fairnessGap: number }
  | { phase: "map"; lobbyId: string };

type QueueContextValue = {
  state: QueueState;
  join: (choice: QueueChoice) => void;
  leave: () => void;
  joining: boolean;
  /**
   * Why the last join was refused, or null. The server owns queue eligibility (you can't queue while
   * a match is live, or twice at once) and says so in plain language — so surface it verbatim rather
   * than swallowing it. Without this the button looks broken: it fires, it's rejected, nothing moves.
   */
  joinError: string | null;
  dismissJoinError: () => void;
};

const QueueContext = createContext<QueueContextValue | null>(null);

/**
 * Global matchmaking state. Mounted once in `_app`, so the queue survives page-to-page navigation —
 * only closing the tab (dropping the subscription) leaves the queue. Holds the per-player
 * `onQueueEvent` subscription and drives the docked widget + map-ban overlay.
 */
export function ProvideQueue({ children }: { children: ReactNode }) {
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const router = useRouter();

  const [state, setState] = useState<QueueState>({ phase: "idle" });
  // Remember the current search so a requeue (opponent declined) restores it with the same timer.
  const searchRef = useRef<({ since: number } & QueueChoice) | null>(null);

  const beginSearching = () => {
    const search = searchRef.current;

    if (search !== null) {
      setState({ phase: "searching", ...search });
    }
  };

  const joinM = trpc.matchmaking.join.useMutation({
    onSuccess: (_data, vars) => {
      searchRef.current = {
        since: Date.now(),
        mode: vars.mode,
        ruleset: vars.ruleset,
        ranked: vars.ranked,
      };
      beginSearching();
    },
  });
  const leaveM = trpc.matchmaking.leave.useMutation({
    onSuccess: () => {
      searchRef.current = null;
      setState({ phase: "idle" });
    },
  });

  trpc.matchmaking.onQueueEvent.useSubscription(
    { playerId },
    {
      enabled: playerId !== "",
      onData: (event) => {
        switch (event.type) {
          case "ready-check-started":
            setState({
              phase: "ready",
              lobbyId: event.lobbyId,
              readyEndsAt: event.readyEndsAt,
              lenient: event.lenient,
              fairnessGap: event.fairnessGap,
            });
            break;
          case "map-phase-started":
            setState({ phase: "map", lobbyId: event.lobbyId });
            break;
          case "match-found":
            searchRef.current = null;
            setState({ phase: "idle" });
            void router.push(`/pick/${event.matchId}`);
            break;
          case "requeued":
            beginSearching();
            break;
          case "dismissed":
          case "left":
            searchRef.current = null;
            setState({ phase: "idle" });
            break;
          case "queue-updated":
            break;
        }
      },
    },
  );

  const value = useMemo<QueueContextValue>(
    () => ({
      state,
      // `playerBaseProcedure` merges `withPlayerIdSchema` into every input, so playerId rides along
      // even though the procedure authorises off `ctx.currentPlayer`.
      join: (choice) => {
        joinM.reset(); // clear a previous refusal so the next attempt starts clean
        joinM.mutate({ ...choice, playerId });
      },
      leave: () => leaveM.mutate({ playerId }),
      joining: joinM.isLoading,
      joinError: joinM.error?.message ?? null,
      dismissJoinError: () => joinM.reset(),
    }),
    [state, joinM, leaveM, playerId],
  );

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);

  if (ctx === null) {
    throw new Error("useQueue must be used within <ProvideQueue>");
  }

  return ctx;
}
