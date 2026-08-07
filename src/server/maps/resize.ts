import type { Position } from "server/core/schemas/position";
import type { Tile } from "server/core/schemas/tile";

/**
 * Reshaping a map: grow it, crop it, or shift its contents inside the same frame.
 *
 * Pure, and server-side rather than in the builder, so there is one implementation of what happens
 * to a unit standing where the map no longer reaches. It is destructive on the way down, which is
 * why the caller is expected to have said so out loud before calling it.
 */

/** Where the existing map sits inside the new frame. */
export const RESIZE_ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

export type ResizeAnchor = (typeof RESIZE_ANCHORS)[number];

export type ResizeRequest = {
  width: number;
  height: number;
  anchor: ResizeAnchor;
};

export type Resizable = {
  tiles: Tile[][];
  predeployedUnits: { position: Position }[];
};

export type ResizeResult<T extends Resizable> = {
  tiles: Tile[][];
  predeployedUnits: T["predeployedUnits"];
  /** Units that fell outside the new frame and were dropped. Reported so the UI can say so. */
  droppedUnits: number;
};

/**
 * How far the old grid is shifted inside the new one.
 *
 * The same arithmetic covers growing and shrinking: the offset simply goes negative when the new
 * frame is smaller, which turns "pad on this side" into "crop from this side".
 */
const offsetFor = (anchor: ResizeAnchor, oldSize: number, newSize: number, axis: "x" | "y") => {
  const slack = newSize - oldSize;

  if (axis === "x") {
    if (anchor.endsWith("left")) {
      return 0;
    }

    if (anchor.endsWith("right")) {
      return slack;
    }

    return Math.floor(slack / 2);
  }

  if (anchor.startsWith("top")) {
    return 0;
  }

  if (anchor.startsWith("bottom")) {
    return slack;
  }

  return Math.floor(slack / 2);
};

export const resizeMap = <T extends Resizable>(
  map: T,
  { width, height, anchor }: ResizeRequest,
  blankTile: Tile,
): ResizeResult<T> => {
  const oldHeight = map.tiles.length;
  const oldWidth = map.tiles[0]?.length ?? 0;

  const dx = offsetFor(anchor, oldWidth, width, "x");
  const dy = offsetFor(anchor, oldHeight, height, "y");

  const tiles: Tile[][] = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      const source = map.tiles[y - dy]?.[x - dx];

      // A fresh cell is a copy, never a shared reference — two cells that are the same object
      // become the same tile the moment one of them is painted.
      return source ?? { ...blankTile };
    }),
  );

  const moved = map.predeployedUnits
    .map((unit) => ({ ...unit, position: [unit.position[0] + dx, unit.position[1] + dy] }))
    .filter(
      (unit) =>
        unit.position[0] >= 0 &&
        unit.position[1] >= 0 &&
        unit.position[0] < width &&
        unit.position[1] < height,
    );

  return {
    tiles,
    predeployedUnits: moved as T["predeployedUnits"],
    droppedUnits: map.predeployedUnits.length - moved.length,
  };
};
