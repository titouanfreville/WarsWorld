"use client";
import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import { getArmyForSlot, getUnitAt, samePosition } from "frontend/components/match/match-view";
import { inspectHighlights, type InspectMode } from "frontend/components/match/inspect-highlights";
import { AmbushLabel } from "frontend/components/match/hud/AmbushLabel";
import { CombatForecastCard } from "frontend/components/match/hud/CombatForecastCard";
import { EndGameScreen } from "frontend/components/match/hud/EndGameScreen";
import { GameOverOverlay } from "frontend/components/match/hud/GameOverOverlay";
import { GameShell } from "frontend/components/match/hud/GameShell";
import { useEndGameFlow } from "frontend/components/match/useEndGameFlow";
import { IntelOverlay } from "frontend/components/match/hud/IntelOverlay";
import { MatchChat } from "frontend/components/match/hud/MatchChat";
import { MatchHud } from "frontend/components/match/hud/MatchHud";
import { UnitDetailCard } from "frontend/components/match/hud/UnitDetailCard";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import type { UnloadDrop } from "frontend/components/match/turn-snapshot-view";
import { useMatchBoard } from "frontend/components/match/useMatchBoard";
import { makeClientId } from "frontend/utils/action-queue";
import { trpc } from "frontend/utils/trpc-client";
import type { Army } from "frontend/utils/sprites";
import { useRouter } from "next/router";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import type { AttackForecastFocus } from "../../pixi/v2/board-controller";
import { mountBoardScene } from "../../pixi/v2/board-scene";
import type { Container } from "pixi.js";
import { Application, Assets } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderMultiplier } from "frontend/components/match/render-constants";

type Props = {
  matchId: string;
  playerId: string;
  spritesheetDataByArmy: SpritesheetDataByArmy;
};

/**
 * Snapshot-driven board (Phase C). Renders from the plain `match.full` data and drives actions off
 * the BE turn snapshot + preview endpoints — NO client engine, NO `MatchWrapper`, NO rules geometry.
 * Selection is a plain position; reachable tiles and the move path come from the snapshot, attack
 * targets from the `attackTargets` endpoint. The backend stays authoritative (any event -> refetch),
 * so the client can't desync. This is now the DEFAULT board; the old engine-on-client board is the
 * `?v1` fallback during the cutover.
 *
 * Interaction: select a unit (blue reachable tiles), click a reachable tile to stage a move there,
 * then pick from an in-board contextual menu (ATTACK / CAPTURE / WAIT). ATTACK reveals red enemies
 * to click; a facility opens a build menu of its affordable units. Only turn management lives in the
 * top bar — every other action is a pixi menu anchored at the tile (matching the v1 look).
 *
 * Actions are buffered optimistically (see `applyBufferedActions` + `action-queue`): move/capture/
 * production show instantly as presentation deltas while the queue drains one action at a time and
 * reconciles against the BE's authoritative refetch. Attacks are BE-resolved and serialize on each
 * other (an unresolved attack blocks the next). Combat is never previewed on the client.
 */
