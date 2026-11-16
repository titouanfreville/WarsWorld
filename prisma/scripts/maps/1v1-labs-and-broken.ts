/**
 * Two 1v1 maps built around a single hard obstacle each: a ring of tech prizes reachable only by
 * standing on the one highway, and a pair of pipes that shut the northern half of the map.
 */

import type { MapDefinition } from "../map-definitions";

const labAscendancy: MapDefinition = {
  name: "1v1 Lab Ascendancy",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Four neutral labs sit in a square around the central comm tower, all four of them on or " +
    "beside the one highway that runs the width of the map. Holding two labs is easy and holding " +
    "three means standing on the highway inside the enemy's reach, so the map is a running " +
    "argument about how much tech is worth exposing an army for. Each HQ is linked to the highway " +
    "by a single spur road, which is also the fastest route home when a lab push goes wrong.",
  tileDataString: `
2,1,3,1,34,1,1,3,1,1,3,1,1,1,3,1,2
1,42,39,1,1,1,3,1,1,1,1,34,1,3,1,1,1
1,39,16,3,1,1,1,1,133,1,1,1,3,1,1,1,1
3,1,16,1,34,1,3,1,1,1,3,1,1,34,1,3,1
1,39,16,1,1,2,1,1,1,1,1,2,1,1,3,1,1
1,40,16,1,1,1,3,1,111,1,3,1,1,1,1,1,3
1,1,16,34,145,3,1,1,1,1,1,3,145,1,1,1,1
2,15,24,15,15,15,15,15,133,15,15,15,15,15,22,15,2
1,1,1,1,145,3,1,1,1,1,1,3,145,34,16,1,1
3,1,1,1,1,1,3,1,111,1,3,1,1,1,16,45,1
1,1,3,1,1,2,1,1,1,1,1,2,1,1,16,44,1
1,3,1,34,1,1,3,1,1,1,3,1,34,1,16,1,3
1,1,1,1,3,1,1,1,133,1,1,1,1,3,16,44,1
1,1,1,3,1,34,1,1,1,1,3,1,1,1,44,47,1
2,1,3,1,1,1,3,1,1,3,1,1,34,1,3,1,2
`,
};

const brokenChain: MapDefinition = {
  name: "1v1 Broken Chain",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "asymmetric",
  concept:
    "Two ten-tile pipes seal the northern half of the map into three isolated pockets: a highland " +
    "shoulder behind each player's back, and the middle pocket that holds the comm tower and both " +
    "labs. Each pipe carries a single seam at its midpoint, so a chain only breaks when someone " +
    "spends shots on it; until then everything moves along the highway that runs the full width of " +
    "the map three rows below the HQs. Production is deliberately lopsided: three buildings sit " +
    "south of the HQ on the highway side, ten steps from the tower by vehicle, while one lone base " +
    "is stranded up in the mountains nineteen steps away behind the pipe. The southern opening is " +
    "the fast one and the northern one is the safe one, and they are not the same opening.",
  tileDataString: `
2,2,3,2,2,107,3,2,2,3,2,2,3,107,2,2,3,2,2
2,3,1,2,1,102,2,1,3,1,3,1,2,102,1,2,1,3,2
3,39,1,1,2,102,1,3,2,1,2,3,1,102,2,1,1,44,3
2,1,3,2,1,102,2,1,1,34,1,1,2,102,1,2,3,1,2
1,3,1,1,3,114,1,2,3,1,3,2,1,114,3,1,1,3,1
2,34,1,3,1,102,3,1,2,1,2,1,3,102,1,3,1,34,2
1,2,1,2,3,102,1,3,1,3,1,3,1,102,3,2,1,2,1
42,1,3,1,1,102,1,145,1,133,1,145,1,102,1,1,3,1,47
1,1,1,3,1,102,1,1,1,1,1,1,1,102,1,3,1,1,1
3,1,1,1,3,109,1,3,1,1,1,3,1,109,3,1,1,1,3
15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15
40,1,34,3,1,1,1,1,1,1,1,1,1,1,1,3,34,1,45
1,1,1,1,39,1,34,1,1,111,1,1,34,1,44,1,1,1,1
1,39,3,1,1,1,1,3,1,1,1,3,1,1,1,1,3,44,1
1,1,1,1,1,3,1,1,3,1,3,1,1,3,1,1,1,1,1
`,
};

export const maps: MapDefinition[] = [labAscendancy, brokenChain];
