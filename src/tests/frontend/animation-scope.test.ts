import { describe, expect, it } from "vitest";
import { readAnimationScope, shouldAnimate } from "frontend/components/match/animation-scope";

const VIEWER = "viewer-player-id";
const OPPONENT = "opponent-player-id";

describe("readAnimationScope", () => {
  it("reads a stored setting", () => {
    expect(readAnimationScope({ animations: "own" })).toBe("own");
    expect(readAnimationScope({ animations: "none" })).toBe("none");
  });

  it("defaults to showing everything when the player never chose", () => {
    // Preferences are a free-form JSON blob, so every one of these is reachable in practice —
    // an older client, a player who never opened settings, or a logged-out viewer.
    expect(readAnimationScope(undefined)).toBe("all");
    expect(readAnimationScope(null)).toBe("all");
    expect(readAnimationScope({})).toBe("all");
    expect(readAnimationScope({ particleEffect: "golden" })).toBe("all");
  });

  it("falls back to showing everything on a value it doesn't recognise", () => {
    // Never trust the blob: a junk value must not silently mean "animate nothing".
    expect(readAnimationScope({ animations: "sometimes" })).toBe("all");
    expect(readAnimationScope({ animations: 3 })).toBe("all");
  });
});

describe("shouldAnimate", () => {
  it("plays everything on 'all'", () => {
    expect(shouldAnimate("all", VIEWER, VIEWER)).toBe(true);
    expect(shouldAnimate("all", OPPONENT, VIEWER)).toBe(true);
  });

  it("plays nothing on 'none'", () => {
    expect(shouldAnimate("none", VIEWER, VIEWER)).toBe(false);
    expect(shouldAnimate("none", OPPONENT, VIEWER)).toBe(false);
  });

  it("plays only the viewer's own army on 'own'", () => {
    // Keyed on who the animation is ABOUT — a crash is reported with the army it happened to, so
    // the viewer sees their own units go down and stays quiet for the opponent's.
    expect(shouldAnimate("own", VIEWER, VIEWER)).toBe(true);
    expect(shouldAnimate("own", OPPONENT, VIEWER)).toBe(false);
  });
});
