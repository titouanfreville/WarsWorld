/**
 * 2v2 batch: three team maps built around a shared centre.
 *
 * Two are `mirrorBoth` (the horizontal mirror swaps the two teams, the vertical one swaps
 * teammates), one is `asymmetric`: there every player's four buildings sit at the same four
 * distances from home but point in four different directions, and the woods on either side of the
 * middle hold the same tile count in completely different shapes — so nothing is fair by
 * construction, and income, production and expansion distances stay exact by measurement instead.
 *
 * All three are `sided`: each player's production is split across the two flanks of their
 * HQ-to-centre axis rather than stacked next to the HQ, so which flank you commit to is a choice
 * with a cost.
 *
 * Slot layout on all three: 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. With
 * `teamMapping: [0, 1, 0, 1]` that puts each team on one vertical half, teammates stacked.
 */

import type { MapDefinition } from "../map-definitions";

const centralBastion: MapDefinition = {
  name: "2v2 Central Bastion",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A mountain wall in the middle of the map encloses the four neutral labs and four neutral " +
    "cities, and it only breaks open on the four cardinal axes. Vehicles have to take one of those " +
    "two-tile gates while infantry can climb the wall itself, so holding the keep means garrisoning " +
    "the ramparts as well as the entrances, and a team that pushes a single gate gets shot off it. " +
    "A ring highway runs outside the wall, which is what lets whoever loses a gate be reinforced " +
    "from the far side faster than the attacker can exploit. Production is split around that " +
    "ring: an airport and a forward base sit in the band that feeds your own cardinal gate, while " +
    "a single base is left behind at the HQ corner four steps further from the keep — the gate " +
    "lane is the fast line, holding the ring is the slow one.",
  tileDataString: `
2,2,3,1,1,1,34,1,1,1,1,34,1,1,1,3,2,2
2,42,1,1,3,1,40,1,3,3,1,45,1,3,1,1,47,2
3,39,1,1,16,39,3,1,1,1,1,3,44,16,1,1,44,3
1,1,1,3,16,1,1,3,1,1,3,1,1,16,3,1,1,1
1,15,15,15,17,15,15,15,15,15,15,15,15,17,15,15,15,1
1,1,34,1,16,1,1,133,1,1,133,1,1,16,1,34,1,1
1,1,1,1,16,3,2,2,1,1,2,2,3,16,1,1,1,1
1,3,1,1,16,1,2,34,1,1,34,2,1,16,1,1,3,1
1,1,3,1,16,1,1,1,145,145,1,1,1,16,1,3,1,1
1,1,3,1,16,1,1,1,145,145,1,1,1,16,1,3,1,1
1,3,1,1,16,1,2,34,1,1,34,2,1,16,1,1,3,1
1,1,1,1,16,3,2,2,1,1,2,2,3,16,1,1,1,1
1,1,34,1,16,1,1,133,1,1,133,1,1,16,1,34,1,1
1,15,15,15,17,15,15,15,15,15,15,15,15,17,15,15,15,1
1,1,1,3,16,1,1,3,1,1,3,1,1,16,3,1,1,1
3,49,1,1,16,49,3,1,1,1,1,3,54,16,1,1,54,3
2,52,1,1,3,1,50,1,3,3,1,55,1,3,1,1,57,2
2,2,3,1,1,1,34,1,1,1,1,34,1,1,1,3,2,2
`,
};

