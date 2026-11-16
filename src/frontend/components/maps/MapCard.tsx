import MapThumbnail from "frontend/components/matchmaking/MapThumbnail";
import MapModeTags from "./MapModeTags";
import type { MapSummary } from "./map-browser-types";

type Props = {
  map: MapSummary;
  onOpen: (map: MapSummary) => void;
};

/** One map in the browser grid: terrain thumbnail, name, where it can be played, and its size. */
export default function MapCard({ map, onOpen }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpen(map)}
      aria-label={`Open ${map.name}`}
      className="@group @flex @flex-col @overflow-hidden @rounded-lg @border @border-white/10 @bg-bg-secondary @text-left @transition hover:@border-primary focus-visible:@border-primary focus-visible:@outline-none"
    >
      {/*
        Fixed-height box with the thumbnail letterboxed inside it. Maps range from 15x15 to 29x23,
        so sizing the box to each map's own aspect ratio would leave every card a different height
        and the grid ragged — the name and tags have to line up across a row to be scannable.
      */}
      <div className="@flex @h-40 @items-center @justify-center @bg-bg-primary @p-2">
        <MapThumbnail terrain={map.terrain} className="@h-full @max-h-full @max-w-full" />
      </div>

      <div className="@flex @flex-1 @flex-col @gap-2 @p-3">
        <h3 className="@text-sm @font-bold @leading-tight @text-white group-hover:@text-primary-light">
          {map.name}
        </h3>

        <MapModeTags supportedModes={map.supportedModes} rankedModes={map.rankedModes} />

        <p className="@mt-auto @text-xs @tabular-nums @text-white/50">
          {map.size.width}×{map.size.height} · {map.numberOfPlayers} players
        </p>
      </div>
    </button>
  );
}
