/**
 * 1v1 batch: two naval layouts and one built around a line of missile silos.
 *
 * Authored as AWBW numeric CSV like the rest of the pool (see `map-definitions.ts`). The two
 * `rotate180` maps were written top-half-first and the bottom half derived mechanically, so the
 * slot permutation and the directional variants hold by construction.
 *
 * The asymmetric one is built on a different isometry entirely: a reflection across the NE-SW
 * diagonal. That is what buys the parity checks (distances, terrain mix and the census are carried
 * across exactly, because a reflection is an isometry) while putting every property somewhere the
 * 180-degree rotation would never place it — a base sits the same number of steps from its HQ but
 * in a completely different direction, behind different ground. Fairness is measured, not eyeballed.
 */
import type { MapDefinition } from "../map-definitions";

const tidalLanding: MapDefinition = {
  name: "1v1 Tidal Landing",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Two four-tile-deep seas, one to either side of a three-tile isthmus that is the only dry " +
    "road between the northern and southern landmasses apart from the narrow strips down each " +
    "map edge. The isthmus is a permanent traffic jam, so the fast way onto the enemy shore is a " +
    "lander onto the shoal beaches each side keeps beside its coastal port. Production is stacked " +
    "on the flank that owns that port — base, airfield and port together, four steps closer to " +
    "the isthmus — while a single base is left holding the other approach.",
  tileDataString: `
2,1,3,1,1,34,1,1,1,1,1,34,1,1,3,1,2
1,3,1,1,1,1,1,38,42,38,1,1,1,1,1,3,1
1,1,3,1,39,1,1,1,38,1,1,40,1,3,1,1,1
1,34,1,3,1,2,1,1,1,1,1,1,39,1,34,1,1
3,1,1,1,1,3,2,1,3,1,1,1,1,1,1,1,3
1,1,1,29,29,1,37,1,1,1,1,41,29,29,1,1,1
1,1,28,28,28,28,28,1,1,1,28,28,28,28,28,1,1
1,1,28,28,28,28,28,3,1,3,28,28,28,28,28,1,1
1,1,28,28,28,28,28,3,1,3,28,28,28,28,28,1,1
1,1,28,28,28,28,28,1,1,1,28,28,28,28,28,1,1
1,1,1,29,29,46,1,1,1,1,37,1,29,29,1,1,1
3,1,1,1,1,1,1,1,3,1,2,3,1,1,1,1,3
1,1,34,1,44,1,1,1,1,1,1,2,1,3,1,34,1
1,1,1,3,1,45,1,1,43,1,1,1,44,1,3,1,1
1,3,1,1,1,1,1,43,47,43,1,1,1,1,1,3,1
2,1,3,1,1,34,1,1,1,1,1,34,1,1,3,1,2
`,
};

const siloAlley: MapDefinition = {
  name: "1v1 Silo Alley",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Two mountain walls run down the map three tiles apart, and the one-tile alley between them " +
    "holds five missile silos in a straight line. The walls open at only four lateral gaps and " +
    "the two ends, so a column in the alley is slow to reinforce and easy to bottle up. That is " +
    "the trade the map is about: a silo is worth taking, but everything you park in there is " +
    "queued up in a lane the next missile also covers.",
  tileDataString: `
2,1,3,1,1,34,1,1,1,34,1,1,3,1,2
1,38,42,38,1,1,2,1,2,1,1,1,1,1,1
1,39,1,39,1,3,2,111,2,3,1,34,1,3,1
1,1,38,1,1,1,1,1,1,1,1,1,1,1,1
3,1,1,1,34,1,2,1,2,1,1,1,3,1,3
1,3,1,1,1,1,2,111,2,1,1,35,1,3,1
1,1,3,1,1,3,1,1,1,3,1,1,3,1,1
2,1,1,34,1,1,2,1,2,1,1,1,1,1,2
2,1,3,1,1,1,2,111,2,1,1,1,3,1,2
2,1,1,1,1,1,2,1,2,1,1,34,1,1,2
1,1,3,1,1,3,1,1,1,3,1,1,3,1,1
1,3,1,35,1,1,2,111,2,1,1,1,1,3,1
3,1,3,1,1,1,2,1,2,1,34,1,1,1,3
1,1,1,1,1,1,1,1,1,1,1,1,43,1,1
1,3,1,34,1,3,2,111,2,3,1,44,1,44,1
1,1,1,1,1,1,2,1,2,1,1,43,47,43,1
2,1,3,1,1,34,1,1,1,34,1,1,3,1,2
`,
};

const harborDispute: MapDefinition = {
  name: "1v1 Harbor Dispute",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "asymmetric",
  concept:
    "A square island in open water, both fleets free to sail all the way round it. Each player " +
    "owns two shores: one is a walled harbour — three shoal tiles between two mountain shoulders, " +
    "so a landing there has exactly one address and it is covered — and the other is open beach " +
    "with its shoals scattered along the whole shoreline. Inland the island is split the other " +
    "way: dense timber on the north-east half, bare plain on the south-west, so both armies have " +
    "one wooded flank and one open one. Production is pushed out onto the open flank (port and " +
    "both bases), and the lone airfield sits in the trees behind a mountain ridge, eleven steps " +
    "from the centre against the port's five.",
  tileDataString: `
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
28,28,1,3,3,38,2,29,29,29,2,37,3,3,28,28
28,28,1,1,42,3,3,3,3,34,40,3,3,3,28,28
28,28,29,1,1,3,3,2,2,2,2,2,3,37,28,28
28,28,1,1,38,1,3,3,34,3,3,2,45,2,28,28
28,28,1,39,1,1,1,3,3,3,3,2,34,29,28,28
28,28,1,38,1,1,1,1,133,3,34,2,3,29,28,28
28,28,41,1,34,1,1,1,1,3,3,2,3,29,28,28
28,28,1,1,39,35,1,1,1,1,3,3,3,2,28,28
28,28,29,1,1,34,35,1,1,1,1,3,3,43,28,28
28,28,1,1,34,1,44,34,1,1,43,1,47,3,28,28
28,28,29,1,1,1,1,1,43,44,1,1,1,3,28,28
28,28,1,29,1,29,1,46,1,1,1,29,1,1,28,28
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
`,
};

export const maps: MapDefinition[] = [tidalLanding, siloAlley, harborDispute];
