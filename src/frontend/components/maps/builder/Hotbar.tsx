import type { MapVocabulary } from "./builder-types";
import { SpriteThumb, spriteRefFor, type FrameLookup } from "./SpriteThumb";

/** What a slot holds. `slot` absent means it follows whichever owner is selected. */
export type HotbarCell = {
  kind: "terrain" | "property" | "unit";
  type: string;
  slot?: number;
};

export const HOTBAR_ROWS = 2;
export const HOTBAR_COLUMNS = 10;
export const HOTBAR_SIZE = HOTBAR_ROWS * HOTBAR_COLUMNS;

/**
 * The stock bar, laid out from the server's own rosters so every terrain and property has a key
 * without anyone maintaining a list. Terrain fills row one, then properties and a unit follow.
 */
export const defaultHotbar = (vocabulary: MapVocabulary): (HotbarCell | null)[] => {
  const terrain = vocabulary.terrain
    .filter((tile) => !vocabulary.properties.includes(tile.type))
    .map((tile): HotbarCell => ({ kind: "terrain", type: tile.type }));

  const properties = vocabulary.properties.map((type): HotbarCell => ({ kind: "property", type }));
  const firstUnit = vocabulary.units[0];

  const cells: HotbarCell[] = [
    ...terrain,
    ...properties,
    ...(firstUnit === undefined ? [] : [{ kind: "unit" as const, type: firstUnit.type }]),
  ];

  return Array.from({ length: HOTBAR_SIZE }, (_, index) => cells[index] ?? null);
};

type Props = {
  cells: (HotbarCell | null)[];
  lookup: FrameLookup;
  vocabulary: MapVocabulary;
  activeSlot: number;
  binding: boolean;
  isActive: (cell: HotbarCell) => boolean;
  onUse: (index: number) => void;
  onBind: (index: number) => void;
  onToggleBinding: () => void;
  onReset: () => void;
};

const label = (cell: HotbarCell, vocabulary: MapVocabulary) =>
  cell.kind === "unit"
    ? (vocabulary.units.find((unit) => unit.type === cell.type)?.displayName ?? cell.type)
    : cell.type;

/**
 * A bindable shortcut bar: two rows of ten, row one on the digits and row two on shift+digit.
 *
 * The defaults cover every terrain and property so nothing needs hunting in the rail, and any cell
 * can be rebound — someone building a naval map fills the bar with water and ports and never opens
 * the palette again.
 *
 * A stock property cell follows the selected owner, so `base` is whichever player you are on. A
 * cell you bind yourself captures the owner you had at the time, which is what lets you keep "P1
 * base" and "P2 base" side by side. The two are drawn differently or rebinding looks like a no-op.
 */
export function Hotbar({
  cells,
  lookup,
  vocabulary,
  activeSlot,
  binding,
  isActive,
  onUse,
  onBind,
  onToggleBinding,
  onReset,
}: Props) {
  return (
    <div className="@w-full @max-w-xl">
      <div className="@mb-1.5 @flex @items-center @justify-between">
        <span className="@font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40">
          Shortcut bar
        </span>
        <div className="@flex @gap-1">
          <button
            type="button"
            aria-pressed={binding}
            onClick={onToggleBinding}
            className={`@rounded @border @px-2 @py-0.5 @text-[0.6rem] @uppercase @tracking-wider ${
              binding
                ? "@border-primary @bg-primary/20 @text-white"
                : "@border-white/10 @text-white/60"
            }`}
          >
            {binding ? "Click a slot" : "Bind"}
          </button>
          <button
            type="button"
            onClick={onReset}
            className="@rounded @border @border-white/10 @px-2 @py-0.5 @text-[0.6rem] @uppercase @tracking-wider @text-white/60 hover:@border-white/30"
          >
            Reset
          </button>
        </div>
      </div>

      {Array.from({ length: HOTBAR_ROWS }, (_, row) => (
        <div key={row} className="@mb-1 @grid @grid-cols-10 @gap-1">
          {Array.from({ length: HOTBAR_COLUMNS }, (_, column) => {
            const index = row * HOTBAR_COLUMNS + column;
            const cell = cells[index];
            const key = `${row === 1 ? "⇧" : ""}${(column + 1) % 10}`;

            return (
              <button
                key={index}
                type="button"
                onClick={() => (binding ? onBind(index) : onUse(index))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onBind(index);
                }}
                title={
                  cell === null
                    ? `${key} — empty. Right-click to bind.`
                    : `${key} — ${label(cell, vocabulary)}${
                        cell.slot === undefined
                          ? " (follows selected owner)"
                          : ` (pinned to ${cell.slot < 0 ? "neutral" : `P${cell.slot + 1}`})`
                      }`
                }
                aria-label={
                  cell === null ? `${key}: empty slot` : `${key}: ${label(cell, vocabulary)}`
                }
                className={`@relative @flex @h-10 @items-end @justify-center @overflow-hidden @rounded @border @pb-0.5 ${
                  cell === null
                    ? "@border-white/5 @bg-bg-primary @text-white/20"
                    : isActive(cell)
                      ? "@border-primary @bg-primary/20 @text-white"
                      : "@border-white/10 @bg-bg-secondary @text-white/60"
                } ${cell?.slot !== undefined ? "@border-b-2 @border-b-primary" : ""}`}
              >
                <span className="@absolute @left-0.5 @top-0.5 @z-10 @font-mono @text-[0.5rem] @text-white/40">
                  {key}
                </span>
                {cell !== null && (
                  <SpriteThumb
                    lookup={lookup}
                    sprite={spriteRefFor(lookup, {
                      kind: cell.kind,
                      type: cell.type,
                      // A bound cell shows the owner it captured; a stock one follows the selection.
                      slot: cell.slot ?? activeSlot,
                      armyBySlot: vocabulary.armyBySlot,
                      variants: vocabulary.terrain.find((tile) => tile.type === cell.type)
                        ?.variants,
                    })}
                    size={22}
                    label={label(cell, vocabulary)}
                  />
                )}
              </button>
            );
          })}
        </div>
      ))}

      <p className="@text-[0.7rem] @text-white/35">
        Row one is 1–0, row two is shift+1–0. Right-click a slot to bind what you have selected.
        {activeSlot >= 0
          ? ` Binding now captures P${activeSlot + 1}.`
          : " Binding now captures neutral."}
      </p>
    </div>
  );
}
