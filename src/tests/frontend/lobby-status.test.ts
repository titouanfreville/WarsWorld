import { describe, expect, it } from "vitest";
import { deriveLobbyStatus, type LobbyMatch } from "frontend/components/match/lobby/match-status";

const VIEWER = "viewer-id";
const OPPONENT = "opponent-id";

const match = (players: LobbyMatch["players"], over: Partial<LobbyMatch> = {}): LobbyMatch => ({
  id: "m1",
  map: { numberOfPlayers: 2 },
  players,
  state: "playing",
  turn: 3,
  ...over,
});

describe("deriveLobbyStatus — finished matches", () => {
  it("prefers the stamped result over alive-status (admin force-outcome case)", () => {
    // The regression this guards: a forced outcome stamps `result` but leaves BOTH armies "alive".
    // Deriving win/loss from alive-ness alone labelled the LOSER "victory".
    const forced = match(
      [
        { id: VIEWER, status: "alive", result: "lost" },
        { id: OPPONENT, status: "alive", result: "won" },
      ],
      { finished: true, state: "finished" },
    );

    expect(deriveLobbyStatus(forced, VIEWER)).toBe("defeat");
    expect(deriveLobbyStatus(forced, OPPONENT)).toBe("victory");
  });

  it("reads a forced draw as a draw for both, though both are still alive", () => {
    const drawn = match(
      [
        { id: VIEWER, status: "alive", result: "drawn" },
        { id: OPPONENT, status: "alive", result: "drawn" },
      ],
      { finished: true, state: "finished" },
    );

    expect(deriveLobbyStatus(drawn, VIEWER)).toBe("draw");
    expect(deriveLobbyStatus(drawn, OPPONENT)).toBe("draw");
  });

  it("falls back to alive-status for rows with no stamped result (natural win/loss)", () => {
    const natural = match(
      [
        { id: VIEWER, status: "alive" },
        { id: OPPONENT, status: "routed" },
      ],
      { finished: true, state: "finished" },
    );

    expect(deriveLobbyStatus(natural, VIEWER)).toBe("victory");
    expect(deriveLobbyStatus(natural, OPPONENT)).toBe("defeat");
  });

  it("falls back to a draw when nobody is left alive and no result is stamped", () => {
    const doubleKo = match(
      [
        { id: VIEWER, status: "routed" },
        { id: OPPONENT, status: "routed" },
      ],
      { finished: true, state: "finished" },
    );

    expect(deriveLobbyStatus(doubleKo, VIEWER)).toBe("draw");
  });

  it("doesn't read a result-stamped match as victory when the viewer's own result is missing", () => {
    // stampOutcome writes every player's result in one pass, so this anomaly isn't reachable today —
    // but guard it: a still-"alive" viewer with no result must not fall through to the alive-status
    // heuristic and be labelled a winner while an opponent is stamped "won".
    const anomalous = match(
      [
        { id: VIEWER, status: "alive" },
        { id: OPPONENT, status: "alive", result: "won" },
      ],
      { finished: true, state: "finished" },
    );

    expect(deriveLobbyStatus(anomalous, VIEWER)).toBe("defeat");
  });
});

describe("deriveLobbyStatus — live matches", () => {
  it("labels the turn from the viewer's perspective", () => {
    const live = match([
      { id: VIEWER, status: "alive", hasCurrentTurn: true },
      { id: OPPONENT, status: "alive" },
    ]);

    expect(deriveLobbyStatus(live, VIEWER)).toBe("your-turn");
    expect(deriveLobbyStatus(live, OPPONENT)).toBe("their-turn");
  });
});
