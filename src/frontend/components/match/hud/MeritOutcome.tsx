"use client";

import { RANK_META, romanDivision } from "frontend/components/matchmaking/rank-meta";
import { trpc } from "frontend/utils/trpc-client";

/** Matches RankCard's display target; the real gate is sigma, this is only for the placement bar. */
const TYPICAL_PLACEMENTS = 10;

/**
 * The viewer's Merit swing from a ranked match, shown under the End-Game headline (the "MM win/loss"
 * a player wants to see the moment a rated game ends).
 *
 * Renders nothing for casual/unranked games — `ranking.matchOutcome` returns null (no MeritEvent).
 * During placements the rank is withheld exactly as everywhere else (the estimate isn't a rank yet),
 * so it shows placement progress instead of a delta. Presentation only; the BE owns the numbers.
 */
export function MeritOutcome({
  matchId,
  viewerId,
}: {
  matchId: string;
  viewerId: string | undefined;
}) {
  const { data } = trpc.ranking.matchOutcome.useQuery(
    { matchId, playerId: viewerId ?? "" },
    { enabled: viewerId !== undefined },
  );

  // undefined = still loading; null = casual game, nothing to show.
  if (data === undefined || data === null) {
    return null;
  }

  if (data.inPlacements) {
    return (
      <div className="@mt-3 @inline-flex @items-center @gap-2 @rounded-full @border @border-white/15 @bg-black/30 @px-3 @py-1.5 @text-[0.7rem] @font-semibold @uppercase @tracking-[0.15em] @text-slate-300">
        <span className="@h-1.5 @w-1.5 @rounded-full @bg-primary" />
        Placement · {Math.min(data.games, TYPICAL_PLACEMENTS)}/{TYPICAL_PLACEMENTS}
      </div>
    );
  }

  const meta = RANK_META[data.rank] ?? RANK_META.cadet;
  const gained = data.delta >= 0;
  const rankLabel = meta.divisions ? `${meta.label} ${romanDivision(data.division)}` : meta.label;

  return (
    <div className="@mt-3 @inline-flex @items-center @gap-2.5 @rounded-full @border @border-white/15 @bg-black/30 @py-1.5 @pl-3 @pr-4">
      <span
        className={`@font-russoOne @text-base @leading-none ${
          gained ? "@text-green-400" : "@text-rose-400"
        }`}
      >
        {gained ? "+" : "−"}
        {Math.abs(data.delta)}
      </span>
      <span className="@text-[0.7rem] @font-semibold @uppercase @tracking-[0.15em] @text-slate-400">
        Merit
      </span>
      <span className="@h-3.5 @w-px @bg-white/15" />
      <span className={`@font-russoOne @text-xs @tracking-wide ${meta.emblem.split(" ")[0]}`}>
        {rankLabel}
      </span>
    </div>
  );
}
