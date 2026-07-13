/**
 * Sprite/asset access system. One import surface for game art, grouped by domain:
 * - `nations` — army labels, brand colours, flags, sprite folders
 * - `units`   — unit vocabulary (land/air/sea) + idle sprites
 * - `co`      — general vocabulary + pixel/smooth portraits
 *
 * Components import from here instead of hardcoding `/img/...` paths or hex colours.
 */
export * from "./nations";
export * from "./units";
export * from "./co";
export * from "./skin-source";
