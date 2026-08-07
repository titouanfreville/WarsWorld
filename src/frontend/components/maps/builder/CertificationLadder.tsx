import type { FairnessCheck, MapFairnessReport } from "./builder-types";

type Props = {
  report: MapFairnessReport | null;
  /** Called with the tiles a failing check points at, so the board can highlight them. */
  onFocus: (tiles: [number, number][]) => void;
};

/**
 * The map's standing, as the server last reported it.
 *
 * Two rungs, gated in order: **playable** decides whether the map can be published at all, and
 * **fair** decides whether it may be submitted for ranked. Failing the second is a legitimate
 * design choice for a casual map, which is why it does not block publishing.
 *
 * Every verdict here came from `map.evaluate`. Nothing on this screen is computed client-side.
 */
export function CertificationLadder({ report, onFocus }: Props) {
  if (report === null) {
    return (
      <p className="@rounded @border @border-white/10 @bg-bg-secondary @p-4 @text-sm @text-white/40">
        Paint something and the checker will weigh in.
      </p>
    );
  }

  return (
    <div className="@flex @flex-col @gap-4 @rounded @border @border-white/10 @bg-bg-secondary @p-4">
      <Rung
        title={report.isPlayable ? "Playable" : "Not playable yet"}
        why={
          report.isPlayable
            ? "Two or more seats can start, build and reach each other."
            : "Fix these before the map can be published."
        }
        ok={report.isPlayable}
        checks={report.playable}
        onFocus={onFocus}
      />

      <Rung
        title={report.isFair ? "Fair" : "Fairness"}
        why={
          report.isFair
            ? "No seat has an advantage the checker can measure."
            : "A published map may fail these. The ranked pool may not."
        }
        ok={report.isFair}
        gold
        checks={report.fairness}
        onFocus={onFocus}
      />
    </div>
  );
}

type RungProps = {
  title: string;
  why: string;
  ok: boolean;
  gold?: boolean;
  checks: FairnessCheck[];
  onFocus: (tiles: [number, number][]) => void;
};

function Rung({ title, why, ok, gold = false, checks, onFocus }: RungProps) {
  const headingColour = !ok ? "@text-white" : gold ? "@text-yellow-comet" : "@text-secondary";

  return (
    <div className="@flex @flex-col @gap-1.5">
      <h3 className={`@font-mono @text-[0.7rem] @uppercase @tracking-widest ${headingColour}`}>
        {title}
      </h3>
      <p className="@text-xs @text-white/40">{why}</p>

      <ul className="@flex @flex-col">
        {checks.map((check) => (
          <li key={check.id}>
            <button
              type="button"
              onClick={() => onFocus(check.tiles)}
              disabled={check.tiles.length === 0}
              className={`@grid @w-full @grid-cols-[0.9rem_1fr_auto] @items-baseline @gap-2 @rounded @border-l-2 @px-1.5 @py-1 @text-left @text-xs @transition ${
                check.ok
                  ? "@border-transparent @text-white/60"
                  : "@border-orange-star @bg-orange-star/10 @text-white"
              } ${check.tiles.length > 0 ? "hover:@bg-white/5" : ""}`}
            >
              <span className={`@font-mono ${check.ok ? "@text-secondary" : "@text-orange-star"}`}>
                {check.ok ? "✓" : "✕"}
              </span>
              <span>{check.label}</span>
              <span className="@font-mono @text-[0.65rem] @tabular-nums @text-white/35">
                {check.detail}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
