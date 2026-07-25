"use client";
import { readAnimationScope } from "frontend/components/match/animation-scope";
import { toEndGamePlayers, toGameOverCos, toOutcome } from "frontend/components/match/endgame-view";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition } from "frontend/components/match/match-view";
import { getCurrentTurnPlayer, getPlayerById, toTuple } from "frontend/components/match/match-view";
import { AmbushLabel } from "frontend/components/match/hud/AmbushLabel";
import { BoardCommandMenu } from "frontend/components/match/hud/BoardCommandMenu";
import { BoardInspectOverlays } from "frontend/components/match/hud/BoardInspectOverlays";
import { BoardModeBanners } from "frontend/components/match/hud/BoardModeBanners";
import { EndGameScreen } from "frontend/components/match/hud/EndGameScreen";
import { GameOverOverlay } from "frontend/components/match/hud/GameOverOverlay";
import { GameShell } from "frontend/components/match/hud/GameShell";
import { IntelOverlay } from "frontend/components/match/hud/IntelOverlay";
import { MatchHud } from "frontend/components/match/hud/MatchHud";
import { MatchSideColumn } from "frontend/components/match/hud/MatchSideColumn";
import { readParticleEffect } from "frontend/components/match/hud/particle-effects";
import { PowerActivationSplash } from "frontend/components/match/hud/PowerActivationSplash";
import { TurnStartBanner } from "frontend/components/match/hud/TurnStartBanner";
import { useAttackForecast } from "frontend/components/match/useAttackForecast";
import { useBoardModes } from "frontend/components/match/useBoardModes";
import { useBoardScene } from "./match-board/useBoardScene";
import { useEndGameFlow } from "frontend/components/match/useEndGameFlow";
import { useMatchBoard } from "frontend/components/match/useMatchBoard";
import { usePowerAnimation } from "frontend/components/match/usePowerAnimation";
import { usePowerBoardPulse } from "frontend/components/match/usePowerBoardPulse";
import { useSpriteSheets } from "./match-board/useSpriteSheets";
import { useTurnBanner } from "frontend/components/match/useTurnBanner";
import { useUnitInspect } from "frontend/components/match/useUnitInspect";
import { usePlayers } from "frontend/context/players";
import { hasUnresolvedActions, makeClientId } from "frontend/utils/action-queue";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";
import { useState } from "react";

type Props = {
  matchId: string;
  playerId: string;
  spritesheetDataByArmy: SpritesheetDataByArmy;
};

/**
 * The match board — snapshot-driven and server-authoritative. Renders from the plain `match.full`
 * data and drives actions off the BE turn-snapshot + preview endpoints: NO client engine, NO rules
 * geometry. Selection is a plain position; reachable tiles and the move path come from the snapshot,
 * attack targets from the `attackTargets` endpoint. Any event triggers a refetch, so the client
 * can't desync.
 *
 * Interaction: select a unit (blue reachable tiles), click a reachable tile to stage a move there,
 * then pick from an in-board contextual menu (ATTACK / CAPTURE / WAIT). ATTACK reveals red enemies
 * to click; a facility opens a build menu of its affordable units. Only turn management lives in the
 * top bar — every other action is a pixi menu anchored at the tile.
 *
 * Actions are buffered optimistically (see `action-queue` + `optimistic-view`): move/capture/
 * production show instantly as presentation deltas while the queue drains one action at a time and
 * reconciles against the BE's authoritative refetch. Attacks are BE-resolved and serialize on each
 * other (an unresolved attack blocks the next). Combat is never previewed on the client.
 *
 * This component is composition only. The work lives in focused hooks: `useMatchBoard` (data +
 * action buffer), `useBoardScene` (pixi app, scene refs, stage rebuilds), `useBoardModes` (the
 * mutually-exclusive armed modes), `useUnitInspect` / `useAttackForecast` (the board's BE-fed
 * readouts) and `usePowerBoardPulse` / `useTurnBanner` / `useEndGameFlow` (cinematic sequencing).
 */
