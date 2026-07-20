import {
  baseTileSize,
  mapBorder,
  renderedTileSize,
} from "frontend/components/match/render-constants";
import { intentArrows, phantomPositions } from "frontend/components/match/buffered-intent";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import { getArmyForSlot, getUnitAt } from "frontend/components/match/match-view";
import type { TurnSnapshot, UnloadDrop } from "frontend/components/match/turn-snapshot-view";
import {
  optimisticActions,
  type ActionQueueEvent,
  type ActionQueueState,
} from "frontend/utils/action-queue";
import type { LoadedSpriteSheet } from "pixi/load-spritesheet";
import type { Application, Resource, Texture } from "pixi.js";
import { AnimatedSprite, Container, Sprite } from "pixi.js";
import type { Dispatch, MutableRefObject } from "react";
import { createBoardController, type AttackForecastFocus } from "./board-controller";
import {
  renderHighlightTiles,
  renderInteractiveTilesFromView,
  renderMapFromView,
  renderUnitsFromView,
} from "./render-from-view";
import { renderBufferedArrows, renderPathArrow, shimmerBufferedArrows } from "./render-path-arrow";
import { renderUnitMoveEffect, type MoveAnimationFrames } from "./render-unit-move";
import { renderUnitDestroyEffect } from "./render-unit-destroy";
import { renderCaptureEffect } from "./render-capture";
import { renderWeatherOverlay } from "./render-weather";
import { renderTurnStartEffect } from "./render-turn-start";
import { renderCrashEffect } from "./render-crash";
import {
  renderPoweredUnitPulse,
  renderPowerLaunchEffect,
  type PowerLaunchPulse,
} from "./render-power-effects";

// Movement reads as a neutral white plate, attack as a red one — same relief treatment, so the two
// are told apart by hue alone (see `renderHighlightTiles`). Green stays reserved for unload drops.
const REACHABLE_COLOR = "#ffffff";
const ATTACK_COLOR = "#e02424";
const UNLOAD_COLOR = "#3fb950";

