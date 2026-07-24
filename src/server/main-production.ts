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

  // tRPC WebSocket. Attach it in `noServer` mode and drive the HTTP `upgrade` ourselves (below),
  // rather than letting `ws` bind the server's 'upgrade' event directly.
  const wss = createTRPCwebSocketServer({ noServer: true });

  // Next.js hijacks WebSockets on a custom server. On the FIRST request its handler lazily attaches
  // its OWN 'upgrade' listener to this server — it reads the server off `req.socket.server`, since
  // we never hand the server to next(). That listener then destroys any upgrade it doesn't own,
  // which is our tRPC socket: `ws` completes the handshake, Next tears the socket down a few ms
  // later, and the browser sees close code 1006 "WebSocket closed prematurely" on every query and
  // subscription. The page renders (SSR is fine) but nothing live works.
  //
  // Next only needs upgrades for dev HMR; in production it has no native WebSocket. So we take sole
  // ownership of the event: route every upgrade to tRPC, and refuse any later 'upgrade' listener
  // (Next's) from being registered on this server.
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit("connection", client, req);
    });
  });

  // `setupWebSocketHandler` in next/dist/server/next.js registers via `server.on("upgrade", …)`, so
  // shadowing `.on` (Node aliases `.addListener` to it) drops that one registration while leaving
  // every other event untouched. Our own handler above is already attached, so it stays sole owner.
  const registerListener = server.on.bind(server);
  server.on = function guardedOn(event: string, listener: (...args: unknown[]) => void) {
    if (event === "upgrade") {
      return server;
    }

    return registerListener(event, listener);
  } as typeof server.on;

  server.listen(port);

  // Deliberately the PORT, not NEXT_PUBLIC_WS_URL: that variable is inlined into the client bundle
  // at build time and is simply absent from the server's runtime environment, so the old message
  // printed "listening at undefined3001" in a real deployment — alarming and useless. The public
  // origin belongs to the reverse proxy, which this process knows nothing about.
  logger.info(`Production mode: HTTP + WebSocket server listening on port ${port}`);
})();
