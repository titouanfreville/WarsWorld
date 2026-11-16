/**
 * Ephemeral End-Game presence registry (Epic 5, FR7). Tracks who is currently on a match's End-Game
 * screen so the post-game chat can enforce a **presence-based write window**: the match conversation
 * stays writable while at least one participant is still present, and drains to read-only once
 * everyone has left (their heartbeats lapse). Pure in-memory live state with no DB — like the rest
 * of the live-match cache, it rebuilds empty on boot, which is correct: a reboot ends the post-game
 * session and the historical view is read-only anyway.
 *
 * Cross-cutting infra: both the `endgame` feature (heartbeat) and `social` (send guard) import it.
 */

/** How long a single heartbeat keeps a player marked present. The client re-beats well inside this. */
export const EG_HEARTBEAT_TTL_MS = 20_000;

// matchId → (playerId → epoch ms at which this presence lapses)
const presence = new Map<string, Map<string, number>>();

/** Refresh a player's presence on a match's End-Game screen — called on each client heartbeat. */
export function markEgPresent(matchId: string, playerId: string, now: number = Date.now()): void {
  let seats = presence.get(matchId);

  if (seats === undefined) {
    seats = new Map();
    presence.set(matchId, seats);
  }

  seats.set(playerId, now + EG_HEARTBEAT_TTL_MS);
}

/** The ids of participants still present (non-lapsed) on a match's End-Game screen. */
export function egPresentPlayers(matchId: string, now: number = Date.now()): string[] {
  const seats = presence.get(matchId);

  if (seats === undefined) {
    return [];
  }

  const present: string[] = [];

  for (const [playerId, expiresAt] of seats) {
    if (expiresAt > now) {
      present.push(playerId);
    } else {
      seats.delete(playerId); // opportunistic cleanup of lapsed heartbeats
    }
  }

  if (seats.size === 0) {
    presence.delete(matchId);
  }

  return present;
}

/** True while ≥1 participant is still on the End-Game screen — i.e. the post-game write window. */
export function egChatWritable(matchId: string, now: number = Date.now()): boolean {
  return egPresentPlayers(matchId, now).length > 0;
}
