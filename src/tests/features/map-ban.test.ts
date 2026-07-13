import { describe, expect, it } from "vitest";
import {
  canBan,
  canVote,
  rollMap,
  survivors,
  type PlayerBanVote,
} from "server/matchmaking/map-ban";

/**
 * Pure map pick & ban rules: survivors after bans, live ban/vote validation,
 * and the roll-among-votes. Randomness is injected so every case is deterministic.
 */

const POOL = ["m0", "m1", "m2", "m3", "m4", "m5", "m6"];
const pvb = (playerId: string, bans: string[], vote: string | null): PlayerBanVote => ({
  playerId,
  bannedMapIds: bans,
  votedMapId: vote,
});

// Deterministic "random": always take the first candidate.
const firstPick = (): number => 0;

describe("survivors", () => {
  it("removes every player's bans from the pool", () => {
    const s = survivors(POOL, [pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1", "m5"], null)]);
    expect(s).toEqual(["m2", "m4", "m6"]);
  });
});

describe("ban / vote validation", () => {
  const players = [pvb("p1", ["m0"], null), pvb("p2", ["m1", "m5"], null)];

  it("allows a pool map the player hasn't used up their bans on", () => {
    expect(canBan(POOL, players, players[0], "m2")).toBe(true);
  });

  it("rejects a repeat ban, an out-of-pool map, and a maxed-out banner", () => {
    expect(canBan(POOL, players, players[0], "m0")).toBe(false); // already banned by p1
    expect(canBan(POOL, players, players[0], "zzz")).toBe(false); // not in pool
    expect(canBan(POOL, players, players[1], "m2")).toBe(false); // p2 already has 2 bans
  });

  it("rejects a ban that would empty the pool (last-survivor guard)", () => {
    // Tiny 3-map pool: p1 already banned m0, p2 banned m1 → only m2 survives.
    const tinyPool = ["m0", "m1", "m2"];
    const nearlyEmpty = [pvb("p1", ["m0"], null), pvb("p2", ["m1"], null)];
    expect(canBan(tinyPool, nearlyEmpty, nearlyEmpty[0], "m2")).toBe(false); // would leave nothing
    expect(survivors(tinyPool, nearlyEmpty)).toEqual(["m2"]); // guard preserves the last map
  });

  it("only lets a surviving map be voted", () => {
    expect(canVote(POOL, players, "m2")).toBe(true);
    expect(canVote(POOL, players, "m0")).toBe(false); // banned
    expect(canVote(POOL, players, "m1")).toBe(false); // banned
  });
});

describe("rollMap", () => {
  it("returns the shared favourite when both voted the same survivor", () => {
    const players = [pvb("p1", ["m0", "m3"], "m4"), pvb("p2", ["m1", "m5"], "m4")];
    expect(rollMap(POOL, players, firstPick)).toBe("m4");
  });

  it("rolls among the two votes when they differ", () => {
    const players = [pvb("p1", ["m0", "m3"], "m2"), pvb("p2", ["m1", "m5"], "m6")];
    // firstPick → votes[0]; votes are collected in player order → "m2"
    expect(rollMap(POOL, players, firstPick)).toBe("m2");
  });

  it("falls back to a survivor when nobody voted", () => {
    const players = [pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1", "m5"], null)];
    // survivors = m2,m4,m6 → firstPick picks m2
    expect(rollMap(POOL, players, firstPick)).toBe("m2");
  });

  it("skips a vote that got banned out and rolls among the remaining valid votes", () => {
    // p1 voted m4, but p2 banned m4 → only p2's m2 counts.
    const players = [pvb("p1", ["m0", "m3"], "m4"), pvb("p2", ["m1", "m4"], "m2")];
    expect(rollMap(POOL, players, firstPick)).toBe("m2");
  });
});