export function MatchBoardV2({ matchId, playerId, spritesheetDataByArmy }: Props) {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  // The viewer's AWDS-style animation setting, gating the board's one-shot flourishes.
  const animationScope = readAnimationScope(currentPlayer?.preferences);

  const spriteSheetQuery = useSpriteSheets(spritesheetDataByArmy);
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
    systemLog,
    opponentMovePathsRef,
    destroyedPositionsRef,
    capturePositionsRef,
  } = useMatchBoard({ matchId, playerId });

  // Match outcome (derived by the BE from player elimination); non-null => banner + no more actions.
  const gameOver = optimisticView?.gameOver ?? null;
  const isGameOver = gameOver !== null;

  // Start-of-turn banner: whose CO is up (both players), the day, and — on the viewer's own turn —
  // the upkeep summary. The acting player + their CO come from the current-turn flag on the view.
  const actingPlayer =
    optimisticView !== undefined ? getCurrentTurnPlayer(optimisticView) : undefined;
  const { banner: turnBanner } = useTurnBanner({
    turn: optimisticView?.turn,
    actingPlayerId: actingPlayer?.id,
    actingCoName: actingPlayer?.coId.name,
    actingArmy: actingPlayer?.army,
    viewerId: playerId,
    turnStart: optimisticView?.turnStart ?? null,
  });

  // CO-power activation cinematic (both players see it — activation is public in AW). The splash
  // plays first; `usePowerBoardPulse` holds the on-board set-piece until it has finished.
  const powerActivation = optimisticView?.powerActivation ?? null;
  const powerActivationArmy =
    powerActivation !== null && optimisticView !== undefined
      ? getPlayerById(optimisticView, powerActivation.playerId)?.army
      : undefined;
  const { splash: powerSplash } = usePowerAnimation({
    activation: powerActivation,
    army: powerActivationArmy,
    viewerId: playerId,
  });
  const powerPulse = usePowerBoardPulse(powerActivation);

  const modes = useBoardModes({ isMyTurn, isGameOver });

  // The tile the board context menu is anchored at (right-click on an empty tile), or null when shut.
  const [contextMenu, setContextMenu] = useState<BoardPosition | null>(null);

  // Whether the dev-tools panel is open. Opened from the board context menu (right-click an empty
  // tile), so it needs no board target — and stays open independently of the menu that launched it.
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  // "May I use dev tools in THIS match?" — a plain boolean from the BE, which owns the decision
  // (capability + ranked/testing-tools gate). The board never reasons about roles. This only hides
  // the entry; the mutation re-checks regardless, so a stale `true` costs a 403, not a cheat.
  const devToolsAvailability = trpc.match.devTools.availability.useQuery({ matchId, playerId });

  // Dev actions submit straight to the dev endpoint rather than through the action queue: the queue
  // carries MainActions and models them optimistically, and a dev action is neither. The board
  // repaints from the authoritative `devTool` websocket event, like any other player's action.
  const sendDevTool = trpc.match.devTools.send.useMutation();

  const forecast = useAttackForecast({ matchId, playerId });
  const inspect = useUnitInspect({ matchId, playerId, view: optimisticView });

  const board = useBoardScene({
    view: optimisticView,
    snapshot,
    spriteSheets,
    playerId,
    actingPlayerId: actingPlayer?.id,
    animationScope,
    queue,
    dispatchQueue,
    queueRefs: { queueRef, priceTableRef },
    modeRefs: modes.refs,
    dataUpdatedAt: matchQuery.dataUpdatedAt,
    live: {
      opponentMovePaths: opponentMovePathsRef,
      destroyedPositions: destroyedPositionsRef,
      capturePositions: capturePositionsRef,
    },
    inspectHighlightRef: inspect.highlightRef,
    powerPulse,
    onAttackTargetFocus: forecast.setFocus,
    onUnitInspect: inspect.handleInspect,
    onContextMenu: setContextMenu,
    onTeleportPick: modes.setTeleportSource,
    onDevTeleport: (from, to) => {
      modes.disarmAll();
      sendDevTool.mutate({
        matchId,
        playerId,
        type: "teleportUnit",
        from: toTuple(from),
        to: toTuple(to),
      });
    },
    onDevDeleteUnit: (position) => {
      // Mode stays armed — several units in a row, as with scrap mode.
      sendDevTool.mutate({ matchId, playerId, type: "deleteAnyUnit", position: toTuple(position) });
    },
  });

  // End-of-match screen sequencing: play the victory/defeat "moment", then auto-load the End-Game
  // screen (a reconnect to an already-finished match skips straight to it). Presentation only — the
  // outcome itself is the BE's.
  const { phase, secondsLeft, skip } = useEndGameFlow({
    over: isGameOver,
    ready: optimisticView !== undefined,
  });

  if (matchQuery.isError || spriteSheetQuery.isError) {
    return <p>error {":("}</p>;
  }

  // Turn management + CO power aren't tied to a board tile, so they live in the HUD bar (every other
  // action is a pixi menu on the board). Both reset any in-progress board interaction first.
  const handleActivatePower = (isSuper: boolean) => {
    board.resetInteraction();
    dispatchQueue({
      type: "enqueue",
      clientId: makeClientId(),
      kind: "coPower",
      action: { type: "coPower", isSuper },
    });
  };

  const handlePassTurn = () => {
    board.resetInteraction();
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
            <MatchSideColumn
              matchId={matchId}
              playerId={playerId}
              view={optimisticView}
              spritesheetDataByArmy={spritesheetDataByArmy}
              systemLines={systemLog}
              modes={modes.modes}
              onToggleTeleportMode={modes.toggleTeleport}
              onToggleDevDeleteMode={modes.toggleDevDelete}
              devToolsOpen={devToolsOpen}
              onCloseDevTools={() => setDevToolsOpen(false)}
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
          // pixi appends its own canvas here (created once, StrictMode-safe); the loading state and
          // the overlays below layer over it. This node is always mounted so the ref stays attached.
          <div className="@relative" style={{ imageRendering: "pixelated" }}>
            <div ref={board.containerRef} />
            <AmbushLabel notice={trapNotice} />
            <BoardModeBanners modes={modes.modes} hidden={isGameOver} onDisarm={modes.disarmAll} />
            <BoardInspectOverlays
              forecast={forecast}
              inspect={inspect}
              spritesheetDataByArmy={spritesheetDataByArmy}
            />
            <BoardCommandMenu
              matchId={matchId}
              playerId={playerId}
              position={contextMenu}
              isGameOver={isGameOver}
              mapWidthInTiles={mapWidth}
              isMyTurn={isMyTurn}
              power={snapshot?.power ?? null}
              powerPending={powerPending}
              canPassTurn={isMyTurn && !hasUnresolvedActions(queue)}
              scrapMode={modes.modes.scrap}
              onToggleScrapMode={modes.toggleScrap}
              onActivatePower={handleActivatePower}
              onPassTurn={handlePassTurn}
              devToolsEnabled={devToolsAvailability.data?.enabled ?? false}
              onOpenDevTools={() => setDevToolsOpen(true)}
              onClose={() => setContextMenu(null)}
              onSurrenderError={onActionError("surrender")}
            />
            {(optimisticView === undefined || spriteSheets === undefined) && (
              <div className="@absolute @inset-0 @flex @items-center @justify-center @text-slate-400">
                Loading board…
              </div>
            )}
            {turnBanner !== null && !isGameOver && (
              // key on the nonce so each turn-start REMOUNTS the banner — the CSS entrance animation
              // (fill-mode both, ending at opacity 0) only replays on a fresh mount, so without this a
              // turn arriving before the 3s auto-dismiss leaves the banner stuck invisible.
              <TurnStartBanner key={turnBanner.nonce} {...turnBanner} />
            )}
            {powerSplash !== null && !isGameOver && (
              <PowerActivationSplash
                coName={powerSplash.coName}
                army={powerSplash.army}
                isSuper={powerSplash.isSuper}
                powerName={powerSplash.powerName}
                isViewer={powerSplash.isViewer}
              />
            )}
            {phase === "moment" && gameOver !== null && (
              <GameOverOverlay
                gameOver={gameOver}
                cos={toGameOverCos(optimisticView, playerId)}
                particleEffect={readParticleEffect(currentPlayer?.preferences)}
                secondsLeft={secondsLeft}
                onContinue={skip}
              />
            )}
          </div>
        }
      />
      {phase === "endgame" && gameOver !== null && (
        <EndGameScreen
          matchId={matchId}
          outcome={toOutcome(gameOver)}
          players={toEndGamePlayers(optimisticView, playerId)}
          onBackToLobby={() => void router.push("/your-games")}
        />
      )}
    </>
  );
}
