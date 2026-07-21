/**
 * 2v2 batch: a naval lagoon, a forest map, and one asymmetric map.
 *
 * All three seat four players as two teams of two. `teamMapping` pairs the left column of HQs
 * against the right one, which is the pairing every layout here is drawn for: teammates share a
 * lateral connection down their own side, and the contested lanes run east-west.
 */

import type { MapDefinition } from "../map-definitions";

const lagoonAlliance: MapDefinition = {
  name: "2v2 Lagoon Alliance",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Two landlocked lagoons fill the middle of the map, one behind each team's shore, and the " +
    "only way onto either is the port each player owns. No ground unit crosses east to west " +
    "through the water, so the north and south rims are two separate fronts. Between the lagoons " +
    "a two-tile causeway runs north to south: the one overland link between those fronts, narrow " +
    "enough for a single stack to hold, with a pair of comm towers capping each end. A navy is " +
    "the other way between fronts — down your own lagoon, out of reach of whoever owns the " +
    "causeway.",
  tileDataString: `
2,1,3,39,34,1,1,3,1,1,3,1,1,34,44,3,1,2
1,42,22,15,20,1,3,1,1,1,1,3,1,21,15,22,47,1
3,1,16,3,1,1,34,1,1,1,1,34,1,1,3,16,1,3
1,39,16,1,3,1,1,1,3,3,1,1,1,3,1,16,44,1
1,40,16,34,1,3,1,1,1,1,1,1,3,1,34,16,45,1
3,1,16,1,1,1,3,1,133,133,1,3,1,1,1,16,1,3
1,1,16,1,1,1,29,28,3,3,28,29,1,1,1,16,1,1
1,1,16,1,1,41,28,28,1,1,28,28,46,1,1,16,1,1
1,1,16,1,1,51,28,28,1,1,28,28,56,1,1,16,1,1
1,1,16,1,1,1,29,28,3,3,28,29,1,1,1,16,1,1
3,1,16,1,1,1,3,1,133,133,1,3,1,1,1,16,1,3
1,50,16,34,1,3,1,1,1,1,1,1,3,1,34,16,55,1
1,49,16,1,3,1,1,1,3,3,1,1,1,3,1,16,54,1
3,1,16,3,1,1,34,1,1,1,1,34,1,1,3,16,1,3
1,52,24,15,19,1,3,1,1,1,1,3,1,18,15,24,57,1
2,1,3,49,34,1,1,3,1,1,3,1,1,34,54,3,1,2
`,
};

const forestPact: MapDefinition = {
  name: "2v2 Forest Pact",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "mirrorBoth",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Forest covers most of the map and there is no road anywhere, so nothing moves fast and almost " +
    "nothing is visible under fog. Recon and infantry earn their keep here: an army that pushes " +
    "without scouting walks into whatever the other team parked in the trees. The four neutral " +
    "labs form the one open block in the centre, which is the only place a fight can be seen " +
    "coming. Each player's base and airport sit on the flank facing that centre; a second base " +
    "sits back on the top or bottom edge, three steps further from the fight than anything else " +
    "you own.",
  tileDataString: `
2,1,3,39,1,34,3,3,1,3,3,1,3,3,34,1,44,3,1,2
1,42,3,1,3,1,3,1,3,3,3,3,1,3,1,3,1,3,47,1
3,39,1,3,3,3,1,3,1,3,3,1,3,1,3,3,3,1,44,3
3,3,3,1,34,3,3,1,3,1,1,3,1,3,3,34,1,3,3,3
1,1,3,3,1,3,1,3,3,3,3,3,3,1,3,1,3,3,1,1
3,40,1,3,3,1,3,34,1,3,3,1,34,3,1,3,3,1,45,3
1,3,3,1,3,3,3,1,3,3,3,3,1,3,3,3,1,3,3,1
3,1,3,3,1,3,1,3,3,145,145,3,3,1,3,1,3,3,1,3
3,1,3,3,1,3,1,3,3,145,145,3,3,1,3,1,3,3,1,3
1,3,3,1,3,3,3,1,3,3,3,3,1,3,3,3,1,3,3,1
3,50,1,3,3,1,3,34,1,3,3,1,34,3,1,3,3,1,55,3
1,1,3,3,1,3,1,3,3,3,3,3,3,1,3,1,3,3,1,1
3,3,3,1,34,3,3,1,3,1,1,3,1,3,3,34,1,3,3,3
3,49,1,3,3,3,1,3,1,3,3,1,3,1,3,3,3,1,54,3
1,52,3,1,3,1,3,1,3,3,3,3,1,3,1,3,1,3,57,1
2,1,3,49,1,34,3,3,1,3,3,1,3,3,34,1,54,3,1,2
`,
};

const mirrorBroken: MapDefinition = {
  name: "2v2 Mirror Broken",
  category: "2v2",
  numberOfPlayers: 4,
  symmetry: "asymmetric",
  teamMapping: [0, 1, 0, 1],
  concept:
    "Every player owns the same properties at the same walking and driving distances, but the " +
    "woods between them are shaped four different ways: a wood wall pierced by a single gap, a " +
    "field of scattered copses, two belts angled at the centre, and an open plain rimmed with " +
    "cover. Each quadrant holds twenty forest tiles and the same four mountains, so cover is " +
    "equal in amount and nowhere near equal in shape. Production straddles the home corner: a " +
    "base and an airport on the flank facing the centre, and a lone base out on the map edge " +
    "behind you. The edge base is four steps from your HQ but thirteen from the middle, so it " +
    "builds the units you defend with, never the ones that arrive in time to attack.",
  tileDataString: `
1,1,1,3,39,34,3,2,1,3,2,1,34,44,1,3,1,3
1,42,1,1,3,3,3,1,1,1,3,1,1,1,1,3,47,1
1,39,1,1,3,3,3,1,1,3,1,1,1,1,3,1,44,3
1,1,2,1,3,3,3,34,1,3,34,1,1,1,1,2,1,1
1,1,1,3,3,1,1,1,1,1,3,1,1,1,1,3,1,3
1,1,1,1,3,3,2,1,1,3,1,2,1,1,3,1,3,1
1,1,40,1,34,3,3,1,1,1,3,1,1,34,3,45,1,3
1,2,1,1,3,3,3,1,145,145,3,1,1,1,1,3,2,1
1,2,1,1,3,3,3,3,145,145,1,1,1,1,3,3,2,1
1,1,50,3,34,1,3,3,1,3,1,1,1,34,1,55,1,3
1,3,3,1,1,3,2,3,1,3,1,2,1,1,1,1,1,3
1,1,1,1,1,3,3,1,1,3,1,1,1,3,1,1,1,3
1,1,2,3,3,1,1,34,1,3,34,1,1,1,1,2,1,3
1,49,3,3,1,1,1,1,1,3,3,1,1,1,1,1,54,3
1,52,1,1,3,1,1,1,1,3,3,1,1,1,1,1,57,3
1,1,3,3,49,34,1,2,1,3,2,3,34,54,1,1,3,3
`,
};

export const maps: MapDefinition[] = [lagoonAlliance, forestPact, mirrorBroken];
