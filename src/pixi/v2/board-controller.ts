import { baseTileSize } from "frontend/components/match/render-constants";
import {
  buildableUnits,
  classifyTileClick,
  commitPath as computeCommitPath,
  movableTiles as computeMovableTiles,
  stageActions,
  type InteractionState,
  type StageAction,
} from "frontend/components/match/board-interaction";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import {
  getArmyForSlot,
  getPlayerById,
  getTileAt,
  getUnitAt,
  samePosition,
  toMutablePath,
} from "frontend/components/match/match-view";
import { updateTracedPath } from "frontend/components/match/path-planning";
import type { SnapshotUnit } from "frontend/components/match/turn-snapshot-view";
import {
  snapshotUnitAt,
  type RepairTarget,
  type UnloadDrop,
} from "frontend/components/match/turn-snapshot-view";
import {
  makeClientId,
  type ActionKind,
  type ActionQueueEvent,
  type ActionQueueState,
} from "frontend/utils/action-queue";
import type { LoadedSpriteSheet } from "pixi/load-spritesheet";
import type { Dispatch } from "react";
import type { MainAction } from "frontend/components/match/board-actions";
import type { BoardRenderer, BoardSceneRefs } from "./board-scene";
import { createActionMenuElement, createBoardMenu, createUnitMenuElement } from "./board-menu";

/** The engagement the player is currently eyeing — enough for the BE combat-forecast query. */
export type AttackForecastFocus = {
  attackerPosition: BoardPosition;
  toPosition: BoardPosition;
  targetPosition: BoardPosition;
};

/**
 * Interaction handlers for the v2 snapshot board — the click/hover/menu logic extracted from
 * `mountBoardScene`. Owns nothing about pixi assembly; it reads/writes the refs it's handed and
 * draws through the `BoardRenderer` passed in, so it stays agnostic of how highlights/menus/arrows
 * are actually rendered.
 *
 * Three optional callbacks surface board state to React for the HUD overlays (pure "events out", no
 * pixi coupling): `onAttackTargetFocus` fires while hovering a lit enemy attack target (drives the
 * floating combat-forecast box), `onUnitInspect` fires on a right-click that lands on a visible unit
 * (drives the unit-detail card), and `onContextMenu` fires on a right-click on an empty tile (drives
 * the board context menu). All pass plain positions; React fetches the BE data and renders.
 *
 * The context menu is React's rather than a pixi `createBoardMenu` because its entries are React
 * concerns end-to-end — a typed-confirm modal, tRPC mutations, the same handlers the HUD already
 * owns. Keeping it out of pixi is what stops the board from growing its own network layer.
 */
