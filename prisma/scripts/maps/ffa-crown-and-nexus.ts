/**
 * Two free-for-all maps built on 90-degree rotation, so all four players sit in positionally
 * identical quadrants and no one has a weaker neighbour to be ganged up on.
 *
 * Both are land-only: production is bases plus one airport each, and everything that matters is
 * won on foot or on treads. They differ in what the centre is worth — a fortified plateau in
 * `Mountain Crown`, an undefendable prize in `Lab Nexus`.
 */

import type { MapDefinition } from "../map-definitions";

const mountainCrown: MapDefinition = {
  name: "FFA Mountain Crown",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "A square of mountains rings the middle of the map with exactly one gap per side, so the " +
    "central plateau can only be entered through four one-tile chokes. The crown itself is the " +
    "real position: artillery parked on it out-ranges anything crossing the open ground outside " +
    "while covering a gap. Four neutral comm towers sit at the very centre, so whoever forces a " +
    "gap gains vision over all three rivals at once. Production is deliberately lopsided: each " +
    "player's base and airport sit forward on the flank that faces their own gap, four steps " +
    "closer to the crown than the lone rear base on the far flank, so racing your choke and " +
    "turtling behind it are two different builds.",
  tileDataString: `
2,2,3,1,1,34,1,1,1,1,34,1,1,3,2,2
2,42,1,1,40,1,1,3,3,44,1,1,1,1,47,2
3,1,1,1,1,1,3,1,1,3,1,1,1,1,1,3
1,1,1,3,1,1,39,1,1,1,1,1,3,1,1,1
1,1,1,1,2,2,1,2,2,2,2,2,1,1,45,1
34,1,1,1,2,1,1,34,1,1,1,2,1,1,1,34
1,39,3,1,2,1,3,1,1,3,1,1,44,3,1,1
1,3,1,1,2,1,1,133,133,1,34,2,1,1,3,1
1,3,1,1,2,34,1,133,133,1,1,2,1,1,3,1
1,1,3,54,1,1,3,1,1,3,1,2,1,3,49,1
34,1,1,1,2,1,1,1,34,1,1,2,1,1,1,34
1,55,1,1,2,2,2,2,2,1,2,2,1,1,1,1
1,1,1,3,1,1,1,1,1,49,1,1,3,1,1,1
3,1,1,1,1,1,3,1,1,3,1,1,1,1,1,3
2,57,1,1,1,1,54,3,3,1,1,50,1,1,52,2
2,2,3,1,1,34,1,1,1,1,34,1,1,3,2,2
`,
};

const labNexus: MapDefinition = {
  name: "FFA Lab Nexus",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four neutral labs sit in a block at the exact centre of an open map, with a road running " +
    "from each HQ straight to them in a pinwheel. Nothing shields the block — a unit standing on " +
    "a lab is in reach of the other three roads, so holding all four means fighting on three " +
    "fronts. The neutral bases and silos sit halfway out, giving a player who declines the centre " +
    "somewhere else to spend the early game. Each player's own production is split across their " +
    "highway: a base and an airport pushed forward into the pocket the road's elbow encloses, " +
    "and a single base left behind the highway on the bare flank, four steps further from the " +
    "labs than the forward pair.",
  tileDataString: `
1,1,3,1,34,1,1,3,1,1,44,34,1,1,1,3,1,1
1,42,1,1,1,1,3,1,1,18,15,15,15,15,15,15,47,1
3,16,1,1,3,1,40,1,34,16,1,1,1,1,1,1,1,3
1,16,1,1,1,1,1,3,1,16,35,1,1,3,1,1,1,1
1,16,1,3,2,1,1,39,1,16,1,3,1,2,1,3,1,34
1,16,1,1,1,1,3,1,111,16,1,2,1,1,1,1,1,1
34,16,1,1,3,2,1,1,1,16,1,1,3,1,1,45,3,1
39,16,1,35,1,1,1,3,1,16,3,1,1,44,3,1,1,3
1,21,15,15,15,15,15,15,145,145,1,1,111,1,1,34,1,1
1,1,34,1,1,111,1,1,145,145,15,15,15,15,15,15,19,1
3,1,1,3,54,1,1,3,16,1,3,1,1,1,35,1,16,49
1,3,55,1,1,3,1,1,16,1,1,1,2,3,1,1,16,34
1,1,1,1,1,1,2,1,16,111,1,3,1,1,1,1,16,1
34,1,3,1,2,1,3,1,16,1,49,1,1,2,3,1,16,1
1,1,1,1,3,1,1,35,16,1,3,1,1,1,1,1,16,1
3,1,1,1,1,1,1,1,16,34,1,50,1,3,1,1,16,3
1,57,15,15,15,15,15,15,20,1,1,3,1,1,1,1,52,1
1,1,3,1,1,1,34,54,1,1,3,1,1,34,1,3,1,1
`,
};

export const maps: MapDefinition[] = [mountainCrown, labNexus];
