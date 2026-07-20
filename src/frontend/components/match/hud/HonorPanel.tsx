"use client";

import { ARMY_HEX, ARMY_LABEL, coPortraitUrl, type Army } from "frontend/utils/sprites";
import { trpc } from "frontend/utils/trpc-client";
import { useState } from "react";
import { HonorInsignia } from "./HonorInsignia";

/** The medal palette, keyed by the API's `MedalType` (literal keys stay assignable to the input). */
const MEDALS = [
  { medal: "GOOD_CONDUCT", emoji: "👏", name: "Good Conduct" },
  { medal: "MEDAILLE_MILITAIRE", emoji: "🤝", name: "Médaille Militaire" },
  { medal: "CROIX_DE_GUERRE", emoji: "⚔️", name: "Croix de Guerre" },
] as const;

const MEDAL_BY_KEY = new Map(MEDALS.map((entry) => [entry.medal as string, entry]));

/** The end-of-match cast, enough to draw each opponent's badge (portrait + name + faction colour). */
type HonorPlayer = { id: string; name: string; army: Army; coName: string; isViewer: boolean };

/** One opponent, drawn as their identity badge with a trailing slot (vote buttons, or the medal given). */
function OpponentBadge({ player, children }: { player: HonorPlayer; children: React.ReactNode }) {
  return (
    <div className="egs-hon__badge" style={{ ["--army" as string]: ARMY_HEX[player.army] }}>
      <img
        className="egs-hon__badge-portrait"
        src={coPortraitUrl(player.coName, "full")}
        alt={player.coName}
      />
      <div className="egs-hon__badge-meta">
        <p className="egs-hon__badge-name">{player.name}</p>
        <p className="egs-hon__badge-army">{ARMY_LABEL[player.army]}</p>
      </div>
      {children}
    </div>
  );
}

/**
 * The Honor panel on the End-Game screen (Epic 6): the viewer's own standing (the reusable insignia)
 * plus the award action — one medal, to one opponent, per match. Matchmaking games only; the BE
 * enforces the rules and, via `honor.myAward`, remembers the choice — so once cast, the vote buttons
 * are replaced by the medal shown on that opponent's badge, and it survives a reload (it used to live
 * only in transient client state, so you couldn't see whether or what you'd voted).
 */
export function HonorPanel({
  matchId,
  viewerId,
  players,
}: {
  matchId: string;
  viewerId: string | undefined;
  players: HonorPlayer[];
}) {
  const summary = trpc.endgame.summary.useQuery({ matchId });
  const myAward = trpc.honor.myAward.useQuery(
    { matchId, playerId: viewerId ?? "" },
    { enabled: viewerId !== undefined },
  );
  const utils = trpc.useUtils();
  const award = trpc.honor.award.useMutation();
  const [error, setError] = useState<string | null>(null);

  const onAward = (giverId: string, toId: string, medal: (typeof MEDALS)[number]["medal"]) => {
    setError(null);
    award.mutate(
      { playerId: giverId, matchId, toPlayerId: toId, medal },
      {
        onSuccess: () => {
          // Persisted now — re-read so the panel flips to "you commended X", reload-proof.
          void utils.honor.myAward.invalidate({ matchId });
          void utils.honor.standing.invalidate({ playerId: toId });
        },
        onError: (mutationError) => setError(mutationError.message),
      },
    );
  };

  const opponents = players.filter((player) => player.id !== viewerId);
  const given = myAward.data ?? null;
  const givenTo = given === null ? undefined : opponents.find((player) => player.id === given.toId);

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
      ) : viewerId === undefined ? null : given !== null ? (
        // Already commended — one per match. Show who got it and which medal, no more buttons.
        <>
          <p className="egs-hon__sub">Your commendation</p>
          {givenTo !== undefined ? (
            <OpponentBadge player={givenTo}>
              <div className="egs-hon__given">
                <span className="egs-hon__given-emoji">
                  {MEDAL_BY_KEY.get(given.medal)?.emoji ?? "🎖️"}
                </span>
                <span>{MEDAL_BY_KEY.get(given.medal)?.name ?? given.medal}</span>
              </div>
            </OpponentBadge>
          ) : (
            <p className="egs__panel-body">
              You awarded {MEDAL_BY_KEY.get(given.medal)?.name ?? given.medal} — gg!
            </p>
          )}
        </>
      ) : (
        <>
          <p className="egs-hon__sub">Award a medal — one per match</p>
          {opponents.map((opponent) => (
            <OpponentBadge key={opponent.id} player={opponent}>
              <div className="egs-hon__buttons">
                {MEDALS.map((entry) => (
                  <button
                    key={entry.medal}
                    type="button"
                    className="egs-hon__btn"
                    disabled={award.isLoading}
                    onClick={() => onAward(viewerId, opponent.id, entry.medal)}
                    title={entry.name}
                    aria-label={`Award ${entry.name} to ${opponent.name}`}
                  >
                    {entry.emoji}
                  </button>
                ))}
              </div>
            </OpponentBadge>
          ))}
          {error !== null && <p className="egs-hon__err">{error}</p>}
        </>
      )}
    </section>
  );
}
