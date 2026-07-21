"use client";
import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import {
  getArmyForSlot,
  getCurrentTurnPlayer,
  getPlayerById,
  getUnitAt,
  samePosition,
} from "frontend/components/match/match-view";
import { inspectHighlights, type InspectMode } from "frontend/components/match/inspect-highlights";
import { AmbushLabel } from "frontend/components/match/hud/AmbushLabel";
import { CombatForecastCard } from "frontend/components/match/hud/CombatForecastCard";
import { EndGameScreen } from "frontend/components/match/hud/EndGameScreen";
import { GameOverOverlay } from "frontend/components/match/hud/GameOverOverlay";
import { readParticleEffect } from "frontend/components/match/hud/particle-effects";
import { readAnimationScope, shouldAnimate } from "frontend/components/match/animation-scope";
import { GameShell } from "frontend/components/match/hud/GameShell";
import { usePlayers } from "frontend/context/players";
import { useEndGameFlow } from "frontend/components/match/useEndGameFlow";
import { IntelOverlay } from "frontend/components/match/hud/IntelOverlay";
import { MatchChat } from "frontend/components/match/hud/MatchChat";
import { DevToolsPanel } from "frontend/components/match/hud/DevToolsPanel";
import { MatchHud } from "frontend/components/match/hud/MatchHud";
import { BoardContextMenu } from "frontend/components/match/hud/BoardContextMenu";
import { DeleteModeBanner } from "frontend/components/match/hud/DeleteModeBanner";
import { TeleportModeBanner } from "frontend/components/match/hud/TeleportModeBanner";
import { DevDeleteModeBanner } from "frontend/components/match/hud/DevDeleteModeBanner";
import { SurrenderConfirm } from "frontend/components/match/hud/SurrenderConfirm";
import { UnitDetailCard } from "frontend/components/match/hud/UnitDetailCard";
import { TurnStartBanner } from "frontend/components/match/hud/TurnStartBanner";
import { PowerActivationSplash } from "frontend/components/match/hud/PowerActivationSplash";
import { usePowerAnimation } from "frontend/components/match/usePowerAnimation";
import type { TurnSnapshot } from "frontend/components/match/turn-snapshot-view";
import type { UnloadDrop } from "frontend/components/match/turn-snapshot-view";
import { useMatchBoard } from "frontend/components/match/useMatchBoard";
import { useTurnBanner } from "frontend/components/match/useTurnBanner";
import { hasUnresolvedActions, makeClientId, optimisticActions } from "frontend/utils/action-queue";
import { trpc } from "frontend/utils/trpc-client";
import type { Army } from "frontend/utils/sprites";
import { useRouter } from "next/router";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import type { AttackForecastFocus } from "../../pixi/v2/board-controller";
import { mountBoardScene } from "../../pixi/v2/board-scene";
import type { PowerLaunchPulse } from "../../pixi/v2/render-power-effects";
import type { Container } from "pixi.js";
import { Application, Assets } from "pixi.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { renderMultiplier } from "frontend/components/match/render-constants";

