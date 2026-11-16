/**
 * Two 2v2 maps built on `mirrorBoth`: the horizontal mirror separates the two teams (west vs.
 * east), the vertical one separates teammates (north vs. south). Both are authored one quadrant at
 * a time and the other three derived mechanically, so the slot permutation and the directional
 * road/river variants stay consistent.
 */

import type { MapDefinition } from "../map-definitions";

const mountainPassDuo: MapDefinition = {
  name: "2v2 Mountain Pass Duo",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A mountain wall seals off each team's half of the map and is broken by exactly two passes, " +
    "one in front of each teammate. Production is deliberately split around that pass: a second " +
    "base sits out on the map's outer edge beside the HQ, while the first base and the airport " +
    "stay back on the home column behind the north-south highway. Neither wing reaches the pass " +
    "meaningfully sooner than the other, so the split is about width, not tempo — the edge base " +
    "widens the front without buying a faster lane. Every vehicle leaving home has to commit to a " +
    "pass before it can see which one the enemy chose, so the opening is a bluff about whether to " +
    "stack both armies in one pass or split and take the centre from two sides. The highway is " +
    "what makes switching possible, at the cost of a couple of turns.",
  tileDataString: `
2,1,16,3,1,2,1,3,3,1,2,1,3,16,1,2
1,42,23,1,39,2,1,1,1,1,2,44,1,25,47,1
1,39,16,34,1,2,3,1,1,3,2,1,34,16,44,1
38,1,16,1,1,1,1,1,1,1,1,1,1,16,1,43
1,40,16,3,1,2,1,34,34,1,2,1,3,16,45,1
1,1,16,34,1,2,3,1,1,3,2,1,34,16,1,1
3,1,16,1,1,2,1,1,1,1,2,1,1,16,1,3
2,1,16,1,3,2,1,145,145,1,2,3,1,16,1,2
2,1,16,1,3,2,1,145,145,1,2,3,1,16,1,2
3,1,16,1,1,2,1,1,1,1,2,1,1,16,1,3
1,1,16,34,1,2,3,1,1,3,2,1,34,16,1,1
1,50,16,3,1,2,1,34,34,1,2,1,3,16,55,1
48,1,16,1,1,1,1,1,1,1,1,1,1,16,1,53
1,49,16,34,1,2,3,1,1,3,2,1,34,16,54,1
1,52,23,1,49,2,1,1,1,1,2,54,1,25,57,1
2,1,16,3,1,2,1,3,3,1,2,1,3,16,1,2
`,
};

const riverAlliance: MapDefinition = {
  name: "2v2 River Alliance",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A closed river rectangle encircles the middle of the map, and the only crossings are two " +
    "bridges on each team's side of the ring. Both teammates draw on the same pair of bridges, so " +
    "an armoured push and a reinforcement column cannot use them at once and the team has to " +
    "agree who goes first. Outside the ring the ground is open all the way around, which makes " +
    "abandoning the centre and racing to the far bridges a real alternative to holding it.",
  tileDataString: `
2,38,1,3,1,1,1,3,1,1,1,1,3,1,1,1,3,1,43,2
1,42,39,1,1,3,1,1,1,1,1,1,1,1,3,1,1,44,47,1
1,39,1,1,3,1,1,1,1,3,3,1,1,1,1,3,1,1,44,1
3,1,1,34,1,1,1,3,1,1,1,1,3,1,1,1,34,1,1,3
1,1,3,1,1,7,4,4,4,4,4,4,4,4,8,1,1,3,1,1
1,39,1,3,1,5,1,1,3,1,1,3,1,1,5,1,3,1,44,1
1,1,34,1,1,27,1,34,1,1,1,1,34,1,27,1,1,34,1,1
3,1,1,1,3,5,1,133,1,145,145,1,133,1,5,3,1,1,1,3
3,1,1,1,3,5,1,133,1,145,145,1,133,1,5,3,1,1,1,3
1,1,34,1,1,27,1,34,1,1,1,1,34,1,27,1,1,34,1,1
1,49,1,3,1,5,1,1,3,1,1,3,1,1,5,1,3,1,54,1
1,1,3,1,1,10,4,4,4,4,4,4,4,4,9,1,1,3,1,1
3,1,1,34,1,1,1,3,1,1,1,1,3,1,1,1,34,1,1,3
1,49,1,1,3,1,1,1,1,3,3,1,1,1,1,3,1,1,54,1
1,52,49,1,1,3,1,1,1,1,1,1,1,1,3,1,1,54,57,1
2,48,1,3,1,1,1,3,1,1,1,1,3,1,1,1,3,1,53,2
`,
};

export const maps: MapDefinition[] = [mountainPassDuo, riverAlliance];
