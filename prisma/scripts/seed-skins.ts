import { PrismaClient } from "@prisma/client";
import { fileURLToPath } from "url";
import {
  ARMIES,
  ARMY_LABEL,
  CO_NAMES,
  coArtUrl,
  coPortraitUrl,
  ENGINE_UNIT_KEY,
  nationFlagUrl,
  UNIT_TYPES,
  unitSpriteUrl,
  type UnitType,
} from "frontend/utils/sprites";

/**
 * Seeds the skin/asset tables (SkinType / Skin / SkinAsset) by materialising the frontend's current
 * sprite-path convention as data — every path is produced by the SAME resolver functions the FE uses
 * today, so the DB is byte-identical to convention and a later FE cutover to DB-resolved sprites is a
 * no-op visually. Idempotent: clears the skin tables then re-inserts.
 *
 *   army skin (one per nation) → element `<engineUnitKey>` = idle unit sprite; `flag` = nation crest.
 *   co skin (single "default")  → element `<co>:portraitSmall|portraitFull|art` = CO portrait / art.
 *
 * Exposed as `seedSkins(prisma)` for `prisma/seed.ts`; runs standalone when invoked directly.
 */

export async function seedSkins(prisma: PrismaClient) {
  await prisma.skinAsset.deleteMany();
  await prisma.skin.deleteMany();
  await prisma.skinType.deleteMany();

  const armyType = await prisma.skinType.create({ data: { key: "army" } });
  const coType = await prisma.skinType.create({ data: { key: "co" } });

  // --- Army skins: idle unit sprites + flag, per nation ---
  for (const army of ARMIES) {
    const assets = [
      ...UNIT_TYPES.map((unit: UnitType) => ({
        elementKey: ENGINE_UNIT_KEY[unit],
        path: unitSpriteUrl(unit, army),
      })),
      { elementKey: "flag", path: nationFlagUrl(army) },
    ];

    await prisma.skin.create({
      data: {
        typeId: armyType.id,
        key: army,
        displayName: ARMY_LABEL[army],
        assets: { create: assets },
      },
    });
  }

  // --- CO skin: portraits + full art for every general ---
  const coAssets = CO_NAMES.flatMap((co) => [
    { elementKey: `${co}:portraitSmall`, path: coPortraitUrl(co, "small") },
    { elementKey: `${co}:portraitFull`, path: coPortraitUrl(co, "full") },
    { elementKey: `${co}:art`, path: coArtUrl(co) },
  ]);

  await prisma.skin.create({
    data: {
      typeId: coType.id,
      key: "default",
      displayName: "Default",
      assets: { create: coAssets },
    },
  });

  const [skins, assets] = await Promise.all([prisma.skin.count(), prisma.skinAsset.count()]);
  console.log(`Seeded ${skins} skins, ${assets} skin assets.`);
}

// Run standalone (but not when imported by prisma/seed.ts).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const prisma = new PrismaClient();
  seedSkins(prisma)
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(() => void prisma.$disconnect());
}
