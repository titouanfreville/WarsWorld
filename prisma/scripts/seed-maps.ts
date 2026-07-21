import type { PrismaClient } from "@prisma/client";
import { importAWBWMap } from "server/tools/map-importer-utilities";
import { mapDefinitions, rankedModesOf, supportedModesOf } from "./map-definitions";

/**
 * Seeds the test map pool (see `map-definitions.ts`).
 *
 * Idempotent by name so re-seeding an existing dev database does not pile up duplicates —
 * `WWMap.name` is not unique, so the guard is an explicit lookup rather than an upsert.
 *
 * Run `npm run maps:check` before seeding: it verifies each map's symmetry and per-slot property
 * parity without touching the database.
 */
export const seedMaps = async (prisma: PrismaClient) => {
  const existing = await prisma.wWMap.findMany({
    where: { name: { in: mapDefinitions.map(({ name }) => name) } },
    select: { id: true, name: true },
  });
  const alreadySeeded = new Map(existing.map((row) => [row.name, row.id]));

  for (const definition of mapDefinitions) {
    const existingId = alreadySeeded.get(definition.name);

    if (existingId !== undefined) {
      // The row survives (it may be referenced by a live match, and rewriting its tiles would
      // corrupt that match) but its mode tags are re-applied. They are read only when a lobby or
      // queue picks a map, never during play, so refreshing them is safe — and without this a row
      // that predates the columns keeps an empty `supportedModes` and is playable nowhere.
      await prisma.wWMap.update({
        where: { id: existingId },
        data: {
          supportedModes: supportedModesOf(definition),
          rankedModes: rankedModesOf(definition),
        },
      });
      continue;
    }

    await importAWBWMap(
      {
        name: definition.name,
        numberOfPlayers: definition.numberOfPlayers,
        tileDataString: definition.tileDataString,
        supportedModes: supportedModesOf(definition),
        // These maps ARE vetted — each is checked against its designed mode — so unlike a bare
        // import they opt into ranked rather than taking the importer's casual-only default.
        rankedModes: rankedModesOf(definition),
      },
      // The client WE were handed. Left to its default, the create went through the importer's own
      // module singleton while the lookup and update above used this one — two connection pools for
      // one seed, and no way for the two halves to ever share a transaction.
      prisma,
    );
  }
};
