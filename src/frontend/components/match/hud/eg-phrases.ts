/**
 * Pure phrase generators for the End-Game screen — short human sentences that describe *how* a match
 * went, derived from the replay stats/grade. Kept framework-free so they can be unit-tested without
 * tRPC (the components feed them plain numbers). See .ai/plans/end-game-screen-plan.md.
 */

const fmt = (value: number): string => Math.round(value).toLocaleString();
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** Wall-clock duration as a compact label (`45s` · `18 min` · `1h 4m`); `—` for a zero/unknown span. */
export const formatDuration = (ms: number): string => {
  if (ms < 1000) {
    return "—";
  }

  const totalSec = Math.round(ms / 1000);

  if (totalSec < 60) {
    return `${totalSec}s`;
  }

  const min = Math.round(totalSec / 60);

  if (min < 60) {
    return `${min} min`;
  }

  return `${Math.floor(min / 60)}h ${min % 60}m`;
};

/** Tactics rationale — trade efficiency (value destroyed vs lost). */
export const tacticsNote = (dealt: number, taken: number): string => {
  if (dealt === 0 && taken === 0) {
    return "No engagements this match.";
  }

  if (taken === 0) {
    return `Flawless trading — ${fmt(dealt)} funds destroyed, nothing lost.`;
  }

  return `${fmt(dealt)} funds destroyed vs ${fmt(taken)} lost — a ${(dealt / taken).toFixed(1)}× trade.`;
};

/** Strength rationale — aggression + board control. */
export const strengthNote = (killed: number, captures: number): string => {
  if (killed === 0 && captures === 0) {
    return "Little board presence.";
  }

  return `${plural(killed, "unit")} destroyed · ${plural(captures, "capture")}.`;
};

/** Economy rationale — income vs spending. */
export const economyNote = (earned: number, produced: number, banked: number): string =>
  `${fmt(earned)} earned · ${fmt(produced)} into production · ${fmt(banked)} left banked.`;

/**
 * A one-line "how it was won" decider. HQ capture is the clearest signal; otherwise a full wipe, or a
 * board decision. Draws get their own phrasing.
 */
export const deciderPhrase = (opts: {
  isDraw: boolean;
  winnerName?: string;
  loserName?: string;
  hqCaptureTurn?: number;
  loserWiped: boolean;
}): string => {
  if (opts.isDraw || opts.winnerName === undefined) {
    return "A stalemate — neither side broke through.";
  }

  if (opts.hqCaptureTurn !== undefined) {
    return `${opts.winnerName} won by capturing the HQ on turn ${opts.hqCaptureTurn}.`;
  }

  if (opts.loserWiped) {
    return `${opts.winnerName} won by wiping out ${opts.loserName ?? "the enemy"}'s army.`;
  }

  return `${opts.winnerName} won on the board — no HQ fell.`;
};
