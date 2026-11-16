import { winProbability } from "server/ranking/skill";
import type { LobbyLayout } from "server/matches/layout";
import type { Ticket } from "./queue";

/**
 * Who sits where once a group is formed.
 *
 * Forming a fair GROUP and forming fair TEAMS are different problems, and only the first is the
 * queue's job. Four evenly-matched players can still be split 2v2 into a walkover — put the two
 * strongest together and the group's fairness says nothing about the match's. So the split is chosen
 * here, after the group exists, by trying every partition and keeping the most even one.
 *
 * Exhaustive rather than clever: a 2v2 has three distinct partitions of four players (each is "who
 * partners the first player"), and a free-for-all has none to make. There is no search space worth
 * an approximation.
 */

export type Seat = { playerId: string; team: number; slotWithinTeam: number };

/** Every way to split `n` tickets into two teams of `n / 2`, up to swapping the teams over. */
const halvingPartitions = (tickets: Ticket[]): [Ticket[], Ticket[]][] => {
  const [first, ...rest] = tickets;
  const partnerCount = tickets.length / 2 - 1;
  const partitions: [Ticket[], Ticket[]][] = [];

  // The first player anchors team 0 — fixing them removes the mirror-image duplicates (A+B vs C+D is
  // the same split as C+D vs A+B). Whoever joins them decides the whole partition.
  const choose = (from: Ticket[], picked: Ticket[]): void => {
    if (picked.length === partnerCount) {
      const teamA = [first, ...picked];
      const teamB = rest.filter((t) => !picked.includes(t));

      partitions.push([teamA, teamB]);

      return;
    }

    for (let i = 0; i < from.length; i++) {
      choose(from.slice(i + 1), [...picked, from[i]]);
    }
  };

  choose(rest, []);

  return partitions;
};

/** How lopsided a two-team split is, as |P(team A wins) − 0.5|. */
export const splitUnfairness = (teamA: Ticket[], teamB: Ticket[]): number =>
  Math.abs(
    winProbability(
      teamA.map((t) => t.skill),
      teamB.map((t) => t.skill),
    ) - 0.5,
  );

/**
 * Assign every ticket a seat, choosing the fairest arrangement the layout allows.
 *
 * - **Two teams** (duel, 2v2): the partition with the most even predicted outcome wins. For a duel
 *   there is only one partition, so this reduces to "one each" — the previous behaviour exactly.
 * - **Free-for-all**: every player is their own team, so there is nothing to balance; the group's
 *   own fairness is the whole story. Seated in queue order.
 *
 * Returns the seats plus the unfairness of the chosen arrangement, which is what the ready-check
 * advertises and what decides whether a casual match gets the lenient decline.
 */
export const assignSeats = (
  tickets: Ticket[],
  layout: LobbyLayout,
): { seats: Seat[]; unfairness: number } => {
  const { teamCount, slotsPerTeam } = layout;

  if (slotsPerTeam === 1) {
    // One seat per team: nothing to arrange. Unfairness is the worst pairing in the group — in a
    // free-for-all everyone plays everyone, so the widest gap is what a player actually feels.
    const unfairness = Math.max(
      0,
      ...tickets.flatMap((a, i) => tickets.slice(i + 1).map((b) => splitUnfairness([a], [b]))),
    );

    return {
      seats: tickets.map((ticket, i) => ({
        playerId: ticket.playerId,
        team: i % teamCount,
        slotWithinTeam: 0,
      })),
      unfairness,
    };
  }

  const [teamA, teamB] = halvingPartitions(tickets).reduce((best, candidate) =>
    splitUnfairness(candidate[0], candidate[1]) < splitUnfairness(best[0], best[1])
      ? candidate
      : best,
  );

  const seats = [teamA, teamB].flatMap((team, teamIndex) =>
    team.map((ticket, slotWithinTeam) => ({
      playerId: ticket.playerId,
      team: teamIndex,
      slotWithinTeam,
    })),
  );

  return { seats, unfairness: splitUnfairness(teamA, teamB) };
};
