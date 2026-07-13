import type { MedalType } from "@prisma/client";

/**
 * Honor = a PRESTIGE track (distinct from the military-rank ladder, which is MMR). A player earns
 * named medals — one per opponent, matchmaking games only — and each medal RANKS UP by how many of
 * that medal they hold: a metal tier (Bronze→Diamond) split into 3 star sub-ranks, aggregating to an
 * overall Prestige. This module is the pure compute (counts → standing); it's the shared source for
 * the End-Game award panel and the reusable insignia widget (profile · lobby · champ-select · in-game).
 * Thresholds are intentionally simple + tunable — first calibration.
 */

/** Fixed medal order for stable rendering. */
export const MEDAL_ORDER: MedalType[] = ["GOOD_CONDUCT", "MEDAILLE_MILITAIRE", "CROIX_DE_GUERRE"];

/** Metal tiers by cumulative count of a given medal. `recruit` is the pre-Bronze base. */
const TIERS = [
  { key: "recruit", label: "Recruit", min: 0 },
  { key: "bronze", label: "Bronze", min: 10 },
  { key: "silver", label: "Silver", min: 30 },
  { key: "gold", label: "Gold", min: 75 },
  { key: "platinum", label: "Platinum", min: 150 },
  { key: "diamond", label: "Diamond", min: 350 },
] as const;

export type MedalStanding = {
  medal: MedalType;
  count: number;
  tierKey: string;
  tierLabel: string;
  /** Sub-rank within the tier, 1–3. */
  star: number;
  /** Progress toward the next tier, 0–1 (1 at the top tier). */
  progress: number;
  /** Count that unlocks the next tier, or null at the top. */
  nextThreshold: number | null;
};

export type HonorStanding = {
  medals: MedalStanding[];
  /** Overall prestige = sum of each medal's tier index (Bronze=1 … Diamond=5). */
  prestige: { points: number; max: number };
};

type Tier = {
  index: number;
  key: string;
  label: string;
  star: number;
  progress: number;
  nextThreshold: number | null;
};

const tierFor = (count: number): Tier => {
  let index = 0;

  for (let i = 0; i < TIERS.length; i++) {
    if (count >= TIERS[i].min) {
      index = i;
    }
  }

  const tier = TIERS[index];
  const next = TIERS[index + 1] ?? null;
  const span = next !== null ? next.min - tier.min : Math.max(1, tier.min);
  const into = count - tier.min;

  return {
    index,
    key: tier.key,
    label: tier.label,
    star: Math.min(3, 1 + Math.floor(into / (span / 3))),
    progress: next !== null ? into / (next.min - tier.min) : 1,
    nextThreshold: next?.min ?? null,
  };
};

export const computeStanding = (counts: Partial<Record<MedalType, number>>): HonorStanding => {
  const medals: MedalStanding[] = MEDAL_ORDER.map((medal) => {
    const count = counts[medal] ?? 0;
    const tier = tierFor(count);

    return {
      medal,
      count,
      tierKey: tier.key,
      tierLabel: tier.label,
      star: tier.star,
      progress: tier.progress,
      nextThreshold: tier.nextThreshold,
    };
  });

  const points = MEDAL_ORDER.reduce((sum, medal) => sum + tierFor(counts[medal] ?? 0).index, 0);

  return {
    medals,
    prestige: { points, max: (TIERS.length - 1) * MEDAL_ORDER.length },
  };
};
