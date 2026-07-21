import { GAME_MODES, MODE_LABEL, type GameMode, type MapFilter } from "./map-browser-types";

type Props = {
  filter: MapFilter;
  onChange: (next: MapFilter) => void;
  /** Shown next to the controls so it is obvious the filters did something. */
  resultCount: number;
  isLoading: boolean;
};

const chip = (active: boolean) =>
  "@rounded @border @px-3 @py-1 @text-xs @font-bold @uppercase @tracking-wider @transition " +
  (active
    ? "@border-primary @bg-primary @text-bg-primary"
    : "@border-white/15 @text-white/60 hover:@border-primary hover:@text-white");

export default function MapFilters({ filter, onChange, resultCount, isLoading }: Props) {
  // Clicking the active chip clears it, so every filter is its own toggle and there is no
  // separate "All" option to keep in sync.
  const toggleMode = (mode: GameMode) =>
    onChange({ ...filter, mode: filter.mode === mode ? undefined : mode });

  const hasFilters =
    filter.mode !== undefined ||
    filter.rankedOnly === true ||
    (filter.search !== undefined && filter.search !== "");

  return (
    <div className="@flex @flex-col @gap-3">
      <div className="@flex @flex-wrap @items-center @gap-2">
        <label className="@sr-only" htmlFor="map-search">
          Search maps by name
        </label>
        <input
          id="map-search"
          type="search"
          value={filter.search ?? ""}
          onChange={(e) => onChange({ ...filter, search: e.target.value })}
          placeholder="Search maps…"
          className="@w-56 @rounded @border @border-white/15 @bg-bg-primary @px-3 @py-1.5 @text-sm @text-white placeholder:@text-white/30 focus:@border-primary focus:@outline-none"
        />

        <span className="@mx-1 @h-5 @w-px @bg-white/15" />

        {GAME_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={filter.mode === mode}
            onClick={() => toggleMode(mode)}
            className={chip(filter.mode === mode)}
          >
            {MODE_LABEL[mode]}
          </button>
        ))}

        <span className="@mx-1 @h-5 @w-px @bg-white/15" />

        <button
          type="button"
          aria-pressed={filter.rankedOnly === true}
          onClick={() =>
            onChange({ ...filter, rankedOnly: filter.rankedOnly === true ? undefined : true })
          }
          title="Only maps that count towards your rating"
          className={chip(filter.rankedOnly === true)}
        >
          Ranked ★
        </button>

        {hasFilters ? (
          <button
            type="button"
            onClick={() => onChange({})}
            className="@px-2 @py-1 @text-xs @text-white/50 @underline hover:@text-white"
          >
            Clear
          </button>
        ) : null}
      </div>

      <p className="@text-xs @tabular-nums @text-white/40" aria-live="polite">
        {isLoading ? "Loading maps…" : `${resultCount} map${resultCount === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
