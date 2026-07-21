/**
 * FFA batch: three four-player maps built on a 90-degree rotation, so no player is anyone's
 * closer neighbour. Each one puts its prize in the middle and differs only in how hard the
 * middle is to reach — by road, by causeway, or by crossing the ring.
 */

import type { MapDefinition } from "../map-definitions";

/* -------------------------------------------------------------------------------------------- */
/* FFA (4 players)                                                                              */
/* -------------------------------------------------------------------------------------------- */

const crossRoads: MapDefinition = {
  name: "FFA Cross Roads",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Each player has one road out of their corner, and all four end at the same 2x2 block of " +
    "comm towers in the centre. The roads are the only fast way to the middle, and each one runs " +
    "the length of its owner's quarter, so using a neighbour's road means driving a lane they " +
    "see end to end. Each corner's production straddles its own road — two buildings behind it and " +
    "one just across it — so neither side of the lane is the safe side. Four silos sit off the " +
    "roads as the reason to leave them.",
  tileDataString: `
2,2,3,1,1,34,1,1,1,1,3,1,1,16,2,2
2,42,1,1,3,1,1,3,34,1,45,1,44,16,47,2
15,15,19,39,1,3,1,1,18,15,15,15,15,20,1,3
1,39,16,34,1,1,3,1,16,3,1,1,34,44,1,1
1,1,16,1,3,1,1,3,16,1,1,3,1,1,3,1
3,40,16,1,1,111,1,1,16,2,111,1,1,3,1,34
1,1,16,3,1,2,3,1,16,3,1,1,3,1,1,1
1,34,21,15,15,15,15,133,133,1,1,3,1,1,3,1
1,3,1,1,3,1,1,133,133,15,15,15,15,19,34,1
1,1,1,3,1,1,3,16,1,3,2,1,3,16,1,1
34,1,3,1,1,111,2,16,1,1,111,1,1,16,50,3
1,3,1,1,3,1,1,16,3,1,1,3,1,16,1,1
1,1,54,34,1,1,3,16,1,3,1,1,34,16,49,1
3,1,18,15,15,15,15,20,1,1,3,1,49,21,15,15
2,57,16,54,1,55,1,34,3,1,1,3,1,1,52,2
2,2,16,1,1,3,1,1,1,1,34,1,1,3,2,2
`,
};

const fourIslands: MapDefinition = {
  name: "FFA Four Islands",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four islands ring an inland sea, and a shoal crossroads at the very centre splits that sea " +
    "into four bays — each one shared by a pair of neighbours, whose ports both face it. The " +
    "crossroads and the one-tile shoal isthmuses at the map edges are the only dry ground " +
    "between islands, so a lander is still the fast way to put ground units anywhere. " +
    "Production is split hard across the HQ: a base, an airport and the port march down the " +
    "seaward flank toward the crossroads, while a single base is left behind on the other side.",
  tileDataString: `
2,2,3,1,1,34,1,3,29,1,1,3,1,1,1,3,2,2
2,42,1,1,3,1,1,1,28,1,34,1,1,1,1,44,47,2
3,39,1,39,1,3,1,1,28,3,1,1,3,1,1,1,1,3
1,1,1,34,1,40,3,1,28,1,1,3,1,1,34,44,1,1
1,1,1,1,3,1,1,29,28,3,1,1,1,3,1,1,3,1
1,1,3,1,1,1,29,41,28,1,29,37,1,1,45,3,1,34
3,1,1,3,1,37,28,28,28,29,28,28,29,1,3,1,1,1
1,34,1,1,1,29,28,28,28,29,28,28,46,29,1,1,1,3
1,1,3,1,3,1,29,29,29,29,28,28,28,28,28,28,28,29
29,28,28,28,28,28,28,28,29,29,29,29,1,3,1,3,1,1
3,1,1,1,29,56,28,28,29,28,28,28,29,1,1,1,34,1
1,1,1,3,1,29,28,28,29,28,28,28,37,1,3,1,1,3
34,1,3,55,1,1,37,29,1,28,51,29,1,1,1,3,1,1
1,3,1,1,3,1,1,1,3,28,29,1,1,3,1,1,1,1
1,1,54,34,1,1,3,1,1,28,1,3,50,1,34,1,1,1
3,1,1,1,1,3,1,1,3,28,1,1,3,1,49,1,49,3
2,57,54,1,1,1,1,34,1,28,1,1,1,3,1,1,52,2
2,2,3,1,1,1,3,1,1,29,3,1,34,1,1,3,2,2
`,
};

const ringRoad: MapDefinition = {
  name: "FFA Ring Road",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "A closed square highway rings the middle of the map and every HQ has a spur onto it, so " +
    "armour reaches any other corner fast — but only by driving past whoever sits between. " +
    "Inside the ring are four labs, four silos and a block of comm towers, all off-road: taking " +
    "them means leaving the highway that is also the way home, while the players still on it " +
    "choose when to close it behind you. Production leans to one side: a base and an airport " +
    "sit forward on the flank that meets the ring first, and a single base is left back beside " +
    "the HQ on the other.",
  tileDataString: `
2,2,3,1,1,1,34,1,1,3,1,1,1,3,1,1,1,16,2,2
2,42,39,1,3,1,1,1,3,1,1,3,1,1,1,1,1,16,47,2
15,15,15,15,15,15,15,15,19,1,1,1,34,1,44,3,1,16,44,3
1,1,1,1,1,34,1,1,16,1,3,1,45,1,3,1,1,16,1,1
1,1,3,1,1,1,3,1,16,3,1,1,3,1,1,1,1,16,3,1
1,1,39,3,1,1,1,1,16,1,1,1,1,3,1,1,34,16,1,1
3,1,1,1,1,3,18,15,24,15,15,15,15,19,1,3,1,16,1,34
1,1,34,40,3,1,16,2,1,111,3,1,2,16,1,1,1,16,1,1
1,3,1,1,1,1,16,1,145,1,1,145,1,25,15,15,15,20,3,1
1,1,1,3,1,1,16,3,1,133,133,1,111,16,1,3,1,1,1,3
3,1,1,1,3,1,16,111,1,133,133,1,3,16,1,1,3,1,1,1
1,3,18,15,15,15,23,1,145,1,1,145,1,16,1,1,1,1,3,1
1,1,16,1,1,1,16,2,1,3,111,1,2,16,1,3,50,34,1,1
34,1,16,1,3,1,21,15,15,15,15,22,15,20,3,1,1,1,1,3
1,1,16,34,1,1,3,1,1,1,1,16,1,1,1,1,3,49,1,1
1,3,16,1,1,1,1,3,1,1,3,16,1,3,1,1,1,3,1,1
1,1,16,1,1,3,1,55,1,3,1,16,1,1,34,1,1,1,1,1
3,54,16,1,3,54,1,34,1,1,1,21,15,15,15,15,15,15,15,15
2,57,16,1,1,1,1,1,3,1,1,3,1,1,1,3,1,49,52,2
2,2,16,1,1,1,3,1,1,1,3,1,1,34,1,1,1,3,2,2
`,
};

export const maps: MapDefinition[] = [crossRoads, fourIslands, ringRoad];
