import { PrismaClient } from "@prisma/client";
import { seedGameData } from "./seed-game-data";
import { seedCos } from "./seed-cos";
import { seedSkins } from "./seed-skins";
import { seedMaps } from "./seed-maps";

/**
 * Seeds ONLY the game reference data a deployment genuinely needs: units/terrain/properties, then
 * commanders, then skins, then the map pool.
 *
 * This exists because `prisma/seed.ts` is a DEV seed and must never run against a real deployment:
 * alongside the same reference data it creates a `development_user` holding **every role, including
 * `admin`**, with the password `secret`, plus fixture players, articles and sample matches. Running
 * it against production would hand anyone who guessed those credentials full admin over the ladder.
 *
 * Ordering is load-bearing: `seedCos` writes per-unit modifier rows that FK to `UnitType`, so the
 * unit tables must exist first.
 *
 * Run: `npm run prisma:seed:reference`
 *
 * NOT idempotent in the gentle sense — `seedGameData` and `seedCos` CLEAR their tables before
 * re-inserting. That is fine before a deployment takes traffic, and fine for a content refresh
 * during a maintenance window, but do not run it casually against a live database.
 */
const main = async () => {
  const prisma = new PrismaClient();

  try {
    console.log("Seeding game reference data…");
    await seedGameData(prisma);
    await seedCos(prisma);
    await seedSkins(prisma);
    await seedMaps(prisma);
    console.log("✔ Reference data seeded (game data, commanders, skins, maps).");
  } finally {
    await prisma.$disconnect();
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
