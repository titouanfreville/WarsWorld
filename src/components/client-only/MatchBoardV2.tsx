"use client";
import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import { getPlayerById } from "frontend/components/match/match-view";
import { trpc } from "frontend/utils/trpc-client";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import { Application } from "pixi.js";
import { useEffect, useRef } from "react";
import { renderMultiplier, renderedTileSize } from "./MatchRenderer";
import {
  renderInteractiveTilesFromView,
  renderMapFromView,
  renderUnitsFromView,
} from "../../pixi/v2/render-from-view";

type Props = {
  matchId: string;
  playerId: string;
  spritesheetDataByArmy: SpritesheetDataByArmy;
};

/**
 * Snapshot-driven board (Phase C, in progress). Renders the map + units straight from the plain
 * `match.full` data — no client-side `MatchWrapper`, no engine. Read-only for now; movement /
 * capture / production / attack are layered on next via the turn snapshot + action buffer. Lives
 * behind `?v2` on the match page so the working engine-based board is untouched during the cut.
 */
export function MatchBoardV2({ matchId, playerId, spritesheetDataByArmy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const spriteSheetQuery = useQuery({
    queryKey: ["spritesheets"],
    queryFn: () => loadSpritesFromSpriteMap(spritesheetDataByArmy),
  });

  const matchQuery = trpc.match.full.useQuery({ matchId, playerId });

  const match = matchQuery.data;
  const spriteSheets = spriteSheetQuery.data;

  useEffect(() => {
    if (match === undefined || spriteSheets === undefined || canvasRef.current === null) {
      return;
    }

    const app = new Application({
      view: canvasRef.current,
      autoDensity: true,
      resolution: window.devicePixelRatio,
      backgroundColor: "#000b2c",
      width: match.map.tiles[0].length * renderedTileSize + renderedTileSize,
      height: match.map.tiles.length * renderedTileSize + renderedTileSize,
    });
    app.stage.sortableChildren = true;
    app.stage.scale.set(renderMultiplier, renderMultiplier);

    app.stage.addChild(
      renderMapFromView(match, spriteSheets),
      renderUnitsFromView(match, spriteSheets),
      renderInteractiveTilesFromView(
        match,
        (pos) => console.log("[v2] tile click", pos),
        () => undefined, // hover: no-op for now (movement preview lands in the next increment)
      ),
    );

    return () => {
      app.destroy(true, { children: true });
    };
  }, [match, spriteSheets]);

  if (matchQuery.isError || spriteSheetQuery.isError) {
    return <p>error {":("}</p>;
  }

  if (match === undefined || spriteSheets === undefined) {
    return <p>Loading v2 board…</p>;
  }

  return (
    <div className="@w-full @h-full @flex @flex-col @items-center @justify-center @py-4">
      <p>[v2 snapshot board — read-only] Funds: {getPlayerById(match, playerId)?.funds ?? 0}</p>
      <canvas className="@inline" style={{ imageRendering: "pixelated" }} ref={canvasRef}></canvas>
    </div>
  );
}
