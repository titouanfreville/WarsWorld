"use client";
import { useQuery } from "@tanstack/react-query";
import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import type { BoardPosition, MatchView } from "frontend/components/match/match-view";
import {
  getArmyForSlot,
  getCurrentTurnPlayer,
  getPlayerById,
  getTileAt,
  getUnitAt,
  samePosition,
} from "frontend/components/match/match-view";
import type {
  BuildableTile,
  SnapshotUnit,
  TurnSnapshot,
} from "frontend/components/match/turn-snapshot-view";
import { reconstructPath, snapshotUnitAt } from "frontend/components/match/turn-snapshot-view";
import { trpc } from "frontend/utils/trpc-client";
import { loadSpritesFromSpriteMap } from "pixi/load-spritesheet";
import { Application, Assets, Container } from "pixi.js";
import { useEffect, useRef } from "react";
import { baseTileSize, mapBorder, renderMultiplier, renderedTileSize } from "./MatchRenderer";
import {
  createActionMenuElement,
  createBoardMenu,
  createUnitMenuElement,
} from "../../pixi/v2/board-menu";
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

const REACHABLE_COLOR = "#43d9e4";
const ATTACK_COLOR = "#be1919";

const toMutable = (path: readonly BoardPosition[]): [number, number][] =>
  path.map((p) => [p[0], p[1]]);

const inList = (list: readonly BoardPosition[], pos: BoardPosition): boolean =>
  list.some((p) => samePosition(p, pos));

/**
 * Snapshot-driven board (Phase C). Renders from the plain `match.full` data and drives actions off
 * the BE turn snapshot + preview endpoints — NO client engine, NO `MatchWrapper`, NO rules geometry.
 * Selection is a plain position; reachable tiles and the move path come from the snapshot, attack
 * targets from the `attackTargets` endpoint. The backend stays authoritative (any event -> refetch),
 * so the client can't desync. Behind `?v2`.
 *
 * Interaction: select a unit (blue reachable tiles), click a reachable tile to stage a move there,
 * then pick from an in-board contextual menu (ATTACK / CAPTURE / WAIT). ATTACK reveals red enemies
 * to click; a facility opens a build menu of its affordable units. Only turn management lives in the
 * top bar — every other action is a pixi menu anchored at the tile (matching the v1 look). Attacks
 * are BE-resolved. Optimistic buffering isn't wired yet — everything is BE-authoritative.
 */
