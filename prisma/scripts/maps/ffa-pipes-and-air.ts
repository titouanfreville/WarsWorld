/**
 * Free-for-all batch: pipes, airfields and forest.
 *
 * All three are `rotate90` on a square grid, the only symmetry under which four players sit in
 * positionally identical quadrants. Each was authored as its top-left quadrant and the other three
 * derived by rotation, so the property census, the distances and the terrain mix are identical by
 * construction — `npm run maps:check` re-verifies that, variants and slot permutation included.
 *
 * The shared skeleton is deliberate: every player gets 1 HQ, 2 bases, 1 own city and 1 airport, and
 * the maps differ in what sits between the quadrants and what is worth walking to.
 *
 * All three are `sided`: the three producers are pushed out of the HQ corner and split two-to-one
 * across the flanks of the HQ-to-centre diagonal, with the pair on the flank that also reaches the
 * centre first. Openings are therefore a choice — commit to the fast side or develop the slow one —
 * rather than the same two bases next to the HQ on every map.
 */
import type { MapDefinition } from "../map-definitions";

/**
 * The pipe arms form a pinwheel rather than a cross: each arm runs from the centre block outwards
 * and stops two tiles short of the edge, so the rim is the only ground route between quadrants
 * until a seam is blown. Every arm carries exactly one seam, at the same offset from the centre.
 */
const pipeHub: MapDefinition = {
  name: "FFA Pipe Hub",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four pipe arms spiral out of the centre and wall each quadrant off from its neighbours, " +
    "leaving one two-tile gap in each rim as the only early ground link. Production is split " +
    "across those two gaps: an airport and a forward base sit on the fast flank, hard against the " +
    "pipe beside its gap, while a single base guards the slow flank four steps further back, so " +
    "an opening commits to one neighbour. Each arm carries a single seam, so a player who spends " +
    "shots on one chooses which front to open, and opens it for that neighbour too. The centre " +
    "block of four comm towers sits inside the spiral, reachable by everyone and defensible by " +
    "nobody.",
  tileDataString: `
1,2,1,3,1,1,34,1,1,1,1,3,44,1,3,1,2,1
2,42,1,1,1,3,40,1,3,1,1,1,1,34,1,1,47,2
1,1,38,1,2,1,1,39,1,102,1,2,1,1,1,43,1,1
3,1,1,1,1,34,1,1,1,102,1,1,1,1,1,1,1,3
1,34,1,1,1,1,1,2,1,114,1,111,1,1,1,2,1,1
39,1,1,1,1,1,3,1,1,102,3,1,1,1,34,1,3,1
3,1,2,1,111,1,1,1,1,102,1,1,3,1,1,1,45,34
1,1,1,1,1,3,1,1,3,102,1,1,1,2,1,44,1,1
1,1,101,101,113,101,101,101,133,133,3,1,1,1,1,1,3,1
1,3,1,1,1,1,1,3,133,133,101,101,101,113,101,101,1,1
1,1,54,1,2,1,1,1,102,3,1,1,3,1,1,1,1,1
34,55,1,1,1,3,1,1,102,1,1,1,1,111,1,2,1,3
1,3,1,34,1,1,1,3,102,1,1,3,1,1,1,1,1,49
1,1,2,1,1,1,111,1,114,1,2,1,1,1,1,1,34,1
3,1,1,1,1,1,1,1,102,1,1,1,34,1,1,1,1,3
1,1,53,1,1,1,2,1,102,1,49,1,1,2,1,48,1,1
2,57,1,1,34,1,1,1,1,3,1,50,3,1,1,1,52,2
1,2,1,3,1,54,3,1,1,1,1,34,1,1,3,1,2,1
`,
};

/**
 * The four centre airports are adjacent to each other, so whoever lands there first is producing
 * air units inside everyone else's reach. The road spurs exist to make that race winnable by
 * infantry rather than only by a mech that started next to it — and each player's base-and-airport
 * pair sits on the spur, so the fast flank is the one the whole map is pointed at.
 */
