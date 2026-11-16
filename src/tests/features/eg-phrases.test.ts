import { describe, expect, it } from "vitest";
import {
  deciderPhrase,
  economyNote,
  formatDuration,
  strengthNote,
  tacticsNote,
} from "frontend/components/match/hud/eg-phrases";

describe("formatDuration", () => {
  it("scales from seconds to hours and blanks a zero span", () => {
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(18 * 60_000)).toBe("18 min");
    expect(formatDuration(64 * 60_000)).toBe("1h 4m");
  });
});

describe("performance notes", () => {
  it("describes the trade ratio, or a flawless / empty match", () => {
    expect(tacticsNote(3400, 900)).toBe("3,400 funds destroyed vs 900 lost — a 3.8× trade.");
    expect(tacticsNote(2000, 0)).toBe("Flawless trading — 2,000 funds destroyed, nothing lost.");
    expect(tacticsNote(0, 0)).toBe("No engagements this match.");
  });

  it("pluralises strength + phrases economy", () => {
    expect(strengthNote(1, 1)).toBe("1 unit destroyed · 1 capture.");
    expect(strengthNote(7, 9)).toBe("7 units destroyed · 9 captures.");
    expect(strengthNote(0, 0)).toBe("Little board presence.");
    expect(economyNote(42000, 15000, 3000)).toBe(
      "42,000 earned · 15,000 into production · 3,000 left banked.",
    );
  });
});

describe("deciderPhrase", () => {
  it("prefers HQ capture, then a wipe, then a board decision; draws are their own", () => {
    expect(
      deciderPhrase({
        isDraw: false,
        winnerName: "Andy",
        loserName: "Olaf",
        hqCaptureTurn: 26,
        loserWiped: false,
      }),
    ).toBe("Andy won by capturing the HQ on turn 26.");
    expect(
      deciderPhrase({ isDraw: false, winnerName: "Andy", loserName: "Olaf", loserWiped: true }),
    ).toBe("Andy won by wiping out Olaf's army.");
    expect(deciderPhrase({ isDraw: false, winnerName: "Andy", loserWiped: false })).toBe(
      "Andy won on the board — no HQ fell.",
    );
    expect(deciderPhrase({ isDraw: true, loserWiped: false })).toBe(
      "A stalemate — neither side broke through.",
    );
  });
});
