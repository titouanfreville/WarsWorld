/**
 * 2v2 batch: three team maps whose centre holds an objective neither team can ignore — shared
 * airports, a ring of silos, and a pair of comm towers straddling the team boundary.
 *
 * All three are `mirrorBoth`: the horizontal mirror swaps the two teams (slots 0 <-> 1, 2 <-> 3)
 * and the vertical one swaps teammates (0 <-> 2, 1 <-> 3). Each grid was derived mechanically from
 * its top-left quadrant, so the fairness the checker measures holds by construction.
 */

import type { MapDefinition } from "../map-definitions";

const airfieldPact: MapDefinition = {
  name: "2v2 Airfield Pact",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Four neutral airports sit in the open middle, one facing each player, and every player also " +
    "starts with an airport of their own. A team that captures only the airport in front of it " +
    "buys air units it cannot cover; taking both of a team's centre airports needs the two " +
    "players to push the same row together. Production is split on purpose: the airport and a " +
    "forward base sit down the outer lane, hugging the road that runs to the middle, while a " +
    "single base is left back beside the HQ on the inner side. The fast wing is the outer one, " +
    "and it is the wing a teammate can escort along that road.",
  tileDataString: `
2,2,3,1,1,1,34,1,1,1,1,34,1,1,1,3,2,2
2,42,39,16,3,1,1,1,3,3,1,1,1,3,16,44,47,2
3,1,1,16,1,1,3,1,1,1,1,3,1,1,16,1,1,3
1,1,1,16,1,34,1,3,1,1,3,1,34,1,16,1,1,1
1,40,1,16,1,1,1,1,3,3,1,1,1,1,16,1,45,1
1,38,1,16,3,1,36,1,1,1,1,36,1,3,16,1,43,1
3,1,39,16,1,3,1,1,1,1,1,1,3,1,16,44,1,3
1,1,3,16,1,1,1,34,1,1,34,1,1,1,16,3,1,1
1,1,3,16,1,1,1,34,1,1,34,1,1,1,16,3,1,1
3,1,49,16,1,3,1,1,1,1,1,1,3,1,16,54,1,3
1,48,1,16,3,1,36,1,1,1,1,36,1,3,16,1,53,1
1,50,1,16,1,1,1,1,3,3,1,1,1,1,16,1,55,1
1,1,1,16,1,34,1,3,1,1,3,1,34,1,16,1,1,1
3,1,1,16,1,1,3,1,1,1,1,3,1,1,16,1,1,3
2,52,49,16,3,1,1,1,3,3,1,1,1,3,16,54,57,2
2,2,3,1,1,1,34,1,1,1,1,34,1,1,1,3,2,2
`,
};

const siloPressure: MapDefinition = {
  name: "2v2 Silo Pressure",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Four silos ring a 2x2 mountain block in the centre, each one within reach of two players from " +
    "opposite teams. A silo fired from there lands on the open ground both teams have to cross, so " +
    "the danger is symmetric and standing armies bunch up at their peril. Land-only production " +
    "keeps the answer to a silo simple: get an infantry onto it first, or spread out.",
  tileDataString: `
2,1,3,1,1,34,1,1,1,1,34,1,1,3,1,2
1,42,39,1,3,1,1,3,3,1,1,3,1,44,47,1
3,39,1,1,1,1,3,1,1,3,1,1,1,1,44,3
1,1,1,3,1,34,1,1,1,1,34,1,3,1,1,1
1,38,1,1,2,1,1,3,3,1,1,2,1,1,43,1
1,1,3,1,1,1,111,1,1,111,1,1,1,3,1,1
3,1,1,34,1,3,1,1,1,1,3,1,34,1,1,3
1,1,1,1,3,1,1,2,2,1,1,3,1,1,1,1
1,1,1,1,3,1,1,2,2,1,1,3,1,1,1,1
3,1,1,34,1,3,1,1,1,1,3,1,34,1,1,3
1,1,3,1,1,1,111,1,1,111,1,1,1,3,1,1
1,48,1,1,2,1,1,3,3,1,1,2,1,1,53,1
1,1,1,3,1,34,1,1,1,1,34,1,3,1,1,1
3,49,1,1,1,1,3,1,1,3,1,1,1,1,54,3
1,52,49,1,3,1,1,3,3,1,1,3,1,54,57,1
2,1,3,1,1,34,1,1,1,1,34,1,1,3,1,2
`,
};

const commTug: MapDefinition = {
  name: "2v2 Comm Tug",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Two pairs of comm towers sit on the team boundary, and a highway runs straight from every " +
    "player's HQ corner to the pair in front of them. The road makes the towers the fastest " +
    "thing on the map to reach and the hardest to hold: whoever stands on one is in the open at " +
    "the end of the enemy's own highway. Production leans to the outer wing — the airport and a " +
    "forward base sit further down the vertical link road, well past the highway, while one base " +
    "stays back at the HQ. Reinforcing the lane that is losing the tug means committing that " +
    "outer wing.",
  tileDataString: `
2,2,3,1,1,1,34,1,3,1,1,3,1,34,1,1,1,3,2,2
2,42,39,1,3,1,1,1,1,1,1,1,1,1,1,3,1,44,47,2
3,1,16,1,34,1,3,1,1,1,1,1,1,3,1,34,1,16,1,3
1,15,17,15,15,15,15,15,15,133,133,15,15,15,15,15,15,17,15,1
1,40,16,1,1,1,1,1,3,1,1,3,1,1,1,1,1,16,45,1
1,38,16,3,1,3,1,1,1,1,1,1,1,1,3,1,3,16,43,1
3,39,16,1,34,1,1,3,1,1,1,1,3,1,1,34,1,16,44,3
1,1,16,1,1,1,3,1,2,1,1,2,1,3,1,1,1,16,1,1
1,1,16,1,1,1,3,1,2,1,1,2,1,3,1,1,1,16,1,1
3,49,16,1,34,1,1,3,1,1,1,1,3,1,1,34,1,16,54,3
1,48,16,3,1,3,1,1,1,1,1,1,1,1,3,1,3,16,53,1
1,50,16,1,1,1,1,1,3,1,1,3,1,1,1,1,1,16,55,1
1,15,17,15,15,15,15,15,15,133,133,15,15,15,15,15,15,17,15,1
3,1,16,1,34,1,3,1,1,1,1,1,1,3,1,34,1,16,1,3
2,52,49,1,3,1,1,1,1,1,1,1,1,1,1,3,1,54,57,2
2,2,3,1,1,1,34,1,3,1,1,3,1,34,1,1,1,3,2,2
`,
};

export const maps: MapDefinition[] = [airfieldPact, siloPressure, commTug];
