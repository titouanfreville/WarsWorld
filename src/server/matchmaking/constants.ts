/**
 * Every matchmaking tunable in one place. Times are seconds unless the name ends in `_MS`. Kept
 * framework-free so `queue.ts` / `map-ban.ts` stay pure and testable.
 */

// --- Fairness tolerance (widens with wait) ---
//
// Measured in P(win) DISTANCE FROM 0.5, not rating points. These used to be 400-scale Elo gaps; the
// port to OpenSkill couldn't convert them, because win probability depends on σ as well as Δμ:
//
//   +8.7 μ -> P(win) 0.745 at a starting σ (8.33)
//   +8.7 μ -> P(win) ~0.91 at a converged σ (~2)
//
// ...so ANY fixed μ tolerance is right at exactly one σ and wrong at every other — worst precisely
// for the wide-σ newcomers a tolerance exists to protect. Gating on `predictWin` reads σ natively:
// a provisional player matches loosely, a settled one tightly, with no conversion anywhere.
//
// Calibrated to roughly reproduce the old Elo feel (100 Elo ≈ P 0.64), NOT measured. Revisit with
// queue data — see .ai/plans/ranked-ladder-plan.md §4.1.

/** Acceptable |P(win) − 0.5| at 0s waited. 0.12 ⇒ accept a 0.38..0.62 matchup immediately. */
export const BASE_TOLERANCE = 0.12;

/** Extra tolerance per second waited (~1.2 percentage points/s). */
export const TOLERANCE_RATE = 0.012;

/**
 * Cap, so a lonely extreme-rating player still eventually matches with ANYONE. Must be 0.5 (the
 * maximum possible unfairness) for that to be literally true — at 0.49 a 99%-certain matchup never
 * pairs and its player waits forever, which is the one thing this cap exists to prevent.
 */
export const MAX_TOLERANCE = 0.5;

// --- Ready-check (AFK accept window) ---

/** |P(win) − 0.5| above this ⇒ wide-gap match: longer window, no sanction for declining. */
export const LENIENT_GAP = 0.25;
export const READY_SECONDS = 20;
export const READY_SECONDS_LENIENT = 40;

// --- Queue loop / anti-rematch ---
export const TICK_MS = 2000; // how often the pairing pass runs
export const REMATCH_COOLDOWN_MS = 30_000; // a declined pair isn't re-offered for this long

// --- Map pick & ban ---
export const MAP_POOL_SIZE = 7; // candidate maps; 2 players × 2 bans leaves ≥3 to vote on
export const BANS_PER_PLAYER = 2;
// Smallest pool that still leaves a votable survivor after both players spend every ban
// (2 players × BANS_PER_PLAYER + 1). Below this the ban phase is degenerate; the last-survivor
// guard in `canBan` keeps it safe, but we warn because it signals too few eligible maps in the DB.
export const MIN_MAP_POOL_SIZE = BANS_PER_PLAYER * 2 + 1;
export const SECONDS_PER_MAP_DECISION = 30; // time budgeted per ban and for the final vote
// Whole ban/vote phase = one shared deadline covering every ban + the vote (BANS_PER_PLAYER + 1).
export const MAP_PHASE_SECONDS = (BANS_PER_PLAYER + 1) * SECONDS_PER_MAP_DECISION; // 90s
// After both vote, both players study the rolled map for this long before the CO pick begins.
export const MAP_REVEAL_SECONDS = 30;