const pipeDivide: MapDefinition = {
  name: "2v2 Pipe Divide",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A two-tile-thick pipeline runs down the centre and separates the teams; the only ground route " +
    "around it is the open strip along the north and south edges, a long march away from either " +
    "HQ. Four pairs of seams face the enemy — one on each team highway, two guarding the middle " +
    "labs — and blowing a pair is a two-unit job that opens a lane for both sides at once. Land " +
    "production only, so the decision is which seam you commit to and whether you can hold the " +
    "hole you just made. Every base a player owns sits on the outer-edge flank, the same side as " +
    "the open strip that goes around the pipe; the seam side has no production behind it at all, " +
    "so opening a seam means feeding it from the far end of your own half.",
  tileDataString: `
2,1,1,16,1,1,34,1,1,1,1,1,1,34,1,1,16,1,1,2
1,42,39,16,1,3,39,1,3,1,1,3,1,44,3,1,16,44,47,1
39,1,1,16,1,1,1,3,1,109,109,1,3,1,1,1,16,1,1,44
3,1,1,16,1,1,1,1,111,102,102,111,1,1,1,1,16,1,1,3
1,1,34,25,15,15,15,15,15,114,114,15,15,15,15,15,23,34,1,1
1,1,1,16,3,1,1,34,1,102,102,1,34,1,1,3,16,1,1,1
1,1,1,16,1,133,3,1,1,102,102,1,1,3,133,1,16,1,1,1
2,1,3,16,1,3,1,1,145,114,114,145,1,1,3,1,16,3,1,2
2,1,3,16,1,3,1,1,145,114,114,145,1,1,3,1,16,3,1,2
1,1,1,16,1,133,3,1,1,102,102,1,1,3,133,1,16,1,1,1
1,1,1,16,3,1,1,34,1,102,102,1,34,1,1,3,16,1,1,1
1,1,34,25,15,15,15,15,15,114,114,15,15,15,15,15,23,34,1,1
3,1,1,16,1,1,1,1,111,102,102,111,1,1,1,1,16,1,1,3
49,1,1,16,1,1,1,3,1,107,107,1,3,1,1,1,16,1,1,54
1,52,49,16,1,3,49,1,3,1,1,3,1,54,3,1,16,54,57,1
2,1,1,16,1,1,34,1,1,1,1,1,1,34,1,1,16,1,1,2
`,
};

const splitDoctrine: MapDefinition = {
  name: "2v2 Split Doctrine",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Four home grounds, no two alike. Every player owns the same HQ, two bases and one airport at " +
    "the same four distances from home, but no two point the same way: the north-west army builds " +
    "east along its highway and plants a forward base at the head of the plain, the north-east " +
    "builds down its own edge column, and the southern pair mirror neither of them. West of the " +
    "middle the woods are one solid thicket you have to go through or around; east of it the same " +
    "count of trees is scattered into copses, so an eastern push is a run of ambush points instead " +
    "of one wall. Cities, labs, towers and the four mountain spurs sit on shared ground at equal " +
    "distance from all four HQs — the ground is even, the shapes are not.",
  tileDataString: `
2,1,1,1,1,1,1,34,1,3,34,1,1,1,44,15,15,2
1,42,15,15,15,15,40,1,1,1,1,1,1,1,1,3,47,1
1,1,1,1,1,1,15,15,39,1,3,1,1,1,1,3,16,1
1,1,34,1,3,3,3,1,1,1,3,1,1,1,1,34,16,3
1,39,1,1,3,3,3,2,1,1,2,1,1,1,1,1,16,3
1,1,1,133,3,3,3,34,1,3,34,1,1,1,133,3,16,1
1,1,1,1,3,3,3,1,1,1,3,1,1,1,1,1,45,1
1,1,1,2,1,1,1,1,145,145,1,3,1,1,2,54,1,3
1,1,1,2,1,3,1,1,145,145,3,1,1,1,2,1,3,1
1,1,1,1,1,3,1,3,1,1,1,1,1,3,1,1,44,3
1,3,1,133,1,3,1,34,1,3,34,1,1,1,133,55,16,1
1,49,1,3,1,3,1,2,1,1,2,3,1,1,1,1,16,3
1,1,34,1,1,3,16,3,1,1,1,1,1,1,3,34,16,1
1,1,3,1,1,3,16,1,49,3,1,1,1,3,1,1,16,1
1,52,15,15,15,15,3,1,1,1,1,1,3,1,1,1,57,1
2,1,1,1,1,50,1,34,1,1,34,1,1,3,54,15,15,2
`,
};

export const maps: MapDefinition[] = [centralBastion, pipeDivide, splitDoctrine];
