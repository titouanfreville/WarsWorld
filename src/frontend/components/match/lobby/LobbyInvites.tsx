import { usePlayers } from "frontend/context/players";
import { trpc } from "frontend/utils/trpc-client";
import { useRouter } from "next/router";

/**
 * Invitee-side surface on the matches page: lobbies you've been invited to (accept / decline) and
 * open lobbies you can join without an invite. Polls, since lobby-phase live WS isn't wired yet.
 */
export default function LobbyInvites() {
  const router = useRouter();
  const { currentPlayer } = usePlayers();
  const playerId = currentPlayer?.id ?? "";
  const utils = trpc.useUtils();

  const invites = trpc.lobby.myInvites.useQuery(
    { playerId },
    { enabled: playerId !== "", refetchInterval: 3000 },
  );
  const open = trpc.lobby.openLobbies.useQuery(
    { playerId },
    { enabled: playerId !== "", refetchInterval: 3000 },
  );

  const respond = trpc.lobby.respondInvite.useMutation();
  const join = trpc.lobby.join.useMutation();

  const refresh = () => {
    void utils.lobby.myInvites.invalidate();
    void utils.lobby.openLobbies.invalidate();
  };

  const accept = async (lobbyId: string) => {
    await respond.mutateAsync({ lobbyId, playerId, accept: true });
    void router.push(`/lobby/${lobbyId}`);
  };

  const decline = async (lobbyId: string) => {
    await respond.mutateAsync({ lobbyId, playerId, accept: false });
    refresh();
  };

  const joinLobby = async (lobbyId: string) => {
    await join.mutateAsync({ lobbyId, playerId });
    void router.push(`/lobby/${lobbyId}`);
  };

  const inviteList = invites.data ?? [];
  const openList = open.data ?? [];

  if (inviteList.length === 0 && openList.length === 0) {
    return null;
  }

  const hostName = (lobby: (typeof inviteList)[number]) =>
    lobby.members.find((m) => m.playerId === lobby.hostPlayerId)?.name ?? "Someone";

  const seatedCount = (lobby: (typeof inviteList)[number]) =>
    lobby.members.filter((m) => m.membership === "active" && !m.isSpectator).length;

  return (
    <div className="@mb-5 @flex @flex-col @gap-3">
      {inviteList.map((lobby) => (
        <div
          key={lobby.id}
          className="@flex @flex-wrap @items-center @justify-between @gap-3 @rounded-lg @bg-bg-secondary @px-4 @py-3 @outline @outline-2 @outline-primary/40"
        >
          <div className="@min-w-0">
            <p className="@py-0 @text-sm @font-semibold">
              <span className="@text-primary">{hostName(lobby)}</span> invited you
            </p>
            <p className="@py-0 @text-xs @text-slate-400">
              {lobby.mode} · {seatedCount(lobby)}/{lobby.capacity} seated
            </p>
          </div>
          <div className="@flex @gap-2">
            <button
              className="@rounded @bg-primary @px-3 @py-1.5 @text-sm @font-semibold @text-black hover:@bg-primary-light disabled:@opacity-50 disabled:@cursor-not-allowed"
              disabled={respond.isLoading || join.isLoading}
              onClick={() => void accept(lobby.id)}
            >
              Accept
            </button>
            <button
              className="@rounded @border @border-bg-tertiary @px-3 @py-1.5 @text-sm hover:@bg-bg-tertiary disabled:@opacity-50 disabled:@cursor-not-allowed"
              disabled={respond.isLoading}
              onClick={() => void decline(lobby.id)}
            >
              Decline
            </button>
          </div>
        </div>
      ))}

      {openList.map((lobby) => (
        <div
          key={lobby.id}
          className="@flex @flex-wrap @items-center @justify-between @gap-3 @rounded-lg @bg-bg-secondary @px-4 @py-3 @outline @outline-2 @outline-black"
        >
          <div className="@min-w-0">
            <p className="@py-0 @text-sm @font-semibold">{hostName(lobby)}&rsquo;s lobby</p>
            <p className="@py-0 @text-xs @text-slate-400">
              {lobby.mode} · {seatedCount(lobby)}/{lobby.capacity} seated · open
            </p>
          </div>
          <button
            className="@rounded @border @border-bg-tertiary @px-3 @py-1.5 @text-sm hover:@bg-bg-tertiary disabled:@opacity-50 disabled:@cursor-not-allowed"
            disabled={join.isLoading || respond.isLoading}
            onClick={() => void joinLobby(lobby.id)}
          >
            Join
          </button>
        </div>
      ))}
    </div>
  );
}
