import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";
import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/** The six ranked ladders (FE-local mirror of the server `LeagueType`; the BE re-validates). */
export const LEAGUES = [
  "standard",
  "fog",
  "highFunds",
  "dualLeague",
  "standardTeams",
  "broken",
] as const;
export type League = (typeof LEAGUES)[number];

export const LEAGUE_LABEL: Record<League, string> = {
  standard: "Standard",
  fog: "Fog of War",
  highFunds: "High Funds",
  dualLeague: "Dual",
  standardTeams: "Teams",
  broken: "Broken",
};

/** The client-side view of where this player is in the matchmaking flow. */
type QueueState =
  | { phase: "idle" }
  | { phase: "searching"; since: number; league: League }
  | { phase: "ready"; lobbyId: string; readyEndsAt: string; lenient: boolean; mmrDiff: number }
  | { phase: "map"; lobbyId: string };

type QueueContextValue = {
  state: QueueState;
  join: (league: League) => void;
  leave: () => void;
  joining: boolean;
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
  const searchRef = useRef<{ since: number; league: League } | null>(null);

  const beginSearching = () => {
    const search = searchRef.current;

    if (search !== null) {
      setState({ phase: "searching", since: search.since, league: search.league });
    }
  };

  const joinM = trpc.matchmaking.join.useMutation({
    onSuccess: (_data, vars) => {
      searchRef.current = { since: Date.now(), league: vars.leagueType as League };
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
              mmrDiff: event.mmrDiff,
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
      join: (league) => joinM.mutate({ leagueType: league, mode: "1v1", playerId }),
      leave: () => leaveM.mutate({ playerId }),
      joining: joinM.isLoading,
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
