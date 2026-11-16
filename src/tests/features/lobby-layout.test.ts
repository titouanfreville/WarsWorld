import { describe, expect, it } from "vitest";
import { capacityForMode, isValidSeat, layoutForMode, matchSlotFor } from "server/matches/layout";

/**
 * Pure lobby-mode geometry: how many teams/seats a mode has, how a (team, seat) maps to the map
 * player-slot, and which seats are in-bounds. The lobby's self-assign validation and the spawn
 * path's teamMapping both lean on these, so they're locked here.
 */
describe("lobby layout", () => {
  it("has the right capacity per mode", () => {
    expect(capacityForMode("duel")).toBe(2);
    expect(capacityForMode("teams")).toBe(4);
    expect(capacityForMode("ffa")).toBe(4);
  });

  it("groups teammates into contiguous map slots", () => {
    // 2v2: team 0 → slots 0,1 ; team 1 → slots 2,3
    expect(matchSlotFor("teams", 0, 0)).toBe(0);
    expect(matchSlotFor("teams", 0, 1)).toBe(1);
    expect(matchSlotFor("teams", 1, 0)).toBe(2);
    expect(matchSlotFor("teams", 1, 1)).toBe(3);
    // ffa4: one seat per team → slot == team
    expect(matchSlotFor("ffa", 3, 0)).toBe(3);
  });

  it("accepts in-bounds seats and rejects out-of-bounds ones", () => {
    expect(isValidSeat("duel", 0, 0)).toBe(true);
    expect(isValidSeat("duel", 1, 0)).toBe(true);
    expect(isValidSeat("duel", 2, 0)).toBe(false); // only 2 teams
    expect(isValidSeat("duel", 0, 1)).toBe(false); // only 1 seat per team
    expect(isValidSeat("teams", 1, 1)).toBe(true);
    expect(isValidSeat("teams", 0, 2)).toBe(false);
    expect(isValidSeat("ffa", 3, 0)).toBe(true);
    expect(isValidSeat("ffa", 4, 0)).toBe(false);
  });

  it("exposes team/slot dimensions per mode", () => {
    expect(layoutForMode("duel")).toEqual({ teamCount: 2, slotsPerTeam: 1 });
    expect(layoutForMode("teams")).toEqual({ teamCount: 2, slotsPerTeam: 2 });
    expect(layoutForMode("ffa")).toEqual({ teamCount: 4, slotsPerTeam: 1 });
  });
});
