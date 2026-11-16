import type { ISpritesheetData } from "pixi.js";
import type { Army } from "shared/schemas/army";
import type { PropertyTileType } from "shared/schemas/tile";
import type { UnitType } from "frontend/components/match/unit-types";

export type SheetNames = Army | "neutral" | "arrow" | "icons";

export type SpriteAnimationKeys =
  | PropertyTileType
  | TileAnimationVariants
  | UnitType
  | UnitAnimationVariants;

export type ArmySpritesheetData = ISpritesheetData & {
  animations: Record<SpriteAnimationKeys, undefined>;
};

export type SpritesheetDataByArmy = Record<SheetNames, ArmySpritesheetData>;

// Matches the actual spritesheet animation keys (e.g. "city-snow", "port-rain") — hyphen, not underscore.
type TileAnimationVariants = `${PropertyTileType}-${"rain" | "snow"}`;
type UnitMoveDirection = "down" | "side" | "up";
type UnitAnimationVariants = `${UnitType}-m${UnitMoveDirection}`;
