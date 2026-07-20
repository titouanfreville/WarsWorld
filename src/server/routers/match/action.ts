import { observable } from "@trpc/server/observable";
import { subscribe } from "server/emitter/event-emitter";
import { mainActionSchema } from "server/core/schemas/action";
import type { Emittable } from "server/engine/types/events";
import { matchActionUsecase } from "server/composition-root";
import { matchBaseProcedure, playerInMatchBaseProcedure, router } from "server/trpc/trpc-setup";

export const actionRouter = router({
  /** Play a board action. `playerInMatchBaseProcedure` is the "it's your turn" gate. */
  send: playerInMatchBaseProcedure
    .input(mainActionSchema)
    .mutation(({ input, ctx: { match } }) => matchActionUsecase.send(match, input)),

  /**
   * Concede the match.
   *
   * Rides on `matchBaseProcedure`, NOT `playerInMatchBaseProcedure`: that one enforces "it's your
   * turn", and a resignation you can only make on your own turn would miss the moment people
   * actually want it — while the opponent is taking theirs. The usecase does the gating this
   * procedure doesn't: that you're in this match, still alive, and it's still being played.
   */
  surrender: matchBaseProcedure.mutation(({ ctx: { match, currentPlayer } }) =>
    matchActionUsecase.surrender(match, currentPlayer.id),
  ),

  onEvent: matchBaseProcedure.subscription(({ ctx: { match, currentPlayer } }) =>
    observable<Emittable>((emit) => subscribe(match.id, currentPlayer.id, emit.next)),
  ),
  // TODO create procedure for anonymous users to observe games
  // (they get their own special "-1" team or something)
});
