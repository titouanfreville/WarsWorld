/**
 * Three 1v1 maps built on a 180-degree rotation: air control, a single land bridge, and a
 * highland siege. Each was authored as a top half and mechanically rotated into its bottom half,
 * so census, distances and terrain mix are equal by construction.
 */

import type { MapDefinition } from "../map-definitions";

const twinAirfields: MapDefinition = {
  name: "1v1 Twin Airfields",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Each player starts with an airport next to their HQ and two more sit unclaimed on the " +
    "centreline, so the first real decision is whether to buy air units off the airport you " +
    "already own or to spend infantry taking a second one. Two long east-west runways of road " +
    "let ground units cross the map fast enough to punish a player who over-invests in air. " +
    "A neutral comm tower sits between the two contested airports, so the fight for the middle " +
    "is one engagement, not three.",
  tileDataString: `
2,2,1,3,1,1,34,1,1,1,3,1,1,34,1,1,2
2,42,39,1,1,3,1,1,2,1,1,3,1,1,1,3,1
1,39,40,1,34,1,1,3,1,1,1,34,1,1,3,1,1
1,1,1,15,15,15,15,15,15,15,15,15,15,15,1,1,1
1,3,34,1,1,2,1,3,1,3,1,1,1,1,1,3,1
1,1,39,1,3,1,1,1,1,1,2,1,1,1,1,1,1
1,1,1,1,36,1,34,1,133,1,1,1,3,1,1,1,1
1,1,1,1,3,1,1,1,133,1,34,1,36,1,1,1,1
1,1,1,1,1,1,2,1,1,1,1,1,3,1,44,1,1
1,3,1,1,1,1,1,3,1,3,1,2,1,1,34,3,1
1,1,1,15,15,15,15,15,15,15,15,15,15,15,1,1,1
1,1,3,1,1,34,1,1,1,3,1,1,34,1,45,44,1
1,3,1,1,1,3,1,1,2,1,1,3,1,1,44,47,2
2,1,1,34,1,1,3,1,1,1,34,1,1,3,1,2,2
`,
};

const theIsthmus: MapDefinition = {
  name: "1v1 The Isthmus",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Two landmasses face each other across a sea channel, joined only by a three-tile neck at " +
    "the centre with a neutral city on it. Ground armies either grind through that neck, where " +
    "nothing wider than three units can engage at once, or pay for transports. Production is " +
    "deliberately lopsided: two forward bases and both ports sit on one flank, well away from " +
    "the HQ, while a single base is left behind on the other. The neck splits the water into two " +
    "seas that never meet, so each player owns one of them outright — and the sea you own washes " +
    "the coast your opponent left thin. Shoal beaches on both coasts are the only tiles a lander " +
    "can unload onto, which fixes exactly where an amphibious turn can come ashore.",
  tileDataString: `
2,2,1,3,1,1,34,1,1,1,1,1,34,1,3,1,1,2,2
2,42,1,1,1,3,1,1,3,1,1,1,1,1,1,3,1,1,2
1,1,1,1,34,1,1,1,1,133,1,39,1,1,34,1,1,1,1
1,39,1,3,1,1,3,1,1,1,1,1,3,1,1,1,3,1,1
1,3,34,1,1,1,1,3,1,1,1,3,1,1,1,34,1,3,1
1,1,1,1,29,29,1,3,1,1,1,3,39,29,29,41,1,41,1
28,28,28,28,28,28,28,28,1,1,1,28,28,28,28,28,28,28,28
28,28,28,28,28,28,28,28,3,34,3,28,28,28,28,28,28,28,28
28,28,28,28,28,28,28,28,1,1,1,28,28,28,28,28,28,28,28
1,46,1,46,29,29,44,3,1,1,1,3,1,29,29,1,1,1,1
1,3,1,34,1,1,1,3,1,1,1,3,1,1,1,1,34,3,1
1,1,3,1,1,1,3,1,1,1,1,1,3,1,1,3,1,44,1
1,1,1,1,34,1,1,44,1,133,1,1,1,1,34,1,1,1,1
2,1,1,3,1,1,1,1,1,1,3,1,1,3,1,1,1,47,2
2,2,1,1,3,1,34,1,1,1,1,1,34,1,1,3,1,2,2
`,
};

const highlandFort: MapDefinition = {
  name: "1v1 Highland Fort",
  category: "1v1",
  numberOfPlayers: 2,
  symmetry: "rotate180",
  concept:
    "Each HQ sits in a corner walled off by a four-tile mountain massif with a single gap beside " +
    "it, so an attacker arrives on a known tile and an artillery parked behind the wall covers " +
    "it. Scattered mountains across the middle give indirects firing platforms all the way in, " +
    "which makes the approach a leapfrog rather than a charge. Two silos flank the centre as the " +
    "one way to break a dug-in line without paying for it in units.",
  tileDataString: `
2,42,38,1,1,3,1,34,1,1,3,1,1,1,2
2,39,39,1,3,1,1,1,1,3,1,1,34,1,1
2,2,2,2,1,1,3,1,1,1,1,3,1,1,1
1,1,1,2,1,34,1,1,2,1,1,1,3,1,1
1,34,1,1,1,1,3,1,1,1,3,1,1,2,1
3,1,1,3,1,2,1,1,1,1,1,1,2,1,1
1,1,3,1,1,1,1,133,1,1,2,1,1,3,1
1,2,1,1,34,1,111,1,111,1,34,1,1,2,1
1,3,1,1,2,1,1,133,1,1,1,1,3,1,1
1,1,2,1,1,1,1,1,1,2,1,3,1,1,3
1,2,1,1,3,1,1,1,3,1,1,1,1,34,1
1,1,3,1,1,1,2,1,1,34,1,2,1,1,1
1,1,1,3,1,1,1,1,3,1,1,2,2,2,2
1,1,34,1,1,3,1,1,1,1,3,1,44,44,2
2,1,1,1,3,1,1,34,1,3,1,1,43,47,2
`,
};

export const maps: MapDefinition[] = [twinAirfields, theIsthmus, highlandFort];
