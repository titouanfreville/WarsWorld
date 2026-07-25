import { logger } from "shared/utils/logger";
import { createTRPCwebSocketServer } from "./common-server";
import { matchStore } from "./match-store";
import { matchActionUsecase, matchesUsecase } from "./composition-root";
import { matchmakingUsecase } from "./composition-root";
import { startAuthAttemptSweep } from "./auth/throttle.dbo";

void (async () => {
  await matchStore.rebuild();
  // Re-arm general-picker deadlines from Match.pickEndsAt so a restart never drops one.
  await matchesUsecase.reschedulePickDeadlines();
  // Re-arm turn clocks from Match.turnEndsAt, so time keeps running across a restart
  // instead of the acting player quietly getting a fresh bank.
  await matchActionUsecase.rescheduleTurnDeadlines();
  // Re-arm matchmaking ready-check / map-ban deadlines, then start the pairing loop.
  await matchmakingUsecase.rescheduleLobbyPhases();
  matchmakingUsecase.startQueueTick();
  // Retire sign-in/sign-up failure counters that have gone quiet, so a name-spraying run can't
  // grow the table without bound.
  startAuthAttemptSweep();

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
