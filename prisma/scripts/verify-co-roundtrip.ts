import { PrismaClient } from "@prisma/client";
import { loadCoProfiles } from "server/adapters/game-data/co-repo";
import { CO_PROFILES } from "server/engine/constants/co-profiles";
import type { COProfile } from "server/engine/constants/co-profile";

/**
 * Proves the DB is a FAITHFUL mirror of the declarative `CO_PROFILES`: loads every commander back
 * through the adapter and asserts it equals the hand-authored source. Comparison is order-independent
 * (modifier/effect order doesn't affect the engine) and key-order-independent (JSONB reorders keys),
 * so a match means every existing hook/effect verify test applies to the DB data unchanged.
 *
 *   rtk proxy npx tsx prisma/scripts/verify-co-roundtrip.ts
 */

const prisma = new PrismaClient();

/** Recursively sort object keys and sort arrays by their canonical form → order-independent JSON. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonical).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => [k, canonical(v)] as const)
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  }

  return value;
};

const byId = (p: COProfile) => `${p.gameVersion}/${p.key}`;
const canon = (list: COProfile[]) =>
  JSON.stringify([...list].sort((a, b) => byId(a).localeCompare(byId(b))).map(canonical));

async function main() {
  const dbProfiles = await loadCoProfiles(prisma);

  const expected = canon(CO_PROFILES);
  const actual = canon(dbProfiles);

  if (expected === actual) {
    console.log(`✅ round-trip OK — ${dbProfiles.length} DB profiles == CO_PROFILES exactly.`);
    return;
  }

  console.error(
    `❌ round-trip MISMATCH (${dbProfiles.length} DB vs ${CO_PROFILES.length} source).`,
  );

  // Pinpoint the first differing commander for a readable diff.
  const dbById = new Map(dbProfiles.map((p) => [byId(p), p]));

  for (const src of CO_PROFILES) {
    const db = dbById.get(byId(src));

    if (db === undefined) {
      console.error(`  missing in DB: ${byId(src)}`);
      continue;
    }

    if (JSON.stringify(canonical(src)) !== JSON.stringify(canonical(db))) {
      console.error(`  first diff at ${byId(src)}:`);
      console.error("   source:", JSON.stringify(canonical(src)));
      console.error("   db    :", JSON.stringify(canonical(db)));
      break;
    }
  }

  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