/** Every ref the scene reads/writes, owned by `MatchBoardV2` and passed in so state survives re-renders. */
export type BoardSceneRefs = {
  reachableHighlightRef: MutableRefObject<Container | null>;
  attackHighlightRef: MutableRefObject<Container | null>;
  unloadHighlightRef: MutableRefObject<Container | null>;
  pathArrowRef: MutableRefObject<Container | null>;
  plannedPathRef: MutableRefObject<BoardPosition[]>;
  shimmerRef: MutableRefObject<((delta: number) => void) | null>;
  /** The active weather animation on the ticker, tracked so it's dropped before a stage rebuild. */
  weatherAnimRef: MutableRefObject<((delta: number) => void) | null>;
  /** The start-of-turn upkeep flourish on the ticker, if one is currently playing (self-removes). */
  turnStartAnimRef: MutableRefObject<((delta: number) => void) | null>;
  /** The one-shot fuel-out crash flourish on the ticker, if playing (self-removes). */
  crashAnimRef: MutableRefObject<((delta: number) => void) | null>;
  /** The persistent "under power" aura tick on the ticker while any unit is powered (dropped on rebuild). */
  powerAuraAnimRef: MutableRefObject<((delta: number) => void) | null>;
  /** The one-shot CO-power launch-blink flourish on the ticker, if playing (self-removes). */
  powerLaunchAnimRef: MutableRefObject<((delta: number) => void) | null>;
  /** Every in-flight unit-move slide on the ticker — an array since simultaneous moves play at once. */
  moveAnimRef: MutableRefObject<((delta: number) => void)[]>;
  /**
   * Persistent overlay holding in-flight slide sprites. Created once and NOT destroyed on a stage
   * rebuild, so a move slide runs to completion even though the board underneath is torn down and
   * rebuilt (the BE confirm/refetch rebuilds within ~100ms of an own move) — otherwise the slide would
   * be cut off almost immediately and read as an instant teleport.
   */
  moveLayerRef: MutableRefObject<Container | null>;
  /** Destination `"x-y"` keys with a slide in flight, so each rebuild re-hides those static sprites. */
  activeSlideDestsRef: MutableRefObject<Set<string>>;
  /** The latest units container, so a slide can reveal its destination sprite when it finishes. */
  unitsContainerRef: MutableRefObject<Container | null>;
  /** The latest map container, so the capture flourish can sink/raise the live property sprite. */
  mapContainerRef: MutableRefObject<Container | null>;
  selectionRef: MutableRefObject<BoardPosition | null>;
  stagedDestRef: MutableRefObject<BoardPosition | null>;
  attackTargetsRef: MutableRefObject<BoardPosition[]>;
  unloadDropsRef: MutableRefObject<UnloadDrop[]>;
  missileArmRef: MutableRefObject<{ path: readonly BoardPosition[] } | null>;
  resetInteractionRef: MutableRefObject<() => void>;
  // Lets React paint the inspect overlay's reachable/threat tiles (right-click preview) onto the
  // board — the same highlight layer the interaction uses, so the next board action clears it.
  inspectHighlightRef: MutableRefObject<
    (reachable: readonly BoardPosition[], attack: readonly BoardPosition[]) => void
  >;
  matchRef: MutableRefObject<MatchView | null>;
  snapshotRef: MutableRefObject<TurnSnapshot | null>;
  priceTableRef: MutableRefObject<TurnSnapshot["production"]["priceTable"]>;
  queueRef: MutableRefObject<ActionQueueState>;
  /**
   * Whether the board is in delete mode: every left-click on one of the viewer's own units scraps it,
   * and keeps doing so until the mode is turned off. A ref rather than a prop so toggling it doesn't
   * tear down and rebuild the pixi scene — the controller reads it lazily on each click.
   */
  deleteModeRef: MutableRefObject<boolean>;
  /**
   * Dev teleport mode: null = off; `{ from: null }` = armed, waiting for a unit; `{ from: pos }` =
   * unit picked, next click is the destination. A ref (not state) because the pixi click handler
   * reads it synchronously — same reasoning as `deleteModeRef`.
   */
  teleportModeRef: MutableRefObject<{ from: BoardPosition | null } | null>;
  /**
   * Dev delete mode. Distinct from `deleteModeRef` (scrap), which submits the normal `delete` action
   * and only reaches the viewer's OWN units — this one reaches ANY unit, enemies included, via the
   * dev endpoint. A ref for the same reason: the pixi click handler reads it synchronously.
   */
  devDeleteModeRef: MutableRefObject<boolean>;
};

/** The drawing surface `board-controller` uses to reflect interaction state onto the board. */
export type BoardRenderer = {
  drawHighlights: (
    reachable: readonly BoardPosition[],
    attack: readonly BoardPosition[],
    unload?: readonly BoardPosition[],
  ) => void;
  drawPathArrow: () => void;
  showMenu: (menu: Container) => void;
  closeMenu: () => void;
};

/** One unit's confirmed/buffered move to animate: the full tile path it travelled. */
export type MovePulse = { path: readonly BoardPosition[] };

