/**
 * Three 2v2 layouts built around the same question: how much of the map does a teammate share
 * with you, and how easily can the two of you trade places?
 *
 * `teamMapping: [0, 1, 0, 1]` puts slots 0 and 2 together throughout. On the two mirrored layouts
 * that makes the teams the left and right halves, so teammates sit one above the other and enemies
 * face each other across the middle; on the pinwheel below the same mapping pairs the diagonally
 * opposite seats instead.
 */

import type { MapDefinition } from "../map-definitions";

/* -------------------------------------------------------------------------------------------- */
/* 2v2                                                                                          */
/* -------------------------------------------------------------------------------------------- */

const sharedShore: MapDefinition = {
  name: "2v2 Shared Shore",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A sea lane wraps the whole map, so the two players of a team share one coastline and one " +
    "port each, and the water they launch from runs uninterrupted around to the enemy's beaches. " +
    "Every base, every neutral city and the stacked labs and comm towers in the middle are on the " +
    "inland block, which is where the game is actually won; the four neutral ports on the sand " +
    "are the only reason to contest the sea. The naval flank is therefore optional and slow — a " +
    "team that commits to it is betting on landing behind a front its teammate has to hold alone. " +
    "Production is split unevenly around each HQ: the seaward flank carries the port, the airport " +
    "and a base pushed forward level with the comm towers, while the flank facing the enemy half " +
    "keeps only the one base beside the HQ — so the fast build-up and the short road to the " +
    "middle are both on the side that has its back to the water.",
  tileDataString: `
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
28,28,29,1,3,1,1,1,1,1,1,1,1,1,1,3,1,29,28,28
28,28,1,42,39,1,34,1,3,1,1,3,1,34,1,44,47,1,28,28
28,41,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,46,28
28,28,37,1,40,1,1,1,1,1,1,1,1,1,1,45,1,37,28,28
28,28,1,1,1,2,1,34,1,1,1,1,34,1,2,1,1,1,28,28
28,28,29,3,39,1,1,1,1,133,133,1,1,1,1,44,3,29,28,28
28,28,1,1,34,1,3,1,1,145,145,1,1,3,1,34,1,1,28,28
28,28,1,1,34,1,3,1,1,145,145,1,1,3,1,34,1,1,28,28
28,28,29,3,49,1,1,1,1,133,133,1,1,1,1,54,3,29,28,28
28,28,1,1,1,2,1,34,1,1,1,1,34,1,2,1,1,1,28,28
28,28,37,1,50,1,1,1,1,1,1,1,1,1,1,55,1,37,28,28
28,51,1,1,1,1,1,1,1,2,2,1,1,1,1,1,1,1,56,28
28,28,1,52,49,1,34,1,3,1,1,3,1,34,1,54,57,1,28,28
28,28,29,1,3,1,1,1,1,1,1,1,1,1,1,3,1,29,28,28
28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28
`,
};

const twinLanes: MapDefinition = {
  name: "2v2 Twin Lanes",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "A two-tile mountain wall runs the whole width of the map and cuts it into a northern and a " +
    "southern lane, one per teammate. The wall opens in only two places on each team's side: a " +
    "plain gap beside the home bases and a pair of neutral labs deeper in, so switching lanes " +
    "costs several turns and can only be done at home, never through the enemy's half. Each lane " +
    "has its own highway straight from one HQ to the other, which makes every lane a self-" +
    "contained duel that the teammate can reinforce but not take over.",
  tileDataString: `
2,39,1,1,3,1,34,1,1,1,2,2,1,1,1,34,1,3,1,1,44,2
42,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,47
2,39,1,1,1,3,1,1,1,1,1,1,1,1,1,1,3,1,1,1,44,2
1,40,1,34,1,1,1,1,1,133,1,1,133,1,1,1,1,1,34,1,45,1
3,1,1,1,1,1,1,1,3,1,1,1,1,3,1,1,1,1,1,1,1,3
1,1,34,1,3,1,1,1,1,1,1,1,1,1,1,1,1,3,1,34,1,1
1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,2,1,1,1,1,1,1
2,2,1,2,2,2,145,2,2,2,2,2,2,2,2,145,2,2,2,1,2,2
2,2,1,2,2,2,145,2,2,2,2,2,2,2,2,145,2,2,2,1,2,2
1,1,1,1,1,1,2,1,1,1,1,1,1,1,1,2,1,1,1,1,1,1
1,1,34,1,3,1,1,1,1,1,1,1,1,1,1,1,1,3,1,34,1,1
3,1,1,1,1,1,1,1,3,1,1,1,1,3,1,1,1,1,1,1,1,3
1,50,1,34,1,1,1,1,1,133,1,1,133,1,1,1,1,1,34,1,55,1
2,49,1,1,1,3,1,1,1,1,1,1,1,1,1,1,3,1,1,1,54,2
52,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,15,57
2,49,1,1,3,1,34,1,1,1,2,2,1,1,1,34,1,3,1,1,54,2
`,
};

