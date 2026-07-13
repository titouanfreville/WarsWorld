"use client";

import { trpc } from "frontend/utils/trpc-client";
import { useState } from "react";
import { HonorInsignia } from "./HonorInsignia";

/** The medal palette, keyed by the API's `MedalType` (literal keys stay assignable to the input). */
const MEDALS = [
  { medal: "GOOD_CONDUCT", emoji: "👏", name: "Good Conduct" },
  { medal: "MEDAILLE_MILITAIRE", emoji: "🤝", name: "Médaille Militaire" },
  { medal: "CROIX_DE_GUERRE", emoji: "⚔️", name: "Croix de Guerre" },
] as const;

/**
 * The Honor panel on the End-Game screen (Epic 6): the viewer's own standing (the reusable insignia)
 * plus the award action — grant one opponent a single medal. Matchmaking games only; the BE enforces
 * the rules (one per match, no self, participants only) and this reflects the outcome.
 */
export function HonorPanel({
  matchId,
  viewerId,
}: {
  matchId: string;
  viewerId: string | undefined;
}) {
  const summary = trpc.endgame.summary.useQuery({ matchId });
  const utils = trpc.useUtils();
  const award = trpc.honor.award.useMutation();
  const [awarded, setAwarded] = useState<{ toId: string; medal: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onAward = (giverId: string, toId: string, medal: (typeof MEDALS)[number]["medal"]) => {
    setError(null);
    award.mutate(
      { playerId: giverId, matchId, toPlayerId: toId, medal },
      {
        onSuccess: () => {
          setAwarded({ toId, medal });
          void utils.honor.standing.invalidate({ playerId: toId });
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  return (
    <section className="egs__panel">
      <header className="egs__panel-head">
        <h2 className="egs__panel-title">Honor</h2>
        {summary.data !== undefined && (
          <span className={`egs__soon${summary.data.isRanked ? " is-mm" : ""}`}>
            {summary.data.isRanked ? "Matchmaking" : "Custom game"}
          </span>
        )}
      </header>

      {viewerId !== undefined && (
        <>
          <p className="egs-hon__sub">Your standing</p>
          <HonorInsignia playerId={viewerId} />
        </>
      )}

      {summary.data === undefined ? null : !summary.data.isRanked ? (
        <p className="egs__panel-body">Honor is only awarded in matchmaking games.</p>
      ) : viewerId === undefined ? null : (
        <>
          <p className="egs-hon__sub">Award a medal — one per match</p>
          {summary.data.players
            .filter((player) => player.playerId !== viewerId)
            .map((opponent) => (
              <div className="egs-hon__award" key={opponent.playerId}>
                <span className="egs-hon__opp">{opponent.name}</span>
                <div className="egs-hon__buttons">
                  {MEDALS.map((entry) => {
                    const picked =
                      awarded?.toId === opponent.playerId && awarded.medal === entry.medal;

                    return (
                      <button
                        key={entry.medal}
                        type="button"
                        className={`egs-hon__btn${picked ? " is-picked" : ""}`}
                        disabled={awarded !== null || award.isLoading}
                        onClick={() => onAward(viewerId, opponent.playerId, entry.medal)}
                        title={entry.name}
                        aria-label={`Award ${entry.name} to ${opponent.name}`}
                      >
                        {entry.emoji}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          {awarded !== null && <p className="egs-hon__done">Medal awarded — gg!</p>}
          {error !== null && <p className="egs-hon__err">{error}</p>}
        </>
      )}
    </section>
  );
}
