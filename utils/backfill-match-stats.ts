/**
 * Backfill `MatchPlayerStats` + `Match.days`/`durationMs` for matches that finished BEFORE finalize
 * started writing them (plan §6, phase 2).
 *
 * Finalize now derives the battle-report headline once, at the moment a match ends. Rows that
 * finished before that landed have no stats, so their history entries would show no grade. This
 * replays each one's event log once and writes the same rows finalize would have.
 *
 * Idempotent: `persistStats` self-guards on `Match.statsAt`, so re-running skips anything already
 * done. Safe to run repeatedly.
 *
 *   npx tsx --tsconfig tsconfig.json utils/backfill-match-stats.ts
 */
import { PrismaClient } from "@prisma/client";
import { EndgameUsecase } from "server/endgame/endgame.usecase";

const prisma = new PrismaClient();
const endgame = new EndgameUsecase(prisma);

const main = async (): Promise<void> => {
  const pending = await prisma.match.findMany({
    // Cancelled matches were played too and have a real event log, so they get a report as well;
    // `setup` never started, so there'd be nothing to derive.
    where: { status: { in: ["finished", "cancelled"] }, statsAt: null },
    select: { id: true, status: true },
    orderBy: { finishedAt: "asc" },
  });

  console.log(`${pending.length} match(es) need stats.`);

  let done = 0;
  let failed = 0;

  for (const match of pending) {
    try {
      // Same call finalize makes — one transaction per match, so a bad row can't strand the rest.
      await prisma.$transaction((tx) => endgame.persistStats(tx, match.id));
      done += 1;
      console.log(`  ✓ ${match.id} (${match.status})`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${match.id} (${match.status}):`, (error as Error).message);
    }
  }

  console.log(`\nbackfilled ${done}, failed ${failed}.`);
};

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
