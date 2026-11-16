import { useEffect, useRef, useState } from "react";

/** none = still playing · moment = victory/defeat animation holding · endgame = End-Game screen. */
export type EndGamePhase = "none" | "moment" | "endgame";

type Params = {
  /** The match is decided (BE-derived `gameOver` is non-null). */
  over: boolean;
  /** The match view has loaded — gates the reconnect check below (don't decide before data lands). */
  ready: boolean;
  /** How long the victory/defeat "moment" holds before the End-Game screen auto-loads (skippable). */
  holdSeconds?: number;
};

/**
 * Drives the end-of-match sequence for the board:
 * - while playing → `none`;
 * - when the match is decided *while we're watching* → play the victory/defeat `moment` for
 *   `holdSeconds` (a visible countdown; `skip()` jumps early), then auto-advance to `endgame`;
 * - a player who connects to an ALREADY-finished match (never saw it live) skips the moment and lands
 *   straight on the End-Game screen.
 *
 * Presentation only — the outcome itself is the BE's; this just sequences the screens.
 */
export function useEndGameFlow({ over, ready, holdSeconds = 20 }: Params) {
  const [phase, setPhase] = useState<EndGamePhase>("none");
  const [secondsLeft, setSecondsLeft] = useState(holdSeconds);
  // Set once we've seen the match still in progress this session, so a fresh connection to a finished
  // match doesn't replay the "moment" it never witnessed.
  const sawLiveRef = useRef(false);

  useEffect(() => {
    if (!ready) {
      return;
    }

    if (!over) {
      sawLiveRef.current = true;
      setPhase("none");

      return;
    }

    // Match is over: enter the moment if we watched it end, else jump to the End-Game screen. Once
    // we've left `none` we never recompute — the countdown / skip owns the moment→endgame transition.
    setPhase((prev) => (prev !== "none" ? prev : sawLiveRef.current ? "moment" : "endgame"));
  }, [ready, over]);

  useEffect(() => {
    if (phase !== "moment") {
      return;
    }

    setSecondsLeft(holdSeconds);
    let remaining = holdSeconds;

    const id = setInterval(() => {
      remaining -= 1;
      setSecondsLeft(remaining);

      if (remaining <= 0) {
        clearInterval(id);
        setPhase("endgame");
      }
    }, 1000);

    return () => clearInterval(id);
  }, [phase, holdSeconds]);

  return { phase, secondsLeft, skip: () => setPhase("endgame") };
}
