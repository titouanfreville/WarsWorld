import { Application, Sprite } from "pixi.js";
import type { LoadedSpriteSheet } from "../load-spritesheet";

/**
 * Turns atlas frames into standalone images the DOM can show.
 *
 * The palette used to slice the atlas with a CSS background, which works for the neutral sheet and
 * is wrong for every other one: the army atlases store most frames ROTATED and many of them
 * TRIMMED (orange-star alone has 209 rotated and 169 trimmed). A background-position can express
 * neither, so properties and units came out as garbage cut from the wrong part of the sheet.
 *
 * Pixi already knows how to compose those frames — it is what `Spritesheet` parses the flags for —
 * so the fix is to let it draw each one once and keep the result. That also means the palette does
 * no atlas arithmetic at all, and a frame's true height comes out naturally.
 */

/** One renderer for every thumbnail, built on first use and kept. */
let application: Application | null = null;

const renderer = () => {
  application ??= new Application({ width: 1, height: 1, backgroundAlpha: 0 });

  return application.renderer;
};

const cache = new Map<string, string>();

export type FrameRef = { sheet: string; frame: string };

export const frameKey = ({ sheet, frame }: FrameRef) => `${sheet}/${frame}`;

/**
 * A data URL for one atlas frame, or null when the sheet has no such frame.
 *
 * Cached forever: an atlas is static for the life of the page, and a palette re-renders constantly.
 */
export const frameThumbnail = (sheets: LoadedSpriteSheet, ref: FrameRef): string | null => {
  const key = frameKey(ref);
  const hit = cache.get(key);

  if (hit !== undefined) {
    return hit;
  }

  const texture = sheets[ref.sheet as keyof LoadedSpriteSheet]?.textures[ref.frame];

  if (texture === undefined) {
    return null;
  }

  const sprite = new Sprite(texture);
  // `extract` renders the sprite as pixi would draw it on the board, so rotation and trimming are
  // already undone by the time it reaches a canvas.
  const canvas = renderer().extract.canvas(sprite) as HTMLCanvasElement;
  const url = canvas.toDataURL();
  sprite.destroy();

  cache.set(key, url);

  return url;
};

/** Natural size of a frame once composed, so a caller can lay it out without measuring the image. */
export const frameSize = (
  sheets: LoadedSpriteSheet,
  ref: FrameRef,
): { width: number; height: number } | null => {
  const texture = sheets[ref.sheet as keyof LoadedSpriteSheet]?.textures[ref.frame];

  return texture === undefined ? null : { width: texture.width, height: texture.height };
};
