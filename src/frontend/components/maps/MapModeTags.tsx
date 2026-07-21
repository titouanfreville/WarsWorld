import { MODE_LABEL, type GameMode } from "./map-browser-types";

/**
 * A map's mode tags: every mode it can be played in, with the ranked-legal ones marked.
 *
 * The two lists say different things and the UI has to keep them apart — a 4-seat map is playable
 * both as 2v2 and free-for-all, but usually counts for rating in only the one it was designed for.
 * Showing a single list would tell a player their casual-only map is ladder-legal.
 */
type Props = {
  supportedModes: GameMode[];
  rankedModes: GameMode[];
  className?: string;
};

export default function MapModeTags({ supportedModes, rankedModes, className }: Props) {
  if (supportedModes.length === 0) {
    return (
      <span
        className={`@rounded @border @border-white/20 @px-1.5 @py-0.5 @text-[0.65rem] @uppercase @tracking-wider @text-white/40 ${className ?? ""}`}
        title="No modes configured — this map cannot be selected anywhere"
      >
        Unavailable
      </span>
    );
  }

  return (
    <div className={`@flex @flex-wrap @gap-1 ${className ?? ""}`}>
      {supportedModes.map((mode) => {
        const isRanked = rankedModes.includes(mode);

        return (
          <span
            key={mode}
            title={
              isRanked
                ? `Ranked and casual in ${MODE_LABEL[mode]}`
                : `Casual only in ${MODE_LABEL[mode]}`
            }
            className={
              "@rounded @px-1.5 @py-0.5 @text-[0.65rem] @font-bold @uppercase @tracking-wider @border " +
              (isRanked
                ? "@border-primary @bg-primary/15 @text-primary-light"
                : "@border-white/20 @text-white/55")
            }
          >
            {MODE_LABEL[mode]}
            {isRanked ? " ★" : ""}
          </span>
        );
      })}
    </div>
  );
}