export function MatchBoardV2({ matchId, playerId, spritesheetDataByArmy }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const reachableHighlightRef = useRef<Container | null>(null);
  const attackHighlightRef = useRef<Container | null>(null);
  // Selection: the unit's origin tile. Staged destination: where a move is being composed (null =
  // acting from the origin). Attack targets: the currently clickable red tiles. All read by the
  // imperative pixi click handler, so they live in refs.
  const selectionRef = useRef<BoardPosition | null>(null);
  const stagedDestRef = useRef<BoardPosition | null>(null);
  const attackTargetsRef = useRef<BoardPosition[]>([]);
  const resetInteractionRef = useRef<() => void>(() => undefined);

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

  const matchQuery = trpc.match.full.useQuery({ matchId, playerId });
  const match = matchQuery.data;
  const spriteSheets = spriteSheetQuery.data;

  const isMyTurn = match !== undefined && getCurrentTurnPlayer(match)?.id === playerId;

  const snapshotQuery = trpc.matchPreview.turnSnapshot.useQuery(
    { matchId, playerId },
    { enabled: isMyTurn },
  );

  const utils = trpc.useUtils();
  const actionMutation = trpc.action.send.useMutation();

  matchRef.current = match ?? null;
  snapshotRef.current = isMyTurn ? (snapshotQuery.data ?? null) : null;

  trpc.action.onEvent.useSubscription(
    { playerId, matchId },
    {
      onData() {
        void utils.match.full.invalidate({ matchId, playerId });
        void utils.matchPreview.turnSnapshot.invalidate({ matchId, playerId });
      },
    },
  );

  const onActionError = (label: string) => (error: { message: string }) =>
    console.error(`[v2] ${label} rejected by BE:`, error.message);

  // Enemies attackable from `fromPosition` this turn (empty on error / no snapshot).
  const fetchAttackTargets = async (
    unitPosition: BoardPosition,
    fromPosition: BoardPosition,
  ): Promise<BoardPosition[]> => {
    try {
      return await utils.matchPreview.attackTargets.fetch({
        matchId,
        playerId,
        unitPosition: [unitPosition[0], unitPosition[1]],
        fromPosition: [fromPosition[0], fromPosition[1]],
      });
    } catch {
      return [];
    }
  };

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
    containerRef.current.appendChild(canvas);
    appRef.current = app;

    return () => {
      app.destroy(true, { children: true });
      appRef.current = null;
    };
  }, []);

  // (Re)render the stage content whenever the data changes. The app itself persists.
  useEffect(() => {
    const app = appRef.current;

    if (app === null || match === undefined || spriteSheets === undefined) {
      return;
    }

    app.renderer.resize(
      match.map.tiles[0].length * renderedTileSize + renderedTileSize,
      match.map.tiles.length * renderedTileSize + renderedTileSize,
    );

    for (const child of app.stage.removeChildren()) {
      child.destroy({ children: true });
    }

    const mapSize = {
      width: match.map.tiles[0].length,
      height: match.map.tiles.length,
    };

    const mapContainer = renderMapFromView(match, spriteSheets);
    // Menus live on their own layer above the units, sharing the map's offset so tile coordinates
    // line up. Only turn management stays in the top bar; every other action is a board menu.
    const menuLayer = new Container();
    menuLayer.x = mapBorder;
    menuLayer.y = mapBorder;
    menuLayer.sortableChildren = true;

    reachableHighlightRef.current = null;
    attackHighlightRef.current = null;
    selectionRef.current = null;
    stagedDestRef.current = null;
    attackTargetsRef.current = [];

    let openMenu: Container | null = null;

    const closeMenu = () => {
      openMenu?.destroy({ children: true });
      openMenu = null;
    };

    const drawHighlights = (
      reachable: readonly BoardPosition[],
      attack: readonly BoardPosition[],
    ) => {
      reachableHighlightRef.current?.destroy();
      attackHighlightRef.current?.destroy();
      const blue = renderHighlightTiles(reachable, REACHABLE_COLOR);
      const red = renderHighlightTiles(attack, ATTACK_COLOR);
      mapContainer.addChild(blue, red);
      reachableHighlightRef.current = blue;
      attackHighlightRef.current = red;
    };

    const resetInteraction = () => {
      selectionRef.current = null;
      stagedDestRef.current = null;
      attackTargetsRef.current = [];
      closeMenu();
      drawHighlights([], []);
    };

    resetInteractionRef.current = resetInteraction;

    const submit = (
      label: string,
      path: readonly BoardPosition[],
      subAction:
        | { type: "wait" }
        | { type: "ability" }
        | { type: "attack"; defenderPosition: [number, number] },
    ) => {
      resetInteraction();
      actionMutation.mutate(
        { playerId, matchId, type: "move", path: toMutable(path), subAction },
        { onError: onActionError(label) },
      );
    };

    // Open a contextual action menu (WAIT / CAPTURE / ATTACK) anchored at `dest`.
    const openActionMenu = (
      dest: BoardPosition,
      options: { label: string; onSelect: () => void }[],
    ) => {
      closeMenu();
      const unitSize = baseTileSize / 2;
      const elements = options.map((option, index) => {
        const element = createActionMenuElement(option.label, index);
        element.on("pointerdown", option.onSelect);
        return element;
      });
      const menu = createBoardMenu(mapSize, dest, options.length * unitSize * 2, 3, elements);
      menuLayer.addChild(menu);
      openMenu = menu;
    };

    // Stage a move at `dest` and offer the actions available from there (attack / capture / wait).
    const stageMove = (unit: SnapshotUnit, origin: BoardPosition, dest: BoardPosition) => {
      const reachable = unit.reachableTiles.map((tile) => tile.position);
      const myPlayer = getPlayerById(match, playerId);
      const destTile = getTileAt(match, dest);
      const canCapture =
        (unit.type === "infantry" || unit.type === "mech") &&
        myPlayer !== undefined &&
        "playerSlot" in destTile &&
        destTile.playerSlot !== myPlayer.slot;

      void (async () => {
        const targets = await fetchAttackTargets(origin, dest);

        stagedDestRef.current = dest;
        attackTargetsRef.current = targets;
        drawHighlights(reachable, []); // red targets appear only once ATTACK is chosen

        const options: { label: string; onSelect: () => void }[] = [];

        if (targets.length > 0) {
          options.push({
            label: "ATTACK",
            onSelect: () => {
              closeMenu();
              drawHighlights(reachable, targets); // now pick a red enemy on the board
            },
          });
        }

        if (canCapture) {
          options.push({
            label: "CAPTURE",
            onSelect: () => {
              const path = reconstructPath(unit, dest);

              if (path !== null) {
                submit("capture", path, { type: "ability" });
              }
            },
          });
        }

        options.push({
          label: "WAIT",
          onSelect: () => {
            const path = reconstructPath(unit, dest);

            if (path !== null) {
              submit("move", path, { type: "wait" });
            }
          },
        });

        openActionMenu(dest, options);
      })();
    };

    // Open the build menu for an owned, empty production facility.
    const openBuildMenu = (buildable: BuildableTile) => {
      const snapshot = snapshotRef.current;
      const myPlayer = getPlayerById(match, playerId);
      const army = myPlayer === undefined ? undefined : getArmyForSlot(match, myPlayer.slot);

      if (snapshot === null || army === undefined) {
        return;
      }

      const sheet = spriteSheets[army];
      const buildableUnits = snapshot.production.priceTable
        .filter((entry) => entry.facility === buildable.facility)
        .sort((a, b) => a.cost - b.cost);

      const unitSize = baseTileSize / 2;
      const elements = buildableUnits.map((entry, index) => {
        const selectable = entry.cost <= snapshot.funds;
        const element = createUnitMenuElement(
          sheet,
          { unitType: entry.type, cost: entry.cost, selectable },
          index,
        );

        if (selectable) {
          element.on("pointerdown", () => {
            resetInteraction();
            actionMutation.mutate(
              {
                type: "build",
                unitType: entry.type,
                position: [buildable.position[0], buildable.position[1]],
                playerId,
                matchId,
              },
              { onError: onActionError("build") },
            );
          });
        }

        return element;
      });

      closeMenu();
      const menu = createBoardMenu(
        mapSize,
        buildable.position,
        buildableUnits.length * unitSize * 2,
        6,
        elements,
      );
      menuLayer.addChild(menu);
      openMenu = menu;
    };

    const onTileClick = (pos: BoardPosition) => {
      const currentMatch = matchRef.current;
      const snapshot = snapshotRef.current;
      const selected = selectionRef.current;

      if (currentMatch === null || snapshot === null) {
        return;
      }

      // --- With a unit selected: attack a red enemy, or stage a move at a reachable tile ---
      if (selected !== null) {
        const unit = snapshotUnitAt(snapshot, selected);

        if (unit !== undefined) {
          // Clicked a highlighted enemy -> attack from the staged origin (moving there first).
          if (inList(attackTargetsRef.current, pos)) {
            const path = reconstructPath(unit, stagedDestRef.current ?? selected);

            if (path !== null) {
              submit("attack", path, { type: "attack", defenderPosition: [pos[0], pos[1]] });
            }

            return;
          }

          // Clicked a reachable tile (its own tile included) -> stage there and open its menu.
          if (
            inList(
              unit.reachableTiles.map((tile) => tile.position),
              pos,
            )
          ) {
            stageMove(unit, selected, pos);

            return;
          }
        }
      }

      // --- Click an owned, empty production facility -> open its build menu. ---
      const buildable = snapshot.production.buildableTiles.find((tile) =>
        samePosition(tile.position, pos),
      );

      if (buildable !== undefined && getUnitAt(currentMatch, pos) === undefined) {
        resetInteraction();
        openBuildMenu(buildable);

        return;
      }

      // --- Otherwise: (re)select an own, ready unit, or clear. ---
      const myPlayer = getPlayerById(currentMatch, playerId);
      const unitHere = getUnitAt(currentMatch, pos);
      const snapshotUnit = snapshotUnitAt(snapshot, pos);

      if (
        myPlayer !== undefined &&
        unitHere !== undefined &&
        unitHere.playerSlot === myPlayer.slot &&
        snapshotUnit !== undefined &&
        snapshotUnit.reachableTiles.length > 0
      ) {
        resetInteraction();
        selectionRef.current = pos;
        drawHighlights(
          snapshotUnit.reachableTiles.map((tile) => tile.position),
          [],
        );
      } else {
        resetInteraction();
      }
    };

    app.stage.addChild(
      mapContainer,
      renderUnitsFromView(match, spriteSheets),
      renderInteractiveTilesFromView(match, onTileClick, () => undefined),
      menuLayer,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, spriteSheets]);

  if (matchQuery.isError || spriteSheetQuery.isError) {
    return <p>error {":("}</p>;
  }

  return (
    <div className="@w-full @h-full @flex @flex-col @items-center @justify-center @py-4">
      <p>
        {match === undefined || spriteSheets === undefined
          ? "Loading v2 board…"
          : `[v2 snapshot board] Funds: ${getPlayerById(match, playerId)?.funds ?? 0} — ${
              isMyTurn ? "your turn — pick a unit or facility on the board" : "waiting for opponent"
            }`}
      </p>
      {/* Only turn management lives in the bar; every other action is a menu on the board. */}
      <div className="@flex @gap-2">
        <button
          className="btn @select-none"
          disabled={!isMyTurn || actionMutation.isLoading}
          onClick={() => {
            resetInteractionRef.current();
            actionMutation.mutate(
              { type: "passTurn", playerId, matchId },
              { onError: onActionError("pass turn") },
            );
          }}
        >
          {isMyTurn ? "Pass Turn" : "Not your turn"}
        </button>
      </div>
      {/* pixi appends its own canvas here (created once, StrictMode-safe) */}
      <div ref={containerRef} style={{ imageRendering: "pixelated" }} />
    </div>
  );
}
