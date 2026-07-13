import { LEAGUE_LABEL, LEAGUES, useQueue, type League } from "frontend/context/matchmaking";
import { useState } from "react";

/**
 * The entry point into solo queue. A primary "Play ranked" button that opens a small league picker;
 * once searching, it flips to a live status pill (the docked widget owns the rest of the flow).
 */
export default function PlayButton() {
  const { state, join, leave, joining } = useQueue();
  const [pickerOpen, setPickerOpen] = useState(false);

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
        {LEAGUES.map((league: League) => (
          <button
            key={league}
            disabled={joining}
            onClick={() => {
              join(league);
              setPickerOpen(false);
            }}
            className="@rounded-md @px-2.5 @py-1.5 @text-xs @font-semibold @uppercase @tracking-wide @text-slate-300 @transition hover:@bg-primary hover:@text-black disabled:@opacity-50"
          >
            {LEAGUE_LABEL[league]}
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
