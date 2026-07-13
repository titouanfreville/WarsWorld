"use client";

/**
 * Read-only CO-power star meter, AW2-style: the first `coStars` are the **CO-power** zone (normal
 * size), the remainder up to `totalStars` are the **Super CO-power** zone (drawn LARGER). A star is
 * lit (`★`, gold) once the meter reaches it, otherwise dim (`☆`). Shown for every army in the HUD —
 * power charge is public in AW. Star counts/thresholds are BE-computed (`match.full` player `power`
 * summary); the FE never derives them. Activation controls live in `PowerBar`; this is display only.
 */
type Props = {
  current: number;
  total: number;
  /** Star index where the Super zone begins (larger stars). `null` when the CO has no CO power. */
  coStars: number | null;
  /** Dim the meter for a defeated/routed army. */
  muted?: boolean;
};

export function PowerMeter({ current, total, coStars, muted = false }: Props) {
  const safeTotal = Math.max(0, total);

  if (safeTotal === 0) {
    return null;
  }

  // Clamp: the meter can momentarily exceed range right after a power fires.
  const lit = Math.max(0, Math.min(current, safeTotal));
  // Where the enlarged Super stars begin. Null coStars → treat every star as the same (small) size.
  const superFrom = coStars ?? safeTotal;

  return (
    <span
      className="@inline-flex @items-end @gap-[1px] @leading-none"
      aria-label={`${lit} of ${safeTotal} power stars`}
    >
      {Array.from({ length: safeTotal }, (_, i) => {
        const isLit = i < lit;
        const isSuper = i >= superFrom;
        // A thin gap marks the CO → Super boundary so the two zones read as distinct.
        const boundary = coStars !== null && i === superFrom;

        return (
          <span
            key={i}
            className={`${isSuper ? "@text-[15px]" : "@text-[11px]"} ${
              boundary ? "@ml-1" : ""
            } ${muted ? "@text-slate-600" : isLit ? "@text-yellow-400" : "@text-white/25"} ${
              isLit && !muted ? "@drop-shadow-[0_0_2px_rgba(250,204,21,0.7)]" : ""
            }`}
          >
            {isLit ? "★" : "☆"}
          </span>
        );
      })}
    </span>
  );
}
