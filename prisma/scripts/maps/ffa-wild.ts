/**
 * Asymmetric free-for-all maps.
 *
 * Nothing here is fair by construction: the four quarters are shaped independently, so the pool's
 * usual "the symmetry guarantees it" argument does not apply. What holds instead is the measured
 * parity `npm run maps:check` enforces — identical property census, identical sorted distances from
 * every HQ to its own property, to each neutral kind and to the contested objectives, and the same
 * terrain mix on each player's Voronoi ground to within two tiles.
 *
 * The construction that makes that reachable by hand: the property positions and every tile that
 * blocks a tread — mountain, water, shoal — are laid out on a strict 90-degree orbit, so foot AND
 * vehicle distances are identical between players by construction. What is authored per quarter is
 * the *cover*: each quarter holds the same number of forest tiles as every other, redistributed
 * inside its own Voronoi ground. In two opposite quarters the woodland belt hugs the HQ corner and
 * the approach to the middle is bare; in the other two it is the reverse. That is enough to put the
 * pool's asymmetry floor comfortably behind us without moving a single tile that a tank cares about.
 *
 * Production is deliberately lopsided, and identically so for all four players (`sided` in
 * `BALANCED_MAPS` terms): each quarter pushes most of its producers forward onto one side of the
 * HQ-to-centre diagonal and leaves a single base tucked behind on the other, so committing to your
 * strong flank is the opening decision and the weak one is a genuinely slow road to the middle.
 */

import type { MapDefinition } from "../map-definitions";

const fourDoctrines: MapDefinition = {
  name: "FFA Four Doctrines",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  concept:
    "Three bases and no air or sea: a pure infantry-and-armour brawl decided by which way you " +
    "commit. Two of each player's bases sit forward on one side of the HQ-to-centre diagonal, one " +
    "of them right on the border shared with the next player round; the third is tucked behind the " +
    "HQ on the far side, a full seven vehicle-steps further from the middle. Four comm towers fill " +
    "the centre 2x2 and each quarter keeps one silo, so the middle is worth crossing the map for. " +
    "Roughly two fifths of the ground is forest, and where that forest lies is what differs " +
    "between quarters: in two of them it wraps the HQ, in the other two it covers the approach.",
  tileDataString: `
2,3,3,3,3,3,3,3,1,1,1,1,1,44,1,1,1,2
3,42,15,15,15,15,39,3,1,3,3,1,1,1,1,1,47,1
3,3,3,3,34,3,3,1,1,3,3,1,1,2,2,1,16,1
3,3,2,3,3,3,1,1,39,3,3,34,1,1,1,1,16,1
39,3,2,3,3,1,1,1,1,3,3,3,3,1,1,34,16,1
3,3,3,3,1,1,111,1,1,3,3,3,3,3,1,1,16,1
3,3,3,34,1,1,1,1,1,3,34,3,111,3,3,1,44,1
3,1,1,1,1,1,34,1,1,3,3,3,3,3,3,3,1,1
3,1,1,1,1,1,1,1,133,133,3,3,3,3,44,3,3,1
1,3,3,54,3,3,3,3,133,133,1,1,1,1,1,1,1,3
1,1,3,3,3,3,3,3,3,1,1,34,1,1,1,1,1,3
1,54,1,3,3,111,3,34,3,1,1,1,1,1,34,3,3,3
1,16,1,1,3,3,3,3,3,1,1,111,1,1,3,3,3,3
1,16,34,1,1,3,3,3,3,1,1,1,1,3,3,2,3,49
1,16,1,1,1,1,34,3,3,49,1,1,3,3,3,2,3,3
1,16,1,2,2,1,1,3,3,1,1,3,3,34,3,3,3,3
1,57,1,1,1,1,1,3,3,1,3,49,15,15,15,15,52,3
2,1,1,1,54,1,1,1,1,1,3,3,3,3,3,3,3,2
`,
};

