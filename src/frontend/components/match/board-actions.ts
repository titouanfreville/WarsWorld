/**
 * FE-owned action contract for the board's `action.send` submit — redeclared, not
 * imported/inferred, mirroring the server's `mainActionSchema` (`src/shared/schemas/action.ts`).
 * The BE re-validates every submitted action against that zod schema regardless of what the client
 * sends, so this type only needs to stay STRUCTURALLY assignable to the tRPC `action.send` input —
 * drift surfaces as a tsc error at the `mutate` call, not silently at runtime. Keep it in step with
 * `mainActionSchema` by hand when the server schema changes.
 *
 * Positions use mutable `[number, number]` tuples (not `readonly`) so this stays assignable to the
 * inferred `action.send` input, which expects plain mutable tuples on the wire.
 */

import type { UnitType } from "./unit-types";

export type BoardActionPosition = [number, number];
export type BoardActionDirection = "up" | "down" | "left" | "right";

type WaitSubAction = { type: "wait" };
type AbilitySubAction = { type: "ability" };
type AttackSubAction = { type: "attack"; defenderPosition: BoardActionPosition };
type UnloadWaitSubAction = {
  type: "unloadWait";
  unloads: { isSecondUnit: boolean; direction: BoardActionDirection }[];
};
type RepairSubAction = { type: "repair"; direction: BoardActionDirection };
type LaunchMissileSubAction = { type: "launchMissile"; targetPosition: BoardActionPosition };

/** Comes after a move (which can also be "stand still"), mirroring the server's `subActionSchema`. */
export type MainActionSubAction =
  | WaitSubAction
  | AttackSubAction
  | AbilitySubAction
  | UnloadWaitSubAction
  | RepairSubAction
  | LaunchMissileSubAction;

type MoveAction = {
  type: "move";
  path: BoardActionPosition[];
  subAction: MainActionSubAction;
};

type BuildAction = {
  type: "build";
  unitType: UnitType;
  position: BoardActionPosition;
};

type DeleteAction = {
  type: "delete";
  position: BoardActionPosition;
};

//AWBW behaviour, main action (needs position of transport, cause it's a main action)
type UnloadNoWaitAction = {
  type: "unloadNoWait";
  transportPosition: BoardActionPosition;
  unloads: { isSecondUnit: boolean; direction: BoardActionDirection };
};

type COPowerAction = {
  type: "coPower";
  isSuper: boolean;
};

type PassTurnAction = {
  type: "passTurn";
};

export type MainAction =
  | MoveAction
  | BuildAction
  | DeleteAction
  | UnloadNoWaitAction
  | COPowerAction
  | PassTurnAction;
