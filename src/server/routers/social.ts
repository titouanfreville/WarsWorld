import { observable } from "@trpc/server/observable";
import { socialUsecase } from "server/composition-root";
import { matchBaseProcedure, playerBaseProcedure, router } from "server/trpc/trpc-setup";
import {
  conversationIdSchema,
  createCategorySchema,
  editMessageSchema,
  friendCategoryAssignmentSchema,
  getNotificationsSchema,
  messageIdSchema,
  notificationIdSchema,
  respondToFriendRequestSchema,
  sendMessageSchema,
  targetPlayerIdSchema,
  targetPlayerNameSchema,
} from "server/social/schemas";
import { subscribeSocial, type SocialEvent } from "server/social/social-emitter";

export const socialRouter = router({
  // ─── Notifications ───
  getNotifications: playerBaseProcedure
    .input(getNotificationsSchema)
    .query(({ ctx, input }) =>
      socialUsecase.getNotifications(ctx.currentPlayer.id, input.onlyUnread),
    ),

  markNotificationRead: playerBaseProcedure
    .input(notificationIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.markNotificationRead(ctx.currentPlayer.id, input.notificationId),
    ),

  // ─── Friend requests & friends ───
  sendFriendRequest: playerBaseProcedure
    .input(targetPlayerNameSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.sendFriendRequest(ctx.currentPlayer, input.targetPlayerName),
    ),

  respondToFriendRequest: playerBaseProcedure
    .input(respondToFriendRequestSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.respondToFriendRequest(ctx.currentPlayer, input.senderId, input.accept),
    ),

  getFriendsList: playerBaseProcedure.query(({ ctx }) =>
    socialUsecase.getFriendsList(ctx.currentPlayer.id),
  ),

  // ─── Friend categories ───
  createCategory: playerBaseProcedure
    .input(createCategorySchema)
    .mutation(({ ctx, input }) => socialUsecase.createCategory(ctx.currentPlayer.id, input.name)),

  assignFriendToCategory: playerBaseProcedure
    .input(friendCategoryAssignmentSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.assignFriendToCategory(
        ctx.currentPlayer.id,
        input.friendshipId,
        input.categoryId,
      ),
    ),

  removeFriendFromCategory: playerBaseProcedure
    .input(friendCategoryAssignmentSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.removeFriendFromCategory(
        ctx.currentPlayer.id,
        input.friendshipId,
        input.categoryId,
      ),
    ),

  // ─── Conversations & messaging ───
  getOrCreateDMConversation: playerBaseProcedure
    .input(targetPlayerNameSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.getOrCreateDMConversation(ctx.currentPlayer, input.targetPlayerName),
    ),

  getOrCreateMatchChannels: matchBaseProcedure.mutation(({ ctx }) => {
    const { match, currentPlayer } = ctx;
    const myTeam = match.getPlayerById(currentPlayer.id)?.team ?? null;

    return socialUsecase.getOrCreateMatchChannels({
      matchId: match.id,
      allPlayerIds: match.getAllPlayers().map((player) => player.data.id),
      myTeam:
        myTeam !== null
          ? { index: myTeam.index, playerIds: myTeam.players.map((player) => player.data.id) }
          : null,
    });
  }),

  sendMessage: playerBaseProcedure
    .input(sendMessageSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.sendMessage(ctx.currentPlayer, input.conversationId, input.content),
    ),

  getConversationHistory: playerBaseProcedure
    .input(conversationIdSchema)
    .query(({ ctx, input }) =>
      socialUsecase.getConversationHistory(ctx.currentPlayer.id, input.conversationId),
    ),

  markConversationRead: playerBaseProcedure
    .input(conversationIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.markConversationRead(ctx.currentPlayer.id, input.conversationId),
    ),

  editMessage: playerBaseProcedure
    .input(editMessageSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.editMessage(ctx.currentPlayer.id, input.messageId, input.content),
    ),

  deleteMessage: playerBaseProcedure
    .input(messageIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.deleteMessage(ctx.currentPlayer.id, input.messageId),
    ),

  // ─── Recent combatants ───
  getRecentCombatants: playerBaseProcedure.query(({ ctx }) =>
    socialUsecase.getRecentCombatants(ctx.currentPlayer.id),
  ),

  // ─── Block & mute ───
  blockPlayer: playerBaseProcedure
    .input(targetPlayerIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.blockPlayer(ctx.currentPlayer.id, input.targetPlayerId),
    ),

  unblockPlayer: playerBaseProcedure
    .input(targetPlayerIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.unblockPlayer(ctx.currentPlayer.id, input.targetPlayerId),
    ),

  mutePlayer: playerBaseProcedure
    .input(targetPlayerIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.mutePlayer(ctx.currentPlayer.id, input.targetPlayerId),
    ),

  unmutePlayer: playerBaseProcedure
    .input(targetPlayerIdSchema)
    .mutation(({ ctx, input }) =>
      socialUsecase.unmutePlayer(ctx.currentPlayer.id, input.targetPlayerId),
    ),

  // ─── Real-time social updates ───
  onSocialEvent: playerBaseProcedure.subscription(({ ctx }) =>
    observable<SocialEvent>((emit) => subscribeSocial(ctx.currentPlayer.id, emit.next)),
  ),
});
