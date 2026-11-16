import { usePlayers } from "frontend/context/players";
import { MODE_LABEL, RULESET_LABEL, useQueue } from "frontend/context/matchmaking";
import { trpc } from "frontend/utils/trpc-client";
import { useEffect, useState } from "react";

/** Re-render every second so timers tick. */
const useNow = (active: boolean): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) {
      return;
    }

    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
};

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
};

/**
 * The docked, non-blocking matchmaking widget. Rendered globally by `ProvideQueue`; shows nothing
 * unless the player is searching or in a ready-check (the map-ban phase has its own overlay).
 */
export default function QueueWidget() {
  const { state, leave } = useQueue();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";

  const accept = trpc.matchmaking.acceptReadyCheck.useMutation();
  const decline = trpc.matchmaking.declineReadyCheck.useMutation();

  const active = state.phase === "searching" || state.phase === "ready";
  const now = useNow(active);

  if (state.phase === "idle" || state.phase === "map") {
    return null;
  }

  const shell =
    "@fixed @bottom-5 @right-5 @z-50 @w-[340px] @overflow-hidden @rounded-2xl @border @border-bg-tertiary @text-white @shadow-2xl @shadow-black/60";
  const bg = { background: "linear-gradient(180deg,#20304f,#1a2540)" };

  if (state.phase === "searching") {
    const waited = now - state.since;

    return (
      <div className={shell} style={bg}>
        <div className="@flex @items-center @gap-2.5 @border-b @border-white/10 @bg-[#1a2440] @px-4 @py-3">
          <span className="@relative @h-2.5 @w-2.5 @flex-none @rounded-full @bg-primary">
            <span className="@absolute @inset-0 @animate-ping @rounded-full @bg-primary/70" />
          </span>
          <span className="@text-xs @font-bold @uppercase @tracking-[0.14em]">Finding match</span>
          <span className="@ml-auto @rounded-full @border @border-primary-dark @px-2 @py-[3px] @text-[10px] @font-bold @uppercase @tracking-wider @text-primary-light">
            {MODE_LABEL[state.mode]} · {RULESET_LABEL[state.ruleset]}
          </span>
        </div>
        <div className="@px-4 @pb-4 @pt-4">
          <div className="@flex @items-baseline @gap-2.5">
            <span className="@font-mono @text-4xl @font-extrabold @tabular-nums">
              {mmss(waited)}
            </span>
            <span className="@text-[10px] @font-semibold @uppercase @tracking-[0.14em] @text-slate-500">
              elapsed
            </span>
          </div>
          {/* No MMR number: the rating is hidden by design. We say the search is widening, not by
              how much. */}
          <p className="@mt-4 @py-0 @text-[11px] @uppercase @tracking-wide @text-slate-400">
            Widening the search the longer you wait.
          </p>
          <button
            className="@mt-4 @w-full @rounded-lg @border @border-white/15 @bg-[#182238] @py-2.5 @text-xs @font-bold @uppercase @tracking-wider @text-slate-300 @transition hover:@border-slate-400 hover:@text-white"
            onClick={leave}
          >
            Cancel search
          </button>
        </div>
      </div>
    );
  }

  // Ready-check.
  const remaining = new Date(state.readyEndsAt).getTime() - now;
  const accent = state.lenient ? "#e0a53b" : "#E47220";

  return (
    <div className={shell} style={bg}>
      <div className="@flex @items-center @gap-2.5 @border-b @border-white/10 @bg-[#1a2440] @px-4 @py-3">
        <span className="@h-2.5 @w-2.5 @flex-none @rounded-full" style={{ background: accent }} />
        <span className="@text-xs @font-bold @uppercase @tracking-[0.14em]">Match found</span>
        <span
          className="@ml-auto @rounded-full @border @px-2 @py-[3px] @text-[10px] @font-bold @uppercase @tracking-wider"
          style={{ borderColor: `${accent}66`, color: accent }}
        >
          {state.lenient ? "Wide gap" : "Ready check"}
        </span>
      </div>
      <div className="@px-4 @pb-4 @pt-4">
        <div className="@flex @items-center @gap-3">
          <span
            className="@font-mono @text-4xl @font-extrabold @tabular-nums"
            style={{ color: accent }}
          >
            {Math.max(0, Math.ceil(remaining / 1000))}
          </span>
          {/* No odds/gap number — the rating is hidden, and a lopsided ranked game can't happen (the
              rank band prevents it), so there's nothing to warn about here. */}
          <p className="@py-0 @text-[11px] @leading-snug @text-slate-400">
            Both players must accept to launch.
          </p>
        </div>

        {state.lenient && (
          <div
            className="@mt-3 @rounded-lg @border @px-3 @py-2 @text-[11px] @leading-snug"
            style={{
              background: "rgba(224,165,59,.10)",
              borderColor: "rgba(224,165,59,.4)",
              color: "#f0d295",
            }}
          >
            <b style={{ color: accent }}>Wide skill gap.</b> Decline with no penalty — no flag
            either way.
          </div>
        )}

        {accept.isSuccess ? (
          // Accepting is a commitment — once in, you can't back out; just wait for the opponent.
          <p className="@mt-4 @py-0 @text-center @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300">
            Waiting for opponent…
          </p>
        ) : (
          <div className="@mt-4 @flex @gap-2">
            <button
              className="@flex-1 @rounded-lg @py-2.5 @text-xs @font-bold @uppercase @tracking-wider @text-black @transition hover:@brightness-110 disabled:@opacity-50"
              style={{ background: accent }}
              disabled={accept.isLoading}
              onClick={() => accept.mutate({ lobbyId: state.lobbyId, playerId })}
            >
              Accept
            </button>
            {/* Declining only exists for wide-gap matches; a normal ranked check must be accepted
                or it times out (and flags you). */}
            {state.lenient && (
              <button
                className="@flex-1 @rounded-lg @border @border-red-500/40 @py-2.5 @text-xs @font-bold @uppercase @tracking-wider @text-red-300 @transition hover:@border-red-500 hover:@text-white disabled:@opacity-50"
                disabled={decline.isLoading}
                onClick={() => decline.mutate({ lobbyId: state.lobbyId, playerId })}
              >
                Decline · free
              </button>
            )}
          </div>
        )}

        {!state.lenient && !accept.isSuccess && (
          <p className="@mt-2 @py-0 @text-center @text-[10px] @uppercase @tracking-wide @text-slate-500">
            Accept, or it times out
          </p>
        )}
      </div>
    </div>
  );
}
