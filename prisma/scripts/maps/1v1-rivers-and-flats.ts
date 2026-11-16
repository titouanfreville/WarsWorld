/**
 * Two 1v1 maps built on the same question asked from opposite ends: how much terrain should stand
 * between the two armies? Delta Crossing answers "a lot, but perforated"; Salt Flats answers
 * "almost none". Both are `rotate180`, so the bottom half is the mechanical image of the top one.
 */

import type { MapDefinition } from "../map-definitions";

const deltaCrossing: MapDefinition = {
  name: "1v1 Delta Crossing",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Three river channels braid across the middle of the map, each crossed by three bridges, and " +
    "the crossings are staggered so no two line up into a straight lane. A vehicle heading for " +
    "the enemy half has to hop from island strip to island strip, changing column at every " +
    "channel, which means the defender can never hold one tile and call the map closed. Infantry " +
    "ford the channels directly and take the two island cities that neither side can garrison " +
    "cheaply; the silos sit on those strips as the reason to fight for them.",
  tileDataString: `
2,1,3,1,1,34,1,1,3,1,1,1,1,1,3,1,2
1,42,39,1,3,1,1,1,1,1,1,3,1,1,1,1,1
1,39,38,1,1,1,34,1,1,1,34,1,1,1,3,1,1
1,40,1,3,1,1,1,1,133,1,1,1,1,34,1,1,1
3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1
4,4,4,27,4,4,4,4,4,27,4,4,4,27,4,4,4
1,3,1,34,1,1,3,1,111,1,3,1,1,34,1,3,1
4,4,4,4,4,27,4,4,27,4,4,27,4,4,4,4,4
1,3,1,34,1,1,3,1,111,1,3,1,1,34,1,3,1
4,4,4,27,4,4,4,27,4,4,4,4,4,27,4,4,4
1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,1,3
1,1,1,34,1,1,1,1,133,1,1,1,1,3,1,45,1
1,1,3,1,1,1,34,1,1,1,34,1,1,1,43,44,1
1,1,1,1,1,3,1,1,1,1,1,1,3,1,44,47,1
2,1,3,1,1,1,1,1,3,1,1,34,1,1,3,1,2
`,
};

const saltFlats: MapDefinition = {
  name: "1v1 Salt Flats",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Open pan with two highways running the full width of the map and almost nothing to hide " +
    "behind — five rocks and four stands of trees on 247 tiles. Nothing slows an advance and " +
    "nothing shelters a retreat, so the game is decided by what each player built rather than " +
    "where they stood: three bases per side and ten neutral cities in the open reward committing " +
    "early. Indirects rule the flats but die the moment they are caught out of position, and the " +
    "lone central silo gives the losing side one swing back.",
  tileDataString: `
1,39,3,1,1,1,1,1,1,34,1,1,1,1,1,1,1,1,1
1,42,15,15,19,1,1,34,1,1,1,1,1,1,1,1,1,1,1
1,39,38,1,16,1,1,1,1,1,1,1,3,1,1,1,1,1,1
39,1,1,1,16,1,1,1,1,2,1,1,1,34,1,1,1,1,1
15,15,15,15,24,15,15,15,15,15,15,15,15,15,15,15,15,15,15
1,1,2,1,1,1,34,1,1,1,1,1,1,1,1,1,3,1,1
1,1,1,1,1,34,1,1,1,111,1,1,1,34,1,1,1,1,1
1,1,3,1,1,1,1,1,1,1,1,1,34,1,1,1,2,1,1
15,15,15,15,15,15,15,15,15,15,15,15,15,15,22,15,15,15,15
1,1,1,1,1,34,1,1,1,2,1,1,1,1,16,1,1,1,44
1,1,1,1,1,1,3,1,1,1,1,1,1,1,16,1,43,44,1
1,1,1,1,1,1,1,1,1,1,1,34,1,1,21,15,15,47,1
1,1,1,1,1,1,1,1,1,34,1,1,1,1,1,1,3,44,1
`,
};

export const maps: MapDefinition[] = [deltaCrossing, saltFlats];
