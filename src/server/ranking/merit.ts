import type { Rank } from "@prisma/client";

/**
 * Military Merit + the military-rank ladder — the DISPLAYED half of ranked. Pure math, no I/O.
 *
 * Two numbers, two jobs (plan §1):
 *   - hidden skill (`skill.ts`, OpenSkill μ/σ) pairs opponents and sizes Merit. Never shown.
 *   - rank + Merit (here) is progression and identity. Never used for pairing.
 *
 * Merit is STORED, not derived from skill. A rank that's a pure function of μ yo-yos with every
 * result and reads as noise; storing it and nudging it toward skill is what makes a ladder feel like
 * progress. That nudge is {@link convergence}.
 *
 * NAMING — none of this is free, see plan §1.1:
 *   - `general` means Commanding Officer in this codebase (38 files, incl. the Prisma schema), so
 *     the apex is `marechal` — French, matching the MEDAILLE_MILITAIRE / CROIX_DE_GUERRE medals.
 *   - `recruit` is honor's pre-Bronze tier, so entry is `cadet`.
 *   - Canon Advance Wars "ranks" ARE the S/A/B/C War Room grades, already used per-match by
 *     computeGrades — which is exactly why this ladder uses military titles instead.
 *   - Never abbreviate Military Merit to "MM": one letter from MMR, the other number in this system.
 */

/** Ladder order, lowest first. The Prisma `Rank` enum in the same order. */
export const RANK_ORDER: Rank[] = [
  "cadet",
  "private",
  "sergeant",
  "lieutenant",
  "captain",
  "major",
  "colonel",
  "marechal",
];

/**
 * Which ranks exist right now. The full ladder ships in the enum; only four are reachable, and more
 * activate as the playerbase grows — the ladder grows in the MIDDLE (sergeant sits between private
 * and lieutenant), which is why this is a SET, not a ceiling.
 *
 * Activation must only ever happen at a season rollover, never mid-season: percentile bands are safe
 * precisely because activation coincides with re-placement, so the re-sort is expected rather than a
 * silent reshuffle. Seasons are phase 6 — this constant is where `Season.activeRanks` will live.
 */
export const ACTIVE_RANKS: Rank[] = ["cadet", "private", "lieutenant", "captain", "marechal"];

/** Divisions per rank, best-first when displayed (V is the lowest, I the highest). */
export const DIVISIONS_PER_RANK = 5;
export const MERIT_PER_DIVISION = 100;

/** Cadet is placements; Marechal is the apex — neither carries divisions. */
export const hasDivisions = (rank: Rank): boolean => rank !== "cadet" && rank !== "marechal";

/** The ladder as actually climbable today: everything active except placements and the apex. */
const CLIMBABLE = (): Rank[] => ACTIVE_RANKS.filter(hasDivisions);

/**
 * Population share per rank, cumulative from the bottom. Percentile bands rather than absolute
 * thresholds, so the ladder stays meaningful whatever the playerbase does.
 *
 * GUESSES — no data behind them (plan §11). Revisit against a real distribution.
 */
export const RANK_BANDS: { rank: Rank; upTo: number }[] = [
  { rank: "private", upTo: 0.4 },
  { rank: "lieutenant", upTo: 0.75 },
  { rank: "captain", upTo: 0.95 },
  { rank: "marechal", upTo: 1 },
];

export type Ladder = { rank: Rank; division: number; merit: number };

/** Where a fresh player starts: in placements, no rank shown. */
export const startingLadder = (): Ladder => ({
  rank: "cadet",
  division: DIVISIONS_PER_RANK,
  merit: 0,
});

/** Total Merit from the bottom of the climbable ladder — the linear coordinate promotions move along. */
export const totalMeritOf = (ladder: Ladder): number => {
  const climbable = CLIMBABLE();
  const rankIndex = climbable.indexOf(ladder.rank);

  if (rankIndex < 0) {
    // cadet (below the ladder) or marechal (above it): merit is a raw score, not a position.
    return ladder.rank === "marechal"
      ? climbable.length * DIVISIONS_PER_RANK * MERIT_PER_DIVISION + ladder.merit
      : 0;
  }

  // Divisions count DOWN (V is lowest), so invert to get distance travelled.
  const divisionsClimbed = DIVISIONS_PER_RANK - ladder.division;

  return (rankIndex * DIVISIONS_PER_RANK + divisionsClimbed) * MERIT_PER_DIVISION + ladder.merit;
};

/** The inverse: a linear Merit coordinate back to rank + division + remainder. */
export const ladderFromTotal = (total: number): Ladder => {
  const climbable = CLIMBABLE();
  const ceiling = climbable.length * DIVISIONS_PER_RANK * MERIT_PER_DIVISION;

  if (total >= ceiling) {
    // Apex: unbounded Merit, so the top of the ladder still sorts.
    return { rank: "marechal", division: 1, merit: total - ceiling };
  }

  const clamped = Math.max(0, total);
  const divisionsTotal = Math.floor(clamped / MERIT_PER_DIVISION);
  const rankIndex = Math.min(climbable.length - 1, Math.floor(divisionsTotal / DIVISIONS_PER_RANK));
  const divisionsClimbed = divisionsTotal - rankIndex * DIVISIONS_PER_RANK;

  return {
    rank: climbable[rankIndex],
    division: DIVISIONS_PER_RANK - divisionsClimbed,
    merit: clamped % MERIT_PER_DIVISION,
  };
};

