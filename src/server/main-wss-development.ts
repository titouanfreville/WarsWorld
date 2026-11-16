import { logger } from "shared/utils/logger";
import { createTRPCwebSocketServer } from "./common-server";
import { startBackgroundWork } from "./composition-root";
import { matchStore } from "./match-store";

void (async () => {
  await matchStore.rebuild();
  // Re-arm timers and warm caches; the composition root owns that sequence.
  await startBackgroundWork();
  const wss = createTRPCwebSocketServer({
    port: 3001,
  });

  wss.on("connection", (ws) => {
    logger.debug(`➕➕ Connection (${wss.clients.size})`);
    ws.once("close", () => {
      logger.debug(`➖➖ Connection (${wss.clients.size})`);
    });
  });

  logger.info(`Development mode: tRPC listening on ${process.env.NEXT_PUBLIC_WS_URL}`);
})();
