"use client";

import { trpc } from "frontend/utils/trpc-client";

/**
 * The reusable honor-insignia widget (Epic 6): a player's Prestige + their three medals (metal tier,
 * star sub-rank, progress), from `honor.standing`. Meant to be dropped anywhere a player's standing
 * should show — the End-Game screen, profile, lobby, champ-select, in-game. `compact` trims it to the
 * medal discs + stars for tight spots.
 */

const MEDAL_META: Record<string, { emoji: string; name: string }> = {
  GOOD_CONDUCT: { emoji: "👏", name: "Good Conduct" },
  MEDAILLE_MILITAIRE: { emoji: "🤝", name: "Médaille Militaire" },
  CROIX_DE_GUERRE: { emoji: "⚔️", name: "Croix de Guerre" },
};

const TIER_COLOR: Record<string, string> = {
  recruit: "#64748b",
  bronze: "#cd7f32",
  silver: "#cfd4da",
  gold: "#ffd54a",
  platinum: "#e5e4e2",
  diamond: "#b9f2ff",
};

const stars = (count: number): string => "★".repeat(count);

export function HonorInsignia({
  playerId,
  compact = false,
}: {
  playerId: string;
  compact?: boolean;
}) {
  const query = trpc.honor.standing.useQuery({ playerId });

  if (query.data === undefined || query.data === null) {
    return <p className="egs__panel-body">Loading honor…</p>;
  }

  const { medals, prestige } = query.data;

  return (
    <div className={`hon${compact ? " is-compact" : ""}`}>
      <div className="hon__prestige">
        <span className="hon__prestige-badge">🎖️</span>
        <span className="hon__prestige-level">Prestige {prestige.points}</span>
      </div>
      <div className="hon__medals">
        {medals.map((medal) => {
          const meta = MEDAL_META[medal.medal] ?? { emoji: "🎖️", name: medal.medal };

          return (
            <div
              className="hon__medal"
              key={medal.medal}
              style={{ ["--tier" as string]: TIER_COLOR[medal.tierKey] ?? "#64748b" }}
              title={`${meta.name} · ${medal.tierLabel} ${stars(medal.star)} · ${medal.count}`}
            >
              <div className="hon__disc">
                <span>{meta.emoji}</span>
              </div>
              <div className="hon__stars">{stars(medal.star)}</div>
              {!compact && (
                <>
                  <p className="hon__name">{meta.name}</p>
                  <p className="hon__count">
                    {medal.tierLabel} · {medal.count}
                  </p>
                  {medal.nextThreshold !== null && (
                    <div className="hon__prog">
                      <i style={{ width: `${Math.round(medal.progress * 100)}%` }} />
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
