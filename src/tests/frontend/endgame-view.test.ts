import { describe, expect, it } from "vitest";
import { toEndGamePlayers, toGameOverCos, toOutcome } from "frontend/components/match/endgame-view";
import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";

const player = (over: Partial<MatchPlayer>): MatchPlayer =>
  ({
    id: "me",
    name: "Andy",
    army: "orange-star",
    slot: 0,
    coId: { name: "andy" },
    result: "won",
    ...over,
  }) as unknown as MatchPlayer;

const view = (...players: MatchPlayer[]): MatchView => ({ players }) as unknown as MatchView;

const gameOver = (over: Partial<{ viewerWon: boolean; winnerTeamIndex: number | null }>) =>
  ({ viewerWon: false, winnerTeamIndex: 0, ...over }) as NonNullable<MatchView["gameOver"]>;

describe("end-of-match view models", () => {
  describe("viewer-relative outcome", () => {
    it("reads a win for the viewer as victory", () => {
      expect(toOutcome(gameOver({ viewerWon: true }))).toBe("victory");
    });

    it("reads a decided match the viewer didn't win as a defeat", () => {
      expect(toOutcome(gameOver({ viewerWon: false, winnerTeamIndex: 1 }))).toBe("defeat");
    });

    it("reads no winning team as a draw rather than a defeat", () => {
      expect(toOutcome(gameOver({ viewerWon: false, winnerTeamIndex: null }))).toBe("draw");
    });
  });

  describe("CO cast", () => {
    it("tags the viewer's own CO and carries each result through", () => {
      const cast = toGameOverCos(
        view(
          player({}),
          player({ id: "them", coId: { name: "max", version: "AWDS" }, result: "lost" }),
        ),
        "me",
      );

      expect(cast).toEqual([
        { name: "andy", result: "won", isViewer: true },
        { name: "max", result: "lost", isViewer: false },
      ]);
    });

    it("is empty while the view is still loading", () => {
      expect(toGameOverCos(undefined, "me")).toEqual([]);
      expect(toEndGamePlayers(undefined, "me")).toEqual([]);
    });
  });

  it("summarises each seat with its name, army, CO and result", () => {
    expect(toEndGamePlayers(view(player({})), "me")).toEqual([
      {
        id: "me",
        name: "Andy",
        army: "orange-star",
        coName: "andy",
        result: "won",
        isViewer: true,
      },
    ]);
  });
});
