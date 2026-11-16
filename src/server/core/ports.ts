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

/** A hidden rating pair, as OpenSkill models it. Structural so `core` needs no rating library. */
export type SkillRating = { mu: number; sigma: number };

/**
 * What matchmaking needs to READ from whoever owns rating: who is how good, and what rank to band
 * them into. Implemented by the `ranking` feature.
 *
 * Separate from {@link Rater} because the two are opposite directions — `Rater` WRITES a result,
 * this one only reads — and a queue that could write ratings would be a queue that could rig them.
 */
export type SkillSource = {
  /** Hidden ratings by player id, keyed per mode. Missing players are simply absent from the map. */
  getSkills(playerIds: string[], mode: GameMode): Promise<Map<string, SkillRating>>;
  /** The player's displayed rank code in this mode, or null when they have none yet. */
  rankFor(playerId: string, mode: GameMode): Promise<string | null>;
  /**
   * What an unrated player counts as. Supplied by `ranking` rather than assumed here: the default
   * is part of the rating model, and a queue inventing its own would seed the ladder differently
   * from the rater.
   */
  defaultSkill(): SkillRating;
  /**
   * Active rank codes in ladder order, for the rank band a queue widens through.
   *
   * Which ranks exist is seeded data, so the queue must ASK rather than hold a constant — a season
   * that activates a new rank must not require a deploy to the matchmaker.
   */
  activeRankCodes(): Promise<string[]>;
};

/** A confirmed seat handed over by whoever assembled the match: who sits where. */
export type SpawnSeat = { playerId: string; team: number; slotWithinTeam: number };

export type SpawnMatchInput = {
  /** Provenance, when the match came from a lobby. */
  lobbyId?: string;
  mode: GameMode;
  ruleset: Ruleset;
  isRanked: boolean;
  mapId: string;
  rules: MatchRules;
  seats: SpawnSeat[];
  /** Cosmetic faction per team index, carried from whoever assembled the seats. */
  teamFactions?: string[];
};

/**
 * What lobby/matchmaking need from whoever owns matches. Implemented by `MatchesUsecase`.
 *
 * The composition root asserts the implementation against this type, so the two cannot drift
 * silently — which they already did once: this port was written before `MatchesUsecase` existed and
 * guessed both the method name and the payload wrong.
 */
export type MatchSpawner = {
  spawnFromLobby(input: SpawnMatchInput): Promise<{ matchId: string }>;
};
