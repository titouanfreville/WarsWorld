/**
 * Optional DB-sourced sprite paths. The sprite resolvers (`unitSpriteUrl`, `coPortraitUrl`, …) look
 * here FIRST and fall back to the hardcoded path convention when it's empty — so rendering works
 * before the map loads (and during SSR), and switches to SQL-managed skins once bootstrapped.
 *
 * The DB skin paths are seeded FROM these same convention functions (`verify-skins-roundtrip` pins
 * the equality), so a loaded map produces byte-identical paths — no hydration mismatch, no visual
 * change; the point is that skins become editable via SQL. Populated by `bootstrapSkins()`.
 */

export type SkinMap = {
  /** army key → element key (engine unit key or "flag") → asset path */
  army: Record<string, Record<string, string>>;
  /** CO element key (`<co>:portraitSmall` | `<co>:portraitFull` | `<co>:art`) → asset path */
  co: Record<string, string>;
};

let skinMap: SkinMap | null = null;

export const setSkinMap = (map: SkinMap | null): void => {
  skinMap = map;
};

/** DB path for an army element (unit engine-key or "flag"), or undefined to fall back to convention. */
export const armyAsset = (army: string, elementKey: string): string | undefined =>
  skinMap?.army[army]?.[elementKey];

/** DB path for a CO element, or undefined to fall back to convention. */
export const coAsset = (elementKey: string): string | undefined => skinMap?.co[elementKey];

/** Fetch the DB skin map once and install it (call at app startup). Silent on failure — the
 *  convention fallback keeps sprites working. */
export const bootstrapSkins = async (): Promise<void> => {
  try {
    const res = await fetch("/api/game-data");

    if (!res.ok) {
      return;
    }

    const data = (await res.json()) as { skins?: SkinMap };

    if (data.skins) {
      setSkinMap(data.skins);
    }
  } catch {
    // Keep the convention fallback; skins are cosmetic and non-blocking.
  }
};
