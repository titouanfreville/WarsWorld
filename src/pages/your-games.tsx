import { ProtectPage } from "frontend/components/auth/ProtectPage";
import MatchCard from "frontend/components/match/card/MatchCard";
import MatchHistoryCard from "frontend/components/match/history/MatchHistoryCard";
import {
  HISTORY_FILTERS,
  HISTORY_PAGE_SIZE,
  pageCountOf,
  pageOf,
} from "frontend/components/match/history/history-filters";
import LobbyInvites from "frontend/components/match/lobby/LobbyInvites";
import { deriveLobbyStatus, isFinished } from "frontend/components/match/lobby/match-status";
import type { LobbyStatusKind } from "frontend/components/match/lobby/match-status";
import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";

/**
 * Your Games — the two things that are *yours*: the matches you're in, and the ones you've played.
 *
 * Deliberately NOT a lobby: finding an open game and spectating someone else's are browsing
 * activities, and they live under Play and Community respectively. This page never reads
 * `match.getAll`.
 */

type Tab = "live" | "history";

const TABS: { key: Tab; label: string }[] = [
  { key: "live", label: "Live" },
  { key: "history", label: "History" },
];

const isTab = (value: unknown): value is Tab => value === "live" || value === "history";

/** Live-view chips. Status is viewer-derived, so these read off `deriveLobbyStatus`. */
const LIVE_FILTERS: { key: string; label: string; accepts: (kind: LobbyStatusKind) => boolean }[] =
  [
    { key: "all", label: "All", accepts: () => true },
    { key: "your-turn", label: "Your turn", accepts: (kind) => kind === "your-turn" },
    { key: "waiting", label: "Waiting", accepts: (kind) => kind === "their-turn" },
    { key: "setup", label: "Setup", accepts: (kind) => kind === "setup" },
  ];

const chipClass = (active: boolean): string =>
  `@rounded-lg @border @px-3 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @transition ${
    active
      ? "@border-primary @bg-bg-secondary @text-white"
      : "@border-bg-tertiary @text-slate-400 hover:@text-white"
  }`;