export function createBoardController(deps: {
  view: MatchView;
  spriteSheets: LoadedSpriteSheet;
  playerId: string;
  queue: ActionQueueState;
  dispatchQueue: Dispatch<ActionQueueEvent>;
  mapSize: { width: number; height: number };
  refs: BoardSceneRefs;
  renderer: BoardRenderer;
  onAttackTargetFocus?: (focus: AttackForecastFocus | null) => void;
  onUnitInspect?: (position: BoardPosition | null) => void;
  onContextMenu?: (position: BoardPosition | null) => void;
  /** Dev teleport: both positions picked, submit it. The BE re-validates them. */
  onDevTeleport?: (from: BoardPosition, to: BoardPosition) => void;
  /** The unit picked as the teleport source (null once it's submitted/cleared) — drives the banner. */
  onTeleportPick?: (position: BoardPosition | null) => void;
  /** Dev delete: remove ANY unit at this position, enemies included. */
  onDevDeleteUnit?: (position: BoardPosition) => void;
}): {
  resetInteraction: () => void;
  onTileClick: (pos: BoardPosition) => void;
  onTileHover: (pos: BoardPosition) => void;
  onTileRightClick: (pos: BoardPosition) => void;
} {
  const { view, spriteSheets, playerId, dispatchQueue, mapSize, refs, renderer } = deps;
  const { onAttackTargetFocus, onUnitInspect, onContextMenu } = deps;
  const { onDevTeleport, onTeleportPick, onDevDeleteUnit } = deps;
  const {
    selectionRef,
    stagedDestRef,
    attackTargetsRef,
    unloadDropsRef,
    missileArmRef,
    plannedPathRef,
    matchRef,
    snapshotRef,
    priceTableRef,
    queueRef,
    deleteModeRef,
    teleportModeRef,
    devDeleteModeRef,
  } = refs;

  const resetInteraction = () => {
    selectionRef.current = null;
    stagedDestRef.current = null;
    attackTargetsRef.current = [];
    unloadDropsRef.current = [];
    missileArmRef.current = null;
    plannedPathRef.current = [];
    renderer.closeMenu();
    renderer.drawHighlights([], []);
    renderer.drawPathArrow();
    onAttackTargetFocus?.(null); // no target under consideration once the interaction is cleared
    // NOTE: the inspect card is NOT cleared here — a right-click runs resetInteraction before
    // (re)inspecting, and clearing would wipe the state the second-click toggle reads. Left-click
    // dismissal is handled explicitly in `onTileClick`.
  };

  // The route to commit for a move to `dest`: the cursor-traced path when it ends there, otherwise
  // the snapshot's shortest path. So a hovered/drawn route is honoured; a direct click uses shortest.
  const commitPath = (unit: SnapshotUnit, dest: BoardPosition): BoardPosition[] | null =>
    computeCommitPath(unit, dest, plannedPathRef.current);

  // Buffer an action optimistically and close the interaction; the drain effect submits it and
  // reconciles against the BE. This is the ONLY submit path for board actions now.
  const enqueue = (kind: ActionKind, action: MainAction) => {
    resetInteraction();
    dispatchQueue({ type: "enqueue", clientId: makeClientId(), kind, action });
  };

  const enqueueMove = (
    kind: ActionKind,
    path: readonly BoardPosition[],
    subAction:
      | { type: "wait" }
      | { type: "ability" }
      | { type: "attack"; defenderPosition: [number, number] },
  ) => enqueue(kind, { type: "move", path: toMutablePath(path), subAction });

  // A unit's reachable tiles minus those a BUFFERED move now occupies (a tile another unit has
  // been moved onto isn't a valid plain-move destination — we'd stack two units). Its own tile and
  // valid load targets stay. Vacated tiles are already free in the optimistic view. We don't
  // re-path around new blockers — the BE reconciles that (per the locked design).
  const movableTiles = (unit: SnapshotUnit): BoardPosition[] => computeMovableTiles(view, unit);

  // Open a contextual action menu (WAIT / CAPTURE / ATTACK) anchored at `dest`.
  const openActionMenu = (
    dest: BoardPosition,
    options: { label: string; onSelect: () => void }[],
  ) => {
    renderer.closeMenu();
    const unitSize = baseTileSize / 2;
    const elements = options.map((option, index) => {
      const element = createActionMenuElement(option.label, index);
      element.on("pointerdown", option.onSelect);
      return element;
    });
    const menu = createBoardMenu(mapSize, dest, options.length * unitSize * 2, 3, elements);
    renderer.showMenu(menu);
  };

  // After UNLOAD is chosen: if the transport carries two units, first pick which one; then light
  // up that unit's valid drop tiles (green) for the player to click.
  const showUnloadDrops = (unit: SnapshotUnit, dest: BoardPosition, drops: UnloadDrop[]) => {
    const transport = getUnitAt(view, unit.position) as
      | { loadedUnit?: { type: string } | null; loadedUnit2?: { type: string } | null }
      | undefined;

    const slotLabel = (isSecond: boolean): string => {
      const cargo = isSecond ? transport?.loadedUnit2 : transport?.loadedUnit;
      return cargo ? cargo.type.toUpperCase() : "UNIT";
    };

    const lightUpSlot = (isSecond: boolean) => {
      const slotDrops = drops.filter((drop) => drop.isSecondUnit === isSecond);
      unloadDropsRef.current = slotDrops;
      renderer.closeMenu();
      renderer.drawHighlights(
        [],
        [],
        slotDrops.map((drop) => drop.position),
      );
    };

    const slots = Array.from(new Set(drops.map((drop) => drop.isSecondUnit)));

    if (slots.length === 1) {
      lightUpSlot(slots[0]);

      return;
    }

    openActionMenu(
      dest,
      slots.map((isSecond) => ({
        label: slotLabel(isSecond),
        onSelect: () => lightUpSlot(isSecond),
      })),
    );
  };

  // After REPAIR is chosen: pick which adjacent friendly to repair (its direction), then buffer the
  // move+repair. A single target repairs immediately; multiple offer a small submenu.
  const chooseRepair = (unit: SnapshotUnit, dest: BoardPosition, targets: RepairTarget[]) => {
    const bufferRepair = (target: RepairTarget) => {
      const path = commitPath(unit, dest);

      if (path !== null) {
        enqueue("repair", {
          type: "move",
          path: toMutablePath(path),
          subAction: { type: "repair", direction: target.direction },
        });
      }
    };

    if (targets.length === 1) {
      bufferRepair(targets[0]);

      return;
    }

    openActionMenu(
      dest,
      targets.map((target) => ({
        label: `REPAIR ${(getUnitAt(view, target.position)?.type ?? "unit").toUpperCase()}`,
        onSelect: () => bufferRepair(target),
      })),
    );
  };

  // After LAUNCH is chosen: arm the missile (light the whole board red) and let the next click pick
  // the strike tile. The path onto the silo is captured now; the target is chosen on the board.
  const armMissile = (unit: SnapshotUnit, dest: BoardPosition) => {
    const path = commitPath(unit, dest);

    if (path === null) {
      return;
    }

    renderer.closeMenu();
    missileArmRef.current = { path };
    attackTargetsRef.current = [];
    unloadDropsRef.current = [];

    const everyTile: BoardPosition[] = [];

    for (let y = 0; y < view.map.tiles.length; y++) {
      for (let x = 0; x < view.map.tiles[y].length; x++) {
        everyTile.push([x, y]);
      }
    }

    renderer.drawHighlights(movableTiles(unit), everyTile); // red = pick any tile as the missile target
  };

  // Stage a move at `dest` and offer the actions available from there. Fully synchronous (load
  // validity, attack targets and unload drops all come from the snapshot, not the network) so
  // staging works instantly even offline / throttled — the whole point of buffering.
  const stageMove = (unit: SnapshotUnit, dest: BoardPosition) => {
    // Lock the traced route to end at `dest` (the drawn path if the cursor reached it, else the
    // shortest), then draw it — every action from here commits along this exact path.
    plannedPathRef.current = updateTracedPath(unit, plannedPathRef.current, dest);
    renderer.drawPathArrow();

    const reachable = movableTiles(unit);

    const staged = stageActions(view, unit, dest, queueRef.current, playerId);

    if (staged === null) {
      return; // occupied by a friendly the BE won't let us load/join into — no action here
    }

    stagedDestRef.current = dest;
    attackTargetsRef.current = staged.attackTargets;
    unloadDropsRef.current = [];
    renderer.drawHighlights(reachable, []); // red targets / green drops appear only once chosen

    // Maps a staged action to its menu entry — onSelect reproduces the pre-extraction inline
    // handlers exactly (attack/unload open a sub-step; the rest commit the path and enqueue).
    const menuOptionFor = (action: StageAction): { label: string; onSelect: () => void } => {
      switch (action.kind) {
        case "load-join":
          return {
            label: action.label,
            onSelect: () => {
              const path = commitPath(unit, dest);

              if (path !== null) {
                enqueueMove("move", path, { type: "wait" });
              }
            },
          };
        case "attack":
          return {
            label: action.label,
            onSelect: () => {
              renderer.closeMenu();
              renderer.drawHighlights(reachable, action.targets); // now pick a red enemy on the board
            },
          };
        case "capture":
          return {
            label: action.label,
            onSelect: () => {
              const path = commitPath(unit, dest);

              if (path !== null) {
                enqueueMove("capture", path, { type: "ability" });
              }
            },
          };
        case "unload":
          return {
            label: action.label,
            onSelect: () => showUnloadDrops(unit, dest, action.drops),
          };
        case "ability":
          return {
            label: action.label,
            onSelect: () => {
              const path = commitPath(unit, dest);

              if (path !== null) {
                enqueueMove("ability", path, { type: "ability" });
              }
            },
          };
        case "launch":
          return { label: action.label, onSelect: () => armMissile(unit, dest) };
        case "repair":
          return {
            label: action.label,
            onSelect: () => chooseRepair(unit, dest, action.targets),
          };
        case "delete":
          return {
            label: action.label,
            onSelect: () =>
              enqueue("delete", {
                type: "delete",
                position: [unit.position[0], unit.position[1]],
              }),
          };
        case "wait":
          return {
            label: action.label,
            onSelect: () => {
              const path = commitPath(unit, dest);

              if (path !== null) {
                enqueueMove("move", path, { type: "wait" });
              }
            },
          };
      }
    };

    openActionMenu(dest, staged.actions.map(menuOptionFor));
  };

  // Open the build menu for an owned, empty production facility. Uses the LATCHED price table (no
  // round-trip) and OPTIMISTIC funds (already-buffered builds subtracted), so producing never
  // waits on the BE after the round-start list is known.
  const openBuildMenu = (position: BoardPosition, facility: string) => {
    const myPlayer = getPlayerById(view, playerId);
    const army = myPlayer === undefined ? undefined : getArmyForSlot(view, myPlayer.slot);
    const priceTable = priceTableRef.current;

    if (myPlayer === undefined || army === undefined || priceTable.length === 0) {
      return;
    }

    const sheet = spriteSheets[army];
    // Own funds are always sent (only opponents' funds are nulled under fog), so coalesce defensively.
    const availableFunds = myPlayer.funds ?? 0;
    // Dev free-production flag from the BE snapshot — makes every unit buildable regardless of funds.
    const freeProduction = snapshotRef.current?.production.freeProduction ?? false;
    const entries = buildableUnits(priceTable, facility, availableFunds, freeProduction);

    const unitSize = baseTileSize / 2;
    const elements = entries.map((entry, index) => {
      const element = createUnitMenuElement(
        sheet,
        { unitType: entry.type, cost: entry.cost, selectable: entry.selectable },
        index,
      );

      if (entry.selectable) {
        element.on("pointerdown", () => {
          enqueue("production", {
            type: "build",
            unitType: entry.type,
            position: [position[0], position[1]],
          });
        });
      }

      return element;
    });

    const menu = createBoardMenu(mapSize, position, entries.length * unitSize * 2, 6, elements);
    renderer.showMenu(menu);
  };

  const onTileClick = (pos: BoardPosition) => {
    const currentMatch = matchRef.current;

    // Any left-click means the player is acting — dismiss the passive inspect card/overlay and the
    // context menu. (Delete mode is deliberately NOT cleared here: it's a mode, and it survives the
    // clicks it acts on until the player turns it off.)
    onUnitInspect?.(null);
    onContextMenu?.(null);

    if (currentMatch === null || currentMatch.gameOver !== null) {
      return; // the match is decided — the board is read-only
    }

    // Delete mode short-circuits the normal click routing: while it's on, a click on one of the
    // viewer's own units scraps it outright rather than selecting it. Enemy units and empty tiles are
    // ignored (rather than falling through to a select/build) so a stray click can't quietly do
    // something else while the player is in a destructive mode.
    if (deleteModeRef.current) {
      const myPlayer = getPlayerById(currentMatch, playerId);
      const unitHere = getUnitAt(currentMatch, pos);

      if (
        myPlayer !== undefined &&
        unitHere !== undefined &&
        unitHere.playerSlot === myPlayer.slot
      ) {
        enqueue("delete", { type: "delete", position: [pos[0], pos[1]] });
      }

      return;
    }

    // Dev delete mode: like scrap mode above, but it reaches ANY unit — enemies included — through
    // the dev endpoint rather than the normal `delete` action. Stays armed so several units can be
    // removed in a row, and ignores clicks on empty tiles for the same reason scrap mode does.
    if (devDeleteModeRef.current) {
      if (getUnitAt(currentMatch, pos) !== undefined) {
        onDevDeleteUnit?.([pos[0], pos[1]]);
      }

      return;
    }

    // Dev teleport mode, mirroring delete mode above: it short-circuits normal routing, and clicks
    // that don't fit the mode are IGNORED rather than falling through to a select — a stray click
    // must not quietly do something else while a dev mode is armed.
    //
    // Two clicks: any unit (ENEMY units included — unlike delete mode, this is a staff tool), then
    // any destination. The BE re-validates both; the board just collects the two positions.
    if (teleportModeRef.current !== null) {
      const from = teleportModeRef.current.from;

      if (from === null) {
        if (getUnitAt(currentMatch, pos) !== undefined) {
          teleportModeRef.current = { from: [pos[0], pos[1]] };
          onTeleportPick?.([pos[0], pos[1]]);
        }

        return;
      }

      onDevTeleport?.(from, [pos[0], pos[1]]);
      teleportModeRef.current = null;
      onTeleportPick?.(null);
      return;
    }

    const state: InteractionState = {
      selection: selectionRef.current,
      stagedDest: stagedDestRef.current,
      attackTargets: attackTargetsRef.current,
      unloadDrops: unloadDropsRef.current,
      missileArm: missileArmRef.current,
    };

    const result = classifyTileClick(
      currentMatch,
      snapshotRef.current,
      pos,
      state,
      queueRef.current,
      playerId,
    );

    switch (result.type) {
      case "launch":
        enqueue("launch", {
          type: "move",
          path: toMutablePath(result.path),
          subAction: { type: "launchMissile", targetPosition: [pos[0], pos[1]] },
        });
        break;
      case "unload": {
        const path = commitPath(result.unit, result.from);

        if (path !== null) {
          enqueue("move", {
            type: "move",
            path: toMutablePath(path),
            subAction: {
              type: "unloadWait",
              unloads: [
                { isSecondUnit: result.drop.isSecondUnit, direction: result.drop.direction },
              ],
            },
          });
        }

        break;
      }
      case "attack": {
        const path = commitPath(result.unit, result.from);

        if (path !== null) {
          enqueueMove("attack", path, { type: "attack", defenderPosition: [pos[0], pos[1]] });
        }

        break;
      }
      case "stage":
        stageMove(result.unit, result.dest);
        break;
      case "build":
        resetInteraction();
        openBuildMenu(result.position, result.facility);
        break;
      case "select":
        resetInteraction();
        selectionRef.current = result.pos;
        plannedPathRef.current = [result.pos]; // start the traced route at the unit's tile
        renderer.drawHighlights(movableTiles(result.unit), []);
        break;
      case "reset":
        resetInteraction();
        break;
      case "none":
        break;
    }
  };

  // Hovering a lit enemy attack target (after ATTACK is chosen, or while the staged menu is up) asks
  // React for the combat forecast; hovering a reachable tile (before a destination is staged) extends
  // the cursor-drawn route and redraws the AW arrow. The exact route is what gets committed, so the
  // player controls which tiles the unit crosses — critical in fog.
  const onTileHover = (pos: BoardPosition) => {
    const snapshot = snapshotRef.current;
    const selected = selectionRef.current;

    // Combat forecast: only when this tile is one of the currently-latched red targets.
    if (selected !== null && attackTargetsRef.current.some((target) => samePosition(target, pos))) {
      onAttackTargetFocus?.({
        attackerPosition: selected,
        toPosition: stagedDestRef.current ?? selected,
        targetPosition: pos,
      });

      return;
    }

    onAttackTargetFocus?.(null); // left the target row (or never on it) — hide the box

    // Only trace while still choosing a destination — not once a move is staged (menu open / picking
    // an attack target or unload tile) and not while arming a missile.
    if (
      snapshot === null ||
      selected === null ||
      stagedDestRef.current !== null ||
      missileArmRef.current !== null
    ) {
      return;
    }

    const unit = snapshotUnitAt(snapshot, selected);

    if (unit === undefined) {
      return;
    }

    plannedPathRef.current = updateTracedPath(unit, plannedPathRef.current, pos);
    renderer.drawPathArrow();
  };

  // Right-click is the universal cancel (clear selection / staged move / menu / armed missile). When
  // it lands on a visible unit it ALSO opens that unit's detail card and its range preview — for ANY
  // unit, own or enemy, so a player can read an enemy's movement reach and threat. The ranges come
  // from the BE (via the card's query) and are painted by React; the controller just signals which
  // unit. A fogged/concealed unit isn't in the view, so it can't be probed this way.
  //
  // On an EMPTY tile it opens the board context menu — but only when there was nothing to cancel.
  // Cancelling stays right-click's first duty: with a unit selected or a missile armed, a right-click
  // anywhere just clears, exactly as before, and the menu is offered on the next (now idle) click.
  const onTileRightClick = (pos: BoardPosition) => {
    const currentMatch = matchRef.current;
    const unitHere = currentMatch === null ? undefined : getUnitAt(currentMatch, pos);
    const wasInteracting = selectionRef.current !== null || missileArmRef.current !== null;

    resetInteraction();

    // A pipe seam has HP and can be shot, so it inspects like a unit even though no unit stands
    // there — that health is what you're deciding against when you aim at it.
    const seamHere =
      currentMatch !== null && getTileAt(currentMatch, pos).type === "pipeSeam" ? pos : undefined;

    if (unitHere !== undefined || seamHere !== undefined) {
      onContextMenu?.(null); // inspecting a unit and holding a tile menu open at once reads as noise
      onUnitInspect?.(pos);

      return;
    }

    onUnitInspect?.(null);
    onContextMenu?.(wasInteracting ? null : pos);
  };

  return { resetInteraction, onTileClick, onTileHover, onTileRightClick };
}
