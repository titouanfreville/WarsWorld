import type { SpritesheetDataByArmy } from "frontend/components/match/getSpritesheetData";
import { useSpriteSheets } from "./match-board/useSpriteSheets";
import { trpc } from "frontend/utils/trpc-client";
import { createEditorBoard, type EditorBoard } from "pixi/editor/editor-board";
import { frameSize, frameThumbnail } from "pixi/editor/sprite-thumbnails";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  describeSaveState,
  mirrorImage,
  mirrorVariant,
  floodRegion,
  reflowVariants,
  type BuilderTile,
  type MapFairnessReport,
  type MapVocabulary,
  type MirrorImage,
  type MirrorMode,
  type PlaceableUnitFacts,
} from "frontend/components/maps/builder/builder-types";
import { MIRROR_GLYPHS, TOOL_GLYPHS } from "frontend/components/maps/builder/BuilderGlyphs";
import { CertificationLadder } from "frontend/components/maps/builder/CertificationLadder";
import { MyMaps } from "frontend/components/maps/builder/MyMaps";
import { RailSection } from "frontend/components/maps/builder/RailSection";
import { DirectionPicker } from "frontend/components/maps/builder/DirectionPicker";
import {
  SpriteThumb,
  spriteRefFor,
  type FrameLookup,
} from "frontend/components/maps/builder/SpriteThumb";
import {
  defaultHotbar,
  Hotbar,
  HOTBAR_COLUMNS,
  type HotbarCell,
} from "frontend/components/maps/builder/Hotbar";
import { useLocalStorage } from "frontend/utils/use-local-storage";
import { useMapDraft } from "frontend/components/maps/builder/use-map-draft";

type Props = {
  playerId: string;
  spritesheetDataByArmy: SpritesheetDataByArmy;
};

type Brush = { kind: "terrain" | "property" | "unit"; type: string };

/** A predeployed unit as the builder holds it. The server fills in HP, fuel and ammo on save. */
type DraftUnit = { type: string; playerSlot: number; position: [number, number] };

const unitKey = (x: number, y: number) => `${x},${y}`;

/**
 * Whether the selection must belong to a player.
 *
 * An HQ and a predeployed unit have no unowned form — the atlas carries no neutral art for either,
 * because neither exists unowned in the game.
 */
const ownerRequired = (brush: Brush | null) =>
  brush !== null && (brush.kind === "unit" || brush.type === "hq");

/**
 * The variant a set of held directions resolves to, or null while it names nothing the art can
 * draw. The legal list is the server's — this only checks membership.
 */
const resolveChosenVariant = (
  vocabulary: MapVocabulary,
  tileType: string,
  directions: string[],
): string | null => {
  if (directions.length === 0) {
    return null;
  }

  const facts = vocabulary.terrain.find((tile) => tile.type === tileType);
  const name = ["top", "right", "bottom", "left"]
    .filter((direction) => directions.includes(direction))
    .join("-");

  return facts?.variants.includes(name) === true ? name : null;
};

type Tool = "brush" | "fill" | "pick";

/** One square a stroke lands on: a target, or one of that target's mirror images. */
type Stroke = {
  x: number;
  y: number;
  slot: number;
  /** Absent on the original stroke; set on each mirrored one so its art can be turned to match. */
  transform?: MirrorImage["transform"];
  /** The target this came from. A fill has many, and each image must follow its own. */
  sourceX: number;
  sourceY: number;
};

const SIZE_PRESETS = [
  { width: 15, height: 15, label: "Duel, tight" },
  { width: 21, height: 15, label: "Duel, standard" },
  { width: 20, height: 20, label: "2v2" },
  { width: 24, height: 24, label: "Free-for-all" },
];

/** Faction colours are presentation, not game data — the mapping slot to faction is the server's. */
const SLOT_COLOURS = ["#d04038", "#466efe", "#37a42a", "#daa520"];

/** The blank cell comes from the server: `plain` needs a variant the client has no business knowing. */
const blankGrid = (width: number, height: number, blank: BuilderTile): BuilderTile[][] =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ...blank })));

/**
 * The map builder. Paints a grid, and shows the server's verdict on it.
 *
 * The verdict is never computed here: every check on screen came from `map.evaluate`, debounced, and
 * publishing re-runs it server-side anyway. The client owns the intent, the backend owns the rules.
 */
