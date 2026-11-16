import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";

/**
 * The turn clock: a per-player time bank that ticks only during their own turn, topped up by a fixed
 * increment at the start of each of their turns. Running out doesn't lose the match — the turn is
 * ended for them and they play on with the increment alone.
 *
 * PURE, and deliberately so. The engine holds only BANKS (plain numbers, rebuilt exactly by replaying
 * the event log); the wall-clock deadline is orchestration state that lives on the match entity and
 * the Match row, never in a rule. What a turn actually consumed enters the engine as event data
 * (`bankRemainingMs`), the same way combat luck and weather rolls do — read a clock in here and every
 * replay would produce a different match.
 */

export type TurnClock = { bankMs: number; incrementMs: number };

/**
 * This match's clock, or `null` when it has none. Absent rules mean an untimed match — every game
 * created before the clock existed, and any custom game that opts out — and those must keep playing
 * with no deadline rather than inheriting a default.
 */
export const matchClock = (match: MatchWrapper): TurnClock | null => {
  const { turnBankSeconds, turnIncrementSeconds } = match.rules;

  if (turnBankSeconds === undefined) {
    return null;
  }

  return { bankMs: turnBankSeconds * 1000, incrementMs: (turnIncrementSeconds ?? 0) * 1000 };
};

/**
 * A player's remaining bank in ms, or `null` in an untimed match.
 *
 * An unset bank means "hasn't started their first turn yet", which resolves to the match's starting
 * bank. Initialising lazily here — rather than stamping every player at spawn — is what lets a match
 * that predates the clock pick one up correctly, and keeps spawn free of clock knowledge.
 */
export const bankOf = (player: PlayerInMatchWrapper): number | null => {
  const clock = matchClock(player.match);

  if (clock === null) {
    return null;
  }

  return player.data.timeBankMs ?? clock.bankMs;
};

/**
 * Bank the time a player had left when they ended their turn. `remainingMs` comes off the event, so
 * this replays identically; `null` (an untimed match, or a legacy event with no clock recorded)
 * leaves the bank alone.
 */
export const settleBankOnTurnEnd = (
  player: PlayerInMatchWrapper,
  remainingMs: number | null | undefined,
): void => {
  if (remainingMs === null || remainingMs === undefined || matchClock(player.match) === null) {
    return;
  }

  player.data.timeBankMs = Math.max(0, Math.round(remainingMs));
};

/**
 * Credit the increment to the player whose turn is beginning. Runs off the bank they already had
 * (or the starting bank on their first turn), so someone who flagged last turn starts this one with
 * exactly the increment — which is what keeps them in the game.
 */
export const creditIncrementOnTurnStart = (player: PlayerInMatchWrapper): void => {
  const clock = matchClock(player.match);

  if (clock === null) {
    return;
  }

  player.data.timeBankMs = (player.data.timeBankMs ?? clock.bankMs) + clock.incrementMs;
};
