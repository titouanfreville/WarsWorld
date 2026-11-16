// Pin the timezone so the TZ-dependent formatters are deterministic (frontend/CLAUDE.md: date
// helpers pin process.env.TZ in tests). Set before the formatters run.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";
import { formatClockTime, formatDuration, formatMatchDate } from "frontend/utils/format-time";

describe("formatDuration", () => {
  it("rounds sub-minute up to 1m and scales through minutes/hours/days", () => {
    expect(formatDuration(30_000)).toBe("1m"); // sub-minute rounds up, never "0m"
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(90 * 60_000)).toBe("1h 30m");
    expect(formatDuration(2 * 60 * 60_000)).toBe("2h"); // whole hours drop the minutes
    expect(formatDuration(26 * 60 * 60_000)).toBe("1d 2h");
  });

  it("returns an em dash for non-positive or non-finite input", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
  });
});

describe("formatMatchDate", () => {
  it("returns an em dash for null/undefined/invalid", () => {
    expect(formatMatchDate(null)).toBe("—");
    expect(formatMatchDate(undefined)).toBe("—");
    expect(formatMatchDate("not a date")).toBe("—");
  });

  it("formats a valid timestamp under the pinned TZ", () => {
    // Locale controls the month spelling, so assert the TZ-stable parts rather than an exact string.
    expect(formatMatchDate("2026-07-20T12:00:00Z")).toContain("2026");
  });
});

describe("formatClockTime", () => {
  it("renders an hour:minute clock time", () => {
    // Locale-dependent (12h vs 24h), so assert the shape rather than an exact string.
    expect(formatClockTime("2026-07-20T13:05:00Z")).toMatch(/\d{1,2}:\d{2}/);
  });
});
