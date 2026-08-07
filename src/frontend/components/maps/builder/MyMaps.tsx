export type MyMap = {
  id: string;
  name: string;
  status: string;
  rankedReview: string;
  numberOfPlayers: number;
  updatedAt: Date;
  size: { width: number; height: number };
};

type Props = {
  maps: MyMap[];
  busyId: string | null;
  onOpen: (mapId: string) => void;
};

/**
 * The author's own maps, so a draft is something you come back to rather than something you lose.
 *
 * Sorted by when they were last touched: the one you were working on five minutes ago is the one
 * you almost certainly want, and it is first.
 */
export function MyMaps({ maps, busyId, onOpen }: Props) {
  if (maps.length === 0) {
    return null;
  }

  return (
    <div className="@flex @flex-col @gap-2">
      <p className="@font-mono @text-[0.65rem] @uppercase @tracking-widest @text-white/40">
        Your maps
      </p>

      <ul className="@flex @flex-col @gap-1">
        {maps.map((map) => (
          <li key={map.id}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => onOpen(map.id)}
              className="@flex @w-full @items-center @justify-between @gap-3 @rounded @border @border-white/10 @bg-bg-secondary @px-3 @py-2 @text-left @transition hover:@border-primary disabled:@opacity-50"
            >
              <span className="@min-w-0">
                <span className="@block @truncate @text-sm">{map.name}</span>
                <span className="@block @text-xs @tabular-nums @text-white/40">
                  {map.size.width} × {map.size.height} · {map.numberOfPlayers} seats ·{" "}
                  {formatWhen(map.updatedAt)}
                </span>
              </span>

              <span className="@flex @shrink-0 @items-center @gap-1.5">
                {map.rankedReview === "pending" && (
                  <span className="@rounded @border @border-yellow-comet/40 @px-1.5 @py-0.5 @font-mono @text-[0.6rem] @uppercase @text-yellow-comet">
                    In review
                  </span>
                )}
                <StatusChip status={map.status} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const published = status === "published";

  return (
    <span
      className={`@rounded @border @px-1.5 @py-0.5 @font-mono @text-[0.6rem] @uppercase ${
        published ? "@border-secondary/40 @text-secondary" : "@border-primary/40 @text-primary"
      }`}
    >
      {published ? "Published" : "Draft"}
    </span>
  );
}

/**
 * Relative for anything recent, absolute once it stops being useful.
 *
 * Deliberately coarse: "3 hours ago" tells you which map you were on, and a timestamp to the minute
 * does not tell you any more than that.
 */
const formatWhen = (when: Date): string => {
  const minutes = Math.round((Date.now() - when.getTime()) / 60_000);

  if (minutes < 1) {
    return "just now";
  }

  if (minutes < 60) {
    return `${minutes} min ago`;
  }

  const hours = Math.round(minutes / 60);

  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }

  const days = Math.round(hours / 24);

  return days < 7 ? `${days} day${days === 1 ? "" : "s"} ago` : when.toLocaleDateString();
};
