/**
 * Every matchmaking tunable in one place (per the plan). Times are seconds unless the name ends in
 * `_MS`. Kept framework-free so `queue.ts` / `map-ban.ts` stay pure and testable.
 */

// --- MMR tolerance (grows with wait) ---
export const BASE_TOLERANCE = 100; // acceptable |ΔMMR| at 0s waited
export const TOLERANCE_RATE = 15; // extra acceptable |ΔMMR| per second waited
export const MAX_TOLERANCE = 2000; // cap so a lonely extreme-rating player still eventually matches

// --- Ready-check (AFK accept window) ---
export const LENIENT_GAP = 400; // |ΔMMR| above this → wide-gap match: longer window, no sanction
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
