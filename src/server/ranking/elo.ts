/**
 * Pure Elo rating math. No I/O — fed plain numbers, returns plain numbers, so it's exhaustively
 * unit-testable. Used by the ranking usecase to move `MMR` on a ranked finalize.
 */

/** Every player/league starts here (matches the `MMR.mmr`/`topMmr` Prisma default). */
export const DEFAULT_MMR = 800;

/** Rating swing per game. Standard chess-club K; tune later if ratings move too fast/slow. */
export const ELO_K = 32;

/** Score a match result maps to: a win is 1, a draw ½, a loss 0. */
export type Score = 0 | 0.5 | 1;

/**
 * Expected score of `rating` against `opponentRating` (0..1). The classic logistic curve: equal
 * ratings → 0.5; +400 → ~0.91.
 */
export const expectedScore = (rating: number, opponentRating: number): number =>
  1 / (1 + 10 ** ((opponentRating - rating) / 400));

/**
 * New rating after a single game against one (possibly averaged) opponent rating. Symmetric and
 * zero-sum for 1v1: what the winner gains, the loser loses.
 */
export const nextRating = (rating: number, opponentRating: number, score: Score): number =>
  Math.round(rating + ELO_K * (score - expectedScore(rating, opponentRating)));

/** Map a stored `MatchPlayer.result` to its Elo score. Anything not "won"/"drawn" counts as a loss. */
export const scoreForResult = (result: string | null): Score =>
  result === "won" ? 1 : result === "drawn" ? 0.5 : 0;
