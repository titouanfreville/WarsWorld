"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Reusable animated particle layer for the end-of-match screen — a "separate container" composited
 * over the CO poses (see GameOverOverlay). The particle *vocabulary* is drawn from the CO art
 * (golden burst, confetti, flower petals on a win; ash, embers, red droplets on a loss) but rendered
 * generically in CSS so it animates and combines with any CO, rather than being baked per-image.
 *
 * Pure presentation, pointer-events-none. Honors prefers-reduced-motion (particles.scss freezes the
 * motion). Positions are randomised on the client after mount to avoid SSR hydration mismatch.
 */

export type ParticleType = "confetti" | "goldBurst" | "petal" | "ash" | "ember" | "droplet";
type Outcome = "victory" | "defeat" | "draw";

/** Default particle mix per outcome. Callers can override with an explicit `types` list. */
const OUTCOME_TYPES: Record<Outcome, ParticleType[]> = {
  victory: ["confetti", "goldBurst", "petal"],
  defeat: ["ash", "ember", "droplet"],
  draw: ["ash"],
};

type TypeConfig = {
  /** particles of this type at intensity 1 */
  count: number;
  /** modifier class in particles.scss (motion + shape) */
  motion: string;
  /** px size range [min, max] */
  size: [number, number];
  /** colour palette (picked per particle) */
  colors: string[];
};

const TYPE_CONFIG: Record<ParticleType, TypeConfig> = {
  confetti: {
    count: 32,
    motion: "is-confetti",
    size: [6, 13],
    colors: ["#fbbf24", "#ef4444", "#3b82f6", "#10b981", "#f472b6", "#ffffff"],
  },
  goldBurst: {
    count: 18,
    motion: "is-gold",
    size: [4, 9],
    colors: ["#fde68a", "#fbbf24", "#fff7cc"],
  },
  petal: {
    count: 14,
    motion: "is-petal",
    size: [9, 16],
    colors: ["#f9a8d4", "#fb7185", "#fbcfe8"],
  },
  ash: {
    count: 30,
    motion: "is-ash",
    size: [3, 7],
    colors: ["#9ca3af", "#6b7280", "#4b5563"],
  },
  ember: {
    count: 20,
    motion: "is-ember",
    size: [3, 6],
    colors: ["#f97316", "#fb923c", "#fbbf24"],
  },
  droplet: {
    count: 14,
    motion: "is-droplet",
    size: [4, 9],
    colors: ["#b91c1c", "#dc2626", "#7f1d1d"],
  },
};

type Particle = {
  key: string;
  motion: string;
  style: React.CSSProperties;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

function build(types: ParticleType[], intensity: number): Particle[] {
  const out: Particle[] = [];

  for (const type of types) {
    const cfg = TYPE_CONFIG[type];
    const n = Math.max(1, Math.round(cfg.count * intensity));

    for (let i = 0; i < n; i++) {
      const size = rand(cfg.size[0], cfg.size[1]);
      out.push({
        key: `${type}-${i}`,
        motion: cfg.motion,
        style: {
          left: `${rand(0, 100)}%`,
          width: `${size}px`,
          height: `${size}px`,
          background: pick(cfg.colors),
          // negative delay so the field starts already in motion, not empty
          animationDelay: `${-rand(0, 8)}s`,
          animationDuration: `${rand(3.2, 7.5)}s`,
          // custom props consumed by particles.scss for per-particle sway/spin variance
          ["--pf-drift" as string]: `${rand(-60, 60)}px`,
          ["--pf-spin" as string]: `${rand(-360, 360)}deg`,
        },
      });
    }
  }

  return out;
}

export function ParticleField({
  outcome,
  types,
  intensity = 1,
}: {
  outcome: Outcome;
  /** Explicit particle mix; defaults to the outcome's mix. */
  types?: ParticleType[];
  /** Scales particle counts (0 hides the field). */
  intensity?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const resolved = useMemo(() => types ?? OUTCOME_TYPES[outcome], [types, outcome]);
  const particles = useMemo(
    () => (mounted && intensity > 0 ? build(resolved, intensity) : []),
    [mounted, intensity, resolved],
  );

  if (particles.length === 0) {
    return null;
  }

  return (
    <div
      className="ww-pf @absolute @inset-0 @overflow-hidden @pointer-events-none"
      aria-hidden="true"
    >
      {particles.map((p) => (
        <span key={p.key} className={`ww-pf__p ${p.motion}`} style={p.style} />
      ))}
    </div>
  );
}
