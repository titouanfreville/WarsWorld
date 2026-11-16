import { describe, expect, it } from "vitest";
import { adminActionToEvent, applyAdminToolEvent } from "server/engine/events/handlers/admin-tool";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { finalizeIfGameOver } from "server/engine/previews/finalize";
import { deriveGameOver } from "server/engine/previews/game-over";
import type { MatchWrapper } from "server/engine/entities/match";
import { addUnit, createTestMatch, tiles } from "../helpers/scenario";

/**
 * Force-outcome: the admin tool that ends a live match on an imposed result.
 *
 * What's worth pinning is that a FORCED ending leaves the match in the same shape a natural one
 * does — it shares `stampOutcome` with `finalizeIfGameOver` precisely so the endgame screen, battle
 * report and ranking can't read a different shape depending on how the game ended.
 */

const contestedMatch = (): MatchWrapper => {
  const match = createTestMatch({
    tiles: [[tiles.plain(), tiles.plain()]],
    players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
  });

  // Both sides alive and holding units: the game is genuinely undecided.
  addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);
  addUnit(match.getPlayerBySlot(1)!, "infantry", [1, 0]);
  return match;
};

const force = (match: MatchWrapper, winnerTeamIndex: number | null): void =>
  applyAdminToolEvent(
    match,
    adminActionToEvent(match, { type: "forceOutcome", winnerTeamIndex }, "admin-one"),
  );

describe("admin tools — force outcome", () => {
  it("ends a contested match, marking the named team the winner", () => {
    const match = contestedMatch();
    // Guard the premise: without forcing, this match is NOT over.
    expect(finalizeIfGameOver(match)).toBeNull();

    force(match, 0);

    expect(match.status).toBe("finished");
    expect(match.getPlayerBySlot(0)!.data.result).toBe("won");
    expect(match.getPlayerBySlot(1)!.data.result).toBe("lost");
  });

  it("makes deriveGameOver report the win even though BOTH armies are still alive", () => {
    // The bug this guards: force-outcome leaves every unit on the board, so the alive-status
    // derivation would say "still contested" and the client would never show the end screen. A
    // finished match must read its winner from the stamped result instead.
    const match = contestedMatch();
    expect(deriveGameOver(match, undefined)).toBeNull(); // premise: undecided while playing

    force(match, 0);

    const outcome = deriveGameOver(match, match.getPlayerBySlot(0)!.team);
    expect(outcome).not.toBeNull();
    expect(outcome!.winnerTeamIndex).toBe(0);
    expect(outcome!.viewerWon).toBe(true);
    // Both infantry are still on the board — the win came from the result, not an elimination.
    expect(match.getPlayerBySlot(0)!.getUnits()).toHaveLength(1);
    expect(match.getPlayerBySlot(1)!.getUnits()).toHaveLength(1);
  });

  it("reports a forced draw as no winner", () => {
    const match = contestedMatch();
    force(match, null);

    const outcome = deriveGameOver(match, match.getPlayerBySlot(0)!.team);
    expect(outcome).not.toBeNull();
    expect(outcome!.winnerTeamIndex).toBeNull();
    expect(outcome!.viewerWon).toBe(false);
  });

  it("forces a draw when no team is named", () => {
    const match = contestedMatch();

    force(match, null);

    expect(match.status).toBe("finished");
    expect(match.getPlayerBySlot(0)!.data.result).toBe("drawn");
    expect(match.getPlayerBySlot(1)!.data.result).toBe("drawn");
  });

  it("leaves a forced match in the SAME shape a natural ending would", () => {
    // The reason `forceOutcome` and `finalizeIfGameOver` share `stampOutcome`: a forced win must be
    // indistinguishable downstream from a real one, or the endgame/report/ranking read differently.
    const forced = contestedMatch();
    force(forced, 0);

    const natural = contestedMatch();
    natural
      .getPlayerBySlot(1)!
      .getUnits()
      .forEach((unit) => unit.remove());
    natural.getPlayerBySlot(1)!.data.status = "routed";
    finalizeIfGameOver(natural);

    expect(forced.status).toBe(natural.status);
    expect(forced.getAllPlayers().map((p) => p.data.result)).toEqual(
      natural.getAllPlayers().map((p) => p.data.result),
    );
  });

  it("refuses a team index that isn't in the match", () => {
    // A bogus index would stamp EVERY player "lost" — a match nobody won — and replay would repeat it.
    const match = contestedMatch();

    expect(() => force(match, 7)).toThrow(/No team with index/);
    expect(match.status).toBe("playing");
  });

  it("refuses to re-decide a match that already finished", () => {
    const match = contestedMatch();
    force(match, 0);

    expect(() => force(match, 1)).toThrow(/finished/);
    expect(match.getPlayerBySlot(0)!.data.result).toBe("won");
  });

  it("replays through the normal event path to the same outcome", () => {
    // Forced outcomes are events for the same reason dev tools are: state is rebuilt from the log,
    // so an outcome imposed outside it would replay to a still-playing match.
    const live = contestedMatch();
    const event = adminActionToEvent(
      live,
      { type: "forceOutcome", winnerTeamIndex: 1 },
      "admin-one",
    );

    applyAdminToolEvent(live, event);

    const replayed = contestedMatch();
    applyMainEventToMatch(replayed, event);

    expect(replayed.status).toBe(live.status);
    expect(replayed.getAllPlayers().map((p) => p.data.result)).toEqual(
      live.getAllPlayers().map((p) => p.data.result),
    );
    expect(replayed.getPlayerBySlot(1)!.data.result).toBe("won");
  });
});
