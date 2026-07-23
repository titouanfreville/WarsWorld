import http from "http";
import next from "next";
import { parse } from "url";
import { logger } from "shared/utils/logger";
import { initGameData } from "./adapters/game-data/game-data-cache";
import { createTRPCwebSocketServer } from "./common-server";
import { matchStore } from "./match-store";
import { matchesUsecase } from "./composition-root";
import { matchmakingUsecase } from "./composition-root";
import { prisma } from "./prisma/prisma-client";

const port = parseInt(process.env.PORT ?? "3001", 10);
const app = next({ dev: false });
const handler = app.getRequestHandler();

/**
 * This process serves BOTH the Next app and the tRPC WebSocket on the same port, so the only
 * origin the browser ever talks to is our own. `NEXT_PUBLIC_APP_URL` is that origin (the public
 * one, e.g. `https://<host>`); behind a TLS-terminating proxy it's what CORS must echo — never a
 * hardcoded localhost.
 */
const appOrigin = process.env.NEXT_PUBLIC_APP_URL ?? `http://localhost:${port}`;

void (async () => {
  await matchStore.rebuild();
  // Warm the game-data cache (CO profiles) from the DB so the first request is fast.
  await initGameData(prisma);
  // Re-arm general-picker deadlines from Match.pickEndsAt so a restart never drops one.
  await matchesUsecase.reschedulePickDeadlines();
  // Re-arm matchmaking ready-check / map-ban deadlines, then start the pairing loop.
  await matchmakingUsecase.rescheduleLobbyPhases();
  matchmakingUsecase.startQueueTick();
  await app.prepare();

  const server = http.createServer((req, res) => {
    // A throw here would be an uncaught exception in the request listener — i.e. the whole server
    // dies on one malformed request. Answer it instead.
    if (req.url === undefined) {
      res.writeHead(400);
      res.end();
      return;
    }

    // Behind a TLS-terminating proxy, bounce plain HTTP to HTTPS. Opt-in: with no proxy (or one
    // that doesn't set the header) this never fires, so a plain-HTTP deployment still works.
    if (req.headers["x-forwarded-proto"] === "http" && req.headers.host !== undefined) {
      // redirect to ssl
      res.writeHead(303, {
        location: `https://${req.headers.host}${req.url}`,
      });
      res.end();

      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": appOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", appOrigin);
    res.setHeader("Access-Control-Allow-Credentials", "true");

    // set browsers to deny framing into an iframe (framebusting)
    res.setHeader("X-Frame-Options", "DENY");

    // set content security policy
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");

    // prevent MIME sniffing
    res.setHeader("X-Content-Type-Options", "nosniff");

    // prevents cross origin script loading
    res.setHeader("Referrer-Policy", "same-origin");

    const parsedUrl = parse(req.url, true);
    void handler(req, res, parsedUrl);
  });

  createTRPCwebSocketServer({ server });
  server.listen(port);

  logger.info(`Production mode: HTTP + tRPC WebSocket listening on port ${port} (${appOrigin})`);
})();
