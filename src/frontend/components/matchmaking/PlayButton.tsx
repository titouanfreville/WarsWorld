import { RULESET_LABEL, RULESETS, useQueue, type Ruleset } from "frontend/context/matchmaking";
import { useState } from "react";

/**
 * A compact entry point into solo queue: a "Play ranked" button that opens a ruleset picker, then
 * flips to a live status pill (the docked widget owns the rest of the flow). /play is the full
 * surface; this is for headers.
 */
export default function PlayButton() {
  const { state, join, leave, joining, joinError, dismissJoinError } = useQueue();
  const [pickerOpen, setPickerOpen] = useState(false);

  // The server refuses a join it doesn't like ("finish your current match first"). Say so — a button
  // that silently does nothing reads as broken.
  if (joinError !== null) {
    return (
      <button
        onClick={dismissJoinError}
        title="Dismiss"
        className="@rounded-lg @border @border-red-500/40 @bg-red-950/40 @px-3 @py-2 @text-xs @text-red-200 hover:@text-white"
      >
        {joinError} ✕
      </button>
    );
  }

  if (state.phase !== "idle") {
    return (
      <div className="@flex @items-center @gap-2 @rounded-lg @border @border-primary/40 @bg-bg-secondary @px-3 @py-2">
        <span className="@relative @h-2 @w-2 @flex-none @rounded-full @bg-primary">
          <span className="@absolute @inset-0 @animate-ping @rounded-full @bg-primary/70" />
        </span>
        <span className="@text-xs @font-semibold @uppercase @tracking-wide @text-slate-200">
          {state.phase === "searching"
            ? "In queue…"
            : state.phase === "ready"
              ? "Match found!"
              : "Map ban…"}
        </span>
        {state.phase === "searching" && (
          <button
            className="@ml-1 @text-[11px] @font-semibold @uppercase @text-slate-500 hover:@text-white"
            onClick={leave}
          >
            Cancel
          </button>
        )}
      </div>
    );
  }

  if (pickerOpen) {
    return (
      <div className="@flex @flex-wrap @items-center @gap-1.5 @rounded-lg @border @border-bg-tertiary @bg-bg-secondary @p-1.5">
        {/* Duel-only picker: the queue takes a mode now, but there's no UI to choose one until the
            Play page lands (plan phase 7), so this keeps today's behaviour. */}
        {RULESETS.map((ruleset: Ruleset) => (
          <button
            key={ruleset}
            disabled={joining}
            onClick={() => {
              join({ mode: "duel", ruleset, ranked: true });
              setPickerOpen(false);
            }}
            className="@rounded-md @px-2.5 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 @transition hover:@bg-primary hover:@text-black disabled:@opacity-50"
          >
            {RULESET_LABEL[ruleset]}
          </button>
        ))}
        <button
          className="@px-2 @py-1.5 @text-xs @text-slate-500 hover:@text-white"
          onClick={() => setPickerOpen(false)}
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setPickerOpen(true)}
      className="@rounded-lg @bg-primary @px-5 @py-2.5 @font-russoOne @text-sm @uppercase @tracking-wider @text-black @transition hover:@brightness-110"
    >
      ▶ Play ranked
    </button>
  );
}