// Hold the on-board power set-piece until the CO splash cinematic has essentially finished (its scrim
// is gone by ~3.2s — see powerSplash.scss / usePowerAnimation), so the board effect isn't dimmed by it.
const POWER_BOARD_DELAY_MS = 3300;

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
  // The one-shot start-of-turn upkeep flourish on the ticker (self-removes when it finishes).
  const turnStartAnimRef = useRef<((delta: number) => void) | null>(null);
  // The one-shot fuel-out crash flourish on the ticker (self-removes when it finishes).
  const crashAnimRef = useRef<((delta: number) => void) | null>(null);
  // The persistent "under power" aura tick, and the one-shot CO-power launch-blink flourish tick.
  const powerAuraAnimRef = useRef<((delta: number) => void) | null>(null);
  const powerLaunchAnimRef = useRef<((delta: number) => void) | null>(null);
  // Every in-flight unit-move slide on the ticker (an array — simultaneous moves animate at once).
  const moveAnimRef = useRef<((delta: number) => void)[]>([]);
  // Persistent overlay + bookkeeping for move slides, so a slide survives the stage rebuilds that
  // happen mid-move (see board-scene). Kept across renders; created lazily by the scene.
  const moveLayerRef = useRef<Container | null>(null);
  const activeSlideDestsRef = useRef<Set<string>>(new Set());
  const unitsContainerRef = useRef<Container | null>(null);
  // The live map container, so the capture flourish can sink/raise the property sprite it acts on.
  const mapContainerRef = useRef<Container | null>(null);
  // clientIds of buffered moves already animated, so a move slides once and not again on each
  // within-turn rebuild. Cleared when the turn changes (tracked below) to stay bounded.
  const animatedMovesRef = useRef<Set<string>>(new Set());
  const animatedMovesTurnRef = useRef<number | null>(null);
  // clientIds of buffered captures already turned into a flourish, so an own capture animates once and
  // not again on each within-turn rebuild. Cleared on turn change alongside `animatedMovesRef`.
  const animatedCapturesRef = useRef<Set<string>>(new Set());
  // The last authoritative fetch (react-query `dataUpdatedAt`) whose opponent moves we drained, so a
  // batch of live opponent moves animates exactly once — on the rebuild that reflects it, not on
  // every within-fetch re-render.
  const drainedMoveFetchRef = useRef<number | null>(null);
  // The last `turn:actingPlayerId` we already played the start-of-turn flourish for, so it fires once
  // per player-turn rather than on every within-turn refetch/rebuild (the scene rebuilds on each
  // optimistic view change). Keyed on the player too — like the banner — because `view.turn` is a day
  // counter shared by both players in a round, so a bare turn value aliases the two turns together.
  const sparkledTurnRef = useRef<string | null>(null);
  // Same, for the fuel-out crash flourish. Tracked separately: crashes are reported to BOTH players
  // (a unit going down is public), so this fires on turns where `turnStart` is null for the viewer.
  // The player-keyed value is essential here: both sides' crashes can share one `view.turn`, so a
  // bare-turn gate would let the first-observed crash suppress the other player's on the same day.
  const crashedTurnRef = useRef<string | null>(null);
  // The viewer's AWDS-style animation setting, gating the one-shot flourishes below.
  const { currentPlayer } = usePlayers();
  const animationScope = readAnimationScope(currentPlayer?.preferences);
  // The last CO-power activation (playerId:timesPowerUsed) we already SCHEDULED the board flourish for,
  // so we arm its delayed timer once per activation, not on every within-turn refetch/rebuild.
  const powerPlayedRef = useRef<string | null>(null);
  // The delayed board flourish, armed by the timer once the splash has played: the pulse to draw, a
  // nonce that bumps when it becomes ready, the last nonce actually played, and the pending timer.
  const armedPulseRef = useRef<PowerLaunchPulse | null>(null);
  const [armedPulseNonce, setArmedPulseNonce] = useState(0);
  const lastPlayedPulseNonceRef = useRef(0);
  const powerDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Delete mode is mirrored into a ref because the pixi click handler reads it lazily, long after the
  // scene mounted — the React state below is what renders the mode's banner and the menu's toggle.
  const deleteModeRef = useRef(false);
  // Dev teleport mode — see `BoardSceneRefs.teleportModeRef`. A ref for the pixi click handler, plus
  // state below for the banner; `setTeleportMode` writes both so the two can't drift (as deleteMode).
  const teleportModeRef = useRef<{ from: BoardPosition | null } | null>(null);
  // Dev delete mode — see `BoardSceneRefs.devDeleteModeRef`. Distinct from scrap mode: reaches ANY
  // unit, enemies included.
  const devDeleteModeRef = useRef(false);

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
    systemLog,
    opponentMovePathsRef,
    destroyedPositionsRef,
    capturePositionsRef,
  } = useMatchBoard({ matchId, playerId });

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

  // CO-power activation cinematic (both players see it — activation is public in AW). The report and
  // the activating army come from `match.full`; the hook fires the splash once per activation.
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

  // Arm the on-board set-piece to play AFTER the splash: on a new activation, map it to the pixi pulse
  // and schedule a timer; when the timer fires it stores the pulse and bumps the nonce, which the scene
  // effect below plays exactly once. Gated on the activation key so a within-turn refetch can't re-arm.
  useEffect(() => {
    if (powerActivation === null) {
      return;
    }

    const key = `${powerActivation.playerId}:${powerActivation.timesPowerUsed}`;

    if (powerPlayedRef.current === key) {
      return;
    }

    powerPlayedRef.current = key;

    const pulse: PowerLaunchPulse = {
      affectedUnits: powerActivation.affectedUnits.map((affected) => ({
        position: [affected.position[0], affected.position[1]] as BoardPosition,
        kind: affected.kind,
      })),
      signature:
        powerActivation.signature === null
          ? null
          : {
              kind: powerActivation.signature.kind,
              epicenters: powerActivation.signature.epicenters.map(
                (epicenter): BoardPosition => [epicenter[0], epicenter[1]],
              ),
            },
    };

    // Drop any still-pending timer from a previous activation before scheduling this one: a second
    // power within POWER_BOARD_DELAY_MS would otherwise leave the first timer to fire on its own (a
    // double pulse, or a setState into a torn-down scene). One pending timer at a time.
    if (powerDelayTimerRef.current !== null) {
      clearTimeout(powerDelayTimerRef.current);
    }

    powerDelayTimerRef.current = setTimeout(() => {
      armedPulseRef.current = pulse;
      setArmedPulseNonce((nonce) => nonce + 1);
    }, POWER_BOARD_DELAY_MS);
  }, [powerActivation]);

  // Clear a pending board-flourish timer on unmount so it can't fire into a torn-down scene.
  useEffect(
    () => () => {
      if (powerDelayTimerRef.current !== null) {
        clearTimeout(powerDelayTimerRef.current);
      }
    },
    [],
  );

  // HUD overlays fed by board events: the engagement being eyed (floating combat-forecast box) and
  // the right-clicked unit being inspected (unit-detail card). The pixi controller sets these via the
  // callbacks passed into `mountBoardScene`; the queries below fetch the BE data to render.
  const [attackFocus, setAttackFocus] = useState<AttackForecastFocus | null>(null);
  // The inspected unit + which overlay it shows: `full` (movement, plus attack reach for a direct
  // unit) on the first right-click, `direct` (in-place attack only) on the second.
  const [inspect, setInspect] = useState<{ pos: BoardPosition; mode: InspectMode } | null>(null);
  const inspectPos = inspect?.pos ?? null;

  // Right-clicking the SAME unit rolls full -> direct -> off, so repeated right-clicks cycle the
  // views and then dismiss — right-click stays its own way out, without reaching for the left button.
  // A right-click on a different unit starts that unit's roll at `full`; null clears outright.
  const handleInspect = useCallback((pos: BoardPosition | null) => {
    if (pos === null) {
      setInspect(null);

      return;
    }

    setInspect((prev) => {
      if (prev === null || !samePosition(prev.pos, pos)) {
        return { pos, mode: "full" };
      }

      return prev.mode === "full" ? { pos, mode: "direct" } : null;
    });
  }, []);

  // The tile the board context menu is anchored at (right-click on an empty tile), or null when shut.
  const [contextMenu, setContextMenu] = useState<BoardPosition | null>(null);
  const [surrenderOpen, setSurrenderOpen] = useState(false);

  // Whether the dev-tools panel is open. Opened from the board context menu (right-click an empty
  // tile), so it needs no board target — and stays open independently of the menu that launched it.
  const [devToolsOpen, setDevToolsOpen] = useState(false);

  // "May I use dev tools in THIS match?" — a plain boolean from the BE, which owns the decision
  // (capability + ranked/testing-tools gate). The board never reasons about roles. This only hides
  // the entry; the mutation re-checks regardless, so a stale `true` costs a 403, not a cheat.
  const devToolsAvailability = trpc.match.devTools.availability.useQuery({ matchId, playerId });

  // Teleport submits straight to the dev endpoint rather than through the action queue: the queue
  // carries MainActions and models them optimistically, and a dev action is neither. The board
  // repaints from the authoritative `devTool` websocket event, like any other player's action.
  const sendDevTool = trpc.match.devTools.send.useMutation();

  // Delete mode: on until the player turns it off, so several units can be scrapped in a row. Kept in
  // both state (for rendering) and a ref (for the pixi click handler) — `setDeleteMode` writes both so
  // the two can't drift.
  const [deleteMode, setDeleteModeState] = useState(false);
  const setDeleteMode = useCallback((active: boolean) => {
    deleteModeRef.current = active;
    setDeleteModeState(active);
  }, []);

  // Dev teleport mode, same ref+state pairing as scrap mode above. Unlike scrap, it is NOT disarmed
  // when the turn changes: teleport is a staff tool that works off-turn by design.
  const [teleportMode, setTeleportModeState] = useState<{ from: BoardPosition | null } | null>(
    null,
  );
  const setTeleportMode = useCallback((mode: { from: BoardPosition | null } | null) => {
    teleportModeRef.current = mode;
    setTeleportModeState(mode);
  }, []);

  // Dev delete mode, same ref+state pairing. Stays armed so several units can go in a row, and — like
  // teleport — is NOT disarmed on turn change, since it works off-turn by design.
  const [devDeleteMode, setDevDeleteModeState] = useState(false);
  const setDevDeleteMode = useCallback((active: boolean) => {
    devDeleteModeRef.current = active;
    setDevDeleteModeState(active);
  }, []);

  // Disarm scrap mode the moment the turn stops being yours. A destructive mode must not outlive the
  // turn it was armed in: left on, the first click of your NEXT turn would disband a unit instead of
  // selecting it. Also covers the match ending while the mode is up.
  useEffect(() => {
    if (!isMyTurn) {
      setDeleteMode(false);
    }
  }, [isMyTurn, setDeleteMode]);

  // A finished match ends ALL dev modes. Their banners already hide on game-over, but the armed refs
  // and the pixi click handlers would otherwise survive — a post-finish click would still fire a
  // teleport / delete against a match the server can only reject.
  useEffect(() => {
    if ((optimisticView?.gameOver ?? null) !== null) {
      setDeleteMode(false);
      setTeleportMode(null);
      setDevDeleteMode(false);
    }
  }, [optimisticView?.gameOver, setDeleteMode, setTeleportMode, setDevDeleteMode]);

  const toTuple = (position: BoardPosition): [number, number] => [position[0], position[1]];

  // Surrender is NOT buffered through the action queue. The queue exists to keep a turn's intent
  // moving over a flaky link, replaying it against the BE; conceding isn't intent to be replayed —
  // it's a decision that ends the match at once. So it's a plain mutation, and the WS `matchEnd` the
  // BE pushes is what flips the board to its result screen.
  const surrenderMutation = trpc.action.surrender.useMutation({
    onError: onActionError("surrender"),
    onSettled: () => setSurrenderOpen(false),
  });

  // BE combat forecast for the focused engagement — min/max damage both ways + defense stars. Only
  // runs while a target is focused; the disabled-state input is a harmless placeholder.
  const forecastQuery = trpc.match.previews.combatForecast.useQuery(
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
  const detailsQuery = trpc.match.previews.unitDetails.useQuery(
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

  // Army owning the TERRAIN under the inspected unit, so the card can draw the tile in its owner's
  // colours. Distinct from `inspectArmy`: a unit routinely stands on someone else's property, and an
  // unowned tile (playerSlot null or the neutral -1) has no army at all.
  const terrainSlot = detailsQuery.data?.terrain.playerSlot ?? null;
  const inspectTerrainArmy =
    terrainSlot !== null && terrainSlot !== -1 && optimisticView !== undefined
      ? (getArmyForSlot(optimisticView, terrainSlot) as Army | undefined)
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

    // Gate the start-of-turn flourish to the FIRST render of a new turn: the BE sends `turnStart`
    // (own units only, fog-safe) for the whole turn, but the scene rebuilds on every action, so we
    // fire the pulse once per turn value and then suppress it until the next turn.
    const report = view.turnStart;
    const turnStartKey = report !== null ? `${view.turn}:${report.playerId}` : null;
    const turnStartPulse =
      report !== null &&
      sparkledTurnRef.current !== turnStartKey &&
      shouldAnimate(animationScope, report.playerId, playerId)
        ? { repaired: report.repaired.map((entry) => entry.position), refuelled: report.refuelled }
        : undefined;

    if (turnStartPulse !== undefined) {
      sparkledTurnRef.current = turnStartKey;
    }

    // Same one-per-turn gate for the fuel-out crashes, on its own ref: `crashes` is sent to BOTH
    // players (fog-masked), so it fires on turns where `turnStart` is null for this viewer. The
    // animation setting keys off whose units went down, so "own units only" stays quiet for the
    // opponent's losses.
    const crashReport = view.crashes;
    const crashKey = crashReport !== null ? `${view.turn}:${crashReport.playerId}` : null;
    const crashPulse =
      crashReport !== null &&
      crashReport.positions.length > 0 &&
      crashedTurnRef.current !== crashKey &&
      shouldAnimate(animationScope, crashReport.playerId, playerId)
        ? { positions: crashReport.positions.map((p): BoardPosition => [p[0], p[1]]) }
        : undefined;

    if (crashPulse !== undefined) {
      crashedTurnRef.current = crashKey;
    }

    // The board flourish is armed by a delayed timer (so it plays AFTER the splash). Play it on the
    // first render that observes a fresh nonce, then mark that nonce so later rebuilds don't replay it.
    const armedReady =
      armedPulseNonce !== lastPlayedPulseNonceRef.current && armedPulseRef.current !== null;
    const powerLaunchPulse = armedReady ? (armedPulseRef.current ?? undefined) : undefined;

    if (armedReady) {
      lastPlayedPulseNonceRef.current = armedPulseNonce;
    }

    // Slide just-moved units along their path instead of teleporting. A buffered move animates once
    // (tracked by clientId); the set is cleared on a turn change so it stays bounded and a re-used
    // clientId can't be suppressed across turns. Own moves are the acting player's, so the animation
    // gate keys off the viewer as both actor and audience.
    if (animatedMovesTurnRef.current !== view.turn) {
      animatedMovesRef.current.clear();
      animatedCapturesRef.current.clear();
      animatedMovesTurnRef.current = view.turn;
    }

    const movePulses: { path: readonly BoardPosition[] }[] = [];
    const capturePulses: { position: BoardPosition; completed: boolean; full: boolean }[] = [];

    if (shouldAnimate(animationScope, playerId, playerId)) {
      for (const queued of optimisticActions(queue)) {
        // Key off the ACTION being a travelling move, not its queue `kind`: a move that ends in an
        // attack/capture/ability is still `{ type: "move", path, subAction }` but buffered under the
        // `attack`/`ability`/… kind — the unit walks the path either way, so it must animate too.
        if (
          queued.action.type !== "move" ||
          queued.action.path.length < 2 ||
          animatedMovesRef.current.has(queued.clientId)
        ) {
          continue;
        }

        animatedMovesRef.current.add(queued.clientId);
        movePulses.push({ path: queued.action.path });
      }
    }

    // Own captures — driven from the BUFFER (not the WS ability event) so the flourish shares the move
    // slide's clock: both are created in THIS rebuild, so `board-scene` can hold the capture until the
    // slide lands deterministically (the event-driven path raced two clocks and mistimed the hop).
    // Completion is known optimistically from the snapshot's capture rate — the same tick
    // `optimistic-view` applies. `full` plays the hop + building sink; a "none" scope keeps just the
    // chevrons as the no-animation indicator.
    {
      const ownFull = shouldAnimate(animationScope, playerId, playerId);

      for (const queued of optimisticActions(queue)) {
        if (queued.kind !== "capture" || queued.action.type !== "move") {
          continue;
        }

        if (animatedCapturesRef.current.has(queued.clientId)) {
          continue;
        }

        animatedCapturesRef.current.add(queued.clientId);

        const path = queued.action.path;
        const from = path[0];
        const snapshotUnit = snapshot?.units.find((unit) => samePosition(unit.position, from));
        const current = snapshotUnit?.currentCapturePoints ?? 20;
        const rate = snapshotUnit?.captureRate ?? 0;

        capturePulses.push({
          position: path[path.length - 1],
          completed: Math.max(0, current - rate) === 0,
          full: ownFull,
        });
      }
    }

    // Opponent moves + unit destructions seen live: drain what accumulated since the last authoritative
    // fetch. Keyed on `dataUpdatedAt` so a batch that arrived together animates once, on the rebuild
    // that reflects it. The refs are always cleared so suppressed entries can't pile up.
    const deathPulses: BoardPosition[] = [];

    if (drainedMoveFetchRef.current !== matchQuery.dataUpdatedAt) {
      drainedMoveFetchRef.current = matchQuery.dataUpdatedAt;

      // Opponent moves are gated by the acting player, so "own units only" keeps the opponent's still
      // while still showing the viewer's own (actor === viewer -> shouldAnimate own).
      const actorAnimates =
        actingPlayer !== undefined && shouldAnimate(animationScope, actingPlayer.id, playerId);

      if (actorAnimates) {
        for (const path of opponentMovePathsRef.current) {
          movePulses.push({ path });
        }
      }

      // Opponent captures (own ones come from the buffer above). Only infantry/mech capture, so an
      // accumulated ability position is a real capture iff the unit now there is one of those;
      // `currentCapturePoints` still set -> in progress, gone -> the tick that finished it. Anything
      // else (apc supply, etc.) is discarded. `full` (the AW hop + building sink) plays when the actor
      // animates; a "none" scope keeps just the chevron/flash indicator.
      if (actorAnimates || animationScope === "none") {
        for (const position of capturePositionsRef.current) {
          const unit = getUnitAt(view, position);

          if (unit === undefined || (unit.type !== "infantry" && unit.type !== "mech")) {
            continue;
          }

          const stillCapturing =
            "currentCapturePoints" in unit && unit.currentCapturePoints !== undefined;
          capturePulses.push({ position, completed: !stillCapturing, full: actorAnimates });
        }
      }

      // A destruction is a public event either player caused, so it plays unless animations are off
      // entirely — mirroring how the fuel-out crash flourish is shown to both sides.
      if (animationScope !== "none") {
        for (const position of destroyedPositionsRef.current) {
          deathPulses.push(position);
        }
      }

      opponentMovePathsRef.current = [];
      destroyedPositionsRef.current = [];
      capturePositionsRef.current = [];
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
        turnStartAnimRef,
        crashAnimRef,
        powerAuraAnimRef,
        powerLaunchAnimRef,
        moveAnimRef,
        moveLayerRef,
        activeSlideDestsRef,
        unitsContainerRef,
        mapContainerRef,
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
        deleteModeRef,
        teleportModeRef,
        devDeleteModeRef,
      },
      turnStartPulse,
      crashPulse,
      powerLaunchPulse,
      movePulses,
      deathPulses,
      capturePulses,
      onAttackTargetFocus: setAttackFocus,
      onUnitInspect: handleInspect,
      onContextMenu: setContextMenu,
      onTeleportPick: (from) => setTeleportMode(from === null ? null : { from }),
      onDevTeleport: (from, to) => {
        setTeleportMode(null);
        sendDevTool.mutate({
          matchId,
          playerId,
          type: "teleportUnit",
          from: [from[0], from[1]],
          to: [to[0], to[1]],
        });
      },
      onDevDeleteUnit: (position) => {
        // Mode stays armed — several units in a row, as with scrap mode.
        sendDevTool.mutate({
          matchId,
          playerId,
          type: "deleteAnyUnit",
          position: [position[0], position[1]],
        });
      },
    });
    // `dataUpdatedAt` is in the deps because the drain above keys on it: without it the effect would
    // rely on `optimisticView` getting a fresh identity every fetch, and a reference-stable refetch
    // would skip the drain and stall opponent animations until the next rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimisticView, spriteSheets, armedPulseNonce, matchQuery.dataUpdatedAt]);

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
            /* Mirrors the HUD column opposite: pinned to the TOP of the screen, chat pushed to the
               bottom. `h-full` + `mt-auto` rather than `justify-between` on GameShell's column, which
               is `justify-end` — the chat must stay at the bottom whether or not the panel is open,
               and `justify-between` would float it upwards on its own. */
            <div className="@flex @h-full @flex-col">
              {devToolsOpen && (
                <DevToolsPanel
                  matchId={matchId}
                  playerId={playerId}
                  teleportMode={teleportMode !== null}
                  onToggleTeleportMode={() => {
                    // The modes are mutually exclusive: the click handler checks scrap, then
                    // dev-delete, then teleport, so leaving two armed would silently give one
                    // priority. Disarm the siblings rather than let a click mean two things.
                    setDeleteMode(false);
                    setDevDeleteMode(false);
                    // Arm with no unit picked yet; toggling while armed cancels.
                    setTeleportMode(teleportMode === null ? { from: null } : null);
                  }}
                  devDeleteMode={devDeleteMode}
                  onToggleDevDeleteMode={() => {
                    setDeleteMode(false);
                    setTeleportMode(null);
                    setDevDeleteMode(!devDeleteMode);
                  }}
                  sheets={spritesheetDataByArmy}
                  army={
                    // The acting player's own colours for the picker sprites; undefined -> name
                    // fallback. Cosmetic only, so the loose lookup is fine here (unlike the slot the
                    // tools act on, which the server states).
                    ((): Army | undefined => {
                      const me = optimisticView.players.find((player) => player.id === playerId);

                      return me === undefined
                        ? undefined
                        : (getArmyForSlot(optimisticView, me.slot) as Army | undefined);
                    })()
                  }
                  onClose={() => setDevToolsOpen(false)}
                />
              )}
              <div className="@mt-auto">
                <MatchChat
                  matchId={matchId}
                  playerId={playerId}
                  players={optimisticView.players.map((player) => ({
                    id: player.id,
                    name: player.name,
                  }))}
                  systemLines={systemLog}
                />
              </div>
            </div>
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
            {deleteMode && gameOver === null && (
              <DeleteModeBanner onExit={() => setDeleteMode(false)} />
            )}
            {teleportMode !== null && gameOver === null && (
              <TeleportModeBanner
                hasPickedUnit={teleportMode.from !== null}
                onExit={() => setTeleportMode(null)}
              />
            )}
            {devDeleteMode && gameOver === null && (
              <DevDeleteModeBanner onExit={() => setDevDeleteMode(false)} />
            )}
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
                spritesheetDataByArmy={spritesheetDataByArmy}
                terrainArmy={inspectTerrainArmy}
                onClose={() => {
                  setInspect(null);
                  inspectHighlightRef.current([], []); // also wipe the range overlay it was showing
                }}
              />
            )}
            {contextMenu !== null && gameOver === null && (
              <BoardContextMenu
                position={contextMenu}
                mapWidthInTiles={mapWidth}
                isMyTurn={isMyTurn}
                power={snapshot?.power ?? null}
                powerPending={powerPending}
                canPassTurn={isMyTurn && !hasUnresolvedActions(queue)}
                deleteMode={deleteMode}
                onToggleDeleteMode={() => {
                  // Same mutual exclusion as the dev modes below — one armed mode at a time.
                  setTeleportMode(null);
                  setDevDeleteMode(false);
                  setDeleteMode(!deleteMode);
                }}
                onActivatePower={(isSuper) => {
                  setContextMenu(null);
                  handleActivatePower(isSuper);
                }}
                onPassTurn={() => {
                  setContextMenu(null);
                  handlePassTurn();
                }}
                onSurrender={() => {
                  setContextMenu(null);
                  setSurrenderOpen(true);
                }}
                devToolsEnabled={devToolsAvailability.data?.enabled ?? false}
                onOpenDevTools={() => {
                  setContextMenu(null);
                  setDevToolsOpen(true);
                }}
                onClose={() => setContextMenu(null)}
              />
            )}
            {surrenderOpen && (
              <SurrenderConfirm
                pending={surrenderMutation.isLoading}
                onConfirm={() => surrenderMutation.mutate({ matchId, playerId })}
                onCancel={() => setSurrenderOpen(false)}
              />
            )}
            {(optimisticView === undefined || spriteSheets === undefined) && (
              <div className="@absolute @inset-0 @flex @items-center @justify-center @text-slate-400">
                Loading v2 board…
              </div>
            )}
            {turnBanner !== null && gameOver === null && (
              // key on the nonce so each turn-start REMOUNTS the banner — the CSS entrance animation
              // (fill-mode both, ending at opacity 0) only replays on a fresh mount, so without this a
              // turn arriving before the 3s auto-dismiss leaves the banner stuck invisible.
              <TurnStartBanner key={turnBanner.nonce} {...turnBanner} />
            )}
            {powerSplash !== null && gameOver === null && (
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
                cos={gameOverCos}
                particleEffect={readParticleEffect(currentPlayer?.preferences)}
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
          onBackToLobby={() => void router.push("/your-games")}
        />
      )}
    </>
  );
}
