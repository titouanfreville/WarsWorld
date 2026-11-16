/**
 * A tiny typed publisher for things that HAPPENED in one feature and matter to another.
 *
 * A port (`core/ports.ts`) is for "I need this done and I need the result". An event is for "this
 * occurred; whoever cares can react" — the publisher neither knows nor cares who is listening, which
 * is what keeps match play from importing `ranking` just to rate a finished game.
 *
 * Deliberately not an infrastructure queue: in-process, no persistence, no retry. That is a real
 * limitation — a handler that fails has simply not run, and nothing will re-run it — so handlers
 * must be idempotent and the work they do must be recoverable another way (rating is re-derivable
 * from the match row; see `Rater.rateMatch`).
 */

export type DomainEventMap = {
  /** A match has just transitioned to "finished" and its per-player results are stamped. */
  matchFinished: { matchId: string; winnerTeamIndex: number | null };
};

export type DomainEventName = keyof DomainEventMap;

type Handler<Name extends DomainEventName> = (
  payload: DomainEventMap[Name],
) => Promise<void> | void;

export class DomainEvents {
  /**
   * @param onHandlerError reports a handler that threw. Injected rather than imported so `core`
   *   keeps depending on nothing; the composition root passes the shared logger.
   */
  constructor(private readonly onHandlerError: (error: unknown, event: DomainEventName) => void) {}

  private readonly handlers = new Map<DomainEventName, Handler<DomainEventName>[]>();

  on<Name extends DomainEventName>(event: Name, handler: Handler<Name>): void {
    const existing = this.handlers.get(event) ?? [];

    existing.push(handler as Handler<DomainEventName>);
    this.handlers.set(event, existing);
  }

  /**
   * Run every handler for this event, in registration order, and WAIT for them.
   *
   * Awaited on purpose: the End-Game screen queries a match's rating the moment it sees the match
   * end, so fire-and-forget would race the client to its own result. Handlers are expected to be
   * short; anything long-running belongs behind a real queue, not here.
   *
   * One handler's failure never reaches the publisher and never stops the handlers after it — a
   * broken listener must not fail the player's move that triggered it.
   */
  async publish<Name extends DomainEventName>(
    event: Name,
    payload: DomainEventMap[Name],
  ): Promise<void> {
    for (const handler of this.handlers.get(event) ?? []) {
      try {
        await handler(payload);
      } catch (error) {
        this.onHandlerError(error, event);
      }
    }
  }
}
