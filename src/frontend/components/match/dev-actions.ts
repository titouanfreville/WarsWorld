/**
 * FE-owned contract for the board's `match.devTools.send` submit — redeclared, not imported,
 * mirroring the server's `devActionSchema` (`src/server/core/schemas/dev-action.ts`), exactly as
 * `board-actions.ts` mirrors `mainActionSchema`.
 *
 * The BE re-validates every submitted action and re-checks authorisation regardless of what the
 * client sends, so this type only needs to stay STRUCTURALLY assignable to the inferred
 * `devTools.send` input — drift surfaces as a tsc error at the `mutate` call, not at runtime. Keep
 * it in step with `devActionSchema` by hand when the server schema changes.
 */

import type { BoardActionPosition } from "./board-actions";
import type { UnitType } from "./unit-types";

/** 0–7. Never -1: that is the neutral pseudo-player, which the server rejects. */
export type DevPlayerSlot = number;

/**
 * One-shot effects. Each mutates state once.
 */
type AddFundsDevAction = { type: "addFunds"; playerSlot: DevPlayerSlot; amount: number };
/** `amount: null` means "fill to this CO's maximum" — the server resolves it. */
type ChargePowerDevAction = {
  type: "chargePower";
  playerSlot: DevPlayerSlot;
  amount: number | null;
};
type TeleportUnitDevAction = {
  type: "teleportUnit";
  from: BoardActionPosition;
  to: BoardActionPosition;
};
type DeleteAnyUnitDevAction = { type: "deleteAnyUnit"; position: BoardActionPosition };

/**
 * Persistent modifiers. These are toggles the engine consults on every later action — not one-shot
 * effects — so the UI should render them as checked/unchecked state, not as buttons that "fire".
 */
type SetDirectCaptureDevAction = {
  type: "setDirectCapture";
  playerSlot: DevPlayerSlot;
  enabled: boolean;
};
type SetFreeProductionDevAction = {
  type: "setFreeProduction";
  playerSlot: DevPlayerSlot;
  enabled: boolean;
};
/** Pins every unit of `unitType` to `visualHp` (1–10). `null` clears the pin. */
type SetHpLockDevAction = {
  type: "setHpLock";
  playerSlot: DevPlayerSlot;
  unitType: UnitType;
  visualHp: number | null;
};
/** Pins every unit of `unitType` to `fuel`. `null` clears the pin. */
type SetFuelLockDevAction = {
  type: "setFuelLock";
  playerSlot: DevPlayerSlot;
  unitType: UnitType;
  fuel: number | null;
};
/** Pins every unit of `unitType` to `ammo` (no-ammo types ignore it). `null` clears the pin. */
type SetAmmoLockDevAction = {
  type: "setAmmoLock";
  playerSlot: DevPlayerSlot;
  unitType: UnitType;
  ammo: number | null;
};

export type DevAction =
  | AddFundsDevAction
  | ChargePowerDevAction
  | TeleportUnitDevAction
  | DeleteAnyUnitDevAction
  | SetDirectCaptureDevAction
  | SetFreeProductionDevAction
  | SetHpLockDevAction
  | SetFuelLockDevAction
  | SetAmmoLockDevAction;

/**
 * FE-owned mirror of the server's `adminActionSchema`. A separate union from `DevAction` because it
 * answers to a different capability and a different endpoint — merging them client-side would invite
 * merging them server-side, which would hand every tester the power to decide matches.
 *
 * `winnerTeamIndex` is a TEAM index; `null` is a draw. Not a "win/lose/draw" enum: defeat is only
 * meaningful relative to a viewer, and the engine settles by team.
 */
export type AdminAction = { type: "forceOutcome"; winnerTeamIndex: number | null };

/**
 * Unit types the locks can pin, as a runtime list for the panel's dropdown.
 *
 * `unit-types.ts` declares `UnitType` as a type-only union with no runtime counterpart, and the panel
 * opens from an empty tile — so there's no selected unit to take a type from. The `satisfies` keeps
 * this honest: drop a type from `UnitType` and this stops compiling.
 */
export const LOCKABLE_UNIT_TYPES = [
  "infantry",
  "mech",
  "recon",
  "apc",
  "artillery",
  "tank",
  "antiAir",
  "missile",
  "rocket",
  "mediumTank",
  "neoTank",
  "megaTank",
  "transportCopter",
  "battleCopter",
  "blackBomb",
  "bomber",
  "fighter",
  "stealth",
  "blackBoat",
  "lander",
  "cruiser",
  "battleship",
  "sub",
  "carrier",
  "pipeRunner",
] as const satisfies readonly UnitType[];

