import type { NextApiRequest, NextApiResponse } from "next";

/**
 * Liveness probe for the container orchestrator / reverse proxy.
 *
 * `GET /api/health` → 200 `{ status: "ok" }`
 *
 * Deliberately touches nothing: no DB, no game data, no auth. It answers "is this process serving
 * HTTP?", which is exactly what a Docker `HEALTHCHECK` needs — Postgres has its own healthcheck,
 * and a DB blip should not make the app look dead and get restarted underneath live matches.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({ status: "ok" });
}
