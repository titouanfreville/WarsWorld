import { BANS_PER_PLAYER } from "./constants";

/**
 * Pure map pick & ban resolution — no I/O. The usecase persists bans/votes on `PlayerInLobby`; this
 * module owns the *rules*: what survives the bans, which votes are valid, and how the final map is
 * rolled. `randomInt(maxExclusive)` is injected so callers stay deterministic in tests.
 *
 * There is no deadline auto-fill: a player who doesn't vote in time abandons the pick and the match
 * is cancelled + flagged (handled in the usecase), rather than voting on their behalf.
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

  return pickRandom(pool, randomInt);
};

/**
 * Validate a live ban: the map must be in the pool, unbanned by this player, and the player must
 * have bans left — AND the ban must not empty the pool. `players` is every member's current
 * ban/vote state; the last-survivor guard rejects a ban that would leave nothing to vote on, so two
 * players can never ban every map (which would make voting impossible and wrongly flag both as
 * having abandoned the pick).
 */
export const canBan = (
  pool: string[],
  players: PlayerBanVote[],
  player: PlayerBanVote,
  mapId: string,
): boolean => {
  if (!pool.includes(mapId)) {
    return false;
  }

  if (player.bannedMapIds.includes(mapId)) {
    return false;
  }

  if (player.bannedMapIds.length >= BANS_PER_PLAYER) {
    return false;
  }

  const afterBan = players.map((p) =>
    p.playerId === player.playerId ? { ...p, bannedMapIds: [...p.bannedMapIds, mapId] } : p,
  );
  return survivors(pool, afterBan).length > 0;
};

/** Validate a live vote: the map must still be a survivor (in pool, not banned by anyone). */
export const canVote = (pool: string[], players: PlayerBanVote[], mapId: string): boolean =>
  survivors(pool, players).includes(mapId);
