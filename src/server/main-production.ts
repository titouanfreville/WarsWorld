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
    if (req.url === undefined) {
      throw new Error("Request url is undefined");
    }

    if (req.headers["x-forwarded-proto"] === "http") {
      if (req.headers.host === undefined || typeof req.headers.url !== "string") {
        throw new Error("Headers are incorrect");
      }

      // redirect to ssl
      res.writeHead(303, {
        location: `https://` + req.headers.host + req.headers.url,
      });
      res.end();

      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "http://localhost:3000",
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      });
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
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

  logger.info(`Production mode: Server listening at ${process.env.NEXT_PUBLIC_WS_URL}${port}`);
})();
