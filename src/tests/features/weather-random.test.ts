import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { createMatchStartEvent } from "server/engine/events/handlers/match-start";
import { getRandomWeather, getRandomWeatherDurationDays } from "server/engine/rules/weather";
import type { MainAction } from "shared/schemas/action";
import type { COID } from "shared/schemas/co";
import type { MatchWrapper } from "server/engine/entities/match";
import { createTestMatch, dispatchMainAction, tiles } from "../helpers/scenario";

const PASS_TURN: MainAction = { type: "passTurn" };

const DRAKE_AW2: COID = { name: "drake", version: "AW2" };

/** Two-player match with the given weather setting; slot 0 starts. */
function twoPlayerMatch(
  weatherSetting: "random" | "clear" | "snow",
  opts: { gameVersion?: "AWDS"; drake?: boolean } = {},
): MatchWrapper {
  return createTestMatch({
    tiles: [[tiles.road(), tiles.road()]],
    players: [
      { slot: 0, hasCurrentTurn: true },
      { slot: 1, ...(opts.drake === true ? { coId: DRAKE_AW2 } : {}) },
    ],
    rules: { weatherSetting, ...(opts.gameVersion ? { gameVersion: opts.gameVersion } : {}) },
  });
}

describe("getRandomWeather probabilities", () => {
  afterEach(() => vi.restoreAllMocks());

  function rollAt(percent: number, match: MatchWrapper) {
    vi.spyOn(Math, "random").mockReturnValue(percent / 100);
    return getRandomWeather(match);
  }

  it("non-AWDS: clear 60 / rain 30 / snow 10 (sandstorm folded into snow)", () => {
    const match = twoPlayerMatch("random");

    expect(rollAt(0, match)).toBe("snow");
    expect(rollAt(9.9, match)).toBe("snow"); // snow spans [0, 10)
    expect(rollAt(10, match)).toBe("rain");
    expect(rollAt(39.9, match)).toBe("rain"); // rain spans [10, 40)
    expect(rollAt(40, match)).toBe("clear");
    expect(rollAt(99, match)).toBe("clear");
  });

  it("non-AWDS never rolls sandstorm across the whole range", () => {
    const match = twoPlayerMatch("random");

    for (let p = 0; p < 100; p++) {
      expect(rollAt(p, match)).not.toBe("sandstorm");
    }
  });

  it("AWDS: snow [0,5) / rain [5,35) / sandstorm [35,40) / clear [40,100)", () => {
    const match = twoPlayerMatch("random", { gameVersion: "AWDS" });

    expect(rollAt(4.9, match)).toBe("snow");
    expect(rollAt(5, match)).toBe("rain");
    expect(rollAt(34.9, match)).toBe("rain");
    expect(rollAt(35, match)).toBe("sandstorm");
    expect(rollAt(39.9, match)).toBe("sandstorm");
    expect(rollAt(40, match)).toBe("clear");
  });

  it("a non-AWDS Drake widens the rain band by 7% (from clear)", () => {
    const match = twoPlayerMatch("random", { drake: true });

    // without the Drake bonus, 45% would be clear (rain ends at 40); the +7 pushes rain to [10, 47).
    expect(rollAt(45, match)).toBe("rain");
    expect(rollAt(47, match)).toBe("clear");
  });
});

describe("getRandomWeatherDurationDays", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps the RNG onto the inclusive 1..4 day range", () => {
    const cases: [number, number][] = [
      [0, 1],
      [0.24, 1],
      [0.25, 2],
      [0.5, 3],
      [0.999, 4],
    ];

    for (const [r, expected] of cases) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      expect(getRandomWeatherDurationDays()).toBe(expected);
      vi.restoreAllMocks();
    }
  });

  it("always stays within [1, 4]", () => {
    // Math.random() yields [0, 1); sweep that half-open range.
    for (let i = 0; i < 20; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 20);
      const days = getRandomWeatherDurationDays();
      expect(days).toBeGreaterThanOrEqual(1);
      expect(days).toBeLessThanOrEqual(4);
      vi.restoreAllMocks();
    }
  });
});

describe("random weather over a match", () => {
  afterEach(() => vi.restoreAllMocks());

  it("locks a drawn effect for a whole number of days (equal per player) then resumes rolling", () => {
    const match = twoPlayerMatch("random", { gameVersion: "AWDS" });

    // First roll: rain (10%) for 2 days (duration RNG 0.30 -> 1 + floor(1.2) = 2). Every roll after
    // the effect ends falls back to 0.99 -> clear, so weather stays clear once it clears.
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0.1)
      .mockReturnValueOnce(0.3)
      .mockReturnValue(0.99);

    expect(match.getCurrentWeather()).toBe("clear");

    // pass 1 (p0 -> p1): rain begins on p1's turn
    dispatchMainAction(match, PASS_TURN);
    expect(match.getCurrentWeather()).toBe("rain");

    // passes 2..4: rain holds for 2 full revolutions — 2 turns each for p0 and p1
    dispatchMainAction(match, PASS_TURN); // p1 -> p0
    expect(match.getCurrentWeather()).toBe("rain");
    dispatchMainAction(match, PASS_TURN); // p0 -> p1
    expect(match.getCurrentWeather()).toBe("rain");
    dispatchMainAction(match, PASS_TURN); // p1 -> p0
    expect(match.getCurrentWeather()).toBe("rain");

    // pass 5 (p0 -> p1): the effect has run its 2 days, weather is forced back to clear
    dispatchMainAction(match, PASS_TURN);
    expect(match.getCurrentWeather()).toBe("clear");
    expect(match.playerToRemoveWeatherEffect).toBeNull(); // removal state released -> rolling resumes

    // pass 6 (p1 -> p0): rolling resumed; the 0.99 fallback keeps it clear
    dispatchMainAction(match, PASS_TURN);
    expect(match.getCurrentWeather()).toBe("clear");
  });
});

describe("match start weather", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a random match starts clear", () => {
    const match = twoPlayerMatch("random");

    expect(createMatchStartEvent(match).weather).toBe("clear");

    applyMainEventToMatch(match, createMatchStartEvent(match));
    expect(match.getCurrentWeather()).toBe("clear");
  });

  it("a fixed-weather match starts on that weather and holds it (no removal countdown)", () => {
    const match = twoPlayerMatch("snow");

    expect(createMatchStartEvent(match).weather).toBe("snow");

    applyMainEventToMatch(match, createMatchStartEvent(match));
    expect(match.getCurrentWeather()).toBe("snow");
    expect(match.playerToRemoveWeatherEffect).toBeNull();

    // a fixed setting never re-rolls, so the weather persists across turns
    dispatchMainAction(match, PASS_TURN);
    expect(match.getCurrentWeather()).toBe("snow");
  });
});
