import { describe, expect, it } from "vitest";
import { releaseHoldings } from "server/engine/rules/elimination";
import { countTeamHoldings, dayLimitWinner } from "server/engine/previews/day-limit";
import { createTestMatch, property, tiles } from "../helpers/scenario";
import type { ChangeableTile } from "server/core/schemas/tile-state";
import type { MatchWrapper } from "server/engine/entities/match";

/**
 * What a player's properties do when they leave the match.
 *
 * Canon Advance Wars: an HQ capture hands the capturer the loser's entire economy, while a rout or a
 * resignation — where there is no capturer to reward — returns the properties to neutral. Either
 * way the HQ stops being an HQ, so nobody ends up holding two and no eliminated player leaves a
 * capturable headquarters behind.
 *
 * Before this rule only the capture path touched the board, so a routed player's empire sat there
 * under their slot forever — and could be scored for them at the day limit.
 */
const grid = () => Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => tiles.plain()));

const threeWayMatch = (changeableTiles: ChangeableTile[], turn = 51): MatchWrapper =>
  createTestMatch({
    tiles: grid(),
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true },
      { slot: 1, id: "p1" },
      { slot: 2, id: "p2" },
    ],
    changeableTiles,
    rules: { dayLimit: 50 },
    turn,
  });

describe("releaseHoldings", () => {
  it("hands everything to the capturer, and turns the captured HQ into a city", () => {
    const match = threeWayMatch([
      property("hq", 0, [1, 1]),
      property("city", 0, [1, 2]),
      property("base", 0, [1, 3]),
    ]);

    releaseHoldings(match, match.getPlayerById("p0")!, 1);

    const owners = match.changeableTiles.map((tile) =>
      "playerSlot" in tile ? tile.playerSlot : null,
    );

    expect(owners).toEqual([1, 1, 1]);
    // No player may hold two headquarters — and a dead player's HQ must not stay capturable.
    expect(match.changeableTiles.map((tile) => tile.type)).toEqual(["city", "city", "base"]);
  });

  it("neutralises everything on a rout or resignation, where nobody inherits", () => {
    const match = threeWayMatch([
      property("hq", 0, [1, 1]),
      property("city", 0, [1, 2]),
      property("airport", 0, [1, 3]),
    ]);

    releaseHoldings(match, match.getPlayerById("p0")!, null);

    const owners = match.changeableTiles.map((tile) =>
      "playerSlot" in tile ? tile.playerSlot : null,
    );

    // -1 is neutral: contestable again, which is what keeps a long game moving.
    expect(owners).toEqual([-1, -1, -1]);
    expect(match.changeableTiles.map((tile) => tile.type)).toEqual(["city", "city", "airport"]);
  });

  it("leaves other players' property alone", () => {
    const match = threeWayMatch([property("city", 0, [1, 1]), property("city", 1, [1, 2])]);

    releaseHoldings(match, match.getPlayerById("p0")!, null);

    expect(
      match.changeableTiles.map((tile) => ("playerSlot" in tile ? tile.playerSlot : null)),
    ).toEqual([-1, 1]);
  });
});

describe("day limit scoring with an eliminated team", () => {
  it("does not crown a team that is already out", () => {
    // The FFA case: p0 was wiped out on day 12 holding the biggest empire on the map. At the day
    // limit that empire must not win the match for a team with no players left alive.
    const match = threeWayMatch([
      property("city", 0, [1, 1]),
      property("city", 0, [1, 2]),
      property("city", 0, [1, 3]),
      property("city", 0, [1, 4]),
      property("city", 1, [2, 1]),
      property("city", 2, [3, 1]),
    ]);

    match.getPlayerById("p0")!.data.status = "routed";

    const scored = countTeamHoldings(match);

    expect(scored.map((holding) => holding.teamIndex)).not.toContain(
      match.getPlayerById("p0")!.team.index,
    );
    expect(dayLimitWinner(match)).not.toBe(match.getPlayerById("p0")!.team.index);
  });

  it("is a draw when the two surviving teams are level", () => {
    const match = threeWayMatch([
      property("city", 0, [1, 1]),
      property("city", 0, [1, 2]),
      property("city", 1, [2, 1]),
      property("city", 2, [3, 1]),
    ]);

    match.getPlayerById("p0")!.data.status = "routed";

    expect(dayLimitWinner(match)).toBeNull();
  });
});
