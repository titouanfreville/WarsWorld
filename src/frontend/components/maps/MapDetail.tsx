import MapThumbnail from "frontend/components/matchmaking/MapThumbnail";
import { PlayerLink } from "frontend/components/PlayerLink";
import { useEffect, useRef } from "react";
import MapModeTags from "./MapModeTags";
import { MODE_LABEL, PROPERTY_LABEL, PROPERTY_ORDER, type MapSummary } from "./map-browser-types";

type Props = {
  map: MapSummary | null;
  onClose: () => void;
};

/**
 * The full read on one map, in a native `<dialog>` so focus trapping, Escape and the backdrop come
 * from the platform rather than hand-rolled key handlers.
 */
export default function MapDetail({ map, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    if (map !== null && !dialog.open) {
      dialog.showModal();
    } else if (map === null && dialog.open) {
      dialog.close();
    }
  }, [map]);

  // `close` also fires for Escape and the backdrop, so the parent's state follows either route.
  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog === null) {
      return;
    }

    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onClose]);

  const perPlayer =
    map === null || map.numberOfPlayers === 0
      ? null
      : PROPERTY_ORDER.map((type) => ({
          type,
          total: map.propertyStats[type] ?? 0,
        })).filter((row) => row.total > 0);

  return (
    <dialog
      ref={dialogRef}
      onClick={(e) => {
        // Clicking the backdrop lands on the dialog element itself, never on its children.
        if (e.target === dialogRef.current) {
          dialogRef.current?.close();
        }
      }}
      /*
        Explicit width + `m-auto`: a native <dialog> centres itself with `margin: auto`, which
        Tailwind's preflight resets to 0, and `max-width` alone lets it shrink to its content —
        together those left the panel tiny and pinned to the top-left corner.
      */
      className="@m-auto @w-[min(52rem,94vw)] @rounded-lg @border @border-white/15 @bg-bg-secondary @p-0 @text-white backdrop:@bg-black/70"
    >
      {map === null ? null : (
        <div className="@flex @flex-col laptop:@flex-row">
          <div className="@bg-bg-primary @p-4 laptop:@w-[58%]">
            <MapThumbnail terrain={map.terrain} className="@w-full" />
          </div>

          <div className="@flex @flex-col @gap-4 @p-5 laptop:@w-[42%]">
            <div className="@flex @items-start @justify-between @gap-3">
              <h2 className="@text-xl @font-bold @leading-tight">{map.name}</h2>
              <button
                type="button"
                onClick={() => dialogRef.current?.close()}
                aria-label="Close"
                className="@rounded @border @border-white/15 @px-2 @py-0.5 @text-sm @text-white/60 hover:@border-primary hover:@text-white"
              >
                ✕
              </button>
            </div>

            <p className="@text-xs @tabular-nums @text-white/50">
              {map.size.width}×{map.size.height} · {map.numberOfPlayers} players
            </p>

            {map.author !== null && (
              <div className="@flex @items-center @gap-1.5 @text-xs @text-white/50">
                <span>Built by</span>
                <PlayerLink name={map.author.name} label={map.author.displayName} hideAvatar />
              </div>
            )}

            <div className="@flex @flex-col @gap-1.5">
              <h3 className="@text-[0.65rem] @uppercase @tracking-widest @text-white/40">
                Playable in
              </h3>
              <MapModeTags supportedModes={map.supportedModes} rankedModes={map.rankedModes} />
              <p className="@text-xs @text-white/45">
                {map.rankedModes.length === 0
                  ? "Casual only — this map does not affect your rating."
                  : `Counts towards your rating in ${map.rankedModes
                      .map((mode) => MODE_LABEL[mode])
                      .join(", ")}.`}
              </p>
            </div>

            {perPlayer === null || perPlayer.length === 0 ? null : (
              <div className="@flex @flex-col @gap-1.5">
                {/* Totals for the whole map, not per player — say so, or "Bases 6" reads as yours. */}
                <h3 className="@text-[0.65rem] @uppercase @tracking-widest @text-white/40">
                  Properties on the map
                </h3>
                <dl className="@grid @grid-cols-[1fr_auto] @gap-x-4 @gap-y-1 @text-sm @tabular-nums">
                  {perPlayer.map((row) => (
                    <div key={row.type} className="@contents">
                      <dt className="@text-white/55">{PROPERTY_LABEL[row.type] ?? row.type}</dt>
                      <dd className="@text-right">{row.total}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
