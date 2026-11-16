import type { MatchWrapper } from "server/engine/entities/match";
import type { TeamWrapper } from "server/engine/entities/team";

/**
 * A team is out once none of its players are still "alive". Lives here rather than in `game-over.ts`
 * only because that module already imports this one — one definition, no cycle.
 */
export const teamInPlay = (team: TeamWrapper): boolean =>
  team.players.some((player) => player.data.status === "alive");

/**
 * The day limit: a match that reaches the last day ends there rather than running forever, and is
 * decided on territory — the standard "time control" for a game that can otherwise stalemate.
 *
 * Scored by TEAM, not by player, so a 2v2 is settled on the alliance's combined holdings.
 */

/** A team's holdings when the clock runs out: every capturable property, plus the city subset. */
export type TeamHoldings = { teamIndex: number; properties: number; cities: number };

/**
 * Has the match run past its last day?
 *
 * `dayLimit <= 0` means NO LIMIT — that's how a match opts out, and it's the value the engine test
 * fixtures use (`src/tests/helpers/scenario.ts`), so this guard is what keeps an unlimited match from
 * being declared over on day one. The comparison is `>` because the limit is the last day that gets
 * PLAYED: with a limit of 50, day 50 is played in full and the match ends as day 51 would begin.
 */
export const isDayLimitReached = (match: MatchWrapper): boolean =>
  match.rules.dayLimit > 0 && match.turn > match.rules.dayLimit;

/**
 * Count each team's properties (and cities) from the live tile state.
 *
 * Only `changeableTiles` can be owned, and only slots >= 0 belong to a player: slot -1 is neutral,
 * and `getPlayerBySlot` answers a NEUTRAL PSEUDO-PLAYER for it rather than `undefined`, so an
 * unguarded lookup would happily bank every neutral city into some team's total.
 */
export const countTeamHoldings = (match: MatchWrapper): TeamHoldings[] => {
  // Only teams STILL IN PLAY can be scored. `releaseHoldings` now neutralises an eliminated player's
  // properties on every exit path, so a dead team should hold nothing anyway — but scoring is the
  // place where a single missed tile becomes "a team wiped out on day 12 wins on day 50", and the
  // day-limit branch is reached precisely when 2+ teams are alive. Restricting the scoreboard to the
  // living makes that unrepresentable rather than merely unlikely.
  const holdings = new Map<number, TeamHoldings>(
    match.teams
      .filter(teamInPlay)
      .map((team) => [team.index, { teamIndex: team.index, properties: 0, cities: 0 }]),
  );

  for (const tile of match.changeableTiles) {
    if (!("playerSlot" in tile) || tile.playerSlot < 0) {
      continue;
    }

    const holding = holdings.get(match.getPlayerBySlot(tile.playerSlot)?.team.index ?? -1);

    if (holding === undefined) {
      continue;
    }

    holding.properties += 1;

    if (tile.type === "city") {
      holding.cities += 1;
    }
  }

  return [...holdings.values()];
};

/**
 * Who wins on territory: most properties, cities breaking a tie, and a genuine DRAW (`null`) when
 * both are level — `stampOutcome` turns that into `"drawn"` for every player.
 */
export const dayLimitWinner = (match: MatchWrapper): number | null => {
  const [leader, runnerUp] = countTeamHoldings(match).sort(
    (a, b) => b.properties - a.properties || b.cities - a.cities,
  );

  if (leader === undefined) {
    return null; // no teams at all — nothing to award
  }

  if (runnerUp === undefined) {
    return leader.teamIndex; // only one team left standing at the limit
  }

  const tied = leader.properties === runnerUp.properties && leader.cities === runnerUp.cities;

  return tied ? null : leader.teamIndex;
};
