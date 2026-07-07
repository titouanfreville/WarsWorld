"use client";
import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import {
  getCurrentTurnPlayer,
  getPlayerById,
  getUnitAt,
  samePosition,
} from "frontend/components/match/match-view";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import { reconstructPath, snapshotUnitAt } from "frontend/components/match/turn-snapshot-view";
import { trpc } from "frontend/utils/trpc-client";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import type { Container } from "pixi.js";
import { Application } from "pixi.js";
import { useEffect, useRef } from "react";
import { renderMultiplier, renderedTileSize } from "./MatchRenderer";
import {
  renderHighlightTiles,
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
 * Snapshot-driven board (Phase C). Renders from the plain `match.full` data and drives movement off
 * the BE turn snapshot — NO client engine, NO `MatchWrapper`. Selection is a plain position, reachable
 * tiles come from the snapshot, and a move path is reconstructed by walking the snapshot's parents.
 * The backend stays authoritative: on any event we refetch, so the client can't desync. Behind `?v2`.
 *
 * Movement only for now (BE-authoritative, no optimistic buffer yet); capture/production/attack next.
 */
export function MatchBoardV2({ matchId, playerId, spritesheetDataByArmy }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapContainerRef = useRef<Container | null>(null);
  const highlightRef = useRef<Container | null>(null);
  const selectionRef = useRef<BoardPosition | null>(null);
  // Latest data for the imperative pixi click handler (whose closure is set up once per rebuild).
  const matchRef = useRef<MatchView | null>(null);
  const snapshotRef = useRef<TurnSnapshot | null>(null);

  const spriteSheetQuery = useQuery({
    queryKey: ["spritesheets"],
    queryFn: () => loadSpritesFromSpriteMap(spritesheetDataByArmy),
  });

  const matchQuery = trpc.match.full.useQuery({ matchId, playerId });
  const match = matchQuery.data;
  const spriteSheets = spriteSheetQuery.data;

  const isMyTurn = match !== undefined && getCurrentTurnPlayer(match)?.id === playerId;

  const snapshotQuery = trpc.matchPreview.turnSnapshot.useQuery(
    { matchId, playerId },
    { enabled: isMyTurn },
  );

  const utils = trpc.useUtils();
  const moveMutation = trpc.action.send.useMutation();

  // Keep the refs the pixi click handler reads pointed at the latest data.
  matchRef.current = match ?? null;
  snapshotRef.current = isMyTurn ? (snapshotQuery.data ?? null) : null;

  // Backend is authoritative: any event -> refetch state + snapshot, board rebuilds from the truth.
  trpc.action.onEvent.useSubscription(
    { playerId, matchId },
    {
      onData() {
        void utils.match.full.invalidate({ matchId, playerId });
        void utils.matchPreview.turnSnapshot.invalidate({ matchId, playerId });
      },
    },
  );

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

    const mapContainer = renderMapFromView(match, spriteSheets);
    mapContainerRef.current = mapContainer;
    highlightRef.current = null;
    selectionRef.current = null;

    const drawHighlights = (positions: readonly BoardPosition[]) => {
      highlightRef.current?.destroy();
      const container = renderHighlightTiles(positions, "#43d9e4");
      mapContainer.addChild(container);
      highlightRef.current = container;
    };

    const clearSelection = () => {
      selectionRef.current = null;
      drawHighlights([]);
    };

    const onTileClick = (pos: BoardPosition) => {
      const currentMatch = matchRef.current;
      const snapshot = snapshotRef.current;

      if (currentMatch === null) {
        return;
      }

      const selected = selectionRef.current;

      // A unit is selected and we clicked one of its reachable tiles -> submit the move.
      if (selected !== null && snapshot !== null && !samePosition(pos, selected)) {
        const selectedUnit = snapshotUnitAt(snapshot, selected);
        const path = selectedUnit === undefined ? null : reconstructPath(selectedUnit, pos);

        if (path !== null) {
          clearSelection();
          moveMutation.mutate(
            {
              playerId,
              matchId,
              type: "move",
              // Wire `Position` is a mutable tuple; our BoardPosition is readonly, so copy.
              path: path.map((p) => [p[0], p[1]] as [number, number]),
              subAction: { type: "wait" },
            },
            { onError: (error) => console.error("[v2] move rejected by BE:", error.message) },
          );
          return;
        }
      }

      // Otherwise (re)select an own, ready, movable unit on our turn, or clear the selection.
      const myPlayer = getPlayerById(currentMatch, playerId);
      const unitHere = getUnitAt(currentMatch, pos);
      const snapshotUnit = snapshot === null ? undefined : snapshotUnitAt(snapshot, pos);

      if (
        myPlayer !== undefined &&
        unitHere !== undefined &&
        unitHere.playerSlot === myPlayer.slot &&
        snapshotUnit !== undefined &&
        snapshotUnit.reachableTiles.length > 0
      ) {
        selectionRef.current = pos;
        drawHighlights(snapshotUnit.reachableTiles.map((tile) => tile.position));
      } else {
        clearSelection();
      }
    };

    app.stage.addChild(
      mapContainer,
      renderUnitsFromView(match, spriteSheets),
      renderInteractiveTilesFromView(match, onTileClick, () => undefined),
    );

    return () => {
      app.destroy(true, { children: true });
      mapContainerRef.current = null;
      highlightRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, spriteSheets]);

  if (matchQuery.isError || spriteSheetQuery.isError) {
    return <p>error {":("}</p>;
  }

  if (match === undefined || spriteSheets === undefined) {
    return <p>Loading v2 board…</p>;
  }

  return (
    <div className="@w-full @h-full @flex @flex-col @items-center @justify-center @py-4">
      <p>
        [v2 snapshot board] Funds: {getPlayerById(match, playerId)?.funds ?? 0} —{" "}
        {isMyTurn ? "your turn (click a unit to move)" : "waiting for opponent"}
      </p>
      <canvas className="@inline" style={{ imageRendering: "pixelated" }} ref={canvasRef}></canvas>
    </div>
  );
}
