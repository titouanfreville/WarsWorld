import type { GameMode, Ruleset } from "./schemas/game-mode";
import type { MatchRules } from "./schemas/match-rules";

/**
 * Cross-feature contracts.
 *
 * Features never import each other, but some genuinely need each other's work — matchmaking has to
 * create a match, match play has to get a finished match rated. A port is the narrow interface that
 * need is expressed through: the consumer depends on the interface declared HERE, the owning feature
 * implements it, and the composition root is the only place the two meet.
 *
 * Ports live in `core` because it is the one module every feature may import. They stay free of
 * feature types on purpose — a port that returned a `MatchWrapper` would drag the engine into `core`
 * and re-create the coupling it exists to prevent. Implementations may return MORE than the port
 * promises (structural typing allows it); consumers only ever see the narrow shape.
 */

/** What a finished match needs from whoever owns rating. Implemented by the `ranking` feature. */
export type Rater = {
  /**
   * Rate a finished match and move its players' ladders.
   *
   * Must be idempotent: match finalization is reachable more than once (the deciding action, a
   * reconnect-driven rebuild, a backfill), and this is called from an event handler with no
   * delivery guarantee of exactly-once.
   *
   * Owns its own transaction — the caller is an event handler, not a unit of work.
   */
  rateFinishedMatch(matchId: string): Promise<void>;
};

export type SpawnMatchInput = {
  mapId: string;
  rules: MatchRules;
  mode: GameMode;
  ruleset: Ruleset;
  isRanked: boolean;
  /** The player opening the match; takes slot 0. */
  createdBy: { id: string; name: string };
};

/**
 * What lobby/matchmaking needs from whoever owns matches.
 *
 * DECLARED, NOT YET IMPLEMENTED — match play still lives in `server/routers/match`, and giving this
 * an implementation means first deciding where the match feature's boundary falls (its creation path
 * reaches for `INITIAL_FUNDS`, an engine constant a feature may not import). That decision belongs
 * to the match-play branch; the contract is here so that branch builds against it rather than
 * inventing a shape later, and so lobby/matchmaking have something to code against meanwhile.
 */
export type MatchSpawner = {
  spawn(input: SpawnMatchInput): Promise<{ matchId: string }>;
};
