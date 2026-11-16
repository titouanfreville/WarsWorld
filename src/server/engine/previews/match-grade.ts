import type { MatchStats } from "./match-stats";

/**
 * Per-player letter grade (Epic 4) — PvP-tuned. Speed is deliberately excluded (see the plan §10);
 * the axes are **Tactics** (trade efficiency), **Strength** (aggression + board control) and
 * **Economy** (income + spending efficiency), weighted 0.40 / 0.35 / 0.25 into the overall.
 *
 * Scoring is RELATIVE to the field, which is what makes it PvP-honest: a share metric is normalised so
 * an even split scores ~50 and dominating scores ~100, so a losing player who fought well can still
 * grade decently on Tactics. Pure: it reads only the already-computed `MatchStats`. Weights + curves
 * are intentionally simple + tunable — this is the first calibration.
 */
export type GradeLetter = "S" | "A" | "B" | "C";

export type AxisGrade = { score: number; letter: GradeLetter };

export type PlayerGrade = {
  playerId: string;
  overall: GradeLetter;
  overallScore: number;
  tactics: AxisGrade;
  strength: AxisGrade;
  economy: AxisGrade;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const letterOf = (score: number): GradeLetter =>
  score >= 85 ? "S" : score >= 70 ? "A" : score >= 50 ? "B" : "C";

const axis = (score: number): AxisGrade => {
  const rounded = Math.round(clamp01(score / 100) * 100);

  return { score: rounded, letter: letterOf(rounded) };
};

export const computeGrades = (stats: MatchStats): PlayerGrade[] => {
  const { players, timeline } = stats;
  const n = Math.max(1, players.length);

  const sum = (get: (p: (typeof players)[number]) => number): number =>
    players.reduce((acc, player) => acc + get(player), 0);

  const totalDamage = sum((p) => p.damageDealt);
  const totalCaptures = sum((p) => p.captures);

  // Per-player income + average idle cash, folded out of the per-turn series.
  const incomeTotal = new Map<string, number>();
  const idleAvg = new Map<string, number>();
  const incomeAvg = new Map<string, number>();

  for (const player of players) {
    let income = 0;
    let idle = 0;
    let count = 0;

    for (const row of timeline) {
      const entry = row.perPlayer.find((p) => p.playerId === player.playerId);

      if (entry !== undefined) {
        income += entry.income;
        idle += entry.funds;
        count += 1;
      }
    }

    incomeTotal.set(player.playerId, income);
    idleAvg.set(player.playerId, count > 0 ? idle / count : 0);
    incomeAvg.set(player.playerId, count > 0 ? income / count : 0);
  }

  const totalIncome = sum((p) => incomeTotal.get(p.playerId) ?? 0);

  // A player's share of a total → 0..100, where an even split (1/n) scores 50 and ≥2× even scores 100.
  const scoreShare = (value: number, total: number): number =>
    total > 0 ? clamp01(((value / total) * n) / 2) * 100 : 50;

  return players.map((player) => {
    // Strength — aggression (damage share) + board control (capture share).
    const strengthScore =
      0.65 * scoreShare(player.damageDealt, totalDamage) +
      0.35 * scoreShare(player.captures, totalCaptures);

    // Tactics — trade efficiency (funds destroyed vs lost), lightly penalised for logistics crashes.
    const fought = player.damageDealt > 0 || player.damageTaken > 0;
    const ratio =
      player.damageTaken > 0
        ? player.damageDealt / player.damageTaken
        : player.damageDealt > 0
          ? 4 // a clean sweep (dealt damage, lost nothing) — strong but not unbounded
          : 1; // no combat — neutral
    const tradeScore = fought ? clamp01(ratio / (ratio + 1)) * 100 : 50;
    const tacticsScore = Math.max(0, tradeScore - player.crashed * 4);

    // Economy — income share + spending efficiency (idle cash is wasted income).
    const incomeShareScore = scoreShare(incomeTotal.get(player.playerId) ?? 0, totalIncome);
    const avgIncome = incomeAvg.get(player.playerId) ?? 0;
    const idleRatio = avgIncome > 0 ? (idleAvg.get(player.playerId) ?? 0) / avgIncome : 0;
    const efficiencyScore = clamp01(1 - idleRatio / 2) * 100;
    const economyScore = 0.6 * incomeShareScore + 0.4 * efficiencyScore;

    const overallScore = Math.round(
      0.4 * tacticsScore + 0.35 * strengthScore + 0.25 * economyScore,
    );

    return {
      playerId: player.playerId,
      overall: letterOf(overallScore),
      overallScore,
      tactics: axis(tacticsScore),
      strength: axis(strengthScore),
      economy: axis(economyScore),
    };
  });
};