export default function MapBuilder({ playerId, spritesheetDataByArmy }: Props) {
  const { data: sheets } = useSpriteSheets(spritesheetDataByArmy);

  const [draftId, setDraftId] = useState<string | null>(null);
  const [seenAt, setSeenAt] = useState<Date | null>(null);
  const [name, setName] = useState("Untitled map");
  const [tiles, setTiles] = useState<BuilderTile[][]>([]);
  const [units, setUnits] = useState<DraftUnit[]>([]);
  const [brush, setBrush] = useState<Brush | null>(null);
  const [slot, setSlot] = useState(0);
  const [mirrorId, setMirrorId] = useState("none");
  /** Directions the author is holding. May not resolve to real art yet — see DirectionPicker. */
  const [pendingDirections, setPendingDirections] = useState<string[]>([]);
  /** Coordinates whose facing was chosen by hand, which auto-resolution must leave alone. */
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [binding, setBinding] = useState(false);
  const [tool, setTool] = useState<Tool>("brush");
  const [openingId, setOpeningId] = useState<string | null>(null);

  // A shortcut bar is a personal preference, not game data — the browser is the right home for it.
  // `useLocalStorage` stores strings, so the layout is serialised here rather than widening it.
  const [storedHotbar, setStoredHotbar] = useLocalStorage("mapBuilderHotbar", null);
  const [zoom, setZoom] = useState(2);
  const [highlight, setHighlight] = useState<[number, number][]>([]);
  const [error, setError] = useState<string | null>(null);

  // Terrain, properties, units and the tile connection table all come from the backend. The client
  // holds no copy of any of it; without this there is nothing to paint with.
  const { data: vocabulary } = trpc.map.vocabulary.useQuery(undefined, { staleTime: Infinity });
  // The author's own maps, so a draft can be picked up again instead of being lost.
  const myMaps = trpc.map.listMine.useQuery(
    { playerId },
    // Refetched when the builder returns to its start screen, so a map just saved appears there.
    { enabled: true },
  );
  const utils = trpc.useContext();
  const startDraft = trpc.map.startDraft.useMutation();
  const resize = trpc.map.resize.useMutation();
  const publish = trpc.map.publish.useMutation();
  const submitForRanked = trpc.map.submitForRanked.useMutation();

  const mountRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<EditorBoard | null>(null);
  const tilesRef = useRef<BuilderTile[][]>([]);
  const brushRef = useRef(brush);
  const slotRef = useRef(slot);
  const mirrorRef = useRef(mirrorId);
  const directionsRef = useRef(pendingDirections);
  const pinnedRef = useRef(pinned);
  const toolRef = useRef(tool);
  const unitsRef = useRef(units);
  const vocabularyRef = useRef<MapVocabulary | null>(null);

  tilesRef.current = tiles;
  brushRef.current = brush;
  slotRef.current = slot;
  mirrorRef.current = mirrorId;
  directionsRef.current = pendingDirections;
  pinnedRef.current = pinned;
  toolRef.current = tool;
  unitsRef.current = units;
  vocabularyRef.current = vocabulary ?? null;

  /**
   * The bar as it stands: whatever was saved, otherwise the stock layout built from the server's
   * rosters. A stored bar from an older deploy can name a tile that no longer exists, so entries
   * are checked against the current vocabulary rather than trusted.
   */
  const hotbar: (HotbarCell | null)[] = useMemo(() => {
    if (vocabulary === undefined) {
      return [];
    }

    const stock = defaultHotbar(vocabulary);

    if (storedHotbar === null) {
      return stock;
    }

    try {
      const saved = JSON.parse(storedHotbar) as (HotbarCell | null)[];
      const known = new Set([
        ...vocabulary.terrain.map((tile) => tile.type),
        ...vocabulary.units.map((unit) => unit.type),
      ]);

      return stock.map((fallback, index) => {
        const cell = saved[index];

        return cell != null && known.has(cell.type)
          ? cell
          : saved[index] === null
            ? null
            : fallback;
      });
    } catch {
      return stock;
    }
  }, [vocabulary, storedHotbar]);

  /**
   * How the palettes resolve a frame. Backed by pixi so rotated and trimmed atlas frames compose
   * correctly — the army sheets are full of both, and CSS cannot undo either.
   */
  const lookup = useMemo(
    () => ({
      url: (ref: { sheet: string; frame: string }) =>
        sheets === undefined ? null : frameThumbnail(sheets, ref),
      size: (ref: { sheet: string; frame: string }) =>
        sheets === undefined ? null : frameSize(sheets, ref),
    }),
    [sheets],
  );

  const draft = useMapDraft({
    mapId: draftId ?? "",
    playerId,
    initialSeenAt: seenAt ?? new Date(0),
  });

  const { report, setReport, saveState, onEdit, saveNow, evaluate } = draft;

  /** Ask the server for a verdict once the grid has been still for a moment. */
  const requestCheck = useCallback(
    (nextTiles: BuilderTile[][], nextName: string, nextUnits: DraftUnit[]) => {
      evaluate
        .mutateAsync({
          playerId,
          name: nextName,
          tiles: nextTiles as Parameters<typeof evaluate.mutateAsync>[0]["tiles"],
          predeployedUnits: nextUnits,
        })
        .then((result) => setReport(result))
        .catch(() => {
          // A dropped check is not a failure worth interrupting for — the next stroke re-asks, and
          // publish re-evaluates server-side regardless.
        });
    },
    [evaluate, playerId, setReport],
  );

  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const paint = useCallback((x: number, y: number) => {
    const grid = tilesRef.current;

    if (grid[y]?.[x] === undefined) {
      return;
    }

    const current = brushRef.current;
    const words = vocabularyRef.current;

    if (current === null || words === null) {
      return;
    }

    // The eyedropper reads rather than writes, so it takes the whole stroke and returns.
    if (toolRef.current === "pick") {
      const unit = unitsRef.current.find(
        (candidate) => unitKey(...candidate.position) === unitKey(x, y),
      );

      if (unit !== undefined) {
        setBrush({ kind: "unit", type: unit.type });
        setSlot(unit.playerSlot);
      } else {
        const tile = grid[y][x];
        setBrush({
          kind: words.properties.includes(tile.type) ? "property" : "terrain",
          type: tile.type,
        });

        if (tile.playerSlot !== undefined) {
          setSlot(tile.playerSlot);
        }

        // Pick up the facing too, but only when it was chosen by hand — copying an auto-resolved
        // variant would pin it everywhere the next stroke lands.
        setPendingDirections(
          pinnedRef.current.has(unitKey(x, y)) && tile.variant !== undefined
            ? tile.variant.split("-")
            : [],
        );
      }

      setTool("brush");

      return;
    }

    setHighlight([]);

    const height = grid.length;
    const width = grid[0]?.length ?? 0;
    const mode = words.mirrors.find((entry) => entry.id === mirrorRef.current);

    /*
     * Which squares the tool addresses before mirroring: one for the brush, a whole contiguous
     * region for the fill.
     *
     * Fill never applies to units — flooding a lake with tanks is never what anyone meant, and a
     * region can easily exceed the 200-unit cap the server enforces. With a unit selected it lays
     * down a single one, as the brush would.
     */
    const targets =
      toolRef.current === "fill" && current.kind !== "unit"
        ? floodRegion(grid, x, y)
        : [[x, y] as [number, number]];

    /*
     * Every square the stroke touches: each target, plus one image per mirror entry.
     *
     * Each image carries its own seat, taken from the server's permutation — mirroring a red base
     * must produce a BLUE base, not a second red one. Neutral has no mirror seat and stays neutral.
     *
     * Each also remembers the target it came from, so a mirrored tile can be turned to match the
     * square it was copied from rather than the one that happened to be clicked.
     */
    const strokes: Stroke[] = [];

    for (const [tx, ty] of targets) {
      strokes.push({ x: tx, y: ty, slot: slotRef.current, sourceX: tx, sourceY: ty });

      for (const image of mode?.images ?? []) {
        const [mx, my] = mirrorImage(image.transform, tx, ty, width, height);

        if (grid[my]?.[mx] === undefined || (mx === tx && my === ty)) {
          continue;
        }

        strokes.push({
          x: mx,
          y: my,
          slot:
            slotRef.current < 0
              ? slotRef.current
              : (image.slotMap[slotRef.current] ?? slotRef.current),
          transform: image.transform,
          sourceX: tx,
          sourceY: ty,
        });
      }
    }

    const painted = new Set(strokes.map((stroke) => unitKey(stroke.x, stroke.y)));

    if (current.kind === "unit") {
      // One unit per square, and the newest wins — placing over an existing one replaces it.
      setUnits((existing) => [
        ...existing.filter((unit) => !painted.has(unitKey(...unit.position))),
        ...strokes.map((stroke) => ({
          type: current.type,
          playerSlot: Math.max(0, stroke.slot),
          position: [stroke.x, stroke.y] as [number, number],
        })),
      ]);

      return;
    }

    const next = grid.map((row) => row.map((tile) => ({ ...tile })));

    for (const stroke of strokes) {
      next[stroke.y][stroke.x] =
        current.kind === "property"
          ? { type: current.type, playerSlot: stroke.slot }
          : { type: current.type };
    }

    // A facing chosen by hand applies to the stroke and pins it, so a later stroke beside it does
    // not quietly turn it back.
    const chosen = resolveChosenVariant(words, current.type, directionsRef.current);
    const pinnedNow = new Set(pinnedRef.current);

    if (chosen !== null && current.kind === "terrain") {
      for (const stroke of strokes) {
        pinnedNow.add(unitKey(stroke.x, stroke.y));
      }
    } else {
      for (const stroke of strokes) {
        pinnedNow.delete(unitKey(stroke.x, stroke.y));
      }
    }

    // Neighbours first, so every mirrored tile resolves against its own surroundings...
    for (const stroke of strokes) {
      reflowVariants(next, stroke.x, stroke.y, words, pinnedNow);
    }

    if (chosen !== null && current.kind === "terrain") {
      for (const [tx, ty] of targets) {
        next[ty][tx].variant = chosen;
      }
    }

    // ...then carry each source tile's facing across to its own images, because a `top-right` road
    // mirrored 180 degrees is a `bottom-left` one and auto-resolution alone would not turn it round.
    for (const stroke of strokes) {
      if (stroke.transform === undefined) {
        continue;
      }

      const mirrored = mirrorVariant(
        next[stroke.sourceY][stroke.sourceX].variant,
        stroke.transform,
      );

      if (mirrored !== undefined) {
        next[stroke.y][stroke.x].variant = mirrored;
      }
    }

    setPinned(pinnedNow);
    setTiles(next);

    // Terrain painted under a unit can strand it — a tank does not float once you flood its square.
    // The server's `units-placeable` check is the authority; this just stops you creating one by
    // accident with a stroke aimed at the ground.
    setUnits((existing) => existing.filter((unit) => !painted.has(unitKey(...unit.position))));
  }, []);

  // Boot: create the draft row before the first stroke, so autosave is only ever an update.
  const begin = async (width: number, height: number) => {
    setError(null);
    const words = vocabularyRef.current;

    if (words === null) {
      return;
    }

    try {
      const created = await startDraft.mutateAsync({ playerId, width, height });
      setDraftId(created.id);
      setSeenAt(created.updatedAt);
      setName(created.name);
      setTiles(blankGrid(width, height, words.blankTile));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start a map.");
    }
  };

  /** Open one of the caller's existing maps. */
  const openMap = async (mapId: string) => {
    setError(null);
    setOpeningId(mapId);

    try {
      const loaded = await utils.client.map.getForEdit.query({ playerId, mapId });

      setDraftId(loaded.id);
      setSeenAt(loaded.updatedAt);
      setName(loaded.name);
      setTiles(loaded.tiles as BuilderTile[][]);
      setUnits(loaded.predeployedUnits as DraftUnit[]);
      setReport(loaded.report);
      /*
       * Variants are NOT pinned on load.
       *
       * A saved facing is authored fact, but pinning every one of them would freeze the whole map:
       * painting a road beside an existing one would leave the old tile pointing the wrong way
       * forever. Auto-resolution tidying its neighbours is the behaviour that matches what people
       * expect from an editor, and a deliberately odd facing can be re-pinned.
       */
      setPinned(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open that map.");
    } finally {
      setOpeningId(null);
    }
  };

  // Mount the Pixi board once the atlases are decoded and a draft exists.
  useEffect(() => {
    if (sheets === undefined || draftId === null || mountRef.current === null) {
      return;
    }

    const board = createEditorBoard({
      sheets,
      armyBySlot: vocabulary?.armyBySlot ?? [],
      onPaint: paint,
      onHover: () => undefined,
    });

    boardRef.current = board;
    mountRef.current.appendChild(board.view);

    return () => {
      board.destroy();
      boardRef.current = null;
    };
  }, [sheets, draftId, paint, vocabulary?.armyBySlot]);

  // Redraw, then schedule the debounced check and the autosave.
  useEffect(() => {
    if (boardRef.current === null || tiles.length === 0) {
      return;
    }

    boardRef.current.setGrid(tiles, units, highlight);
    boardRef.current.setZoom(zoom);
    // Only the brush drags; fill and pick act once per press.
    boardRef.current.setContinuous(tool === "brush");
  }, [tiles, units, highlight, zoom, tool]);

  useEffect(() => {
    if (draftId === null || tiles.length === 0) {
      return;
    }

    onEdit({ name, tiles, predeployedUnits: units });

    if (checkTimer.current !== null) {
      clearTimeout(checkTimer.current);
    }

    checkTimer.current = setTimeout(() => requestCheck(tiles, name, units), 400);

    return () => {
      if (checkTimer.current !== null) {
        clearTimeout(checkTimer.current);
      }
    };
    // `onEdit`/`requestCheck` are stable enough; re-running on every render would defeat the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles, units, name, draftId]);

  /** Reshape the map. Destructive downward, so the caller has already confirmed. */
  const applyResize = async (width: number, height: number, anchor: string) => {
    if (draftId === null || seenAt === null) {
      return;
    }

    setError(null);

    try {
      await saveNow();
      const result = await resize.mutateAsync({
        playerId,
        mapId: draftId,
        seenAt: draft.lastSeenAt(),
        width,
        height,
        anchor: anchor as never,
      });

      setTiles(result.tiles as BuilderTile[] /* rows */[]);
      setUnits(result.predeployedUnits as DraftUnit[]);
      setReport(result.report);
      draft.adopt(result.updatedAt);

      if (result.droppedUnits > 0) {
        setError(
          `Resized. ${result.droppedUnits} unit${result.droppedUnits === 1 ? "" : "s"} fell outside the new map and ${result.droppedUnits === 1 ? "was" : "were"} removed.`,
        );
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not resize.");
    }
  };

  const applyHotbar = useCallback(
    (index: number) => {
      const cell = hotbar[index];

      if (cell === null || cell === undefined) {
        return;
      }

      setBrush({ kind: cell.kind, type: cell.type });
      setPendingDirections([]);

      const wanted = cell.slot ?? slotRef.current;
      setSlot(ownerRequired({ kind: cell.kind, type: cell.type }) ? Math.max(0, wanted) : wanted);
    },
    [hotbar],
  );

  const bindHotbar = (index: number) => {
    if (brush === null) {
      return;
    }

    const next = [...hotbar];
    // Binding captures the owner you had at the time — that is the point of building your own bar.
    next[index] = {
      kind: brush.kind,
      type: brush.type,
      ...(brush.kind === "terrain" ? {} : { slot }),
    };
    setStoredHotbar(JSON.stringify(next));
  };

  /*
   * Keyboard. Digits drive the shortcut bar and arrows compose a direction, which is the pairing
   * the tool is actually used with: one hand on the pointer, one on the keys.
   *
   * Digits are read off `event.code` so the bar works on AZERTY, where the unshifted key of
   * `Digit1` is not "1".
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const digit = /^Digit([0-9])$/.exec(event.code);

      if (digit !== null) {
        const column = digit[1] === "0" ? 9 : Number(digit[1]) - 1;
        applyHotbar((event.shiftKey ? HOTBAR_COLUMNS : 0) + column);
        event.preventDefault();

        return;
      }

      const arrow = { ArrowUp: "top", ArrowRight: "right", ArrowDown: "bottom", ArrowLeft: "left" }[
        event.key
      ];

      if (arrow !== undefined) {
        setPendingDirections((held) =>
          held.includes(arrow) ? held.filter((one) => one !== arrow) : [...held, arrow],
        );
        event.preventDefault();

        return;
      }

      if (event.key === "Backspace") {
        setPendingDirections([]);
        event.preventDefault();

        return;
      }

      const key = event.key.toLowerCase();

      if (key === "b" || key === "f" || key === "i") {
        setTool({ b: "brush", f: "fill", i: "pick" }[key] as Tool);
      } else if (key === "x") {
        setBinding((on) => !on);
      } else if (key === "n") {
        setSlot(-1);
      } else if (key === "[" || key === "]") {
        // Cycling suits owner better than jumping: you toggle between two seats far more often
        // than you reach for a fourth.
        const order = [0, 1, 2, 3, -1];
        const at = order.indexOf(slot);
        setSlot(order[(at + (key === "]" ? 1 : -1) + order.length) % order.length]);
      } else if (key === "m" && vocabulary !== undefined) {
        const usable = vocabulary.mirrors.filter(
          (mode) => !mode.squareOnly || (tiles[0]?.length ?? 0) === tiles.length,
        );
        const at = usable.findIndex((mode) => mode.id === mirrorId);
        setMirrorId(usable[(at + 1) % usable.length].id);
      }
    };

    document.addEventListener("keydown", onKey);

    return () => document.removeEventListener("keydown", onKey);
  }, [applyHotbar, slot, mirrorId, tiles, vocabulary]);

  const act = async (
    run: () => Promise<MapFairnessReport>,
    onDone: (report: MapFairnessReport) => void,
  ) => {
    setError(null);

    try {
      await saveNow();
      onDone(await run());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not work.");
    }
  };

  if (vocabulary === undefined) {
    return <p className="@p-6 @text-white/50">Loading map pieces…</p>;
  }

  if (draftId === null) {
    return (
      <div className="@mx-auto @flex @w-full @max-w-2xl @flex-col @gap-6 @p-6">
        <MyMaps maps={myMaps.data ?? []} busyId={openingId} onOpen={(id) => void openMap(id)} />

        <div>
          <h1 className="@font-russoOne @text-2xl">
            {(myMaps.data?.length ?? 0) > 0 ? "Or start a new one" : "How big?"}
          </h1>
          <p className="@mt-2 @text-sm @text-white/60">
            Size is the only thing worth deciding before the first tile. Everything else is painted,
            and the checker reads it back off the grid.
          </p>
        </div>

        <div className="@grid @grid-cols-2 @gap-2 large_tablet:@grid-cols-4">
          {SIZE_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={startDraft.isLoading}
              onClick={() => void begin(preset.width, preset.height)}
              className="@flex @flex-col @gap-1 @rounded @border @border-white/10 @bg-bg-secondary @p-3 @text-left @transition hover:@border-primary disabled:@opacity-50"
            >
              <span className="@tabular-nums @text-lg">
                {preset.width} × {preset.height}
              </span>
              <span className="@text-xs @text-white/40">{preset.label}</span>
            </button>
          ))}
        </div>

        {error !== null && <p className="@text-sm @text-orange-star">{error}</p>}
      </div>
    );
  }

  return (
    <div className="@flex @w-full @flex-col @gap-4 @p-4 laptop:@h-[calc(100vh-5rem)] laptop:@flex-row laptop:@overflow-hidden">
      {/* Palette */}
      {/* Rails scroll on their own; the board column does not, so the map is always on screen. */}
      <div className="@flex @shrink-0 @flex-col laptop:@w-64 laptop:@overflow-y-auto laptop:@pr-1">
        <div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label="Map name"
            className="@w-full @border-b @border-dashed @border-white/20 @bg-transparent @pb-1 @font-russoOne @text-lg focus:@border-primary focus:@outline-none"
          />
          <div className="@mt-1 @flex @items-center @justify-between @gap-2">
            <p className="@text-xs @text-white/40">{describeSaveState(saveState)}</p>
            <button
              type="button"
              onClick={() => {
                void saveNow().then(async () => {
                  await utils.map.listMine.invalidate();
                  setDraftId(null);
                });
              }}
              className="@shrink-0 @text-xs @text-white/40 @underline hover:@text-white"
            >
              All maps
            </button>
          </div>
        </div>

        {/*
          Tool and owner share one unlabelled row. Both are single-choice controls of three to five
          options whose meaning is carried by the icon or the colour — a heading, a summary and a
          hint paragraph each cost more height than the buttons themselves.
        */}
        <div className="@flex @items-center @justify-between @gap-3 @border-b @border-white/5 @py-2">
          <ToolPicker active={tool} unitSelected={brush?.kind === "unit"} onPick={setTool} />

          <div className="@flex @gap-1" role="group" aria-label="Owner">
            {[0, 1, 2, 3, -1].map((value) => (
              <button
                key={value}
                type="button"
                // An HQ and a unit have no unowned form: the atlas carries no neutral art for
                // either, because neither exists unowned in the game.
                disabled={value < 0 && ownerRequired(brush)}
                title={
                  value < 0 && ownerRequired(brush)
                    ? `${brush?.kind === "unit" ? "A unit" : "An HQ"} must belong to a player`
                    : value >= 0
                      ? `Player ${value + 1}`
                      : "Neutral"
                }
                aria-label={value >= 0 ? `Player ${value + 1}` : "Neutral"}
                aria-pressed={slot === value}
                onClick={() => setSlot(value)}
                style={{ background: value >= 0 ? SLOT_COLOURS[value] : "#7d8798" }}
                className={`@h-5 @w-5 @rounded-sm @transition disabled:@opacity-20 ${
                  slot === value ? "@ring-2 @ring-white" : "@opacity-70 hover:@opacity-100"
                }`}
              />
            ))}
          </div>
        </div>

        <RailSection
          title="Mirror"
          summary={`${(vocabulary.mirrors.find((mode) => mode.id === mirrorId)?.images.length ?? 0) + 1}× per stroke`}
        >
          <MirrorPicker
            modes={vocabulary.mirrors}
            active={mirrorId}
            square={(tiles[0]?.length ?? 0) === tiles.length}
            onPick={setMirrorId}
          />
        </RailSection>

        <RailSection
          title="Size"
          defaultOpen={false}
          summary={`${tiles[0]?.length ?? 0} × ${tiles.length}`}
        >
          <ResizePanel
            width={tiles[0]?.length ?? 0}
            height={tiles.length}
            bounds={vocabulary.size}
            anchors={vocabulary.resizeAnchors}
            busy={resize.isLoading}
            onResize={(w, h, anchor) => void applyResize(w, h, anchor)}
          />
        </RailSection>

        <RailSection title="Terrain" summary={brush?.kind === "terrain" ? brush.type : undefined}>
          <Palette
            lookup={lookup}
            vocabulary={vocabulary}
            slot={slot}
            types={vocabulary.terrain
              .filter((t) => !vocabulary.properties.includes(t.type))
              .map((t) => t.type)}
            active={brush}
            kind="terrain"
            onPick={(type) => {
              setBrush({ kind: "terrain", type });

              if (ownerRequired({ kind: "terrain", type }) && slot < 0) {
                setSlot(0);
              }
            }}
          />
        </RailSection>

        <DirectionPicker
          lookup={lookup}
          armyBySlot={vocabulary.armyBySlot}
          terrain={
            brush?.kind === "terrain"
              ? vocabulary.terrain.find((tile) => tile.type === brush.type)
              : undefined
          }
          pending={pendingDirections}
          resolved={
            brush === null ? null : resolveChosenVariant(vocabulary, brush.type, pendingDirections)
          }
          onToggle={(direction) =>
            setPendingDirections((held) =>
              held.includes(direction)
                ? held.filter((one) => one !== direction)
                : [...held, direction],
            )
          }
          onPick={(variant) => setPendingDirections(variant.split("-"))}
          onAuto={() => setPendingDirections([])}
        />

        <RailSection title="Property" summary={brush?.kind === "property" ? brush.type : undefined}>
          <Palette
            lookup={lookup}
            vocabulary={vocabulary}
            slot={slot}
            types={vocabulary.properties}
            active={brush}
            kind="property"
            onPick={(type) => {
              setBrush({ kind: "property", type });

              if (ownerRequired({ kind: "property", type }) && slot < 0) {
                setSlot(0);
              }
            }}
          />
        </RailSection>

        <RailSection
          title="Predeployed unit"
          summary={brush?.kind === "unit" ? brush.type : undefined}
        >
          <Palette
            lookup={lookup}
            vocabulary={vocabulary}
            slot={slot}
            types={vocabulary.units.map((unit) => unit.type)}
            labels={Object.fromEntries(vocabulary.units.map((u) => [u.type, u.displayName]))}
            active={brush}
            kind="unit"
            onPick={(type) => {
              setBrush({ kind: "unit", type });

              if (ownerRequired({ kind: "unit", type }) && slot < 0) {
                setSlot(0);
              }
            }}
          />
        </RailSection>

        {brush?.kind === "unit" && (
          <UnitFacts facts={vocabulary.units.find((unit) => unit.type === brush.type)} />
        )}

        {units.length > 0 && (
          <button
            type="button"
            onClick={() => setUnits([])}
            className="@rounded @border @border-white/15 @px-2 @py-1.5 @text-xs @text-white/60 hover:@border-orange-star hover:@text-white"
          >
            Clear {units.length} unit{units.length === 1 ? "" : "s"}
          </button>
        )}
      </div>

      {/* Board */}
      <div className="@flex @min-w-0 @flex-1 @flex-col @items-center @gap-3 laptop:@overflow-auto">
        <div ref={mountRef} className="@overflow-auto @border @border-white/15 @bg-bg-primary" />

        <Hotbar
          cells={hotbar}
          lookup={lookup}
          vocabulary={vocabulary}
          activeSlot={slot}
          binding={binding}
          isActive={(cell) => brush?.kind === cell.kind && brush.type === cell.type}
          onUse={applyHotbar}
          onBind={bindHotbar}
          onToggleBinding={() => setBinding((on) => !on)}
          onReset={() => setStoredHotbar(null)}
        />

        <div className="@flex @items-center @gap-2 @font-mono @text-xs @text-white/40">
          <span>Zoom</span>
          {[1, 2, 3].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={zoom === value}
              onClick={() => setZoom(value)}
              className={`@rounded @border @px-2 @py-1 ${
                zoom === value ? "@border-primary @text-white" : "@border-white/10"
              }`}
            >
              {value}×
            </button>
          ))}
        </div>
      </div>

      {/* Verdict */}
      <div className="@flex @shrink-0 @flex-col @gap-3 laptop:@w-80 laptop:@overflow-y-auto laptop:@pl-1">
        <CertificationLadder report={report} onFocus={setHighlight} />

        {error !== null && (
          <p className="@rounded @border @border-orange-star/40 @bg-orange-star/10 @p-3 @text-sm">
            {error}
          </p>
        )}

        <div className="@flex @flex-col @gap-2">
          <button
            type="button"
            onClick={() => void saveNow()}
            className="@rounded @border @border-white/15 @px-3 @py-2 @font-mono @text-xs @uppercase @tracking-widest hover:@border-primary"
          >
            Save draft
          </button>

          <button
            type="button"
            disabled={report?.isPlayable !== true}
            onClick={() =>
              void act(
                () => publish.mutateAsync({ playerId, mapId: draftId }),
                (next) => setReport(next),
              )
            }
            className="@rounded @bg-primary @px-3 @py-2 @font-mono @text-xs @font-bold @uppercase @tracking-widest @text-black disabled:@opacity-40"
          >
            Publish map
          </button>

          <button
            type="button"
            disabled={report?.isFair !== true}
            onClick={() =>
              void act(
                () => submitForRanked.mutateAsync({ playerId, mapId: draftId }),
                (next) => setReport(next),
              )
            }
            className="@rounded @border @border-yellow-comet/50 @px-3 @py-2 @font-mono @text-xs @uppercase @tracking-widest @text-yellow-comet disabled:@opacity-40"
          >
            Submit to ranked pool
          </button>
        </div>
      </div>
    </div>
  );
}