/** Total Merit at the very top of the climbable ladder — where Marechal begins. */
export const LADDER_CEILING = (): number =>
  CLIMBABLE().length * DIVISIONS_PER_RANK * MERIT_PER_DIVISION;

/**
 * The skill an ordinal-scale player at this ladder position is *expected* to have.
 *
 * The convergence term compares a player's skill to their rank, so both sides must be in the SAME
 * unit. Merit is 0..2000; `ordinal()` is ~0 (fresh) to ~30 (a settled strong player, μ35−3σ). This
 * projects a ladder position onto the ordinal scale so the two are comparable — without it the gap
 * is Merit-minus-ordinal, which is meaningless and would peg the nudge to its clamp forever.
 *
 * The range is a GUESS, like the bands. Revisit once real ordinals exist.
 */
export const ORDINAL_FLOOR = 0;
export const ORDINAL_CEIL = 30;

export const anchorOrdinalOf = (ladder: Ladder): number => {
  const ceiling = LADDER_CEILING();
  const fraction = ceiling === 0 ? 0 : clamp(totalMeritOf(ladder) / ceiling, 0, 1);

  return ORDINAL_FLOOR + fraction * (ORDINAL_CEIL - ORDINAL_FLOOR);
};

// ── The formula ───────────────────────────────────────────────────────────────────────────────────

/** Merit for an even, converged match. The "certain amount each game" a ladder needs to feel like one. */
export const BASE_MERIT = 20;

/** How far the rank-vs-skill gap can bend a result, either way. */
export const CONVERGENCE_CLAMP = 10;

/**
 * Ordinal points of skill-vs-rank gap per 1 Merit of nudge. At 3.0, the full ±10 arrives at a gap of
 * 30 ordinal points — i.e. bottom-of-ladder skill sitting at the top, or vice versa.
 */
export const CONVERGENCE_SCALE = 3.0;

/** A win always pays, a loss always costs — never 0, however lopsided the match was. */
export const MIN_WIN = 5;
export const MAX_WIN = 40;
export const MIN_LOSS = -40;
export const MAX_LOSS = -5;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * Merit for one result.
 *
 * `skillTerm` is Elo's `(S − E)` rescaled: it IS "balanced by the expected result". Beat a favourite
 * and it pays; beat someone you were expected to beat and it barely moves.
 *
 * `convergence` is the LoL trick — nudge the displayed rank toward the hidden skill, so a smurf
 * climbs fast and an over-ranked player slides back, without either being teleported.
 *
 *   even + converged  -> +20 / -20
 *   beat a favourite  -> +32 / -8      (E = 0.2)
 *   beat an underdog  -> +6  / -34     (E = 0.85)
 *   under-ranked      -> +30 / -10
 *   over-ranked       -> +10 / -30
 *
 * @param expected  E: 0..1, from `skill.expectedScore`
 * @param score     S: 1 win / 0.5 draw / 0 loss (or a placement score for FFA)
 * @param skillGap  `skillOrdinal(skill) − anchorOrdinalOf(ladder)` — BOTH in ordinal points
 */
export const meritDelta = (expected: number, score: number, skillGap: number): number => {
  const skillTerm = BASE_MERIT * 2 * (score - expected);
  const convergence = clamp(skillGap / CONVERGENCE_SCALE, -CONVERGENCE_CLAMP, CONVERGENCE_CLAMP);
  const raw = skillTerm + convergence;

  if (score > 0.5) {
    return Math.round(clamp(raw, MIN_WIN, MAX_WIN));
  }

  if (score < 0.5) {
    return Math.round(clamp(raw, MIN_LOSS, MAX_LOSS));
  }

  // A draw shouldn't be dragged into a win or a loss by the convergence nudge alone.
  return Math.round(clamp(raw, MIN_LOSS, MAX_WIN));
};

/**
 * Apply a Merit delta to a ladder position. Promotion and demotion both fall out of the linear
 * coordinate: cross 100 and you move up a division (or into the next rank), drop below 0 and you
 * move down. The floor at 0 is the bottom of the ladder — nothing below Private V.
 *
 * NO demotion grace window yet: a player at 0 Merit who loses drops a division immediately. Worth
 * adding (it's the standard kindness), but it needs somewhere to remember "you're on your last life",
 * which is a schema field — deferred rather than faked.
 */
export const applyMerit = (ladder: Ladder, delta: number): Ladder =>
  ladderFromTotal(Math.max(0, totalMeritOf(ladder) + delta));