export type MountBoardSceneParams = {
  app: Application;
  view: MatchView;
  spriteSheets: LoadedSpriteSheet;
  playerId: string;
  queue: ActionQueueState;
  dispatchQueue: Dispatch<ActionQueueEvent>;
  refs: BoardSceneRefs;
  /**
   * When this render is the first of the viewer's new turn, the units the BE repaired/refuelled this
   * upkeep — plays the one-shot start-of-turn flourish over them. Omit on every other render (the
   * caller gates it so it fires once per turn, not on each within-turn refetch).
   */
  turnStartPulse?: { repaired: readonly BoardPosition[]; refuelled: readonly BoardPosition[] };
  /**
   * When this render is the first to observe a new upkeep, the tiles where units ran out of fuel —
   * plays the one-shot crash flourish over them. Unlike `turnStartPulse` this can cover EITHER army:
   * a crash is public, so the opponent sees it too (fog-masked by the BE). Omit on every other render.
   */
  crashPulse?: { positions: readonly BoardPosition[] };
  /**
   * When this render is the first to observe a new CO-power activation, everything the launch flourish
   * draws: the units it touched (each tagged repaired/damaged/spawned/empowered) plus the offensive
   * power's signature set-piece (meteor/lightning/missiles). Omit on every other render (the caller
   * gates it on the activation key so it fires once per activation).
   */
  powerLaunchPulse?: PowerLaunchPulse;
  /**
   * Units that just moved and should slide along their path rather than teleport — the acting player's
   * buffered moves (own) and, later, a fog-masked BE move report (opponent). Each is played as its own
   * concurrent ticker effect; the static sprite at the destination is hidden until its slide finishes.
   */
  movePulses?: MovePulse[];
  /**
   * Tiles where a unit was just destroyed (combat kill or self-destruct) — plays a one-shot explosion
   * over each on the persistent overlay so it survives the rebuild that removes the unit. Fog-safe
   * upstream (the BE only reports a death at a tile this viewer can see).
   */
  deathPulses?: readonly BoardPosition[];
  /**
   * Tiles where an infantry/mech just captured (or made capture progress) — plays a one-shot capture
   * flourish over each on the persistent overlay so it survives the confirm/refetch rebuild that
   * follows the action. `completed` marks the tick that flipped ownership (a brighter flash). `full`
   * plays the rich AW capture (soldier hops + the building sinks/raises); when false only the
   * lightweight chevrons/flash show (the "no-animation" indicator). Fog-safe upstream (the BE only
   * reports the ability at a tile this viewer can see).
   */
  capturePulses?: { position: BoardPosition; completed: boolean; full: boolean }[];
  /** Surfaces the hovered attack engagement to React for the floating combat-forecast box. */
  onAttackTargetFocus?: (focus: AttackForecastFocus | null) => void;
  /** Surfaces a right-clicked unit's position to React for the unit-detail card. */
  onUnitInspect?: (position: BoardPosition | null) => void;
  /** Surfaces a right-clicked empty tile to React for the board context menu. */
  onContextMenu?: (position: BoardPosition | null) => void;
  /** Dev teleport: both positions picked, submit it. */
  onDevTeleport?: (from: BoardPosition, to: BoardPosition) => void;
  /** The unit picked as the teleport source — drives the "now pick a destination" banner. */
  onTeleportPick?: (position: BoardPosition | null) => void;
  /** Dev delete: remove ANY unit at this position, enemies included. */
  onDevDeleteUnit?: (position: BoardPosition) => void;
};

/**
 * (Re)builds the pixi stage content for the v2 snapshot board — the imperative render layer
 * extracted from `MatchBoardV2`'s render effect. Pure "data in, events out": takes the current
 * view/snapshot/queue and the refs the component owns, builds a `BoardRenderer` and hands it to
 * `board-controller` for the click/hover handlers and menus, then appends everything to
 * `app.stage`. See `MatchBoardV2` for the effect that calls this.
 */
