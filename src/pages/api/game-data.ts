import type { NextApiRequest, NextApiResponse } from "next";
import {
  getCoProfiles,
  getSkins,
  invalidateGameData,
} from "server/adapters/game-data/game-data-cache";
import { prisma } from "server/prisma/prisma-client";

/**
 * Game-data bootstrap. Returns the DB-sourced commander profiles as JSON — the payload a client-side
 * engine (e.g. the v1 pixi board, which runs the engine in the browser with no DB access) fetches
 * and feeds to `setCoProfiles`, and a handy inspection endpoint for the DB game data.
 *
 * `GET /api/game-data`            → { coProfiles }
 * `GET /api/game-data?reload=1`   → drops the server cache first, so a SQL edit to the CO tables
 *                                   takes effect (codex + this process's engine) WITHOUT a restart.
 *
 * Note: `getCoProfiles` also re-feeds the engine's `setCoProfiles`, so a reload refreshes combat and
 * the champ-select codex for the process that serves this route.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (req.query.reload !== undefined) {
    invalidateGameData();
  }

  const [coProfiles, skins] = await Promise.all([getCoProfiles(prisma), getSkins(prisma)]);

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ coProfiles, skins });
}
