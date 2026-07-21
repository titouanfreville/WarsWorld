/**
 * FFA batch: three 4-player maps built on 90-degree rotational symmetry.
 *
 * Each is authored as a single quadrant and derived by rotation, so the four seats are
 * positionally identical and no player has a "weak neighbour" to be ganged up on. The three
 * differ in what the middle of the map is worth: a walled quadrant you can hide in, a silo
 * cluster nobody can sit on, or a river pinwheel that decides which two rivals you can reach.
 */
import type { MapDefinition } from "../map-definitions";

const quadrantChokes: MapDefinition = {
  name: "FFA Quadrant Chokes",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Each player's HQ and both bases sit inside a 6x6 corner walled off by an L-shaped mountain " +
    "ridge with a single road gap. Vehicles can only enter or leave through that gap, so a " +
    "defender needs very little to hold the door while infantry climb the ridge to trade slowly. " +
    "Turtling is not free, though: the airport is pushed OUTSIDE the ridge, on the side the road " +
    "spoke runs, so the flank that carries the road carries the production and reaches the centre " +
    "first, while the other side of the corner holds a lone base far from everything. The four " +
    "spokes meet at a 2x2 block of neutral cities in the middle, and whoever never leaves their " +
    "corner is out-produced by whoever does.",
  tileDataString: `
2,2,3,1,1,3,2,1,1,1,1,2,1,1,1,3,2,2
2,42,39,1,34,1,2,1,3,1,3,2,1,1,1,44,47,2
3,39,15,19,1,1,2,1,1,133,45,2,34,1,1,16,44,3
1,1,1,16,1,1,2,3,1,18,15,15,15,15,15,20,1,1
1,1,1,16,3,1,2,1,1,16,1,2,1,3,1,1,34,1
1,1,34,16,1,1,2,1,1,16,3,2,1,1,1,1,1,3
2,2,2,16,2,2,2,1,1,16,1,2,2,2,2,2,2,2
1,3,40,16,1,3,1,1,3,16,1,1,1,1,3,1,1,1
1,1,133,21,15,15,15,15,34,34,3,1,1,1,1,1,3,1
1,3,1,1,1,1,1,3,34,34,15,15,15,15,19,133,1,1
1,1,1,3,1,1,1,1,16,3,1,1,3,1,16,50,3,1
2,2,2,2,2,2,2,1,16,1,1,2,2,2,16,2,2,2
3,1,1,1,1,1,2,3,16,1,1,2,1,1,16,34,1,1
1,34,1,1,3,1,2,1,16,1,1,2,1,3,16,1,1,1
1,1,18,15,15,15,15,15,20,1,3,2,1,1,16,1,1,1
3,54,16,1,1,34,2,55,133,1,1,2,1,1,21,15,49,3
2,57,54,1,1,1,2,3,1,3,1,2,1,34,1,49,52,2
2,2,3,1,1,1,2,1,1,1,1,2,3,1,1,3,2,2
`,
};

const centralSilo: MapDefinition = {
  name: "FFA Central Silo",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four unused silos sit shoulder to shoulder in the exact middle, and one road runs from each " +
    "home cluster straight up to them. Reaching a silo is easy; standing on one is not, because " +
    "the tile it is fired from is the tile the other three roads also arrive on. Massing an army " +
    "near the centre is therefore how you get hit by a silo, so the middle changes hands " +
    "repeatedly instead of being camped. Production is split unevenly on purpose: the airport is " +
    "pushed out along the road side, seven steps closer to the silos by vehicle than the lone " +
    "base left on the opposite flank, so the road side is the committed side and the other one " +
    "is a slow second front.",
  tileDataString: `
2,2,3,1,1,1,34,1,1,3,1,1,1,3,1,1,1,3,2,2
2,42,39,1,3,1,1,1,3,1,1,133,1,1,1,1,1,44,47,2
3,39,16,1,1,3,1,1,1,1,1,45,3,18,15,15,15,15,44,3
1,1,16,3,1,1,34,1,3,1,3,1,1,16,1,1,3,1,1,1
1,1,16,1,34,1,1,3,1,1,1,1,2,16,1,34,1,1,3,1
1,1,16,1,1,2,1,1,1,1,1,1,1,16,2,1,1,3,1,1
3,1,21,15,15,15,19,1,2,1,18,15,15,20,1,1,34,1,1,34
1,1,3,1,2,1,16,1,1,3,16,1,1,1,1,3,1,1,1,1
1,133,40,1,1,1,16,1,1,1,16,1,1,2,1,1,3,1,3,1
1,1,1,3,1,1,21,15,15,111,111,1,3,1,1,1,1,1,1,3
3,1,1,1,1,1,1,3,1,111,111,15,15,19,1,1,3,1,1,1
1,3,1,3,1,1,2,1,1,16,1,1,1,16,1,1,1,50,133,1
1,1,1,1,3,1,1,1,1,16,3,1,1,16,1,2,1,3,1,1
34,1,1,34,1,1,18,15,15,20,1,2,1,21,15,15,15,19,1,3
1,1,3,1,1,2,16,1,1,1,1,1,1,1,2,1,1,16,1,1
1,3,1,1,34,1,16,2,1,1,1,1,3,1,1,34,1,16,1,1
1,1,1,3,1,1,16,1,1,3,1,3,1,34,1,1,3,16,1,1
3,54,15,15,15,15,20,3,55,1,1,1,1,1,3,1,1,16,49,3
2,57,54,1,1,1,1,1,133,1,1,3,1,1,1,3,1,49,52,2
2,2,3,1,1,1,3,1,1,1,3,1,1,34,1,1,1,3,2,2
`,
};

const diagonalRivers: MapDefinition = {
  name: "FFA Diagonal Rivers",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "A river runs diagonally across every quadrant, and the four of them form a pinwheel around " +
    "the labs in the centre. Each river has exactly two bridges, both inside the quadrant it " +
    "cuts, so a player's own ground is the awkward one to move through while the borders with " +
    "the two neighbours stay open land. Infantry ford the water and ignore all of this, which " +
    "makes the opening a race to sit on the bridges before the enemy's vehicles need them.",
  tileDataString: `
2,2,3,1,1,3,1,1,5,3,1,1,1,3,2,2
2,42,39,1,34,1,1,5,5,34,1,45,1,44,47,2
3,39,1,1,1,3,1,5,5,18,15,19,1,1,44,3
1,1,1,34,1,7,4,9,10,27,8,16,34,1,1,1
1,40,18,15,15,26,15,1,1,16,5,16,1,1,34,1
1,1,16,7,4,9,1,3,3,1,10,27,8,3,1,3
3,34,21,26,15,1,3,1,1,3,1,16,5,1,1,1
4,4,4,9,1,3,1,145,145,1,3,1,10,4,4,1
1,4,4,8,1,3,1,145,145,1,3,1,7,4,4,4
1,1,1,5,16,1,3,1,1,3,1,15,26,19,34,3
3,1,3,10,27,8,1,3,3,1,7,4,9,16,1,1
1,34,1,1,16,5,16,1,1,15,26,15,15,20,50,1
1,1,1,34,16,10,27,8,7,4,9,1,34,1,1,1
3,54,1,1,21,15,20,5,5,1,3,1,1,1,49,3
2,57,54,1,55,1,34,5,5,1,1,34,1,49,52,2
2,2,3,1,1,1,3,5,1,1,3,1,1,3,2,2
`,
};

export const maps: MapDefinition[] = [quadrantChokes, centralSilo, diagonalRivers];
