import { ProtectPage } from "frontend/components/auth/ProtectPage";
import CreateMatchModal from "frontend/components/match/lobby/CreateMatchModal";
import RankCard, { type RankView } from "frontend/components/matchmaking/RankCard";
import { PLAY_MODES, queuesFor, type PlayQueue } from "frontend/components/matchmaking/play-queues";
import { RULESET_LABEL, useQueue, type GameMode } from "frontend/context/matchmaking";
import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import Head from "next/head";
import { useRouter } from "next/router";
import { useState } from "react";

/**
 * Play — the "I want to start a game" surface. The other half of the old GAME link: Your Games is
 * what you're already in, this is how you get into another.
 *
 * A queue is (mode × ruleset × ranked). The rail picks the mode; each card is a ruleset × ranked
 * pair. Custom is not a queue — it's a lobby you build yourself — so it lives at the end of the rail
 * and opens the create modal instead.
 */

type RailMode = GameMode | "custom";

const isRailMode = (value: unknown): value is RailMode =>
  value === "duel" || value === "ffa" || value === "teams" || value === "custom";

function Seats({ seats, teamed, active }: { seats: number; teamed: boolean; active: boolean }) {
  return (
    <span className="@flex @flex-none @gap-[2px]">
      {Array.from({ length: seats }, (_, index) => (
        <i
          key={index}
          className={`@h-3.5 @w-1 @rounded-sm ${
            active ? "@bg-primary" : "@bg-bg-tertiary"
          } ${teamed && index >= seats / 2 ? "@opacity-40" : ""}`}
        />
      ))}
    </span>
  );
}

function QueueCard({ queue, mode }: { queue: PlayQueue; mode: GameMode }) {
  const { state, join, joining } = useQueue();
  const searching = state.phase === "searching";

  return (
    <div
      className={`@relative @overflow-hidden @rounded-lg @bg-bg-primary @p-4 @outline @outline-2 ${
        queue.ranked ? "@outline-primary/40" : "@outline-black"
      }`}
    >
      <div className="@flex @items-start @justify-between @gap-2">
        <div>
          <p className="@py-0 @text-lg @font-semibold @uppercase @tracking-wide">{queue.label}</p>
          <p className="@py-0 @pt-0.5 @text-xs @text-slate-500">{queue.blurb}</p>
        </div>
        <span
          className={`@flex-none @rounded @px-2 @py-0.5 @text-[0.6rem] @font-semibold @uppercase @tracking-wide ${
            queue.ranked ? "@bg-primary @text-black" : "@bg-bg-tertiary @text-slate-300"
          }`}
        >
          {queue.ranked ? "Ranked" : "Casual"}
        </span>
      </div>

      <div className="@flex @items-center @justify-end @pt-4">
        <button
          disabled={joining || searching}
          onClick={() => join({ mode, ruleset: queue.ruleset, ranked: queue.ranked })}
          className={`@rounded-lg @px-4 @py-2 @text-xs @font-semibold @uppercase @tracking-wide @transition disabled:@opacity-40 ${
            queue.ranked
              ? "@bg-primary @font-russoOne @text-black hover:@brightness-110"
              : "@border @border-bg-tertiary @text-slate-300 hover:@border-primary hover:@text-white"
          }`}
        >
          {searching ? "In queue…" : "Join queue"}
        </button>
      </div>
    </div>
  );
}

