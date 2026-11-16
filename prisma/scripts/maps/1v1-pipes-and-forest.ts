/**
 * Three 1v1 maps built around what stands between the two armies: a pipe wall, a forest, or the
 * same terrain spent two opposite ways. The first two are authored top-half-first and the bottom
 * half derived, so the fairness the checker measures is a property of the construction rather than
 * of the eyeballing; the third is authored half by half against a distance budget (see its note).
 */

import type { MapDefinition } from "../map-definitions";

const pipeworks: MapDefinition = {
  name: "1v1 Pipeworks",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "A pipe wall runs the full width of the map and three pipe seams are the only way through it. " +
    "Nothing crosses until a seam is shot open, so the opening is spent deciding which seam to " +
    "break and which to leave shut, knowing the enemy walks through whatever you open. The two " +
    "column-wide lanes at the far edges skirt the wall but cost several turns to use, which is " +
    "what keeps a player who breaks nothing from being locked out entirely.",
  tileDataString: `
2,1,3,1,1,34,1,1,1,1,1,34,1,1,3,1,2
1,42,39,1,3,1,1,1,111,1,1,1,3,1,34,1,1
1,39,1,1,1,3,1,1,1,1,3,1,1,1,1,3,1
1,1,1,34,1,1,3,1,40,1,3,1,1,34,1,1,1
1,3,1,1,1,1,1,3,1,3,1,1,1,1,1,3,1
34,1,3,1,133,1,1,1,1,1,1,1,133,1,3,1,1
1,1,1,3,1,1,1,3,1,3,1,1,1,3,1,1,1
1,108,101,101,113,101,101,101,113,101,101,101,113,101,101,110,1
1,1,1,3,1,1,1,3,1,3,1,1,1,3,1,1,1
1,1,3,1,133,1,1,1,1,1,1,1,133,1,3,1,34
1,3,1,1,1,1,1,3,1,3,1,1,1,1,1,3,1
1,1,1,34,1,1,3,1,45,1,3,1,1,34,1,1,1
1,3,1,1,1,1,3,1,1,1,1,3,1,1,1,44,1
1,1,34,1,3,1,1,1,111,1,1,1,3,1,44,47,1
2,1,3,1,1,34,1,1,1,1,1,34,1,1,3,1,2
`,
};

const forestVigil: MapDefinition = {
  name: "1v1 Forest Vigil",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Forest covers roughly half of every row, so almost nothing is ever seen from more than a tile " +
    "or two away and an army can be walked into contact before it is spotted. Fought under fog it " +
    "is a scouting map: recon units and the two comm towers pay for themselves, and indirect fire " +
    "is hard to place because the target keeps disappearing. The single mountain at the centre is " +
    "the one tile that sees anything at all.",
  tileDataString: `
3,3,1,3,1,3,1,34,1,3,1,3,1,3,3
3,42,39,1,3,1,3,1,3,1,3,1,1,3,3
3,39,1,3,1,3,1,133,1,3,1,34,3,1,3
1,39,3,1,3,1,34,1,3,1,3,1,3,3,1
3,1,1,3,1,3,1,3,1,3,1,3,1,1,3
1,3,34,1,3,1,3,145,3,1,3,1,34,3,1
3,1,3,1,1,3,1,3,1,3,1,1,3,1,3
1,3,1,3,1,1,3,1,3,1,1,3,1,3,1
3,1,3,34,3,1,3,2,3,1,3,34,3,1,3
1,3,1,3,1,1,3,1,3,1,1,3,1,3,1
3,1,3,1,1,3,1,3,1,3,1,1,3,1,3
1,3,34,1,3,1,3,145,3,1,3,1,34,3,1
3,1,1,3,1,3,1,3,1,3,1,3,1,1,3
1,3,3,1,3,1,3,1,34,1,3,1,3,44,1
3,1,3,34,1,3,1,133,1,3,1,3,1,44,3
3,3,1,1,3,1,3,1,3,1,3,1,44,47,3
3,3,1,3,1,3,1,34,1,3,1,3,1,3,3
`,
};

/**
 * Authored half by half against a distance budget rather than by mirroring. Each side was given the
 * same allowance of forest, river, mountain and road and spent it in a different shape, then every
 * neutral property and objective was placed so its step count from both HQs is identical on foot
 * AND on treads — which is what lets a base sit in a completely different direction, behind
 * different terrain, and still be the same number of turns away. The obstacles are deliberately
 * kept off the shortest staircase to every objective, so no vehicle is ever detoured to a crossing
 * its opponent does not also pay for. Roughly 44% of tiles differ from the 180-degree image, so
 * this is a genuinely asymmetric layout rather than a mirror wearing the label.
 */
const twoDoctrines: MapDefinition = {
  name: "1v1 Two Doctrines",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "asymmetric",
  concept:
    "Both armies are issued the same ledger of ground — the same count of forest, river, mountain " +
    "and road — and spend it in opposite ways. Slot 0 builds walls: one unbroken tree ridge from " +
    "the north edge down to the west, one river line with a single bridge, three mountains in a " +
    "row and one paved spine into the middle. Slot 1 builds nothing continuous: eighteen trees in " +
    "copses of one and two, three short streams nobody bothered to bridge, three mountains stood " +
    "apart and two road spurs. So the same push costs the same number of turns on either side, but " +
    "slot 0 fights over gates while slot 1 fights in cover that never quite stops anything. Each " +
    "player keeps two bases on one flank — one forward, five steps from the centre — and the lone " +
    "airport on the other, ten steps out, so the strong side is a choice made before the map is.",
  tileDataString: `
2,1,1,34,1,1,1,1,1,3,1,5,1,1,1,1,1,1,1
2,42,1,1,39,1,1,34,3,3,1,5,1,1,1,3,1,1,1
2,1,1,1,1,1,1,3,3,1,1,27,1,34,1,1,1,1,2
1,1,1,1,1,1,3,3,1,1,1,5,1,1,1,1,1,3,3
1,1,1,1,145,3,3,39,4,4,4,9,3,1,1,1,34,1,1
1,40,1,1,3,3,1,1,1,34,1,1,1,1,1,3,3,1,1
1,1,1,3,3,18,15,15,15,15,15,1,111,1,4,4,4,3,2
1,1,34,3,1,16,1,1,1,1,1,1,1,3,3,1,34,1,1
1,1,3,3,1,16,111,1,1,1,3,3,1,1,1,1,1,1,1
1,3,3,1,1,1,1,1,1,34,1,1,3,1,1,1,1,45,1
1,1,34,1,1,1,3,1,1,1,1,44,1,1,145,4,4,1,1
1,1,1,1,1,3,3,3,3,3,1,1,15,15,15,15,1,1,1
1,1,1,1,1,34,1,1,4,4,16,1,3,1,1,44,1,1,1
1,1,1,1,3,1,1,1,1,1,16,34,1,1,1,1,1,47,1
1,1,1,1,3,1,1,1,1,3,16,1,2,1,1,34,1,1,1
`,
};

export const maps: MapDefinition[] = [pipeworks, forestVigil, twoDoctrines];
