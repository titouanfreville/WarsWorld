import { baseTileSize, mapBorder } from "frontend/components/match/render-constants";
import { FRAME_ALIAS } from "frontend/components/match/hud/terrain-sprite";
import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { LoadedSpriteSheet } from "../load-spritesheet";

/**
 * The map builder's board: renders a plain tile grid and reports where you clicked.
 *
 * Separate from `v2/` on purpose — that one draws a `MatchView` (units, fog, vision, effects) and
 * knows about a live match. This one draws a `Tile[][]` and knows nothing else. Same atlases, same
 * anchoring, same `mapBorder`, so a map looks identical in the editor and on the board.
 *
 * React-decoupled per `src/frontend/CLAUDE.md`: data in through `setGrid`, events out through the
 * callbacks. It renders what it is given and decides nothing.
 */

/** Loose on purpose: the server re-validates every tile, and the renderer only needs these fields. */
export type EditorTile = {
  type: string;
  playerSlot?: number;
  variant?: string;
  hp?: number;
};

type Options = {
  sheets: LoadedSpriteSheet;
  /**
   * Slot index to faction, supplied by the server's map vocabulary. Not a constant here: which
   * faction a seat wears is game data, and a copy in the renderer would be a second source of it.
   */
  armyBySlot: string[];
  onPaint: (x: number, y: number) => void;
  onHover: (position: { x: number; y: number } | null) => void;
};

/** A predeployed unit, in the lean shape the builder edits. */
export type EditorUnit = {
  type: string;
  playerSlot: number;
  position: [number, number];
};

export type EditorBoard = {
  view: HTMLCanvasElement;
  setGrid: (tiles: EditorTile[][], units?: EditorUnit[], highlight?: [number, number][]) => void;
  setZoom: (zoom: number) => void;
  /**
   * Whether holding the pointer down keeps painting as it moves.
   *
   * On for the brush, where dragging a line is the point. Off for fill and pick, which act once:
   * a fill re-run on every pointer move would re-flood the whole region dozens of times a second.
   */
  setContinuous: (continuous: boolean) => void;
  destroy: () => void;
};

const spriteFor = (
  tile: EditorTile,
  sheets: LoadedSpriteSheet,
  armyBySlot: string[],
): Sprite | null => {
  const base = FRAME_ALIAS[tile.type] ?? tile.type;

  // A property takes its owner's colours; everything else lives on the neutral sheet.
  if (tile.playerSlot !== undefined) {
    const army = tile.playerSlot >= 0 ? armyBySlot[tile.playerSlot] : undefined;
    const sheet = army === undefined ? sheets.neutral : sheets[army as keyof LoadedSpriteSheet];
    const texture = sheet?.textures[`${base}-0.png`];

    return texture === undefined ? null : new Sprite(texture);
  }

  const { textures } = sheets.neutral;
  const key = tile.variant === undefined ? `${base}.png` : `${base}-${tile.variant}.png`;

  /*
   * Fall back to ANY frame this tile has rather than drawing nothing.
   *
   * A tile whose variant names no real frame used to render as empty space, which on a filled area
   * reads as the board having gone black — a variant bug turning into what looks like a crash. The
   * wrong-looking pipe is a far better failure than a hole, and it keeps the board legible while
   * whatever produced the bad variant is tracked down.
   */
  const texture =
    textures[key] ??
    textures[`${base}.png`] ??
    textures[Object.keys(textures).find((name) => name.startsWith(`${base}-`)) ?? ""];

  return texture === undefined ? null : new Sprite(texture);
};

