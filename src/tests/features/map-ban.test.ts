import { describe, expect, it } from "vitest";
import {
  banStageComplete,
  canBan,
  canVote,
  rollMap,
  survivors,
  type PlayerBanVote,
} from "server/matchmaking/map-ban";

/**
 * Pure map pick & ban rules: survivors after bans, live ban/vote validation, the ban-stage gate that
 * makes banning blind, and the roll-among-votes. Randomness is injected so every case is
 * deterministic.
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

describe("ban validation (blind)", () => {
  const players = [pvb("p1", ["m0"], null), pvb("p2", ["m1", "m5"], null)];

  it("allows a pool map the player hasn't used up their bans on", () => {
    expect(canBan(POOL, players[0], "m2")).toBe(true);
  });

  it("rejects a repeat ban, an out-of-pool map, and a maxed-out banner", () => {
    expect(canBan(POOL, players[0], "m0")).toBe(false); // already banned by p1
    expect(canBan(POOL, players[0], "zzz")).toBe(false); // not in pool
    expect(canBan(POOL, players[1], "m2")).toBe(false); // p2 already has 2 bans
  });

  it("ALLOWS banning what the opponent already banned — rejecting it would leak their ban", () => {
    // p2 has banned m1. p1 is banning blind and cannot know that; the ban must be accepted (and
    // simply wasted) rather than bounced with an error that reveals p2's choice.
    expect(canBan(POOL, players[0], "m1")).toBe(true);
    // The overlap costs a ban but leaves a bigger pool — m1 is removed once, not twice.
    expect(survivors(POOL, [pvb("p1", ["m0", "m1"], null), pvb("p2", ["m1", "m5"], null)])).toEqual(
      ["m2", "m3", "m4", "m6"],
    );
  });

  it("can never empty a legal pool, so no last-survivor guard is needed", () => {
    // MIN_MAP_POOL_SIZE (2 × 2 + 1 = 5) with zero overlap — the worst case still leaves one map.
    const minPool = ["m0", "m1", "m2", "m3", "m4"];
    const allSpent = [pvb("p1", ["m0", "m1"], null), pvb("p2", ["m2", "m3"], null)];
    expect(banStageComplete(allSpent)).toBe(true);
    expect(survivors(minPool, allSpent)).toEqual(["m4"]);
  });
});

describe("banStageComplete", () => {
  it("is true only once every player has spent all their bans", () => {
    expect(banStageComplete([pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1", "m5"], null)])).toBe(
      true,
    );
    expect(banStageComplete([pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1"], null)])).toBe(false);
    expect(banStageComplete([pvb("p1", [], null), pvb("p2", [], null)])).toBe(false);
  });
});

describe("vote validation", () => {
  const players = [pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1", "m5"], null)];

  it("only lets a surviving map be voted", () => {
    expect(canVote(POOL, players, "m2")).toBe(true);
    expect(canVote(POOL, players, "m0")).toBe(false); // banned
    expect(canVote(POOL, players, "m1")).toBe(false); // banned
  });

  it("rejects every vote while the bans are still blind", () => {
    // p2 hasn't finished banning → the bans haven't revealed → nobody may vote yet.
    const midBan = [pvb("p1", ["m0", "m3"], null), pvb("p2", ["m1"], null)];
    expect(canVote(POOL, midBan, "m2")).toBe(false);
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
