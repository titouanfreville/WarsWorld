import { describe, expect, it } from "vitest";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { validateMainActionAndToEvent } from "server/engine/events/action-to-event";
import { bankOf, matchClock } from "server/engine/rules/turn-clock";
import { buildMatchFullView } from "server/engine/previews/match-view";
import type { MatchWrapper } from "server/engine/entities/match";
import type { PassTurnEvent } from "server/engine/types/events";
import { createTestMatch, tiles } from "../helpers/scenario";

/**
 * The turn clock: a per-player bank that only runs on your own turn, topped up by the increment at
 * the start of each of your turns, and force-ended (not lost) at zero.
 *
 * The load-bearing property here is REPLAY: banks live in the engine but time does not. What a turn
 * consumed is recorded on the pass-turn event, so replaying the log reproduces the same banks — the
 * same discipline combat luck and weather rolls already follow.
 */
const clockedMatch = (bankSeconds = 900, incrementSeconds = 120): MatchWrapper =>
  createTestMatch({
    tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true },
      { slot: 1, id: "p1" },
    ],
    rules: { turnBankSeconds: bankSeconds, turnIncrementSeconds: incrementSeconds },
    turn: 3,
  });

/** Pass the turn as the orchestrator does, with a deadline `remainingMs` away from now. */
const passTurnWith = (match: MatchWrapper, remainingMs: number | null): PassTurnEvent => {
  match.turnEndsAt = remainingMs === null ? null : Date.now() + remainingMs;

  const event = validateMainActionAndToEvent(match, { type: "passTurn" }) as PassTurnEvent;

  applyMainEventToMatch(match, event);

  return event;
};

describe("turn clock", () => {
  it("reads the clock off the rules, and is absent when the match has none", () => {
    expect(matchClock(clockedMatch(900, 120))).toEqual({ bankMs: 900_000, incrementMs: 120_000 });

    const untimed = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
      ],
    });

    expect(matchClock(untimed)).toBeNull();
    expect(bankOf(untimed.getPlayerById("p0")!)).toBeNull();
  });

  it("starts every player on the full bank before their first turn", () => {
    const match = clockedMatch();

    expect(bankOf(match.getPlayerById("p0")!)).toBe(900_000);
    expect(bankOf(match.getPlayerById("p1")!)).toBe(900_000);
  });

  it("credits the STARTING player their increment too, so seat 0 opens on the same clock", () => {
    // Regression: turn one used to be armed straight off the raw bank while every other first turn
    // ran through `applyPassTurnEvent` and picked up the increment — a permanent head start for the
    // second seat on the ladder. `applyMatchStartEvent` credits it, mirroring day-1 income, so it
    // also replays.
    const match = clockedMatch(900, 120);

    applyMainEventToMatch(match, { type: "matchStart", weather: "clear" });

    const p0Opening = bankOf(match.getPlayerById("p0")!);

    expect(p0Opening).toBe(1_020_000);

    // ...and that is exactly what p1 gets when their own first turn begins.
    passTurnWith(match, 600_000);

    expect(bankOf(match.getPlayerById("p1")!)).toBe(p0Opening);
  });

  it("banks what was left and credits the increment to the incoming player", () => {
    const match = clockedMatch(900, 120);

    // p0 ends their turn with 10 minutes left.
    passTurnWith(match, 600_000);

    expect(bankOf(match.getPlayerById("p0")!)).toBeCloseTo(600_000, -3);
    // p1 begins their first turn: full bank + the increment.
    expect(bankOf(match.getPlayerById("p1")!)).toBe(1_020_000);
  });

  it("records the remaining time ON the event, so a replay reproduces the same banks", () => {
    const match = clockedMatch(900, 120);
    const event = passTurnWith(match, 600_000);

    expect(event.bankRemainingMs).toBeGreaterThan(590_000);
    expect(event.bankRemainingMs).toBeLessThanOrEqual(600_000);

    // Replay the same event onto a fresh match — no wall clock involved — and the banks must match.
    const replayed = clockedMatch(900, 120);

    applyMainEventToMatch(replayed, event);

    expect(bankOf(replayed.getPlayerById("p0")!)).toBe(bankOf(match.getPlayerById("p0")!));
    expect(bankOf(replayed.getPlayerById("p1")!)).toBe(bankOf(match.getPlayerById("p1")!));
  });

  it("leaves a flagged player on exactly the increment, so they keep playing", () => {
    const match = clockedMatch(900, 120);

    passTurnWith(match, 0); // p0 is force-ended on time
    expect(bankOf(match.getPlayerById("p0")!)).toBe(0);

    passTurnWith(match, 500_000); // p1 plays, hands back to p0
    expect(bankOf(match.getPlayerById("p0")!)).toBe(120_000); // 0 + increment
  });

  it("never banks a negative amount, however late the pass lands", () => {
    const match = clockedMatch(900, 120);

    passTurnWith(match, -45_000); // deadline elapsed 45s ago

    expect(bankOf(match.getPlayerById("p0")!)).toBe(0);
  });

  it("leaves an untimed match alone — no banks, no deadline recorded", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain()]],
      players: [
        { slot: 0, id: "p0", hasCurrentTurn: true },
        { slot: 1, id: "p1" },
      ],
      turn: 3,
    });

    const event = passTurnWith(match, null);

    expect(event.bankRemainingMs).toBeUndefined();
    expect(match.getPlayerById("p0")!.data.timeBankMs).toBeUndefined();
    expect(match.getPlayerById("p1")!.data.timeBankMs).toBeUndefined();
  });

  it("honours a zero increment (a plain, non-replenishing bank)", () => {
    const match = clockedMatch(900, 0);

    passTurnWith(match, 600_000);

    expect(bankOf(match.getPlayerById("p1")!)).toBe(900_000);
  });

  it("shows both players' clocks on the board view", () => {
    const match = clockedMatch(900, 120);

    passTurnWith(match, 600_000);
    match.turnEndsAt = 1_800_000_000_000;

    const view = buildMatchFullView(match, "p1");

    expect(view.turnEndsAt).toBe(1_800_000_000_000);
    // Your opponent's remaining time is public — a timed game you can't see the pressure in is worse.
    expect(view.players.find((p) => p.id === "p0")?.timeBankMs).toBeCloseTo(600_000, -3);
    expect(view.players.find((p) => p.id === "p1")?.timeBankMs).toBe(1_020_000);
  });
});
