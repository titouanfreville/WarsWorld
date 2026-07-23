import { PrismaClient } from "@prisma/client";
import { seedCos } from "./seed-cos";
import { seedGameData } from "./seed-game-data";
import { seedSkins } from "./seed-skins";

/**
 * Production seed: the game-reference data ONLY.
 *
 * `prisma/seed.ts` is the DEV seed — it also creates `development_user` (holding every role),
 * fake players, articles and sample maps. None of that belongs on a public deployment, so this
 * script stops after the three tables the app genuinely cannot boot without: units/terrain/
 * properties, commanders, and skins (`initGameData` reads CO profiles at startup).
 *
 * Each seeder clears its own tables before re-inserting, so this is idempotent — but that also
 * means it is a FIRST-BOOT / game-data-update command, not something to wire into container start.
 * Run it deliberately:
 *
 *   docker compose -f docker-compose.prod.yaml run --rm migrate npm run prisma:seed:prod
 */
const prisma = new PrismaClient();

async function main() {
  await seedGameData(prisma);
  await seedCos(prisma);
  await seedSkins(prisma);
  console.log("Production game data seeded.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
