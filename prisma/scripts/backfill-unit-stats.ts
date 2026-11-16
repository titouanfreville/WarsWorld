import { EndgameUsecase } from "server/endgame/endgame.usecase";
import { prisma } from "server/prisma/prisma-client";

/**
 * One-off backfill: populate `MatchPlayerStats.unitBreakdown` on matches finalized before the column
 * existed. Re-runs the End-Game replay (`buildMatchStats`) for each finished match and writes only the
 * per-unit tallies — the same logic the EG review uses, applied across every match. Idempotent.
 *
 * Run with: `npx tsx prisma/scripts/backfill-unit-stats.ts`
 */
async function main(): Promise<void> {
  const endgame = new EndgameUsecase(prisma);
  const matches = await prisma.match.findMany({
    where: { statsAt: { not: null } },
    select: { id: true },
  });

  console.log(`Backfilling unit breakdown for ${matches.length} finished matches…`);
  let done = 0;

  for (const match of matches) {
    try {
      await endgame.backfillUnitBreakdown(match.id);
      done += 1;
    } catch (error) {
      console.error(`  match ${match.id} failed:`, error instanceof Error ? error.message : error);
    }
  }

  console.log(`Done: ${done}/${matches.length}.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
