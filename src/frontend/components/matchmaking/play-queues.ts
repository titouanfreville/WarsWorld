import type { GameMode, Ruleset } from "frontend/context/matchmaking";

/**
 * The Play page's queue catalogue — pure, FE-local. A queue is (mode × ruleset × ranked): all three
 * axes, each independent. Ranked Standard and casual Standard are DIFFERENT queues that merely share
 * a ruleset.
 *
 * Types are structural so this imports nothing from the server; the BE re-validates every join, so
 * drift surfaces as a tsc error at the `join` call site.
 */

export type PlayMode = {
  mode: GameMode;
  label: string;
  blurb: string;
  seats: number;
  teamed: boolean;
};

/** Modes the queue can actually serve. `custom` isn't here — it's a lobby, not a queue. */
export const PLAY_MODES: PlayMode[] = [
  { mode: "duel", label: "1v1", blurb: "2 players · duel", seats: 2, teamed: false },
  { mode: "ffa", label: "FFA", blurb: "4 players · free-for-all", seats: 4, teamed: false },
  { mode: "teams", label: "2v2", blurb: "4 players · teams", seats: 4, teamed: true },
];

export type PlayQueue = { ruleset: Ruleset; ranked: boolean; label: string; blurb: string };

const RANKED: PlayQueue[] = [
  {
    ruleset: "standard",
    ranked: true,
    label: "Standard",
    blurb: "Clear weather, default funds. The ladder.",
  },
  { ruleset: "fog", ranked: true, label: "Fog of War", blurb: "Vision-limited. Same ladder." },
];

const CASUAL: PlayQueue[] = [
  { ruleset: "standard", ranked: false, label: "Standard", blurb: "Same rules, nothing at stake." },
  { ruleset: "fog", ranked: false, label: "Fog of War", blurb: "Fog, unranked." },
  {
    ruleset: "highFunds",
    ranked: false,
    label: "High Funds",
    blurb: "Fat economy, big armies, fast games.",
  },
];

/**
 * Ranked is duel-only for now. Not a technical limit — `rate()` handles FFA and teams natively — but
 * a design one: for N>2 the Merit expectation uses P(winning outright), which isn't the expectation
 * of a placement score (plan §4.2/§5). Worth settling before those ladders count for anything.
 */
export const queuesFor = (mode: GameMode): { ranked: PlayQueue[]; casual: PlayQueue[] } => ({
  ranked: mode === "duel" ? RANKED : [],
  casual: CASUAL,
});