export default function Play() {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const [createOpen, setCreateOpen] = useState(false);

  // `playerBaseProcedure` merges `withPlayerIdSchema` into every input, so playerId rides along even
  // though the procedure authorises off `ctx.currentPlayer`.
  const { data: ranks } = trpc.ranking.myRank.useQuery(
    { playerId: currentPlayer?.id ?? "" },
    { enabled: currentPlayer !== undefined },
  );

  const mode: RailMode = isRailMode(router.query.mode) ? router.query.mode : "duel";

  const setMode = (next: RailMode) => {
    void router.push({ query: { ...router.query, mode: next } }, undefined, { shallow: true });
  };

  const queues = mode === "custom" ? { ranked: [], casual: [] } : queuesFor(mode);
  const rankView = ranks?.find((row) => row.mode === mode) as RankView | undefined;

  return (
    <ProtectPage>
      <Head>
        <title>Play | Wars World</title>
      </Head>

      <div className="@mx-auto @max-w-[1360px] @px-4 @pb-16 @pt-8">
        <header className="@mb-5 @border-b @border-bg-tertiary @pb-3">
          <h1 className="@py-0 @text-3xl @font-semibold @uppercase @tracking-wide">Play</h1>
          <p className="@py-0 @text-slate-400">
            Pick a mode, pick a queue. We&apos;ll find you an opponent.
          </p>
        </header>

        <div className="@grid @gap-6 desktop:@grid-cols-[220px_1fr_260px]">
          {/* mode rail */}
          <nav className="@flex @gap-1 @overflow-x-auto @rounded-xl @bg-bg-primary/70 @p-2 @outline @outline-1 @outline-bg-tertiary desktop:@flex-col">
            {PLAY_MODES.map((entry) => (
              <button
                key={entry.mode}
                onClick={() => setMode(entry.mode)}
                className={`@flex @flex-none @items-center @gap-3 @rounded-lg @px-3 @py-2.5 @text-left @transition ${
                  mode === entry.mode
                    ? "@bg-bg-secondary @text-white @outline @outline-1 @outline-bg-tertiary"
                    : "@text-slate-400 hover:@bg-bg-secondary hover:@text-white"
                }`}
              >
                <Seats seats={entry.seats} teamed={entry.teamed} active={mode === entry.mode} />
                <span className="@whitespace-nowrap">
                  <span className="@block @text-sm @font-semibold">{entry.label}</span>
                  <span className="@block @text-[0.65rem] @text-slate-500">{entry.blurb}</span>
                </span>
              </button>
            ))}

            <button
              onClick={() => setMode("custom")}
              className={`@flex @flex-none @items-center @gap-3 @rounded-lg @px-3 @py-2.5 @text-left @transition ${
                mode === "custom"
                  ? "@bg-bg-secondary @text-white @outline @outline-1 @outline-bg-tertiary"
                  : "@text-slate-400 hover:@bg-bg-secondary hover:@text-white"
              }`}
            >
              <Seats seats={2} teamed active={mode === "custom"} />
              <span className="@whitespace-nowrap">
                <span className="@block @text-sm @font-semibold">Custom</span>
                <span className="@block @text-[0.65rem] @text-slate-500">
                  your rules · unranked
                </span>
              </span>
            </button>
          </nav>

          {/* queues */}
          <main className="@min-w-0">
            {mode === "custom" ? (
              <>
                <div className="@rounded-lg @bg-bg-primary @p-4 @outline @outline-2 @outline-black">
                  <div className="@flex @flex-wrap @items-center @justify-between @gap-3">
                    <div>
                      <p className="@py-0 @text-lg @font-semibold @uppercase @tracking-wide">
                        Create a lobby
                      </p>
                      <p className="@py-0 @pt-0.5 @text-xs @text-slate-500">
                        Your map, your rules, your general pick. Invite friends or leave a seat
                        open.
                      </p>
                    </div>
                    <button
                      onClick={() => setCreateOpen(true)}
                      className="@rounded-lg @bg-primary @px-5 @py-2.5 @font-russoOne @text-sm @uppercase @tracking-wider @text-black @transition hover:@brightness-110"
                    >
                      + Create lobby
                    </button>
                  </div>
                </div>

                <p className="@mt-4 @rounded-lg @border @border-dashed @border-bg-tertiary @p-6 @text-center @text-sm @text-slate-500">
                  Browsing other players&apos; open lobbies is coming here next.
                </p>
              </>
            ) : (
              <>
                {queues.ranked.length > 0 && (
                  <>
                    <p className="@mb-2.5 @flex @items-center @gap-2 @py-0 @text-xs @font-semibold @uppercase @tracking-wide @text-primary">
                      Ranked · moves your rank
                    </p>
                    <div className="@mb-6 @grid @gap-3 laptop:@grid-cols-2">
                      {queues.ranked.map((queue) => (
                        <QueueCard key={queue.ruleset} queue={queue} mode={mode} />
                      ))}
                    </div>
                  </>
                )}

                <p className="@mb-2.5 @py-0 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-500">
                  Casual · nothing at stake
                </p>
                <div className="@grid @gap-3 laptop:@grid-cols-2">
                  {queues.casual.map((queue) => (
                    <QueueCard key={queue.ruleset} queue={queue} mode={mode} />
                  ))}
                </div>

                {queues.ranked.length === 0 && (
                  <p className="@mt-4 @rounded-lg @border @border-dashed @border-bg-tertiary @p-4 @text-xs @leading-relaxed @text-slate-500">
                    <span className="@font-semibold @text-slate-300">
                      No ranked {RULESET_LABEL.standard.toLowerCase()} ladder for this mode yet.
                    </span>{" "}
                    Rating {PLAY_MODES.find((m) => m.mode === mode)?.label} games works — OpenSkill
                    handles teams and free-for-alls natively — but Merit is sized off the chance of
                    winning outright, which isn&apos;t the same as placing well in a 4-player game.
                    That wants settling before these count.
                  </p>
                )}
              </>
            )}
          </main>

          {/* rank */}
          <aside className="@flex @flex-col @gap-4">
            {mode === "custom" ? (
              <div className="@rounded-xl @bg-bg-primary/70 @p-4 @outline @outline-1 @outline-bg-tertiary">
                <p className="@py-0 @text-xs @uppercase @tracking-wide @text-slate-500">Custom</p>
                <p className="@py-0 @pt-2 @text-sm @text-slate-500">
                  Custom lobbies are unranked by design — your rules, no ladder impact.
                </p>
              </div>
            ) : (
              <RankCard view={rankView} />
            )}

            <button
              onClick={() => void router.push("/leaderboard")}
              className="@w-full @rounded-lg @border @border-bg-tertiary @py-2 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 @transition hover:@bg-primary-light hover:@text-black"
            >
              Leaderboard
            </button>
          </aside>
        </div>
      </div>

      <CreateMatchModal isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </ProtectPage>
  );
}
