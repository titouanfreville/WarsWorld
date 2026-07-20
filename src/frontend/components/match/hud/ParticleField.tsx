"use client";

import { useEffect, useMemo, useState } from "react";
import type { ParticleType } from "./particle-effects";

/**
 * Reusable animated particle layer for the end-of-match screen — a "separate container" composited
 * over the CO poses (see GameOverOverlay). Renders a resolved list of particle types (see
 * particle-effects for the effect library + per-CO resolution) generically in CSS so it animates and
 * combines with any CO, rather than being baked per-image.
 *
 * Pure presentation, pointer-events-none. Honors prefers-reduced-motion (particles.scss freezes the
 * motion). Positions are randomised on the client after mount to avoid SSR hydration mismatch.
 */

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
    count: 26,
    motion: "is-confetti",
    size: [6, 13],
    colors: ["#fbbf24", "#ef4444", "#3b82f6", "#10b981", "#f472b6", "#ffffff"],
  },
  goldBurst: {
    count: 24,
    motion: "is-gold",
    size: [5, 11],
    colors: ["#fde68a", "#fbbf24", "#fff7cc"],
  },
  petal: {
    count: 20,
    motion: "is-petal",
    size: [11, 20],
    colors: ["#f9a8d4", "#fb7185", "#fbcfe8", "#f472b6"],
  },
  ash: {
    count: 28,
    motion: "is-ash",
    size: [3, 7],
    colors: ["#9ca3af", "#6b7280", "#4b5563"],
  },
  ember: {
    count: 26,
    motion: "is-ember",
    size: [4, 9],
    colors: ["#f97316", "#fb923c", "#fbbf24", "#fca5a5"],
  },
  droplet: {
    count: 18,
    motion: "is-droplet",
    size: [5, 10],
    colors: ["#dc2626", "#b91c1c", "#7f1d1d"],
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
  types,
  intensity = 1,
}: {
  /** Resolved particle mix (see resolveParticleTypes). */
  types: ParticleType[];
  /** Scales particle counts (0 hides the field). */
  intensity?: number;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const typesKey = types.join(",");
  const particles = useMemo(
    () => (mounted && intensity > 0 && types.length > 0 ? build(types, intensity) : []),
    // typesKey captures the mix identity without depending on array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mounted, intensity, typesKey],
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