const brokenCompass: MapDefinition = {
  name: "FFA Broken Compass",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  concept:
    "The four labs in the middle 2x2 are the prize, and every quarter is built to reach them from " +
    "one side only: two bases and the quarter's airport hang forward off the strong flank, the " +
    "nearest of them five vehicle-steps from the centre, while the fourth base sits behind the HQ " +
    "on the weak side at fifteen. Take the labs by ground down your strong flank or fly over the " +
    "top from the airport — the weak flank is a place to retreat to, not to attack from. Each " +
    "quarter keeps one silo, and half its ground is forest, banded differently quarter by quarter.",
  tileDataString: `
2,3,3,3,3,3,3,3,3,3,1,1,1,1,44,1,1,1,1,2
3,42,15,15,15,15,15,39,3,1,3,1,1,1,1,1,1,1,47,1
3,3,3,3,34,3,3,3,1,1,3,3,34,1,1,2,2,1,16,1
3,3,2,2,3,3,3,1,1,1,3,3,3,1,1,1,2,1,16,1
3,3,2,3,3,3,1,1,1,39,3,3,3,3,1,1,1,34,16,1
39,3,3,3,3,1,34,1,1,1,3,111,3,3,3,1,1,1,16,1
3,3,3,1,1,1,1,1,1,1,3,3,3,3,34,3,1,1,16,1
3,3,34,1,1,1,1,1,40,1,3,3,3,3,3,3,3,1,44,1
3,3,1,1,1,111,1,1,1,1,3,3,45,3,3,3,3,3,1,1
3,1,1,1,1,1,1,1,1,145,145,3,3,3,3,44,3,3,3,1
1,3,3,3,54,3,3,3,3,145,145,1,1,1,1,1,1,1,1,3
1,1,3,3,3,3,3,55,3,3,1,1,1,1,111,1,1,1,3,3
1,54,1,3,3,3,3,3,3,3,1,50,1,1,1,1,1,34,3,3
1,16,1,1,3,34,3,3,3,3,1,1,1,1,1,1,1,3,3,3
1,16,1,1,1,3,3,3,111,3,1,1,1,34,1,3,3,3,3,49
1,16,34,1,1,1,3,3,3,3,49,1,1,1,3,3,3,2,3,3
1,16,1,2,1,1,1,3,3,3,1,1,1,3,3,3,2,2,3,3
1,16,1,2,2,1,1,34,3,3,1,1,3,3,3,34,3,3,3,3
1,57,1,1,1,1,1,1,1,3,1,3,49,15,15,15,15,15,52,3
2,1,1,1,1,54,1,1,1,1,3,3,3,3,3,3,3,3,3,2
`,
};

const wildQuarters: MapDefinition = {
  name: "FFA Wild Quarters",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  concept:
    "Four shoal-fringed wedges of sea cut in from the middle of each map edge, and every one of " +
    "them straddles the border between two neighbours: the port a player owns and one of the four " +
    "neutral ports share the same contested inlet, so a fleet is a weapon against exactly one of " +
    "your three rivals. The centre is left as a land crossroads all four armies can drive onto, " +
    "three vehicle-steps from the forward base each player keeps on their strong flank and " +
    "fifteen from the base they keep behind the HQ on the weak one.",
  tileDataString: `
2,3,3,3,3,3,37,28,28,28,28,28,28,29,44,1,1,1,1,2
3,42,15,15,15,3,29,28,28,28,28,28,29,1,1,1,1,1,47,1
3,3,3,34,3,3,41,29,28,28,28,29,1,1,1,1,1,1,16,1
3,3,3,3,3,3,1,29,28,28,29,3,3,34,1,1,1,34,16,1
3,3,3,3,3,3,1,1,29,28,3,3,3,3,1,1,1,1,16,1
39,3,3,3,3,1,1,1,1,29,3,3,3,3,3,1,1,1,1,1
29,3,3,34,1,1,1,1,1,39,3,3,3,3,3,3,3,46,29,37
28,29,1,1,1,1,1,34,1,1,3,3,34,3,3,3,29,29,28,28
28,28,29,1,1,1,1,1,1,39,3,3,3,3,3,29,28,28,28,28
28,28,28,29,1,1,1,1,1,1,3,44,3,44,29,28,28,28,28,28
28,28,28,28,28,29,54,3,54,3,1,1,1,1,1,1,29,28,28,28
28,28,28,28,29,3,3,3,3,3,49,1,1,1,1,1,1,29,28,28
28,28,29,29,3,3,3,34,3,3,1,1,34,1,1,1,1,1,29,28
37,29,56,3,3,3,3,3,3,3,49,1,1,1,1,1,34,3,3,29
1,1,1,1,1,3,3,3,3,3,29,1,1,1,1,3,3,3,3,49
1,16,1,1,1,1,3,3,3,3,28,29,1,1,3,3,3,3,3,3
1,16,34,1,1,1,34,3,3,29,28,28,29,1,3,3,3,3,3,3
1,16,1,1,1,1,1,1,29,28,28,28,29,51,3,3,34,3,3,3
1,57,1,1,1,1,1,29,28,28,28,28,28,29,3,15,15,15,52,3
2,1,1,1,1,54,29,28,28,28,28,28,28,37,3,3,3,3,3,2
`,
};

export const maps: MapDefinition[] = [fourDoctrines, brokenCompass, wildQuarters];
