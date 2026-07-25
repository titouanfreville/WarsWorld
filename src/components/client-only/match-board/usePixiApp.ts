import { renderMultiplier } from "frontend/components/match/render-constants";
import { Application } from "pixi.js";
import { useEffect, useRef } from "react";

/** The board's background — deep navy, so the map reads as a lit surface over dark water. */
const BOARD_BACKGROUND = "#000b2c";

/**
 * Owns the pixi `Application` and its canvas: created once on mount into `containerRef`, destroyed
 * only on unmount. The stage CONTENT is rebuilt on every view change (see `useBoardScene`) — the
 * app itself deliberately survives that, so ticker animations and the WebGL context aren't
 * recreated on each action.
 *
 * Mount `containerRef` on a node that is always rendered (never behind a loading branch), or the
 * canvas has nowhere to attach.
 */
export function usePixiApp() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);

  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const app = new Application({
      autoDensity: true,
      resolution: window.devicePixelRatio,
      backgroundColor: BOARD_BACKGROUND,
    });
    app.stage.sortableChildren = true;
    app.stage.scale.set(renderMultiplier, renderMultiplier);
    const canvas = app.view as unknown as HTMLCanvasElement;
    canvas.style.imageRendering = "pixelated";
    // Right-click is our universal "cancel current interaction" gesture, so suppress the browser
    // context menu over the board (handled per-tile via the scene's `onTileRightClick`).
    const suppressContextMenu = (event: Event) => event.preventDefault();
    canvas.addEventListener("contextmenu", suppressContextMenu);
    containerRef.current.appendChild(canvas);
    appRef.current = app;

    return () => {
      canvas.removeEventListener("contextmenu", suppressContextMenu);
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  return { containerRef, appRef };
}
