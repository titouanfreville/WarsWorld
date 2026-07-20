import { describe, expect, it } from "vitest";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import {
  applyPlayerEliminatedEvent,
  surrenderToEvent,
} from "server/engine/events/handlers/surrender";
import { deriveGameOver } from "server/engine/previews/game-over";
import { finalizeIfGameOver } from "server/engine/previews/finalize";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

const duel = () =>
  createTestMatch({
    tiles: [
      [tiles.plain(), tiles.plain(), tiles.plain()],
      [tiles.plain(), tiles.plain(), tiles.plain()],
    ],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
  });

describe("surrender", () => {
  it("marks the surrendering player resigned — distinct from being routed", () => {
    const match = duel();
    const event = surrenderToEvent(match, "0");

    applyMainEventToMatch(match, event);

    expect(event).toEqual({
      type: "player-eliminated",
      playerId: "0",
      eliminationReason: "surrendered",
    });
    // "resigned" rather than "routed": they conceded, they weren't wiped out. Both are non-alive, so
    // both end the match — but the battle report can tell them apart.
    expect(match.getPlayerById("0")?.data.status).toBe("resigned");
    expect(match.getPlayerById("1")?.data.status).toBe("alive");
  });

  it("clears the surrendering player's units off the board", () => {
    const match = duel();
    const player = match.getPlayerBySlot(0)!;
    addUnit(player, "infantry", [0, 0]);
    addUnit(player, "tank", [1, 0]);

    applyMainEventToMatch(match, surrenderToEvent(match, "0"));

    // Their army leaves with them — a conceded player must not keep blocking tiles or holding vision.
    expect(player.getUnits()).toHaveLength(0);
    expect(match.getUnit([0, 0])).toBeUndefined();
    expect(match.getUnit([1, 0])).toBeUndefined();
  });

  it("hands the win to the opponent in a 1v1, via the normal game-over derivation", () => {
    const match = duel();
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);
    addUnit(match.getPlayerBySlot(1)!, "infantry", [2, 1]);

    expect(deriveGameOver(match, undefined)).toBeNull(); // contested until someone concedes

    applyMainEventToMatch(match, surrenderToEvent(match, "0"));

    // Nothing in the surrender handler decides this: the surrendering team simply has no living
    // player left, which is the same condition a rout produces.
    const finished = finalizeIfGameOver(match);

    expect(finished?.winnerTeamIndex).toBe(match.getPlayerById("1")!.team.index);
    expect(match.status).toBe("finished");
    expect(match.getPlayerById("0")?.data.result).toBe("lost");
    expect(match.getPlayerById("1")?.data.result).toBe("won");
  });

  it("leaves a 3-player match still in play when one of three concedes", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }, { slot: 2 }],
    });

    applyMainEventToMatch(match, surrenderToEvent(match, "1"));

    // Two teams are still standing, so the match continues — the usecase is what moves the turn on
    // if the surrenderer happened to be holding it.
    expect(deriveGameOver(match, undefined)).toBeNull();
    expect(finalizeIfGameOver(match)).toBeNull();
    expect(match.status).toBe("playing");
  });

  it("refuses to surrender twice", () => {
    const match = duel();
    applyMainEventToMatch(match, surrenderToEvent(match, "0"));

    expect(() => surrenderToEvent(match, "0")).toThrow(/already out/i);
  });

  it("refuses a surrender from someone who isn't in the match", () => {
    expect(() => surrenderToEvent(duel(), "not-a-player")).toThrow(/not in this match/i);
  });

  it("refuses to surrender a match that isn't being played", () => {
    const match = duel();
    match.status = "finished";

    expect(() => surrenderToEvent(match, "0")).toThrow(/isn't in progress/i);
  });

  it("survives an event-log replay: status is set when the event is APPLIED", () => {
    // The status lives in the apply step, not in event construction, so rebuilding a match by
    // replaying its log reproduces the resignation. Rebuild a fresh match and replay.
    const original = duel();
    const event = surrenderToEvent(original, "0");

    const rebuilt = duel();
    expect(rebuilt.getPlayerById("0")?.data.status).toBe("alive");

    applyPlayerEliminatedEvent(rebuilt, event);

    expect(rebuilt.getPlayerById("0")?.data.status).toBe("resigned");
  });
});
