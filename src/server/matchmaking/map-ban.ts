import { BANS_PER_PLAYER } from "./constants";

/**
 * Pure map pick & ban resolution — no I/O. The usecase persists bans/votes on `PlayerInLobby`; this
 * module owns the *rules*: what survives the bans, which votes are valid, and how the final map is
 * rolled. `randomInt(maxExclusive)` is injected so callers stay deterministic in tests.
 *
 * BANS ARE BLIND. Both players ban simultaneously without seeing each other's picks; the bans reveal
 * only once everyone has spent them, which is also when voting opens ({@link banStageComplete}).
 * Two consequences the rules here have to honour:
 *
 * - **Duplicate bans are legal.** Rejecting "the opponent already banned that" would leak the
 *   opponent's ban through the error. A wasted ban is the cost of banning blind.
 * - **No last-survivor guard.** It too read the opponent's bans. It isn't needed: the pool is at
 *   least `MIN_MAP_POOL_SIZE` (2 players × BANS_PER_PLAYER + 1), so even with zero overlap the bans
 *   can never empty it.
 *
 * There is no deadline auto-fill: a player who doesn't finish their bans, or doesn't vote in time,
 * abandons the pick and the match is cancelled + flagged (handled in the usecase), rather than
 * deciding on their behalf.
 */

export type RandomInt = (maxExclusive: number) => number;

/** Default randomness. Never called in tests (they inject a stub) — avoids Math.random in logic. */
export const defaultRandomInt: RandomInt = (max) => Math.floor(Math.random() * max);

export type PlayerBanVote = {
  playerId: string;
  bannedMapIds: string[];
  votedMapId: string | null;
};

const pickRandom = <T>(items: readonly T[], randomInt: RandomInt): T =>
  items[randomInt(items.length)];

/** Maps left after every player's bans are removed from the pool. */
export const survivors = (pool: string[], players: PlayerBanVote[]): string[] => {
  const banned = new Set(players.flatMap((p) => p.bannedMapIds));
  return pool.filter((id) => !banned.has(id));
};

/**
 * The final map: rolled at random among the *voted* maps (so a shared favourite is likely but not
 * guaranteed). Reached only once everyone has voted. Falls back to any survivor, then any pool map,
 * so it always returns something even if a vote was banned out at the last moment.
 */
export const rollMap = (
  pool: string[],
  players: PlayerBanVote[],
  randomInt: RandomInt = defaultRandomInt,
): string => {
  const remaining = survivors(pool, players);
  const votes = players
    .map((p) => p.votedMapId)
    .filter((id): id is string => id !== null && remaining.includes(id));

  if (votes.length > 0) {
    return pickRandom(votes, randomInt);
  }

  if (remaining.length > 0) {
    return pickRandom(remaining, randomInt);
  }

  if (pool.length === 0) {
    // Callers guarantee a non-empty pool (createReadyCheck requeues on an empty one); fail loudly
    // rather than returning `undefined` typed as `string`.
    throw new Error("rollMap called with an empty pool");
  }

  return pickRandom(pool, randomInt);
};

/**
 * Has everyone spent all their bans? This is the reveal moment: bans stay hidden until it's true,
 * and voting opens the instant it is.
 */
export const banStageComplete = (players: PlayerBanVote[]): boolean =>
  // `players.length > 0` because `[].every(...)` is vacuously TRUE. A lobby whose deciders have all
  // left (or that somehow contains only spectators) would otherwise report its bans revealed, open
  // voting on nobody, and let `resolveMapBan` roll a map for an empty room.
  players.length > 0 && players.every((p) => p.bannedMapIds.length >= BANS_PER_PLAYER);

/**
 * Validate a live ban. Deliberately blind: it looks ONLY at the pool and at *this* player's own bans
 * — the map must be in the pool, not already banned by them, and they must have bans left. It never
 * consults the other players, because every rejection is information (see the module header).
 */
export const canBan = (pool: string[], player: PlayerBanVote, mapId: string): boolean => {
  if (!pool.includes(mapId)) {
    return false;
  }

  if (player.bannedMapIds.includes(mapId)) {
    return false;
  }

  return player.bannedMapIds.length < BANS_PER_PLAYER;
};

/**
 * Validate a live vote: the ban stage must be over (nobody votes before the reveal — that's what
 * makes the bans meaningful) and the map must still be a survivor.
 */
export const canVote = (pool: string[], players: PlayerBanVote[], mapId: string): boolean =>
  banStageComplete(players) && survivors(pool, players).includes(mapId);