export function mountBoardScene(params: MountBoardSceneParams): void {
  const { app, view, spriteSheets, playerId, queue, dispatchQueue, refs } = params;
  const { onAttackTargetFocus, onUnitInspect, onContextMenu } = params;
  const { onDevTeleport, onTeleportPick, onDevDeleteUnit } = params;
  const {
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
  } = refs;

  app.renderer.resize(
    view.map.tiles[0].length * renderedTileSize + renderedTileSize,
    view.map.tiles.length * renderedTileSize + renderedTileSize,
  );

  // Drop the previous shimmer animation before rebuilding the stage (its sprites are about to be
  // destroyed); a fresh one is registered below for this render's buffered arrows.
  if (shimmerRef.current !== null) {
    app.ticker.remove(shimmerRef.current);
    shimmerRef.current = null;
  }

  // Same for the weather animation — its particles are destroyed with the stage below.
  if (weatherAnimRef.current !== null) {
    app.ticker.remove(weatherAnimRef.current);
    weatherAnimRef.current = null;
  }

  // And any in-flight start-of-turn flourish (it usually self-removes on completion, but a stage
  // rebuild mid-play — e.g. the player acts before it finishes — destroys its container early).
  if (turnStartAnimRef.current !== null) {
    app.ticker.remove(turnStartAnimRef.current);
    turnStartAnimRef.current = null;
  }

  // Same for an in-flight crash flourish — its puffs are destroyed with the stage below.
  if (crashAnimRef.current !== null) {
    app.ticker.remove(crashAnimRef.current);
    crashAnimRef.current = null;
  }

  // The persistent power aura (its glows are destroyed with the stage) and any in-flight one-shot
  // "special hit" flourish — both re-registered below for this render if still applicable.
  if (powerAuraAnimRef.current !== null) {
    app.ticker.remove(powerAuraAnimRef.current);
    powerAuraAnimRef.current = null;
  }

  if (powerLaunchAnimRef.current !== null) {
    app.ticker.remove(powerLaunchAnimRef.current);
    powerLaunchAnimRef.current = null;
  }

  // Unlike the flourishes above, in-flight unit slides are NOT dropped here — they live on the
  // persistent `moveLayer` (preserved below) and keep ticking across this rebuild so a slide runs to
  // completion instead of being cut short by the BE confirm/refetch that follows an own move.
  for (const child of app.stage.removeChildren()) {
    if (child !== moveLayerRef.current) {
      child.destroy({ children: true });
    }
  }

  const mapSize = {
    width: view.map.tiles[0].length,
    height: view.map.tiles.length,
  };

  // The map renderer draws the fog per-tile (interleaved by depth) so a visible property's tall top
  // isn't dimmed by fog on the tile above it. Vision is BE-authoritative (from match.full).
  const mapContainer = renderMapFromView(view, spriteSheets);
  // Menus live on their own layer above the units, sharing the map's offset so tile coordinates
  // line up. Only turn management stays in the top bar; every other action is a board menu.
  const menuLayer = new Container();
  menuLayer.x = mapBorder;
  menuLayer.y = mapBorder;
  menuLayer.sortableChildren = true;

  reachableHighlightRef.current = null;
  attackHighlightRef.current = null;
  pathArrowRef.current = null; // destroyed with the stage on re-render; drop the dangling ref
  plannedPathRef.current = [];
  selectionRef.current = null;
  stagedDestRef.current = null;
  attackTargetsRef.current = [];
  // Also drop the armed-missile / staged-unload interaction: their overlays are destroyed with the
  // stage on this rebuild, so leaving the refs set would make the next click fire a missile / unload
  // at a stale target with no visible cue.
  missileArmRef.current = null;
  unloadDropsRef.current = [];

  let openMenu: Container | null = null;

  const closeMenu = () => {
    openMenu?.destroy({ children: true });
    openMenu = null;
  };

  const drawHighlights = (
    reachable: readonly BoardPosition[],
    attack: readonly BoardPosition[],
    unload: readonly BoardPosition[] = [],
  ) => {
    reachableHighlightRef.current?.destroy();
    attackHighlightRef.current?.destroy();
    unloadHighlightRef.current?.destroy();
    const blue = renderHighlightTiles(reachable, REACHABLE_COLOR);
    const red = renderHighlightTiles(attack, ATTACK_COLOR);
    const green = renderHighlightTiles(unload, UNLOAD_COLOR);
    mapContainer.addChild(blue, red, green);
    reachableHighlightRef.current = blue;
    attackHighlightRef.current = red;
    unloadHighlightRef.current = green;
  };

  // Redraw the AW movement arrow for the currently-traced route (plannedPathRef), into the map
  // container so it shares the map offset. Non-interactive, so it never eats a tile click.
  const drawPathArrow = () => {
    pathArrowRef.current?.destroy({ children: true });
    pathArrowRef.current = null;

    if (spriteSheets === undefined || plannedPathRef.current.length < 2) {
      return;
    }

    const arrow = renderPathArrow(spriteSheets, plannedPathRef.current);
    mapContainer.addChild(arrow);
    pathArrowRef.current = arrow;
  };

  const renderer: BoardRenderer = {
    drawHighlights,
    drawPathArrow,
    showMenu: (menu) => {
      closeMenu();
      menuLayer.addChild(menu);
      openMenu = menu;
    },
    closeMenu,
  };

  const controller = createBoardController({
    view,
    spriteSheets,
    playerId,
    queue,
    dispatchQueue,
    mapSize,
    refs,
    renderer,
    onAttackTargetFocus,
    onUnitInspect,
    onContextMenu,
    onDevTeleport,
    onTeleportPick,
    onDevDeleteUnit,
  });
  resetInteractionRef.current = controller.resetInteraction;
  // Draw the inspect overlay's ranges through the same highlight helper the controller uses (blue
  // reachable, red threat), so a later board interaction's `drawHighlights` naturally replaces them.
  refs.inspectHighlightRef.current = (reachable, attack) =>
    renderer.drawHighlights(reachable, attack);

  // Buffered (unconfirmed) intent: an AW arrow per buffered move at phantom opacity, plus the units
  // it targets rendered as translucent phantoms, so pending actions read directly on the board.
  const buffered = optimisticActions(queue);
  const bufferedArrows = renderBufferedArrows(spriteSheets, intentArrows(buffered));
  // Live in the map container (shares the mapBorder offset, so the arrows line up with the tile
  // grid; its zIndex 1050 keeps them above tiles/highlights but below the units drawn on the stage).
  mapContainer.addChild(bufferedArrows.container);

  // A travelling light cycles along each buffered arrow so pending moves feel alive.
  if (bufferedArrows.groups.length > 0) {
    let shimmerTime = 0;

    const shimmer = (delta: number) => {
      shimmerTime += delta * 0.08;
      shimmerBufferedArrows(bufferedArrows.groups, shimmerTime);
    };

    app.ticker.add(shimmer);
    shimmerRef.current = shimmer;
  }

  const unitsContainer = renderUnitsFromView(view, spriteSheets, phantomPositions(buffered));
  app.stage.addChild(
    mapContainer,
    unitsContainer,
    renderInteractiveTilesFromView(
      view,
      controller.onTileClick,
      controller.onTileHover,
      controller.onTileRightClick,
    ),
  );

  // Unit-move slides. The slide sprite lives on a PERSISTENT overlay (`moveLayer`) that survives stage
  // rebuilds, so it runs to completion on the ticker rather than being torn down by the confirm/refetch
  // rebuild that follows an own move. Each rebuild just re-hides the static sprite of any unit still
  // sliding and reveals it when its slide lands. Concurrent by construction (own + opponent at once);
  // non-blocking — input stays live throughout.
  unitsContainerRef.current = unitsContainer;
  // Latest map container, so the capture flourish can re-find and sink the live property sprite each
  // frame (the map is torn down + rebuilt on every render, same as the units container).
  mapContainerRef.current = mapContainer;

  const hideStaticAt = (x: number, y: number) => {
    const staticSprite = unitsContainer.getChildByName(`unit-${x}-${y}`);

    if (staticSprite !== null) {
      staticSprite.visible = false;
    }
  };

  if (moveLayerRef.current === null) {
    const layer = new Container();
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    layer.zIndex = 1500; // above the board/units, below the crash/power flourishes (2000)
    // Sort its own children by zIndex so a capture's old-building clone (below) sits under the hopping
    // soldier + slides regardless of add order.
    layer.sortableChildren = true;
    moveLayerRef.current = layer;
  }

  // The layer was detached (not destroyed) by `removeChildren` above; re-attach it for this render.
  app.stage.addChild(moveLayerRef.current);

  // Keep hiding the static sprite of every unit whose slide is still in flight from a prior rebuild.
  for (const key of activeSlideDestsRef.current) {
    const [x, y] = key.split("-").map(Number);
    hideStaticAt(x, y);
  }

  for (const pulse of params.movePulses ?? []) {
    const destination = pulse.path[pulse.path.length - 1];
    const destKey = `${destination[0]}-${destination[1]}`;

    // A slide is already running for this destination — don't stack a second one on top of it.
    if (activeSlideDestsRef.current.has(destKey)) {
      continue;
    }

    const unit = getUnitAt(view, destination);

    if (unit === undefined) {
      continue;
    }

    const army = getArmyForSlot(view, unit.playerSlot);

    if (army === undefined) {
      continue;
    }

    const animations = spriteSheets[army].animations as unknown as MoveAnimationFrames;
    const effect = renderUnitMoveEffect(pulse.path, unit.type, animations);

    if (effect === null) {
      continue;
    }

    activeSlideDestsRef.current.add(destKey);
    hideStaticAt(destination[0], destination[1]);
    moveLayerRef.current.addChild(effect.container);

    const tick = (delta: number) => {
      effect.animate(delta);

      if (!effect.isDone()) {
        return;
      }

      app.ticker.remove(tick);
      effect.container.destroy({ children: true });
      activeSlideDestsRef.current.delete(destKey);
      moveAnimRef.current = moveAnimRef.current.filter((registered) => registered !== tick);

      // Reveal the destination sprite in whatever units container is current now (the board may have
      // rebuilt several times during the slide), so the unit hands off from slide to static seamlessly.
      const landed = unitsContainerRef.current?.getChildByName(`unit-${destKey}`);

      if (landed !== null && landed !== undefined) {
        landed.visible = true;
      }
    };

    app.ticker.add(tick);
    moveAnimRef.current.push(tick);
  }

  // Unit destructions: a one-shot explosion over each tile a unit just died on. Lives on the same
  // persistent overlay as the slides so it survives the rebuild that removes the unit (otherwise it
  // would be torn down before it played). Self-removes on completion; only the draining rebuild passes
  // a non-empty list, so there's no per-rebuild replay.
  for (const position of params.deathPulses ?? []) {
    const effect = renderUnitDestroyEffect(position);
    moveLayerRef.current.addChild(effect.container);

    const tick = (delta: number) => {
      effect.animate(delta);

      if (!effect.isDone()) {
        return;
      }

      app.ticker.remove(tick);
      effect.container.destroy({ children: true });
      moveAnimRef.current = moveAnimRef.current.filter((registered) => registered !== tick);
    };

    app.ticker.add(tick);
    moveAnimRef.current.push(tick);
  }

  // Capture flourishes: the AW capture — the soldier hops while the property sinks, springing up in
  // its new colour on the flipping tick — plus gold chevrons/flash. Lives on the same persistent
  // overlay as the slides/deaths so it survives the rebuild the confirmed capture triggers. The
  // hopping soldier + sinking building act on the LIVE unit/map sprites, re-found each frame so they
  // keep working across rebuilds (like the move slide). Self-removes on completion; only the draining
  // rebuild passes a non-empty list, so there's no per-rebuild replay.
  for (const capture of params.capturePulses ?? []) {
    const destKey = `${capture.position[0]}-${capture.position[1]}`;

    let soldierFrames: Texture<Resource>[] | null = null;

    if (capture.full) {
      const unit = getUnitAt(view, capture.position);
      const army = unit === undefined ? undefined : getArmyForSlot(view, unit.playerSlot);

      if (unit !== undefined && army !== undefined) {
        const animations = spriteSheets[army].animations as unknown as MoveAnimationFrames;
        soldierFrames = animations[unit.type] ?? null;
      }
    }

    const effect = renderCaptureEffect(capture.position, capture.completed, soldierFrames);
    const moveLayer = moveLayerRef.current;
    moveLayer.addChild(effect.container);

    const hidesUnit = soldierFrames !== null;
    const sinksBuilding = capture.full;
    const isCompleted = capture.completed;

    const findTile = (): Sprite | null => {
      const tile = mapContainerRef.current?.getChildByName(`tile-${destKey}`);

      return tile instanceof Sprite ? tile : null;
    };

    // A completed capture flips the tile's OWNER (and colour) at the authoritative refetch, which lands
    // mid-flourish. To keep the new colour from appearing before the building rises, we crush a CLONE of
    // the OLD building (captured now, while the live tile is still the old owner) and only reveal the
    // real, already-flipped tile as it rises. A partial capture doesn't change owner, so it needs none.
    let oldBuildingClone: Sprite | null = null;

    if (sinksBuilding && isCompleted) {
      const realTile = findTile();

      if (realTile instanceof AnimatedSprite) {
        const clone = new AnimatedSprite(realTile.textures);
        clone.animationSpeed = realTile.animationSpeed;
        clone.play();
        oldBuildingClone = clone;
      } else if (realTile !== null) {
        oldBuildingClone = new Sprite(realTile.texture);
      }

      if (oldBuildingClone !== null && realTile !== null) {
        oldBuildingClone.anchor.set(realTile.anchor.x, realTile.anchor.y);
        // Real tiles live in the map container (offset by mapBorder); the clone is on the borderless
        // move layer, so add the border back to line it up exactly over its tile.
        oldBuildingClone.x = mapBorder + realTile.x;
        oldBuildingClone.y = mapBorder + realTile.y;
        oldBuildingClone.tint = realTile.tint;
        oldBuildingClone.zIndex = 1400; // under the hopping soldier (effect container 1600) + slides
        oldBuildingClone.eventMode = "none";
        moveLayer.addChild(oldBuildingClone);
      }
    }

    // Drives the property sprites for the frame. Partial: crush the real (old-owner) tile in place.
    // Completed with a clone: crush the OLD clone while the real (new) tile stays hidden, then at the
    // rebuild hand over — hide the clone and let the real tile rise in its new colour. All re-found each
    // frame so a stage rebuild mid-capture can't reset them.
    const paintBuildingFrame = () => {
      if (!sinksBuilding) {
        return;
      }

      const scaleY = effect.buildingScaleY();
      const realTile = findTile();

      if (!isCompleted || oldBuildingClone === null) {
        if (realTile !== null) {
          realTile.scale.y = scaleY;
        }

        return;
      }

      if (effect.isRebuilding()) {
        oldBuildingClone.visible = false;

        if (realTile !== null) {
          realTile.visible = true;
          realTile.scale.y = scaleY;
        }
      } else {
        oldBuildingClone.visible = true;
        oldBuildingClone.scale.y = scaleY;

        if (realTile !== null) {
          realTile.visible = false;
        }
      }
    };

    // Move-then-capture: hold the whole flourish until the unit's slide has ARRIVED (the slide clears
    // its destKey on landing), so the hop + building crush begin when the soldier gets there, not while
    // it's still travelling. A stationary capture has no slide, so it starts at once. Hidden while held.
    let started = !activeSlideDestsRef.current.has(destKey);
    let waited = 0;

    const begin = () => {
      started = true;
      effect.container.visible = true;

      if (hidesUnit) {
        hideStaticAt(capture.position[0], capture.position[1]);
      }
    };

    effect.container.visible = started;

    if (started) {
      begin();
    }

    // Seed the building visuals before the first tick (clone shown full / real hidden for a completed
    // capture), so the new colour never shows for even a frame while waiting for the slide.
    paintBuildingFrame();

    const tick = (delta: number) => {
      if (!started) {
        // Keep the old-building clone in front through the wait, then hold until the slide arrives.
        paintBuildingFrame();
        waited += delta;

        // Wait out the slide; cap it so a dropped slide can't strand the effect forever (~4s).
        if (activeSlideDestsRef.current.has(destKey) && waited < 240) {
          return;
        }

        begin();
      }

      effect.animate(delta);
      paintBuildingFrame();

      if (hidesUnit) {
        const staticUnit = unitsContainerRef.current?.getChildByName(`unit-${destKey}`);

        if (staticUnit !== null && staticUnit !== undefined) {
          staticUnit.visible = false;
        }
      }

      if (!effect.isDone()) {
        return;
      }

      app.ticker.remove(tick);
      effect.container.destroy({ children: true });
      oldBuildingClone?.destroy({ children: true });
      moveAnimRef.current = moveAnimRef.current.filter((registered) => registered !== tick);

      // Restore the real property to full height + visible and hand the unit back to its static sprite.
      const realTile = findTile();

      if (sinksBuilding && realTile !== null) {
        realTile.visible = true;
        realTile.scale.y = 1;
      }

      if (hidesUnit) {
        const landed = unitsContainerRef.current?.getChildByName(`unit-${destKey}`);

        if (landed !== null && landed !== undefined) {
          landed.visible = true;
        }
      }
    };

    app.ticker.add(tick);
    moveAnimRef.current.push(tick);
  }

  // Weather sits above the board/units but below menus, non-interactive so clicks pass through. The
  // +1 tile matches the renderer resize (one tile of total border); coords are in baseTileSize units.
  const weather = renderWeatherOverlay(
    view.currentWeather,
    (mapSize.width + 1) * baseTileSize,
    (mapSize.height + 1) * baseTileSize,
  );

  if (weather !== null) {
    app.stage.addChild(weather.container);
    app.ticker.add(weather.animate);
    weatherAnimRef.current = weather.animate;
  }

  // One-shot crash flourish over the tiles where units ran out of fuel this upkeep. Added BEFORE the
  // upkeep motes below so a crash and a neighbouring refuel read in that order. Only the first render
  // to observe the upkeep passes `crashPulse` (the caller gates it), so it plays once.
  const crashes = params.crashPulse;

  if (crashes !== undefined) {
    const effect = renderCrashEffect(crashes.positions);

    if (effect !== null) {
      app.stage.addChild(effect.container);

      const tick = (delta: number) => {
        effect.animate(delta);

        if (effect.isDone()) {
          app.ticker.remove(tick);
          effect.container.destroy({ children: true });

          if (crashAnimRef.current === tick) {
            crashAnimRef.current = null;
          }
        }
      };

      app.ticker.add(tick);
      crashAnimRef.current = tick;
    }
  }

  // One-shot start-of-turn flourish over the units the BE repaired/refuelled this upkeep. Only the
  // first render of a new turn passes `turnStartPulse` (the caller gates it), so it plays once. The
  // tick self-removes and destroys its container when the animation completes.
  const pulse = params.turnStartPulse;

  if (pulse !== undefined) {
    const effect = renderTurnStartEffect(pulse.repaired, pulse.refuelled);

    if (effect !== null) {
      app.stage.addChild(effect.container);

      const tick = (delta: number) => {
        effect.animate(delta);

        if (effect.isDone()) {
          app.ticker.remove(tick);
          effect.container.destroy({ children: true });

          if (turnStartAnimRef.current === tick) {
            turnStartAnimRef.current = null;
          }
        }
      };

      app.ticker.add(tick);
      turnStartAnimRef.current = tick;
    }
  }

  // Persistent "under power" aura: a subtle pulsing glow under every unit whose owner has an active
  // CO/super power. Rebuilt each render from BE state, so it appears when a power fires and clears
  // when it ends. Non-interactive; ticks until the next rebuild removes it (above).
  const poweredPulse = renderPoweredUnitPulse(view, unitsContainer);

  if (poweredPulse !== null) {
    app.ticker.add(poweredPulse.animate);
    powerAuraAnimRef.current = poweredPulse.animate;
  }

  // One-shot spherical blink over every unit the power touched — only the first render to observe a
  // new activation passes `powerLaunchPulse` (the caller gates it), so it plays once. The tick
  // self-removes and destroys its container when the animation completes.
  const launchPulse = params.powerLaunchPulse;

  if (launchPulse !== undefined) {
    const effect = renderPowerLaunchEffect(launchPulse, mapSize);

    if (effect !== null) {
      app.stage.addChild(effect.container);

      const tick = (delta: number) => {
        effect.animate(delta);

        if (effect.isDone()) {
          app.ticker.remove(tick);
          effect.container.destroy({ children: true });

          if (powerLaunchAnimRef.current === tick) {
            powerLaunchAnimRef.current = null;
          }
        }
      };

      app.ticker.add(tick);
      powerLaunchAnimRef.current = tick;
    }
  }

  app.stage.addChild(menuLayer);
}