/**
 * Dev actions do NOT go through the board's action queue.
 *
 * The queue exists so a normal move survives a flaky connection, and it carries `MainAction`s to
 * `action.send` with an optimistic local view. Dev actions are a different union on a different
 * endpoint, and modelling their effects optimistically would mean reimplementing the pins and
 * modifiers on the client — precisely the engine-in-the-frontend the architecture forbids.
 *
 * So they submit directly and the board updates from the authoritative `devTool` event on the
 * websocket, like any other player's action. They're staff-only and rare; the queue buys nothing.
 */
export const DEV_ACTIONS_BYPASS_QUEUE = true;

/**
 * The RESOLVED effects as they arrive on the wire (server's `DevEffect` / `AdminEffect`), mirrored
 * here so the chat can render a system line without importing engine types. These carry values the
 * server already resolved (e.g. `chargePower.powerMeter`, not the caller's "fill to max"), which is
 * why they differ from the `DevAction` submit types above.
 */
type WireDevEffect =
  | { kind: "addFunds"; playerSlot: number; amount: number }
  | { kind: "chargePower"; playerSlot: number; powerMeter: number }
  | { kind: "teleportUnit"; from: BoardActionPosition; to: BoardActionPosition }
  | { kind: "deleteAnyUnit"; position: BoardActionPosition }
  | { kind: "setDirectCapture"; playerSlot: number; enabled: boolean }
  | { kind: "setFreeProduction"; playerSlot: number; enabled: boolean }
  | { kind: "setHpLock"; playerSlot: number; unitType: string; visualHp: number | null }
  | { kind: "setFuelLock"; playerSlot: number; unitType: string; fuel: number | null }
  | { kind: "setAmmoLock"; playerSlot: number; unitType: string; ammo: number | null };

type WireAdminEffect = { kind: "forceOutcome"; winnerTeamIndex: number | null };

const onOff = (enabled: boolean) => (enabled ? "on" : "off");
const at = (p: BoardActionPosition) => `(${p[0]},${p[1]})`;

/** Human sentence for a dev-tool effect — the text of the in-chat system line. */
export const formatDevToolEffect = (effect: WireDevEffect): string => {
  switch (effect.kind) {
    case "addFunds":
      return `${effect.amount >= 0 ? "added" : "removed"} ${Math.abs(effect.amount)} funds (slot ${effect.playerSlot})`;
    case "chargePower":
      return `set slot ${effect.playerSlot}'s power meter to ${effect.powerMeter}`;
    case "teleportUnit":
      return `teleported a unit ${at(effect.from)} → ${at(effect.to)}`;
    case "deleteAnyUnit":
      return `deleted the unit at ${at(effect.position)}`;
    case "setDirectCapture":
      return `turned direct capture ${onOff(effect.enabled)} (slot ${effect.playerSlot})`;
    case "setFreeProduction":
      return `turned free production ${onOff(effect.enabled)} (slot ${effect.playerSlot})`;
    case "setHpLock":
      return effect.visualHp === null
        ? `cleared the HP lock on ${effect.unitType} (slot ${effect.playerSlot})`
        : `locked ${effect.unitType} HP at ${effect.visualHp} (slot ${effect.playerSlot})`;
    case "setFuelLock":
      return effect.fuel === null
        ? `cleared the fuel lock on ${effect.unitType} (slot ${effect.playerSlot})`
        : `locked ${effect.unitType} fuel at ${effect.fuel} (slot ${effect.playerSlot})`;
    case "setAmmoLock":
      return effect.ammo === null
        ? `cleared the ammo lock on ${effect.unitType} (slot ${effect.playerSlot})`
        : `locked ${effect.unitType} ammo at ${effect.ammo} (slot ${effect.playerSlot})`;
  }
};

/** Human sentence for an admin-tool effect. */
export const formatAdminToolEffect = (effect: WireAdminEffect): string => {
  switch (effect.kind) {
    case "forceOutcome":
      return effect.winnerTeamIndex === null
        ? "forced the match to a draw"
        : `forced the match to end — team ${effect.winnerTeamIndex} wins`;
  }
};