/**
 * The one asymmetric layout of the batch, and the only one with no mirror in it at all.
 *
 * It is built as a pinwheel: the whole board is the top-left quarter turned through 90 degrees
 * four times, slots advancing 0 -> 1 -> 2 -> 3 with it. That makes every player an exact isometric
 * image of every other, so the census, the foot and tread distance lists and the terrain mix are
 * identical by construction — while the layout itself is chiral, so it is nothing like the
 * horizontal mirror a 2v2 map is normally cut from. Teammates sit diagonally opposite.
 */
const unevenShores: MapDefinition = {
  name: "2v2 Uneven Shores",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Four shores that never meet. Each player gets a two-tile strip of sea along one board edge, " +
    "beached with shoals and holding their port — and the next player's sea is a quarter turn " +
    "away, so no two coastlines connect and every landing has to be made on the enemy's own " +
    "beach. Both bases and the airport sit on the same side of the line from their HQ to the " +
    "centre, hugging the board edge, so land production all comes from one shoulder; the port sits " +
    "at the far end of the same shore, alone on the other side of that line and a long drive from " +
    "the middle. That leaves the shoulder the neighbour a quarter turn clockwise attacks into with " +
    "one slow building to defend rather than none at all, and makes the port the piece you lose " +
    "first if you commit everything to the strong side. Twelve neutral cities and four comm towers " +
    "spread the expansion out, and a 2x2 block of four neutral labs sits dead centre, equally far " +
    "from all four HQs and impossible to hold without exposing the empty flank.",
  tileDataString: `
28,28,28,28,28,28,28,28,28,1,1,1,1,3,1,29,28,28
28,28,28,28,28,28,28,28,28,3,1,45,1,1,1,1,28,28
29,1,29,1,41,29,1,3,1,1,34,1,44,1,3,29,28,28
1,1,3,1,42,1,1,1,1,1,1,34,1,1,1,1,28,28
3,1,1,1,1,1,34,1,1,2,1,1,3,1,47,46,28,28
1,1,39,1,3,1,1,2,1,1,44,1,1,1,1,29,28,28
1,40,1,34,1,1,1,133,1,1,1,1,1,34,1,1,28,28
1,1,34,1,1,39,1,1,3,1,1,133,2,1,1,3,28,28
1,3,1,1,2,1,1,1,145,145,3,1,1,1,1,1,28,28
28,28,1,1,1,1,1,3,145,145,1,1,1,2,1,1,3,1
28,28,3,1,1,2,133,1,1,3,1,1,49,1,1,34,1,1
28,28,1,1,34,1,1,1,1,1,133,1,1,1,34,1,50,1
28,28,29,1,1,1,1,54,1,1,2,1,1,3,1,49,1,1
28,28,56,57,1,3,1,1,2,1,1,34,1,1,1,1,1,3
28,28,1,1,1,1,34,1,1,1,1,1,1,52,1,3,1,1
28,28,29,3,1,54,1,34,1,1,3,1,29,51,1,29,1,29
28,28,1,1,1,1,55,1,3,28,28,28,28,28,28,28,28,28
28,28,29,1,3,1,1,1,1,28,28,28,28,28,28,28,28,28
`,
};

export const maps: MapDefinition[] = [sharedShore, twinLanes, unevenShores];
