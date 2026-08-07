import { trpc } from "frontend/utils/trpc-client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import MapCard from "./MapCard";
import MapDetail from "./MapDetail";
import MapFilters from "./MapFilters";
import type { MapFilter, MapSummary } from "./map-browser-types";

/** How long to wait after the last keystroke before asking the server again. */
const SEARCH_DEBOUNCE_MS = 250;

/**
 * The map library browser. Filtering is the server's answer, not a client-side `.filter()`: the
 * mode and ranked columns it narrows on are the same ones the lobby and matchmaking guards read,
 * so the browser cannot disagree with what a queue will actually offer.
 */
export default function MapBrowser() {
  const [filter, setFilter] = useState<MapFilter>({});
  const [selected, setSelected] = useState<MapSummary | null>(null);

  // Debounce only the text: mode/ranked chips are single clicks and should feel instant.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(filter.search ?? ""), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [filter.search]);

  const query = useMemo(
    () => ({
      ...(debouncedSearch === "" ? {} : { search: debouncedSearch }),
      ...(filter.mode === undefined ? {} : { mode: filter.mode }),
      ...(filter.rankedOnly === true ? { rankedOnly: true } : {}),
    }),
    [debouncedSearch, filter.mode, filter.rankedOnly],
  );

  const { data, isLoading, isError, error } = trpc.map.getAll.useQuery(query, {
    // The library changes rarely; keep the previous results on screen while refetching so toggling
    // a chip doesn't blank the grid. (react-query v4 spelling — `placeholderData` as a function is
    // the v5 API and this project is on v4.)
    keepPreviousData: true,
  });

  // Annotated, NOT asserted. `map-browser-types.ts` exists so drift between these shapes and the
  // server schema surfaces as a tsc error right here — and `as MapSummary[]` is precisely the
  // construct that suppresses that error. Drop `terrain` server-side with the cast in place and this
  // still compiles, then `MapThumbnail` blows up at render. Let the structural check do its job.
  const maps: MapSummary[] = data ?? [];

  return (
    <div className="@flex @w-full @max-w-[90rem] @flex-col @gap-6 @px-4">
      <div className="@flex @items-center @justify-between @gap-4">
        <p className="@text-sm @text-white/50">
          Every map here was built by someone. Yours can be too.
        </p>
        <Link
          href="/maps/builder"
          className="@shrink-0 @rounded @bg-primary @px-4 @py-2 @text-sm @font-bold @text-black @transition hover:@bg-primary-light"
        >
          Build a map
        </Link>
      </div>

      <MapFilters
        filter={filter}
        onChange={setFilter}
        resultCount={maps.length}
        isLoading={isLoading}
      />

      {isError ? (
        <p className="@rounded @border @border-red-500/40 @bg-red-500/10 @p-4 @text-sm @text-red-200">
          Could not load maps: {error.message}
        </p>
      ) : maps.length === 0 && !isLoading ? (
        <p className="@py-12 @text-center @text-sm @text-white/40">No maps match those filters.</p>
      ) : (
        <div className="@grid @grid-cols-2 @gap-4 large_tablet:@grid-cols-3 laptop:@grid-cols-4 monitor:@grid-cols-5">
          {maps.map((map) => (
            <MapCard key={map.id} map={map} onOpen={setSelected} />
          ))}
        </div>
      )}

      <MapDetail map={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
