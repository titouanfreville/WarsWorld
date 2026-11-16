import { describe, expect, it } from "vitest";
import type { BoardPosition } from "frontend/components/match/match-view";
import { stepAnimation, stepDirection } from "frontend/components/match/unit-animation";

const at = (x: number, y: number): BoardPosition => [x, y];

describe("stepDirection", () => {
  it("reads the four orthogonal steps", () => {
    expect(stepDirection(at(2, 2), at(2, 1))).toEqual({ direction: "up", flipX: false });
    expect(stepDirection(at(2, 2), at(2, 3))).toEqual({ direction: "down", flipX: false });
    expect(stepDirection(at(2, 2), at(3, 2))).toEqual({ direction: "side", flipX: false });
    // Walking left reuses the right-facing "-mside" art, mirrored on X.
    expect(stepDirection(at(2, 2), at(1, 2))).toEqual({ direction: "side", flipX: true });
  });

  it("picks the dominant axis for a diagonal, ties going horizontal", () => {
    // |dy| > |dx| → vertical.
    expect(stepDirection(at(0, 0), at(1, 3))).toEqual({ direction: "down", flipX: false });
    // |dx| >= |dy| → horizontal (equal magnitude falls here).
    expect(stepDirection(at(0, 0), at(2, 2))).toEqual({ direction: "side", flipX: false });
    expect(stepDirection(at(3, 0), at(0, 2))).toEqual({ direction: "side", flipX: true });
  });
});

describe("stepAnimation", () => {
  it("names the spritesheet key from the unit type and direction", () => {
    expect(stepAnimation("tank", at(2, 2), at(2, 1))).toEqual({
      key: "tank-mup",
      idleKey: "tank",
      flipX: false,
    });
    expect(stepAnimation("infantry", at(2, 2), at(1, 2))).toEqual({
      key: "infantry-mside",
      idleKey: "infantry",
      flipX: true,
    });
    expect(stepAnimation("battleCopter", at(2, 2), at(2, 3))).toEqual({
      key: "battleCopter-mdown",
      idleKey: "battleCopter",
      flipX: false,
    });
  });
});