export default function YourGames() {
  const router = useRouter();
  const { currentPlayer } = usePlayers();

  const { data: playerMatches } = trpc.match.getPlayerMatches.useQuery(
    { playerId: currentPlayer?.id ?? "" },
    { enabled: currentPlayer !== undefined },
  );
  const { data: finishedMatches } = trpc.match.getPlayerFinishedMatches.useQuery(
    { playerId: currentPlayer?.id ?? "" },
    { enabled: currentPlayer !== undefined },
  );

  const tab: Tab = isTab(router.query.tab) ? router.query.tab : "live";

  const setTab = (next: Tab) => {
    void router.push({ query: { ...router.query, tab: next } }, undefined, { shallow: true });
  };

  const live = useMemo(
    () => (playerMatches ?? []).filter((match) => !isFinished(match)),
    [playerMatches],
  );

  // Finished matches come from the DB (archived out of the live store), but one that finished this
  // session is still in the in-memory list too — concat and dedupe by id.
  const history = useMemo(() => {
    const seen = new Set<string>();

    return [...(finishedMatches ?? []), ...(playerMatches ?? []).filter(isFinished)].filter(
      (match) => {
        if (seen.has(match.id)) {
          return false;
        }

        seen.add(match.id);
        return true;
      },
    );
  }, [finishedMatches, playerMatches]);

  const [liveFilter, setLiveFilter] = useState("all");
  const [historyFilter, setHistoryFilter] = useState("all");
  const [page, setPage] = useState(0);

  // A filter change invalidates the current page — page 4 of a 2-page result renders empty.
  useEffect(() => setPage(0), [historyFilter]);

  const liveAccepts = LIVE_FILTERS.find((f) => f.key === liveFilter) ?? LIVE_FILTERS[0];
  const liveRows = live.filter((match) =>
    liveAccepts.accepts(deriveLobbyStatus(match, currentPlayer?.id)),
  );

  const historyAccepts = HISTORY_FILTERS.find((f) => f.key === historyFilter) ?? HISTORY_FILTERS[0];
  const historyRows = history.filter((match) => historyAccepts.accepts(match));
  const pageRows = pageOf(historyRows, page);
  const pages = pageCountOf(historyRows.length);
  const urgent = live.filter(
    (match) => deriveLobbyStatus(match, currentPlayer?.id) === "your-turn",
  ).length;

  return (
    <ProtectPage>
      <Head>
        <title>Your Games | Wars World</title>
      </Head>

      <div className="@mx-auto @max-w-[1360px] @px-4 @pb-16 @pt-8">
        <header className="@mb-5 @flex @flex-wrap @items-end @justify-between @gap-3 @border-b @border-bg-tertiary @pb-3">
          <div>
            <h1 className="@py-0 @text-3xl @font-semibold @uppercase @tracking-wide">Your Games</h1>
            <p className="@py-0 @text-slate-400">
              Everything you&apos;re playing, and everything you&apos;ve played.
            </p>
          </div>

          <div className="@flex @gap-1 @rounded-xl @bg-bg-primary/70 @p-1.5 @outline @outline-1 @outline-bg-tertiary">
            {TABS.map(({ key, label }) => {
              const count = key === "live" ? live.length : history.length;
              const isUrgent = key === "live" && urgent > 0;

              return (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`@rounded-lg @px-5 @py-2 @text-xs @font-semibold @uppercase @tracking-wide @transition ${
                    tab === key
                      ? "@bg-bg-secondary @text-white @outline @outline-1 @outline-bg-tertiary"
                      : "@text-slate-400 hover:@text-white"
                  }`}
                >
                  {label}
                  <span
                    className={`@ml-2 @rounded-full @px-1.5 @py-0.5 @text-[0.65rem] ${
                      isUrgent ? "@bg-amber-400 @text-black" : "@bg-bg-tertiary @text-slate-300"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        <LobbyInvites />

        {tab === "live" ? (
          <>
            <div className="@mb-4 @flex @flex-wrap @gap-1.5">
              {LIVE_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setLiveFilter(filter.key)}
                  className={chipClass(liveFilter === filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {liveRows.length === 0 ? (
              <div className="@rounded-lg @border @border-dashed @border-bg-tertiary @p-8 @text-center @text-slate-500">
                {live.length > 0
                  ? "No matches for this filter."
                  : "You're not in any matches right now."}
              </div>
            ) : (
              <div className="@grid @gap-4 laptop:@grid-cols-2 monitor:@grid-cols-3">
                {liveRows.map((match) => (
                  <MatchCard key={match.id} match={match} inMatch />
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="@mb-4 @flex @flex-wrap @gap-1.5">
              {HISTORY_FILTERS.map((filter) => (
                <button
                  key={filter.key}
                  onClick={() => setHistoryFilter(filter.key)}
                  className={chipClass(historyFilter === filter.key)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {pageRows.length === 0 ? (
              <div className="@rounded-lg @border @border-dashed @border-bg-tertiary @p-8 @text-center @text-slate-500">
                {history.length > 0 ? "No matches for this filter." : "No completed games yet."}
              </div>
            ) : (
              <>
                <div className="@flex @flex-col @gap-2">
                  {pageRows.map((match) => (
                    <MatchHistoryCard key={match.id} match={match} playerId={currentPlayer?.id} />
                  ))}
                </div>

                <div className="@mt-4 @flex @flex-wrap @items-center @justify-between @gap-2">
                  <span className="@text-xs @text-slate-500">
                    {page * HISTORY_PAGE_SIZE + 1}–
                    {Math.min(historyRows.length, (page + 1) * HISTORY_PAGE_SIZE)} of{" "}
                    {historyRows.length}
                  </span>

                  {pages > 1 && (
                    <div className="@flex @gap-1">
                      <button
                        onClick={() => setPage(page - 1)}
                        disabled={page === 0}
                        className="@min-w-8 @rounded-md @border @border-bg-tertiary @px-2 @py-1 @text-xs @font-semibold @text-slate-400 disabled:@opacity-30 hover:enabled:@text-white"
                      >
                        ‹
                      </button>
                      {Array.from({ length: pages }, (_, index) => (
                        <button
                          key={index}
                          onClick={() => setPage(index)}
                          className={`@min-w-8 @rounded-md @border @px-2 @py-1 @text-xs @font-semibold @transition ${
                            index === page
                              ? "@border-primary @bg-bg-secondary @text-white"
                              : "@border-bg-tertiary @text-slate-400 hover:@text-white"
                          }`}
                        >
                          {index + 1}
                        </button>
                      ))}
                      <button
                        onClick={() => setPage(page + 1)}
                        disabled={page >= pages - 1}
                        className="@min-w-8 @rounded-md @border @border-bg-tertiary @px-2 @py-1 @text-xs @font-semibold @text-slate-400 disabled:@opacity-30 hover:enabled:@text-white"
                      >
                        ›
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ProtectPage>
  );
}
