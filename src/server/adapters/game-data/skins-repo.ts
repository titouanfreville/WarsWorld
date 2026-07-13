import type { PrismaClient } from "@prisma/client";

/**
 * Adapter: loads the DB skin/asset tables into a flat resolution map the FE can look sprites up in.
 * `army[<armyKey>][<engineUnitKey|"flag">]` and `co[<co>:portraitSmall|portraitFull|art>]` → image
 * path. Mirrors the FE's sprite-path convention (the seed materialised it), so a DB-backed lookup is
 * path-identical; `verify-skins-roundtrip` pins that equivalence.
 */

export type SkinMap = {
  /** army key → element key (engine unit key or "flag") → asset path */
  army: Record<string, Record<string, string>>;
  /** CO element key (`<co>:portraitSmall` | `<co>:portraitFull` | `<co>:art`) → asset path */
  co: Record<string, string>;
};

export const loadSkins = async (prisma: PrismaClient): Promise<SkinMap> => {
  const skins = await prisma.skin.findMany({ include: { type: true, assets: true } });

  const map: SkinMap = { army: {}, co: {} };

  for (const skin of skins) {
    if (skin.type.key === "army") {
      map.army[skin.key] = Object.fromEntries(skin.assets.map((a) => [a.elementKey, a.path]));
    } else if (skin.type.key === "co") {
      for (const asset of skin.assets) {
        map.co[asset.elementKey] = asset.path;
      }
    }
  }

  return map;
};
