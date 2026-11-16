import { z } from "zod";

/** Input contracts for the social feature (friends, categories, messaging, block/mute). */

export const getNotificationsSchema = z.object({ onlyUnread: z.boolean().default(true) });
export const notificationIdSchema = z.object({ notificationId: z.string() });

export const targetPlayerNameSchema = z.object({ targetPlayerName: z.string() });
export const respondToFriendRequestSchema = z.object({
  senderId: z.string(),
  accept: z.boolean(),
});

export const createCategorySchema = z.object({ name: z.string().min(1) });
export const friendCategoryAssignmentSchema = z.object({
  friendshipId: z.string(),
  categoryId: z.string(),
});

export const conversationIdSchema = z.object({ conversationId: z.string() });
export const sendMessageSchema = z.object({
  conversationId: z.string(),
  content: z.string().min(1),
});
export const editMessageSchema = z.object({ messageId: z.string(), content: z.string().min(1) });
export const messageIdSchema = z.object({ messageId: z.string() });

export const targetPlayerIdSchema = z.object({ targetPlayerId: z.string() });
