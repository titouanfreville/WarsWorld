import type { GameMode } from "frontend/context/matchmaking";
import { MERIT_PER_DIVISION, RANK_META, romanDivision } from "./rank-meta";

/**
 * A player's ladder position for one mode: rank, division, Military Merit, and the bar to the next
 * promotion. Placements show no rank at all — an unsettled estimate isn't a rank yet.
 *
 * This is the ONLY ranked number a player sees. The hidden OpenSkill rating never reaches the
 * client: no endpoint returns it.
 */

export type RankView = {
  mode: GameMode;
  rank: string;
  division: number;
  merit: number;
  peakRank: string | null;
  games: number;
  inPlacements: boolean;
};

/** How many rated games a player typically needs before sigma settles. Display only — the gate is sigma. */
const TYPICAL_PLACEMENTS = 10;

export default function RankCard({ view }: { view: RankView | undefined }) {
  if (view === undefined) {
    return (
      <div className="@rounded-xl @bg-bg-primary/70 @p-4 @outline @outline-1 @outline-bg-tertiary">
        <p className="@py-0 @text-xs @uppercase @tracking-wide @text-slate-500">Your rank</p>
        <p className="@py-0 @pt-2 @text-sm @text-slate-500">
          Play a ranked game to start your placements.
        </p>
      </div>
    );
  }

  const meta = RANK_META[view.inPlacements ? "cadet" : view.rank] ?? RANK_META.cadet;
  const showDivisions = !view.inPlacements && meta.divisions;

  // Placements fill toward a typical count; a ranked player fills toward their next promotion.
  const progress = view.inPlacements
    ? Math.min(100, (view.games / TYPICAL_PLACEMENTS) * 100)
    : Math.min(100, (view.merit / MERIT_PER_DIVISION) * 100);

  return (
    <div className="@rounded-xl @bg-bg-primary/70 @p-4 @outline @outline-1 @outline-bg-tertiary">
      <p className="@py-0 @text-xs @uppercase @tracking-wide @text-slate-500">Your rank</p>

      <div className="@pt-3 @text-center">
        <div
          className={`@mx-auto @grid @h-14 @w-14 @place-items-center @rounded-full @bg-black/30 @font-russoOne @outline @outline-2 ${meta.emblem}`}
        >
          {view.inPlacements ? "?" : showDivisions ? romanDivision(view.division) : "★"}
        </div>

        <p className="@py-0 @pt-2 @font-russoOne @text-lg @tracking-wide">
          {view.inPlacements ? "Placement" : meta.label}
          {showDivisions && ` ${romanDivision(view.division)}`}
        </p>

        <p className="@py-0 @text-xs @text-slate-400">
          {view.inPlacements ? (
            <>
              <span className="@font-semibold @text-white">{view.games}</span> /{" "}
              {TYPICAL_PLACEMENTS} games
            </>
          ) : (
            <>
              <span className="@font-semibold @text-white">{view.merit}</span>
              {meta.divisions ? ` / ${MERIT_PER_DIVISION} Merit` : " Merit"}
            </>
          )}
        </p>

        <div className="@my-2 @h-[3px] @overflow-hidden @rounded @bg-bg-tertiary/50">
          <div className="@h-full @bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <p className="@my-0 @rounded @bg-black/25 @p-2 @text-[0.68rem] @leading-snug @text-slate-500">
        {view.inPlacements
          ? "Placements run until your rating settles, not for a fixed number of games — 10 is typical."
          : "Ranked Standard and Ranked Fog both feed this ladder."}
      </p>

      {view.peakRank !== null && !view.inPlacements && (
        <p className="@py-0 @pt-2 @text-[0.68rem] @text-slate-500">
          Peak: {RANK_META[view.peakRank]?.label ?? view.peakRank}
        </p>
      )}
    </div>
  );
}
