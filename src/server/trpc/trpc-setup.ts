import { authMiddleware, requireCapability } from "./middleware/auth";
import { matchMiddleware, withMatchIdSchema } from "./middleware/match";
import { playerMiddleware, withPlayerIdSchema } from "./middleware/player";
import { t } from "./trpc-init";
import { DispatchableError } from "server/engine/dispatchable-error";

export const { router, mergeRouters } = t;
export const publicBaseProcedure = t.procedure;

export const playerBaseProcedure = t.procedure
  .input(withPlayerIdSchema)
  .use(authMiddleware)
  .use(playerMiddleware);

export const matchBaseProcedure = playerBaseProcedure.input(withMatchIdSchema).use(matchMiddleware);

/**
 * Privileged tools that fabricate match state.
 *
 * Built on `matchBaseProcedure`, NOT `playerInMatchBaseProcedure`: the latter enforces "it's your
 * turn", and a dev tool that only works on your own turn would be useless for setting up a scenario.
 *
 * The capability is only the *user* half of the gate. Whether the tools are allowed in THIS match
 * (ranked? testing-tools enabled?) depends on the match, so the usecase must still call
 * `assertDevToolsAllowed`. Neither check alone is sufficient.
 */
export const devToolsBaseProcedure = matchBaseProcedure.use(requireCapability("devTools"));

/** Admin-only transport: modify rank, force a match, force an outcome. */
export const adminBaseProcedure = playerBaseProcedure.use(requireCapability("adminTools"));

/** Admin-only, scoped to a match (force outcome, unwait a unit). */
export const adminMatchBaseProcedure = matchBaseProcedure.use(requireCapability("adminTools"));

export const playerInMatchBaseProcedure = matchBaseProcedure.use(
  matchMiddleware.unstable_pipe(playerMiddleware).unstable_pipe(({ ctx, next }) => {
    const { match, currentPlayer } = ctx;
    //TODO: Do we want this function to also be used
    // when addressing match setup stuff (change CO, army, ready status)
    // or only "in-game" stuff

    //gets us the entire data of the current player (the one logged in)
    const currentPlayerFull = match.getPlayerById(currentPlayer.id);

    //the match hasn't started so, having the turn is irrelevant
    //(this is more for setup like changing CO or army, etc)
    if (match.status === "setup" && currentPlayerFull !== undefined) {
      return next({
        ctx: {
          ...ctx,
          player: currentPlayerFull,
        },
      });
    }

    //TODO: What about when match is "finished"/done?
    //so the match isn't in setup, therefore turn matters (maybe?)
    const playerWithTurn = match.getCurrentTurnPlayer();

    if (playerWithTurn.data.id !== currentPlayer.id) {
      throw new DispatchableError(
        "It's not your turn / currentPlayer id does not match playerWithTurn id",
      );
    }

    return next({
      ctx: {
        ...ctx,
        player: playerWithTurn,
      },
    });
  }),
);