type PaletteProps = {
  types: readonly string[];
  kind: Brush["kind"];
  active: Brush | null;
  /** Display names, when the server has nicer ones than the engine key. */
  labels?: Record<string, string>;
  lookup: FrameLookup;
  vocabulary: MapVocabulary;
  /** Owner to draw properties and units in, so the palette matches what a stroke would place. */
  slot: number;
  onPick: (type: string) => void;
};

/**
 * A palette of real sprites.
 *
 * Each cell shows the actual atlas frame rather than a name, and properties and units are drawn in
 * the currently selected owner's colours — so the palette shows what a stroke would put down, not
 * an approximation of it. The name stays underneath: at 16 pixels a lab and a comm tower are not
 * far apart, and a picker you have to squint at is worse than one that spells it out.
 */
function Palette({ types, kind, active, labels, lookup, vocabulary, slot, onPick }: PaletteProps) {
  return (
    /*
     * Three rows that flow sideways, rather than a column that grows downwards.
     *
     * A three-WIDE grid of 25 units is nine rows tall, which pushes every section below it off
     * screen and forces the rail to scroll — taking the map with it. Three rows deep and as many
     * columns as it needs keeps every section a fixed height, so the whole rail fits and the board
     * keeps the vertical space. The scroll lives on this container, so the page never moves sideways.
     */
    <div className="@grid @grid-flow-col @grid-rows-3 @auto-cols-max @gap-1 @overflow-x-auto @pb-1 [scrollbar-width:thin]">
      {types.map((type) => {
        const selected = active?.kind === kind && active.type === type;
        const sprite = spriteRefFor(lookup, {
          kind,
          type,
          slot,
          armyBySlot: vocabulary.armyBySlot,
          variants: vocabulary.terrain.find((tile) => tile.type === type)?.variants,
        });

        return (
          <button
            key={type}
            type="button"
            title={labels?.[type] ?? type}
            aria-pressed={selected}
            onClick={() => onPick(type)}
            className={`@flex @w-[3.25rem] @shrink-0 @flex-col @items-center @gap-0.5 @rounded @border @px-0.5 @pb-1 @pt-1.5 @transition ${
              selected
                ? "@border-primary @bg-primary/20"
                : "@border-white/10 @bg-bg-secondary hover:@border-white/30"
            }`}
          >
            {/* Fixed-height box so tall art letterboxes rather than making the row ragged. */}
            <span className="@flex @h-8 @items-end @justify-center">
              <SpriteThumb lookup={lookup} sprite={sprite} size={28} />
            </span>
            <span
              className={`@w-full @truncate @text-center @text-[0.55rem] @leading-none ${
                selected ? "@text-white" : "@text-white/50"
              }`}
            >
              {labels?.[type] ?? type}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The selected unit's published stats. Read off the vocabulary the server sent — the client keeps
 * no table of costs, movement or vision.
 */
function UnitFacts({ facts }: { facts?: PlaceableUnitFacts }) {
  if (facts === undefined) {
    return null;
  }

  return (
    <dl className="@grid @grid-cols-2 @gap-x-2 @gap-y-0.5 @rounded @border @border-white/10 @bg-bg-secondary @p-2 @text-[0.65rem] @text-white/50">
      <dt>Cost</dt>
      <dd className="@text-right @tabular-nums @text-white/80">{facts.cost}</dd>
      <dt>Movement</dt>
      <dd className="@text-right @tabular-nums @text-white/80">
        {facts.movementPoints} · {facts.movementType}
      </dd>
      <dt>Vision</dt>
      <dd className="@text-right @tabular-nums @text-white/80">{facts.vision}</dd>
      <dt>Built at</dt>
      <dd className="@text-right @capitalize @text-white/80">{facts.facility}</dd>
    </dl>
  );
}

type MirrorPickerProps = {
  modes: MirrorMode[];
  active: string;
  square: boolean;
  onPick: (id: string) => void;
};

/**
 * The mirror brush. A tool, not a property of the map — nothing here is stored, and the map's real
 * symmetry is measured off the grid. The seat permutations behind each mode come from the server.
 */
function MirrorPicker({ modes, active, square, onPick }: MirrorPickerProps) {
  const current = modes.find((mode) => mode.id === active);

  return (
    <div>
      <p className="@mb-2 @font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40">
        Mirror strokes
      </p>
      <div className="@flex @gap-1">
        {modes.map((mode) => {
          const blocked = mode.squareOnly && !square;

          return (
            <button
              key={mode.id}
              type="button"
              disabled={blocked}
              aria-pressed={active === mode.id}
              title={blocked ? "Needs a square map" : mode.label}
              onClick={() => onPick(mode.id)}
              className={`@flex @flex-1 @flex-col @items-center @gap-1 @rounded @border @px-1 @py-1.5 @transition ${
                active === mode.id
                  ? "@border-primary @bg-primary/20 @text-white"
                  : "@border-white/10 @bg-bg-secondary @text-white/60"
              } disabled:@opacity-30`}
            >
              {(() => {
                // A diagram beats a label here: one filled quadrant for the stroke, fainter ones
                // for its images, so the control looks like what it does.
                const Glyph = MIRROR_GLYPHS[mode.id];

                return Glyph === undefined ? null : <Glyph />;
              })()}
              <span className="@text-[0.55rem] @tabular-nums @leading-none">
                {mode.images.length + 1}×
              </span>
            </button>
          );
        })}
      </div>
      {current !== undefined && (
        <p className="@mt-2 @text-[0.7rem] @leading-snug @text-white/40">{current.hint}</p>
      )}
    </div>
  );
}

type ResizePanelProps = {
  width: number;
  height: number;
  bounds: { min: number; max: number };
  anchors: string[];
  busy: boolean;
  onResize: (width: number, height: number, anchor: string) => void;
};

/**
 * Resize, with the anchor deciding which corner stays put.
 *
 * Shrinking throws away whatever falls outside, so the button says what will be lost before you
 * press it rather than after.
 */
function ResizePanel({ width, height, bounds, anchors, busy, onResize }: ResizePanelProps) {
  const [nextWidth, setNextWidth] = useState(width);
  const [nextHeight, setNextHeight] = useState(height);
  const [anchor, setAnchor] = useState("top-left");

  useEffect(() => {
    setNextWidth(width);
    setNextHeight(height);
  }, [width, height]);

  const clamp = (value: number) => Math.max(bounds.min, Math.min(bounds.max, value));
  const shrinking = nextWidth < width || nextHeight < height;
  const unchanged = nextWidth === width && nextHeight === height;

  return (
    <div>
      <p className="@mb-2 @font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40">
        Size
      </p>

      <div className="@flex @items-center @gap-1.5">
        <input
          type="number"
          value={nextWidth}
          min={bounds.min}
          max={bounds.max}
          aria-label="Width"
          onChange={(event) => setNextWidth(clamp(Number(event.target.value) || bounds.min))}
          className="@w-14 @rounded @border @border-white/10 @bg-bg-primary @px-1.5 @py-1 @text-xs @tabular-nums"
        />
        <span className="@text-white/30">×</span>
        <input
          type="number"
          value={nextHeight}
          min={bounds.min}
          max={bounds.max}
          aria-label="Height"
          onChange={(event) => setNextHeight(clamp(Number(event.target.value) || bounds.min))}
          className="@w-14 @rounded @border @border-white/10 @bg-bg-primary @px-1.5 @py-1 @text-xs @tabular-nums"
        />
      </div>

      {/*
        The nine-way anchor: which part of the current map keeps its place. Drawn as the grid it
        describes rather than named, but labelled — it is not self-explanatory, and picking the
        wrong one silently throws away the wrong side of the map.
      */}
      <p className="@mt-3 @text-[0.7rem] @text-white/40">Anchor — the corner that stays put</p>
      <div
        className="@mt-1 @grid @w-fit @grid-cols-3 @gap-0.5"
        role="group"
        aria-label="Anchor: which part of the map keeps its place"
      >
        {anchors.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Anchor ${option.replace("-", " ")}`}
            title={
              shrinking
                ? `Keep the ${option.replace("-", " ")} of the map and crop the rest`
                : `Keep the map at the ${option.replace("-", " ")} and add space around it`
            }
            aria-pressed={anchor === option}
            onClick={() => setAnchor(option)}
            className={`@h-4 @w-4 @rounded-sm @border ${
              anchor === option
                ? "@border-primary @bg-primary"
                : "@border-white/15 @bg-bg-secondary"
            }`}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={busy || unchanged}
        onClick={() => onResize(nextWidth, nextHeight, anchor)}
        className="@mt-2 @w-full @rounded @border @border-white/15 @px-2 @py-1.5 @text-xs hover:@border-primary disabled:@opacity-40"
      >
        {unchanged ? "Same size" : shrinking ? "Crop map" : "Resize map"}
      </button>

      <p className="@mt-1.5 @text-[0.7rem] @leading-snug @text-white/40">
        {unchanged
          ? "Change a number, then pick which corner stays put."
          : shrinking
            ? `Keeps the ${anchor.replace("-", " ")} of the map. Anything outside the new size is discarded.`
            : `Keeps the map at the ${anchor.replace("-", " ")} and adds blank ground on the other sides.`}
      </p>
    </div>
  );
}

type ToolPickerProps = {
  active: Tool;
  /** Fill is meaningless with a unit selected, and the control should say so rather than misfire. */
  unitSelected: boolean;
  onPick: (tool: Tool) => void;
};

const TOOLS: { id: Tool; label: string; key: string; hint: string }[] = [
  { id: "brush", label: "Brush", key: "B", hint: "Paint one tile, or drag to paint a line." },
  { id: "fill", label: "Fill", key: "F", hint: "Replace the whole contiguous run of one terrain." },
  {
    id: "pick",
    label: "Pick",
    key: "I",
    hint: "Copy whatever is under the cursor into the brush.",
  },
];

/** Icon-only: the glyph carries the meaning and the tooltip carries the rest. */
function ToolPicker({ active, unitSelected, onPick }: ToolPickerProps) {
  return (
    <div className="@flex @gap-1" role="group" aria-label="Tool">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          aria-pressed={active === tool.id}
          title={
            tool.id === "fill" && unitSelected
              ? "Fill does not apply to units — this places a single one (F)"
              : `${tool.label} (${tool.key}) — ${tool.hint}`
          }
          onClick={() => onPick(tool.id)}
          className={`@flex @h-7 @w-7 @items-center @justify-center @rounded @border @transition ${
            active === tool.id
              ? "@border-primary @bg-primary/20 @text-white"
              : "@border-white/10 @bg-bg-secondary @text-white/60 hover:@border-white/30"
          }`}
        >
          {(() => {
            const Glyph = TOOL_GLYPHS[tool.id];

            return Glyph === undefined ? null : <Glyph />;
          })()}
        </button>
      ))}
    </div>
  );
}
