import { describe, expect, it } from "vitest";
import { formatCountdown, formatTimeControl } from "frontend/utils/format-time";

/**
 * The time-control chip the lobby and map-ban screens advertise. An untimed match must produce NO
 * chip — every match created before the clock existed is untimed, and advertising a clock that isn't
 * enforced is worse than saying nothing.
 */
describe("formatTimeControl", () => {
  it("spells out the three presets the way the lobby offers them", () => {
    expect(formatTimeControl(600, 60)).toBe("10m +1m/turn");
    expect(formatTimeControl(900, 120)).toBe("15m +2m/turn");
    expect(formatTimeControl(1800, 240)).toBe("30m +4m/turn");
  });

  it("names a zero increment rather than hiding it", () => {
    // `matchRulesSchema` no longer ACCEPTS a zero increment (it makes flagging terminal — see
    // rule-presets.test.ts), but rows written before that floor still carry one and must still
    // render honestly rather than as a misleading "+0m/turn".
    expect(formatTimeControl(900, 0)).toBe("15m flat");
  });

  it("returns null for an untimed match", () => {
    expect(formatTimeControl(null, null)).toBeNull();
    expect(formatTimeControl(undefined, undefined)).toBeNull();
    // A bank is what makes a match timed; an increment alone is meaningless.
    expect(formatTimeControl(null, 120)).toBeNull();
  });
});

/**
 * The live countdown readout. Timezone-independent (it formats a span, not an instant), so unlike
 * the date helpers in this module it needs no TZ pinning.
 */
describe("formatCountdown", () => {
  it("renders m:ss below an hour", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(65_000)).toBe("1:05");
    expect(formatCountdown(900_000)).toBe("15:00");
  });

  it("switches to h:mm:ss past an hour, zero-padding the minutes", () => {
    // The Long preset starts at 30m and grows with its increment, so this branch is reachable in a
    // real match — and it was the one the component's inlined copy had no coverage for.
    expect(formatCountdown(3_600_000)).toBe("1:00:00");
    expect(formatCountdown(3_665_000)).toBe("1:01:05");
    expect(formatCountdown(7_384_000)).toBe("2:03:04");
  });

  it("rounds UP, so the final second still reads 0:01", () => {
    // A countdown showing 0:00 with time left on it looks broken.
    expect(formatCountdown(1)).toBe("0:01");
    expect(formatCountdown(59_001)).toBe("1:00");
  });

  it("clamps a negative remainder to zero rather than rendering a negative clock", () => {
    // The deadline can be milliseconds in the past between a tick and the server's force-end.
    expect(formatCountdown(-5_000)).toBe("0:00");
  });
});
