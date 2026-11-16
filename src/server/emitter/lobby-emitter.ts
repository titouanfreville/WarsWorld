/**
 * Lobby-room event bus. The match emitter keys rooms by matchId, but the lobby phase happens before
 * a Match exists, so lobby rooms are keyed by `lobbyId`. Kept intentionally coarse: a single
 * "lobby-updated" signal tells subscribed members to refetch the authoritative lobby view, rather
 * than trying to diff fine-grained changes over the wire.
 */
export type LobbyRoomEvent = { lobbyId: string; type: "lobby-updated" };

type Listener = (event: LobbyRoomEvent) => void;

// lobbyId -> playerId -> listeners (a player may have several open tabs)
const listenerMap = new Map<string, Map<string, Listener[]>>();

export const subscribeLobby = (
  lobbyId: string,
  playerId: string,
  listener: Listener,
): (() => void) => {
  let room = listenerMap.get(lobbyId);

  if (room === undefined) {
    room = new Map();
    listenerMap.set(lobbyId, room);
  }

  room.set(playerId, [...(room.get(playerId) ?? []), listener]);

  return () => {
    const current = listenerMap.get(lobbyId)?.get(playerId);

    if (current === undefined) {
      return;
    }

    const remaining = current.filter((l) => l !== listener);

    if (remaining.length > 0) {
      listenerMap.get(lobbyId)?.set(playerId, remaining);
    } else {
      listenerMap.get(lobbyId)?.delete(playerId);
    }
  };
};

export const emitLobby = (playerId: string, event: LobbyRoomEvent): void => {
  listenerMap
    .get(event.lobbyId)
    ?.get(playerId)
    ?.forEach((listener) => listener(event));
};
