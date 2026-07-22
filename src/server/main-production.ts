import http from "http";
import next from "next";
import { parse } from "url";
import { logger } from "shared/utils/logger";
import { initGameData } from "./adapters/game-data/game-data-cache";
import { createTRPCwebSocketServer } from "./common-server";
import { matchStore } from "./match-store";
import { matchActionUsecase, matchesUsecase } from "./composition-root";
import { matchmakingUsecase } from "./composition-root";
import { prisma } from "./prisma/prisma-client";

const port = parseInt(process.env.PORT ?? "3001", 10);
const app = next({ dev: false });
const handler = app.getRequestHandler();

/**
 * The browser origin allowed to call this server, with credentials. This exists only because the
 * Next dev server and the WS/API server sit on different ports; in production they are the SAME
 * process on one origin, so this should be the deployed site's URL.
 *
 * It used to be hardcoded to `http://localhost:3000`, which silently breaks every deployment: a
 * credentialed request from the real origin is rejected, and the header advertises localhost.
 * Falling back is kept (so a local production build still runs) but is loud — in a real deployment
 * an unset CORS_ORIGIN is a misconfiguration, not a default.
 */
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";

if (process.env.CORS_ORIGIN === undefined) {
  logger.warn(
    `CORS_ORIGIN is not set — falling back to ${corsOrigin}. Set it to the deployed origin, ` +
      `or credentialed browser requests will be rejected.`,
  );
}

void (async () => {
  await matchStore.rebuild();
  // Warm the game-data cache (CO profiles) from the DB so the first request is fast.
  await initGameData(prisma);
  // Re-arm general-picker deadlines from Match.pickEndsAt so a restart never drops one.
  await matchesUsecase.reschedulePickDeadlines();
  // Re-arm turn clocks from Match.turnEndsAt, so time keeps running across a restart
  // instead of the acting player quietly getting a fresh bank.
  await matchActionUsecase.rescheduleTurnDeadlines();
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
    // NB: the target path is `req.url` — `req.headers.url` is not a header and is always
    // undefined, which made the old guard throw (killing the process) instead of redirecting.
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
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", corsOrigin);
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

  // Deliberately the PORT, not NEXT_PUBLIC_WS_URL: that variable is inlined into the client bundle
  // at build time and is simply absent from the server's runtime environment, so the old message
  // printed "listening at undefined3001" in a real deployment — alarming and useless. The public
  // origin belongs to the reverse proxy, which this process knows nothing about.
  logger.info(`Production mode: HTTP + WebSocket server listening on port ${port}`);
})();
