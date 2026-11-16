"use client";

import { useRef, useState } from "react";

export type ChartSeries = {
  label: string;
  /** Line/endpoint colour. */
  color: string;
  /** Translucent area fill under the line. */
  fill: string;
  /** One value per x-tick (same length as `xTurns`). */
  data: number[];
};

const W = 620;
const H = 180;
const PL = 34;
const PR = 48;
const PT = 12;
const PB = 22;

/**
 * A small, dependency-free SVG line chart for the End-Game analysis views (Epic 3.3b) — one line per
 * player over the match's turns, with an area fill, endpoint labels and a hover crosshair + tooltip.
 * Data-in / render-out; the caller maps the per-turn series (`stats.timeline`) into `series`.
 */
export function LineChart({
  series,
  xTurns,
  step = false,
  unitLabel,
}: {
  series: ChartSeries[];
  /** The turn number at each x index (for the axis + tooltip). */
  xTurns: number[];
  /** Step interpolation (for discrete counts like properties owned). */
  step?: boolean;
  unitLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const n = xTurns.length;

  if (n < 2) {
    return <p className="egs-an__note">Not enough turns for a chart yet.</p>;
  }

  const maxY = Math.max(1, ...series.flatMap((s) => s.data));
  const x = (i: number): number => PL + (i / (n - 1)) * (W - PL - PR);
  const y = (v: number): number => PT + (1 - v / maxY) * (H - PT - PB);

  const linePath = (data: number[]): string =>
    data
      .map((v, i) => {
        if (i === 0) {
          return `M${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
        }

        return step
          ? `H${x(i).toFixed(1)} V${y(v).toFixed(1)}`
          : `L${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .join(" ");

  const areaPath = (data: number[]): string =>
    `${linePath(data)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z`;

  const gridLines = [0, 1, 2, 3, 4].map((k) => (maxY / 4) * k);
  const xTicks = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);

  const onMove = (event: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;

    if (svg === null) {
      return;
    }

    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * W;
    const i = Math.round(((px - PL) / (W - PL - PR)) * (n - 1));

    setHover(i >= 0 && i < n ? i : null);
  };

  return (
    <div className="egs-an__chart">
      <div className="egs-an__legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
        {unitLabel !== undefined && <span className="egs-an__legend-unit">{unitLabel}</span>}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={unitLabel ?? "Match timeline chart"}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {gridLines.map((g) => (
          <g key={g}>
            <line x1={PL} y1={y(g)} x2={W - PR} y2={y(g)} className="egs-an__grid" />
            <text x={PL - 6} y={y(g) + 3} textAnchor="end" className="egs-an__axis">
              {Math.round(g)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} x={x(i)} y={H - 4} textAnchor="middle" className="egs-an__axis">
            {xTurns[i]}
          </text>
        ))}

        {series.map((s) => (
          <path key={`area-${s.label}`} d={areaPath(s.data)} fill={s.fill} />
        ))}
        {series.map((s) => (
          <path
            key={`line-${s.label}`}
            d={linePath(s.data)}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
          />
        ))}
        {series.map((s) => (
          <circle key={`dot-${s.label}`} cx={x(n - 1)} cy={y(s.data[n - 1])} r={4} fill={s.color} />
        ))}

        {hover !== null && (
          <>
            <line x1={x(hover)} y1={PT} x2={x(hover)} y2={H - PB} className="egs-an__crosshair" />
            {series.map((s) => (
              <circle
                key={`hover-${s.label}`}
                cx={x(hover)}
                cy={y(s.data[hover])}
                r={4}
                fill={s.color}
                stroke="#0a0f22"
                strokeWidth={1.5}
              />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (
        <div
          className="egs-an__tip"
          style={{ left: `${(x(hover) / W) * 100}%`, top: `${(PT / H) * 100}%` }}
        >
          Turn {xTurns[hover]}
          {series.map((s) => (
            <span key={s.label} style={{ color: s.color }}>
              {" · "}
              {Math.round(s.data[hover])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
