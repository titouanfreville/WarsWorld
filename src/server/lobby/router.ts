import { observable } from "@trpc/server/observable";
import { lobbyUsecase as lobby } from "server/composition-root";
import { subscribeLobby, type LobbyRoomEvent } from "server/emitter/lobby-emitter";
import { playerBaseProcedure, router } from "server/trpc/trpc-setup";
import {
  assignTeamSchema,
  createLobbySchema,
  inviteSchema,
  kickSchema,
  respondInviteSchema,
  withLobbyIdSchema,
} from "./schemas";

export const lobbyRouter = router({
  create: playerBaseProcedure
    .input(createLobbySchema)
    .mutation(({ input, ctx }) => lobby.createLobby(ctx.currentPlayer.id, input)),
  get: playerBaseProcedure
    .input(withLobbyIdSchema)
    .query(({ input }) => lobby.getLobby(input.lobbyId)),
  myInvites: playerBaseProcedure.query(({ ctx }) => lobby.listInvites(ctx.currentPlayer.id)),
  openLobbies: playerBaseProcedure.query(({ ctx }) => lobby.listOpen(ctx.currentPlayer.id)),
  onUpdate: playerBaseProcedure
    .input(withLobbyIdSchema)
    .subscription(({ input, ctx }) =>
      observable<LobbyRoomEvent>((emit) =>
        subscribeLobby(input.lobbyId, ctx.currentPlayer.id, emit.next),
      ),
    ),
  join: playerBaseProcedure
    .input(withLobbyIdSchema)
    .mutation(({ input, ctx }) => lobby.joinLobby(input.lobbyId, ctx.currentPlayer.id)),
  assignTeam: playerBaseProcedure
    .input(assignTeamSchema)
    .mutation(({ input, ctx }) =>
      lobby.assignTeam(input.lobbyId, ctx.currentPlayer.id, input.team, input.slotWithinTeam),
    ),
  invite: playerBaseProcedure
    .input(inviteSchema)
    .mutation(({ input, ctx }) =>
      lobby.invite(input.lobbyId, ctx.currentPlayer.id, input.usernames),
    ),
  respondInvite: playerBaseProcedure
    .input(respondInviteSchema)
    .mutation(({ input, ctx }) =>
      lobby.respondInvite(input.lobbyId, ctx.currentPlayer.id, input.accept),
    ),
  kick: playerBaseProcedure
    .input(kickSchema)
    .mutation(({ input, ctx }) =>
      lobby.kick(input.lobbyId, ctx.currentPlayer.id, input.targetPlayerId),
    ),
  leave: playerBaseProcedure
    .input(withLobbyIdSchema)
    .mutation(({ input, ctx }) => lobby.leaveLobby(input.lobbyId, ctx.currentPlayer.id)),
  start: playerBaseProcedure
    .input(withLobbyIdSchema)
    .mutation(({ input, ctx }) => lobby.startLobby(input.lobbyId, ctx.currentPlayer.id)),
});