export const createEditorBoard = ({
  sheets,
  armyBySlot,
  onPaint,
  onHover,
}: Options): EditorBoard => {
  const app = new Application({
    backgroundColor: 0x0b0d11,
    antialias: false,
    autoDensity: true,
    resolution: 1,
  });

  const root = new Container();
  root.sortableChildren = true;
  app.stage.addChild(root);

  const tileLayer = new Container();
  tileLayer.sortableChildren = true;
  // Tall art (an HQ is 31px on a 16px grid) is bottom-anchored and overhangs the row above, so the
  // whole grid is inset by one border — the same reason the match board does it.
  tileLayer.x = mapBorder;
  tileLayer.y = mapBorder;
  root.addChild(tileLayer);

  const overlay = new Graphics();
  overlay.x = mapBorder;
  overlay.y = mapBorder;
  root.addChild(overlay);

  let width = 0;
  let height = 0;
  let painting = false;
  let continuous = true;

  // pixi types `app.view` as the abstract `ICanvas`, which has no DOM rect. In the browser it is a
  // real <canvas>, and the whole point here is to hit-test DOM pointer events against it.
  const canvas = app.view as unknown as HTMLCanvasElement;

  const positionFromEvent = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    // The canvas is scaled up by CSS for zoom, so pointer coordinates are converted back into
    // canvas pixels before being divided into tiles.
    const scale = canvas.width / rect.width;
    const x = Math.floor(((event.clientX - rect.left) * scale - mapBorder) / baseTileSize);
    const y = Math.floor(((event.clientY - rect.top) * scale - mapBorder) / baseTileSize);

    return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
  };

  const handleDown = (event: PointerEvent) => {
    const position = positionFromEvent(event);

    if (position === null) {
      return;
    }

    painting = true;
    canvas.setPointerCapture(event.pointerId);
    onPaint(position.x, position.y);
  };

  const handleMove = (event: PointerEvent) => {
    const position = positionFromEvent(event);
    onHover(position);

    if (painting && continuous && position !== null) {
      onPaint(position.x, position.y);
    }
  };

  const stopPainting = () => {
    painting = false;
  };

  canvas.addEventListener("pointerdown", handleDown);
  canvas.addEventListener("pointermove", handleMove);
  canvas.addEventListener("pointerup", stopPainting);
  canvas.addEventListener("pointerleave", () => {
    stopPainting();
    onHover(null);
  });

  return {
    view: canvas,

    setGrid: (tiles, units = [], highlight = []) => {
      height = tiles.length;
      width = tiles[0]?.length ?? 0;

      app.renderer.resize(
        width * baseTileSize + mapBorder * 2,
        height * baseTileSize + mapBorder * 2,
      );
      tileLayer.removeChildren();

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const tile = tiles[y][x];
          const sprite = spriteFor(tile, sheets, armyBySlot);

          if (sprite === null) {
            continue;
          }

          // Whether a tile is "tall" is read off its own art rather than a list of tile names: any
          // frame higher than one tile overhangs the row above and needs ground drawn beneath it.
          if (sprite.texture.height > baseTileSize) {
            const ground = sheets.neutral.textures["plain.png"];

            if (ground !== undefined) {
              const groundSprite = new Sprite(ground);
              groundSprite.anchor.set(0, 1);
              groundSprite.x = x * baseTileSize;
              groundSprite.y = (y + 1) * baseTileSize;
              groundSprite.zIndex = y * 2;
              tileLayer.addChild(groundSprite);
            }
          }

          sprite.anchor.set(0, 1); // bottom-anchored, like the match board
          sprite.x = x * baseTileSize;
          sprite.y = (y + 1) * baseTileSize;
          sprite.zIndex = y * 2 + 1;
          tileLayer.addChild(sprite);
        }
      }

      // Units last, and above every tile: a unit standing on a mountain must not be swallowed by
      // the art that overhangs from the row below it.
      for (const unit of units) {
        const army = armyBySlot[unit.playerSlot];
        const texture =
          army === undefined
            ? undefined
            : sheets[army as keyof LoadedSpriteSheet]?.textures[`${unit.type}-0.png`];

        if (texture === undefined) {
          continue;
        }

        const sprite = new Sprite(texture);
        sprite.anchor.set(0, 1);
        sprite.x = unit.position[0] * baseTileSize;
        sprite.y = (unit.position[1] + 1) * baseTileSize;
        sprite.zIndex = height * 2 + unit.position[1];
        tileLayer.addChild(sprite);
      }

      overlay.clear();

      for (const [x, y] of highlight) {
        overlay.lineStyle(1, 0xd04038, 1);
        overlay.drawRect(x * baseTileSize, y * baseTileSize, baseTileSize, baseTileSize);
      }
    },

    setContinuous: (enabled) => {
      continuous = enabled;
    },

    setZoom: (zoom) => {
      canvas.style.width = `${canvas.width * zoom}px`;
      canvas.style.height = `${canvas.height * zoom}px`;
      canvas.style.imageRendering = "pixelated";
    },

    destroy: () => {
      canvas.removeEventListener("pointerdown", handleDown);
      canvas.removeEventListener("pointermove", handleMove);
      canvas.removeEventListener("pointerup", stopPainting);
      app.destroy(true, { children: true });
    },
  };
};