const airfieldCentre: MapDefinition = {
  name: "FFA Airfield Centre",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "A 2x2 block of neutral airports sits at the exact centre, with one road spur per quadrant " +
    "running straight into it. Everyone starts with a single airport of their own, parked beside " +
    "the spur next to a base, so the flank that feeds the race is also the flank that owns the " +
    "air; the other flank keeps one lone base out along the far edge, four steps slower to the " +
    "middle. The centre block is the difference between contesting the sky and conceding it, and " +
    "holding it means producing from a tile three other players can walk to. Open ground and few " +
    "mountains keep anti-air able to answer, so the race is worth entering rather than an " +
    "automatic loss.",
  tileDataString: `
42,1,1,3,39,1,1,34,1,1,1,1,3,1,1,47
1,38,1,1,1,34,1,1,16,1,44,34,1,1,43,1
1,1,1,3,1,1,3,1,16,45,3,1,2,1,1,1
3,1,2,1,1,1,111,3,16,133,1,1,1,3,1,3
1,34,1,1,3,1,1,1,16,1,1,3,1,1,1,44
1,39,3,1,1,2,1,1,16,1,2,1,1,1,34,1
1,1,40,133,1,1,3,1,16,3,1,1,111,3,1,1
1,15,15,15,15,15,15,36,36,1,1,1,3,1,1,34
34,1,1,3,1,1,1,36,36,15,15,15,15,15,15,1
1,1,3,111,1,1,3,16,1,3,1,1,133,50,1,1
1,34,1,1,1,2,1,16,1,1,2,1,1,3,49,1
54,1,1,1,3,1,1,16,1,1,1,3,1,1,34,1
3,1,3,1,1,1,133,16,3,111,1,1,1,2,1,3
1,1,1,2,1,3,55,16,1,3,1,1,3,1,1,1
1,53,1,1,34,54,1,16,1,1,34,1,1,1,48,1
57,1,1,3,1,1,1,1,34,1,1,49,3,1,1,52
`,
};

/**
 * The belts are forest and mountain rather than a hard wall: nothing is blocked, everything is
 * slowed. Each belt also stops short of the map edge, so the corners stay open as a flank for a
 * player willing to walk the long way round.
 */
const forestCross: MapDefinition = {
  name: "FFA Forest Cross",
  category: "ffa",
  numberOfPlayers: 4,
  symmetry: "rotate90",
  concept:
    "Four forest-and-mountain belts pinwheel out of the centre and separate the quadrants. Nothing " +
    "is impassable, but a tank crossing a belt spends a turn in cover it cannot shoot out of well, " +
    "which makes an early rush expensive and rewards expanding into your own quarter first. The " +
    "centre block of four neutral labs is the reason anyone eventually pays the crossing cost.",
  tileDataString: `
2,2,3,1,1,34,1,1,3,1,3,1,1,1,34,1,1,3,2,2
2,42,39,1,3,1,1,1,1,3,3,3,1,1,1,3,1,44,47,2
3,39,38,1,1,1,3,1,1,1,2,1,1,3,1,1,1,43,44,3
1,1,1,1,3,1,1,34,1,1,3,1,1,1,1,45,1,1,1,1
1,3,1,40,1,1,1,1,3,1,3,3,1,2,1,1,3,1,3,1
34,1,1,1,1,3,1,1,1,2,3,1,1,1,3,1,1,1,1,34
1,1,3,1,2,1,111,1,1,1,2,1,1,111,1,1,1,3,1,1
1,1,1,1,1,1,1,3,1,1,3,1,3,1,1,1,34,1,1,1
1,3,1,1,3,1,1,1,1,3,3,1,1,1,1,3,1,1,1,3
3,3,2,3,3,3,2,3,3,145,145,3,1,1,2,1,1,1,3,1
1,3,1,1,1,2,1,1,3,145,145,3,3,2,3,3,3,2,3,3
3,1,1,1,3,1,1,1,1,3,3,1,1,1,1,3,1,1,3,1
1,1,1,34,1,1,1,3,1,3,1,1,3,1,1,1,1,1,1,1
1,1,3,1,1,1,111,1,1,2,1,1,1,111,1,2,1,3,1,1
34,1,1,1,1,3,1,1,1,3,2,1,1,1,3,1,1,1,1,34
1,3,1,3,1,1,2,1,3,3,1,3,1,1,1,1,50,1,3,1
1,1,1,1,55,1,1,1,1,3,1,1,34,1,1,3,1,1,1,1
3,54,53,1,1,1,3,1,1,2,1,1,1,3,1,1,1,48,49,3
2,57,54,1,3,1,1,1,3,3,3,1,1,1,1,3,1,49,52,2
2,2,3,1,1,34,1,1,1,3,1,3,1,1,34,1,1,3,2,2
`,
};

export const maps: MapDefinition[] = [pipeHub, airfieldCentre, forestCross];
