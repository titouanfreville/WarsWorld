"use client";

import { coArtUrl, coPortraitUrl, coPoseUrl } from "frontend/utils/sprites";
import { useState } from "react";

/**
 * FE-local shape of the BE-derived game-over flag (from `match.full`'s `gameOver`). Redeclared here
 * per the frontend contract rule (no `shared/` import); the BE stays the single source of the
 * outcome — the client only renders it.
 */
type GameOverInfo = { viewerWon: boolean; winnerTeamIndex: number | null };

/** One general in the end-of-match cast, tagged with how their match ended. */
export type CoResult = {
  name: string;
  /** Set once the match is finalized; absent only in the brief window before finalize. */
  result?: "won" | "lost" | "drawn";
  /** The player viewing this screen — gets a "You" tag on their CO. */
  isViewer: boolean;
};

type Outcome = "victory" | "defeat" | "draw";

const outcomeOf = ({ viewerWon, winnerTeamIndex }: GameOverInfo): Outcome =>
  viewerWon ? "victory" : winnerTeamIndex === null ? "draw" : "defeat";

const WORD: Record<Outcome, string> = { victory: "VICTORY", defeat: "DEFEAT", draw: "DRAW" };

const PROMPT: Record<Outcome, string> = {
  victory: "The battlefield is yours",
  defeat: "Your forces are broken",
  draw: "Mutual annihilation",
};

// Winners first so a 1v1 reads left-to-right as winner → loser.
const rankOf = (result?: CoResult["result"]): number =>
  result === "won" ? 0 : result === "lost" ? 2 : 1;

const coModifier = (result?: CoResult["result"]): string =>
  result === "won" ? "is-win" : result === "lost" ? "is-lose" : "is-draw";

/**
 * Ordered art candidates for a CO, best first: a dedicated win/lose pose if one has been authored
 * (see docs/co-pose-art-spec.md), then the neutral smooth art, then the pixel mugshot. The win/lose
 * *feeling* is derived in CSS (colour + lift vs grey + slump) regardless, so this degrades cleanly
 * for any CO that lacks custom pose art.
 */
const artCandidates = (co: CoResult): string[] => {
  const pose = co.result === "won" ? "win" : co.result === "lost" ? "lose" : null;

  return [
    ...(pose !== null ? [coPoseUrl(co.name, pose)] : []),
    coArtUrl(co.name),
    coPortraitUrl(co.name, "full"),
  ];
};

/** One CO in the cast — walks the candidate art list on load error, hiding only if all are missing. */
function CoFigure({ co }: { co: CoResult }) {
  const candidates = artCandidates(co);
  const [candidate, setCandidate] = useState(0);

  if (candidate >= candidates.length) {
    return null;
  }

  return (
    <figure className={`ww-go__co ${coModifier(co.result)}`}>
      <img
        className="ww-go__co-img"
        src={candidates[candidate]}
        alt=""
        aria-hidden="true"
        onError={() => setCandidate((index) => index + 1)}
      />
      <figcaption className="ww-go__co-name">
        {co.name}
        {co.isViewer && <span className="ww-go__you">You</span>}
      </figcaption>
    </figure>
  );
}

/**
 * End-of-match victory/defeat animation (Epic 1) — a "battle-result cutscene" overlaid on the board.
 * The CO cast lines up along the bottom (winners in colour with a triumphant lift, losers drained to
 * grey and slumped) under a stamped RussoOne word themed by the VIEWER's outcome, plus a diagonal
 * light sweep and a CRT scanline. Purely presentational and desync-proof: driven by the BE-derived
 * `gameOver` flag and each player's `result`, never a client-side decision. Reduced-motion falls back
 * to a crossfade (see gameOver.scss).
 *
 * Follow-up (Epic 2 / Layer C): the timed transition from this "moment" into the full End-Game
 * screen. See .ai/plans/end-game-screen-plan.md.
 */
export function GameOverOverlay({
  gameOver,
  cos,
  secondsLeft,
  onContinue,
}: {
  gameOver: GameOverInfo;
  cos: CoResult[];
  /** Seconds until the End-Game screen auto-loads; shown next to the Continue button. */
  secondsLeft?: number;
  /** Skip the remaining hold and open the End-Game screen now. Omit to hide the control. */
  onContinue?: () => void;
}) {
  const outcome = outcomeOf(gameOver);
  const lineup = [...cos].sort((a, b) => rankOf(a.result) - rankOf(b.result));

  return (
    <div
      className={`ww-go is-${outcome} @absolute @inset-0 @z-20 @overflow-hidden`}
      role="alertdialog"
      aria-label={`${WORD[outcome]} — game over`}
    >
      <div className="ww-go__backdrop @absolute @inset-0 @bg-black/60" />
      {lineup.length > 0 && (
        <div className="ww-go__cast">
          {lineup.map((co, index) => (
            <CoFigure key={`${co.name}-${index}`} co={co} />
          ))}
        </div>
      )}
      <div className="ww-go__sweep @absolute @inset-0 @pointer-events-none" />
      <div className="ww-go__banner">
        <div className="ww-go__stampWrap @relative @flex @flex-col @items-center">
          <div className="ww-go__word @relative @select-none">{WORD[outcome]}</div>
        </div>
        <p className="ww-go__prompt @relative @mt-4 @text-xs @uppercase @tracking-[0.3em] @text-white/70">
          {PROMPT[outcome]}
        </p>
        {onContinue !== undefined && (
          <div className="ww-go__continue @relative @mt-6 @flex @items-center @gap-3">
            {secondsLeft !== undefined && (
              <span className="ww-go__count">Results in {secondsLeft}s</span>
            )}
            <button type="button" className="ww-go__continue-btn" onClick={onContinue}>
              Continue →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
