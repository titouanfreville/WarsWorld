import { PrismaClient } from "@prisma/client";
import { loadSkins } from "server/adapters/game-data/skins-repo";
import {
  ARMIES,
  CO_NAMES,
  coArtUrl,
  coPortraitUrl,
  ENGINE_UNIT_KEY,
  nationFlagUrl,
  UNIT_TYPES,
  unitSpriteUrl,
} from "frontend/utils/sprites";

/**
 * Proves the DB skin assets are byte-identical to the frontend's sprite-path convention: every path
 * the adapter loads must equal what the FE resolver functions return. A match means the FE can
 * resolve sprites from the DB (SQL-managed skins) with zero visual change.
 *
 *   rtk proxy npx tsx prisma/scripts/verify-skins-roundtrip.ts
 */

const prisma = new PrismaClient();

async function main() {
  const map = await loadSkins(prisma);
  const diffs: string[] = [];

  for (const army of ARMIES) {
    const armyMap = map.army[army] ?? {};

    for (const unit of UNIT_TYPES) {
      const key = ENGINE_UNIT_KEY[unit];
      const expected = unitSpriteUrl(unit, army);

      if (armyMap[key] !== expected) {
        diffs.push(`${army}/${key}: db=${armyMap[key]} fe=${expected}`);
      }
    }

    if (armyMap.flag !== nationFlagUrl(army)) {
      diffs.push(`${army}/flag: db=${armyMap.flag} fe=${nationFlagUrl(army)}`);
    }
  }

  for (const co of CO_NAMES) {
    const checks: [string, string][] = [
      [`${co}:portraitSmall`, coPortraitUrl(co, "small")],
      [`${co}:portraitFull`, coPortraitUrl(co, "full")],
      [`${co}:art`, coArtUrl(co)],
    ];

    for (const [key, expected] of checks) {
      if (map.co[key] !== expected) {
        diffs.push(`co ${key}: db=${map.co[key]} fe=${expected}`);
      }
    }
  }

  const total = ARMIES.length * (UNIT_TYPES.length + 1) + CO_NAMES.length * 3;

  if (diffs.length === 0) {
    console.log(`✅ skins round-trip OK — all ${total} paths match the FE convention.`);
    return;
  }

  console.error(`❌ skins round-trip MISMATCH (${diffs.length} of ${total}):`);
  console.error(diffs.slice(0, 20).join("\n"));
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