export function MatchBoardV2({ matchId, playerId, spritesheetDataByArmy }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const reachableHighlightRef = useRef<Container | null>(null);
  const attackHighlightRef = useRef<Container | null>(null);
  const unloadHighlightRef = useRef<Container | null>(null);
  // The move-path arrow shown while hovering a reachable tile with a unit selected. Matters most in
  // fog: the exact route decides which tiles the unit crosses (and whether it hits a hidden unit).
  const pathArrowRef = useRef<Container | null>(null);
  // The AW-style traced route the cursor is drawing (origin -> ... -> hovered tile). This is the path
  // that gets committed — not necessarily the shortest one — so the player controls the exact route.
  const plannedPathRef = useRef<BoardPosition[]>([]);
  // The pixi ticker callback animating the shimmer along buffered arrows; removed on each re-render.
  const shimmerRef = useRef<((delta: number) => void) | null>(null);
  const weatherAnimRef = useRef<((delta: number) => void) | null>(null);
  // Selection: the unit's origin tile. Staged destination: where a move is being composed (null =
  // acting from the origin). Attack targets: the currently clickable red tiles. Unload drops: the
  // clickable green drop tiles once UNLOAD is chosen. All read by the imperative pixi click handler.
  const selectionRef = useRef<BoardPosition | null>(null);
  const stagedDestRef = useRef<BoardPosition | null>(null);
  const attackTargetsRef = useRef<BoardPosition[]>([]);
  const unloadDropsRef = useRef<UnloadDrop[]>([]);
  // While arming a missile: the move path onto the silo. The next board click is the strike target.
  const missileArmRef = useRef<{ path: readonly BoardPosition[] } | null>(null);
  const resetInteractionRef = useRef<() => void>(() => undefined);
  // Set by the scene so React can paint the inspect overlay's reachable/threat tiles onto the board.
  const inspectHighlightRef = useRef<
    (reachable: readonly BoardPosition[], attack: readonly BoardPosition[]) => void
  >(() => undefined);

  const matchRef = useRef<MatchView | null>(null);
  const snapshotRef = useRef<TurnSnapshot | null>(null);

  const spriteSheetQuery = useQuery({
    queryKey: ["spritesheets"],
    queryFn: async () => {
      // The bitmap font the in-board menus render with ("awFont" is declared in this .fnt).
      await Assets.load("/aw2Font.fnt");
      return loadSpritesFromSpriteMap(spritesheetDataByArmy);
    },
  });
  const spriteSheets = spriteSheetQuery.data;

  const {
    matchQuery,
    optimisticView,
    snapshot,
    isMyTurn,
    queue,
    dispatchQueue,
    queueRef,
    priceTableRef,
    actionMutation,
    onActionError,
    trapNotice,
  } = useMatchBoard({ matchId, playerId });

  // HUD overlays fed by board events: the engagement being eyed (floating combat-forecast box) and
  // the right-clicked unit being inspected (unit-detail card). The pixi controller sets these via the
  // callbacks passed into `mountBoardScene`; the queries below fetch the BE data to render.
  const [attackFocus, setAttackFocus] = useState<AttackForecastFocus | null>(null);
  // The inspected unit + which overlay it shows: `full` (movement + reach) on the first right-click,
  // `direct` (in-place attack only) after a second right-click on the same unit — toggling thereafter.
  const [inspect, setInspect] = useState<{ pos: BoardPosition; mode: InspectMode } | null>(null);
  const inspectPos = inspect?.pos ?? null;

  // A right-click on the SAME unit toggles full <-> direct; a different unit resets to full; null clears.
  const handleInspect = useCallback((pos: BoardPosition | null) => {
    if (pos === null) {
      setInspect(null);

      return;
    }

    setInspect((prev) =>
      prev !== null && samePosition(prev.pos, pos)
        ? { pos, mode: prev.mode === "full" ? "direct" : "full" }
        : { pos, mode: "full" },
    );
  }, []);

  const toTuple = (position: BoardPosition): [number, number] => [position[0], position[1]];

  // BE combat forecast for the focused engagement — min/max damage both ways + defense stars. Only
  // runs while a target is focused; the disabled-state input is a harmless placeholder.
  const forecastQuery = trpc.matchPreview.combatForecast.useQuery(
    {
      matchId,
      playerId,
      attackerPosition: attackFocus === null ? [0, 0] : toTuple(attackFocus.attackerPosition),
      toPosition: attackFocus === null ? [0, 0] : toTuple(attackFocus.toPosition),
      targetPosition: attackFocus === null ? [0, 0] : toTuple(attackFocus.targetPosition),
    },
    { enabled: attackFocus !== null },
  );

  // BE stat readout for the inspected unit. Enabled only while a unit is being inspected.
  const detailsQuery = trpc.matchPreview.unitDetails.useQuery(
    { matchId, playerId, unitPosition: inspectPos === null ? [0, 0] : toTuple(inspectPos) },
    { enabled: inspectPos !== null },
  );

  // Drop the inspect card if its unit is gone (moved/destroyed by a refetch) — the BE rejects the
  // stale position, so close rather than show a spinning query.
  useEffect(() => {
    if (inspectPos !== null && detailsQuery.isError) {
      setInspect(null);
    }
  }, [inspectPos, detailsQuery.isError]);

  // Army of the inspected unit's owner, for its sprite in the detail card.
  const inspectUnit =
    inspectPos !== null && optimisticView !== undefined
      ? getUnitAt(optimisticView, inspectPos)
      : undefined;
  const inspectArmy =
    inspectUnit !== undefined && optimisticView !== undefined
      ? (getArmyForSlot(optimisticView, inspectUnit.playerSlot) as Army | undefined)
      : undefined;

  // Interaction handlers read the OPTIMISTIC view (what's on screen), not the raw authoritative one,
  // so a just-moved unit is looked up at its new tile and can't be re-selected. Assign in an effect
  // rather than the render body (mutating a ref during render is a StrictMode/concurrent hazard) —
  // the handlers only read these lazily on a click/hover, well after the effect has committed.
  useEffect(() => {
    matchRef.current = optimisticView ?? null;
    snapshotRef.current = snapshot;
  }, [optimisticView, snapshot]);

  // Create the pixi app once, with its own canvas. Destroy only on unmount.
  useEffect(() => {
    if (containerRef.current === null) {
      return;
    }

    const app = new Application({
      autoDensity: true,
      resolution: window.devicePixelRatio,
      backgroundColor: "#000b2c",
    });
    app.stage.sortableChildren = true;
    app.stage.scale.set(renderMultiplier, renderMultiplier);
    const canvas = app.view as unknown as HTMLCanvasElement;
    canvas.style.imageRendering = "pixelated";
    // Right-click is our universal "cancel current interaction" gesture, so suppress the browser
    // context menu over the board (handled per-tile via onTileRightClick below).
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

  // (Re)render the stage content whenever the rendered (optimistic) view changes. The app persists.
  useEffect(() => {
    const app = appRef.current;
    const view = optimisticView;

    if (app === null || view === undefined || spriteSheets === undefined) {
      return;
    }

    mountBoardScene({
      app,
      view,
      spriteSheets,
      playerId,
      queue,
      dispatchQueue,
      refs: {
        reachableHighlightRef,
        attackHighlightRef,
        unloadHighlightRef,
        pathArrowRef,
        plannedPathRef,
        shimmerRef,
        weatherAnimRef,
        selectionRef,
        stagedDestRef,
        attackTargetsRef,
        unloadDropsRef,
        missileArmRef,
        resetInteractionRef,
        inspectHighlightRef,
        matchRef,
        snapshotRef,
        priceTableRef,
        queueRef,
      },
      onAttackTargetFocus: setAttackFocus,
      onUnitInspect: handleInspect,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticView, spriteSheets]);

  // Paint the inspected unit's ranges once the BE returns them — coloured per rule (own vs enemy) and
  // per mode (full vs the second-click direct view). Depends on `optimisticView` so it repaints after
  // a scene rebuild while a unit stays inspected. We don't clear on the empty branch: the board's own
  // reset owns clearing the highlight layer, and clearing here would wipe a fresh selection's tiles.
  useEffect(() => {
    if (inspect !== null && detailsQuery.data !== undefined) {
      const { reachable, attack } = inspectHighlights(detailsQuery.data, inspect.mode);
      inspectHighlightRef.current(reachable, attack);
    }
  }, [inspect, detailsQuery.data, optimisticView]);

  const router = useRouter();

  // End-of-match screen sequencing: play the victory/defeat "moment", then auto-load the End-Game
  // screen (a reconnect to an already-finished match skips straight to it). Presentation only — the
  // outcome itself is the BE's.
  const { phase, secondsLeft, skip } = useEndGameFlow({
    over: (optimisticView?.gameOver ?? null) !== null,
    ready: optimisticView !== undefined,
  });

  if (matchQuery.isError || spriteSheetQuery.isError) {
    return <p>error {":("}</p>;
  }

  // Match outcome (derived by the BE from player elimination); non-null => banner + no more actions.
  const gameOver = optimisticView?.gameOver ?? null;

  // The full CO cast for the game-over overlay — every general tagged with how their match ended
  // (from `player.result`) so the overlay can colour winners and grey out losers. The viewer is
  // flagged so their own CO gets a "You" marker.
  const gameOverCos =
    optimisticView?.players.map((player) => ({
      name: player.coId.name,
      result: player.result,
      isViewer: player.id === playerId,
    })) ?? [];

  // Viewer-relative outcome for the End-Game screen header + theme.
  const outcome =
    gameOver === null
      ? null
      : gameOver.viewerWon
        ? "victory"
        : gameOver.winnerTeamIndex === null
          ? "draw"
          : "defeat";

  // Richer per-seat summary for the End-Game screen (name + army + CO + result).
  const endGamePlayers =
    optimisticView?.players.map((player) => ({
      id: player.id,
      name: player.name,
      army: player.army as Army,
      coName: player.coId.name,
      result: player.result,
      isViewer: player.id === playerId,
    })) ?? [];

  // Turn management + CO power aren't tied to a board tile, so they live in the HUD bar (every other
  // action is a pixi menu on the board). Both reset any in-progress board interaction first.
  const handleActivatePower = (isSuper: boolean) => {
    resetInteractionRef.current();
    dispatchQueue({
      type: "enqueue",
      clientId: makeClientId(),
      kind: "coPower",
      action: { type: "coPower", isSuper },
    });
  };

  const handlePassTurn = () => {
    resetInteractionRef.current();
    actionMutation.mutate(
      { type: "passTurn", playerId, matchId },
      { onError: onActionError("pass turn") },
    );
  };

  const powerPending = queue.actions.some(
    (action) => action.kind === "coPower" && action.status !== "rejected",
  );

  // Map size (tiles) drives the shell's adaptive layout; 0 until the view lands (board stays mounted).
  const mapWidth = optimisticView?.map.tiles[0]?.length ?? 0;
  const mapHeight = optimisticView?.map.tiles.length ?? 0;

  return (
    <>
      <GameShell
        mapWidth={mapWidth}
        mapHeight={mapHeight}
        overlay={() =>
          optimisticView === undefined ? null : (
            <IntelOverlay view={optimisticView} playerId={playerId} />
          )
        }
        chat={() =>
          optimisticView === undefined ? null : (
            <MatchChat
              matchId={matchId}
              playerId={playerId}
              players={optimisticView.players.map((player) => ({
                id: player.id,
                name: player.name,
              }))}
            />
          )
        }
        hud={(orientation, controls) =>
          optimisticView === undefined || spriteSheets === undefined ? null : (
            <MatchHud
              orientation={orientation}
              controls={controls}
              view={optimisticView}
              snapshot={snapshot}
              playerId={playerId}
              isMyTurn={isMyTurn}
              queue={queue}
              gameOver={gameOver}
              powerPending={powerPending}
              onActivatePower={handleActivatePower}
              onPassTurn={handlePassTurn}
            />
          )
        }
        board={
          // pixi appends its own canvas here (created once, StrictMode-safe); the loading state and the
          // game-over banner overlay it. This node is always mounted so the canvas ref stays attached.
          <div className="@relative" style={{ imageRendering: "pixelated" }}>
            <div ref={containerRef} />
            <AmbushLabel notice={trapNotice} />
            {attackFocus !== null && (
              <CombatForecastCard
                targetPosition={attackFocus.targetPosition}
                forecast={forecastQuery.data}
              />
            )}
            {inspectPos !== null && (
              <UnitDetailCard
                position={inspectPos}
                army={inspectArmy}
                details={detailsQuery.data}
                onClose={() => {
                  setInspect(null);
                  inspectHighlightRef.current([], []); // also wipe the range overlay it was showing
                }}
              />
            )}
            {(optimisticView === undefined || spriteSheets === undefined) && (
              <div className="@absolute @inset-0 @flex @items-center @justify-center @text-slate-400">
                Loading v2 board…
              </div>
            )}
            {phase === "moment" && gameOver !== null && (
              <GameOverOverlay
                gameOver={gameOver}
                cos={gameOverCos}
                secondsLeft={secondsLeft}
                onContinue={skip}
              />
            )}
          </div>
        }
      />
      {phase === "endgame" && outcome !== null && (
        <EndGameScreen
          matchId={matchId}
          outcome={outcome}
          players={endGamePlayers}
          onBackToLobby={() => void router.push("/your-matches")}
        />
      )}
    </>
  );
}
