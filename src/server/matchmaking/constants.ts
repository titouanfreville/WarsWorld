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
// WIDENING IS EXPONENTIAL-IN-TIME (was linear). MMR never gates — the ceiling is 0.5 (the max
// unfairness the metric can express), reached slowly rather than being a wall. The curve is
// `BASE + SCALE·ln(1 + t/τ)`: a close match pairs in seconds, and each further step of leniency
// costs exponentially more waiting. Tunable; calibrate against queue data — see plan §4.1.

/** Acceptable |P(win) − 0.5| at 0s waited. 0.12 ⇒ accept a 0.38..0.62 matchup immediately. */
export const BASE_TOLERANCE = 0.12;

/** Time constant (s) of the log widening. At t = τ the tolerance has grown by SCALE·ln2. */
export const TOLERANCE_TAU = 25;

/** Multiplier on `ln(1 + t/τ)`. With τ=25, SCALE=0.16: ~0.5 (any matchup) after ~5 min waited. */
export const TOLERANCE_SCALE = 0.16;

/**
 * Ceiling, so a lonely extreme-rating player still eventually matches with ANYONE. 0.5 is the
 * maximum possible unfairness — reaching it is what makes "eventually pairs with anyone" literally
 * true. It is a ceiling on a curve, not a gate: MMR alone never blocks a pairing.
 */
export const MAX_TOLERANCE = 0.5;

// --- Rank band (ranked only) ---
//
// Ranked pairs within a RANK band, not just on MMR. The band starts at ±1 and relaxes on the SAME
// exponential-in-time shape as MMR, but with a much larger time constant: a rank gap is VISIBLE to
// the player (a hidden-MMR mismatch is swallowed far more readily than "I got matched two ranks
// up"), so it must widen slower. Hard-capped at a fraction of the ladder height — beyond that we do
// NOT pair, ever. Placements (no rank yet) and casual ignore the band entirely.

/** Time constant (s) for widening the rank band. Much larger than TOLERANCE_TAU — ranks are visible. */
export const RANK_GAP_TAU = 120;

/**
 * Hard ceiling on the rank gap, as a fraction of the active-rank ladder height. 0.6 ⇒ with 5 active
 * ranks the gap never exceeds 3; grow the ladder to 10 and it becomes 6. Past this, no pairing.
 */
export const MAX_RANK_GAP_FRACTION = 0.6;

// --- Ready-check (AFK accept window) ---

/** |P(win) − 0.5| above this ⇒ wide-gap match: longer window, no sanction for declining. */
export const LENIENT_GAP = 0.25;
export const READY_SECONDS = 20;
export const READY_SECONDS_LENIENT = 40;

// --- Queue loop / anti-rematch ---
export const TICK_MS = 2000; // how often the pairing pass runs
export const REMATCH_COOLDOWN_MS = 30_000; // a just-DECLINED pair isn't re-offered for this long

// --- Anti-rematch by recency (relaxes with wait) ---
//
// After you FINISH a game with someone, avoid re-pairing the two of you for a while — but relax it as
// your queue wait grows, on the same exponential-time idea as the tolerance/rank curves: fresh in
// queue you'll only rematch opponents you finished with a long time ago; the longer you wait, the
// more recently-played opponents you'll accept. Never a permanent block (`requiredGap → 0`). The
// required gap is `BASE·e^(−wait/τ)`; an opponent clears if you finished with them longer ago than
// that. A direct rematch (spawned outside the queue; disabled in ranked) is unaffected.

/** At 0s waited, only rematch someone you last finished with ≥ this long ago (seconds). */
export const REMATCH_BASE_GAP_SEC = 1800;

/** Queue-wait time constant for relaxing the rematch gap. Smaller ⇒ recent opponents free up sooner. */
export const REMATCH_TAU = 60;

/** No point loading opponents older than the 0-wait gap — they never block. */
export const REMATCH_LOOKBACK_MS = REMATCH_BASE_GAP_SEC * 1000;

// --- Map pick & ban ---
export const MAP_POOL_SIZE = 7; // candidate maps; a duel's 2 × 2 bans leaves ≥3 to vote on

/**
 * Bans each player gets, by how many are picking.
 *
 * TWO in a duel, ONE in a 4-player mode. Not a scaling accident — total bans are what the pool has
 * to absorb, and four players banning twice would strike 8 of a 7-map pool. Keeping the total at
 * roughly half the pool is what leaves a real vote at the end, and it keeps the blind-ban phase
 * short enough that three people aren't waiting on a fourth for two full decisions.
 */
export const bansPerPlayer = (playerCount: number): number => (playerCount <= 2 ? 2 : 1);

/**
 * Smallest pool that still leaves a votable survivor once EVERY player spends EVERY ban
 * (`playerCount × bansPerPlayer + 1`).
 *
 * This is a HARD FLOOR, not a warning threshold. Bans are blind, so `canBan` deliberately cannot
 * consult the other players' bans — which means it cannot refuse the ban that empties the pool
 * either (refusing would leak what someone else banned). This is the ONLY thing standing between a
 * lobby and a pool with no survivors, where nobody can vote and everyone gets flagged as an
 * abandoner for a vote they were never allowed to cast. A pool below it must never reach the ban
 * phase; see `createReadyCheck`, which refuses to start one.
 */
export const minMapPoolSize = (playerCount: number): number =>
  playerCount * bansPerPlayer(playerCount) + 1;

export const SECONDS_PER_MAP_DECISION = 30; // time budgeted per ban and for the final vote

/**
 * Bans and the vote are SEPARATE deadlines because bans are BLIND: you can't vote until everyone has
 * spent their bans (that's the moment bans reveal), so a shared deadline would let a slow opponent
 * eat your voting time — and get you flagged for a vote you were never allowed to cast.
 */
export const mapBanSeconds = (playerCount: number): number =>
  bansPerPlayer(playerCount) * SECONDS_PER_MAP_DECISION;
export const MAP_VOTE_SECONDS = SECONDS_PER_MAP_DECISION; // 30s, restarted when the bans reveal
// After both vote, both players study the rolled map for this long before the CO pick begins.
export const MAP_REVEAL_SECONDS = 30;
