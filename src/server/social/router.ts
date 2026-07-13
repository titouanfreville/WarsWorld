import { router, playerBaseProcedure, matchBaseProcedure } from "../trpc/trpc-setup";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type Friendship } from "@prisma/client";
import { prisma } from "../prisma/prisma-client";
import { subscribeSocial, emitSocial, type SocialEvent } from "./social-emitter";
import { observable } from "@trpc/server/observable";
import { egChatWritable } from "../adapters/eg-presence";

export const socialRouter = router({
  // ─── NOTIFICATION ENDPOINTS ───

  getNotifications: playerBaseProcedure
    .input(z.object({ onlyUnread: z.boolean().default(true) }))
    .query(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;
      return prisma.notification.findMany({
        where: {
          playerId: currentPlayer.id,
          ...(input.onlyUnread ? { isRead: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }),

  markNotificationRead: playerBaseProcedure
    .input(z.object({ notificationId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;
      return prisma.notification.updateMany({
        where: { id: input.notificationId, playerId: currentPlayer.id },
        data: { isRead: true },
      });
    }),

  // ─── FRIEND REQUESTS & FRIENDS ───

  sendFriendRequest: playerBaseProcedure
    .input(z.object({ targetPlayerName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      const target = await prisma.player.findUnique({
        where: { name: input.targetPlayerName },
      });

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      if (target.id === currentPlayer.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot friend yourself." });
      }

      // Check for block
      const blockExists = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentPlayer.id, blockedId: target.id },
            { blockerId: target.id, blockedId: currentPlayer.id },
          ],
        },
      });

      if (blockExists) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Action blocked by security preferences.",
        });
      }

      // Idempotent: a friendship (pending or accepted) in either direction already covers this
      // relationship. Return it without spamming a second request row or notification.
      const existing = await prisma.friendship.findFirst({
        where: {
          OR: [
            { senderId: currentPlayer.id, receiverId: target.id },
            { senderId: target.id, receiverId: currentPlayer.id },
          ],
        },
      });

      if (existing) {
        return existing;
      }

      let friendship: Friendship;

      try {
        friendship = await prisma.friendship.create({
          data: {
            senderId: currentPlayer.id,
            receiverId: target.id,
            status: "PENDING",
          },
        });
      } catch (error) {
        // Lost a concurrent double-submit race on the unique (senderId, receiverId) index —
        // treat it as the same idempotent no-op and return the row the winning call created.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return prisma.friendship.findUniqueOrThrow({
            where: { senderId_receiverId: { senderId: currentPlayer.id, receiverId: target.id } },
          });
        }

        throw error;
      }

      // A genuinely new request — notify the target exactly once.
      const notificationContent = JSON.stringify({
        senderName: currentPlayer.displayName,
        senderId: currentPlayer.id,
      });
      const notification = await prisma.notification.create({
        data: {
          playerId: target.id,
          type: "FRIEND_REQUEST",
          content: notificationContent,
        },
      });

      // Emit Live Alert
      emitSocial(target.id, {
        type: "NOTIFICATION_NEW",
        notificationId: notification.id,
        alertType: "FRIEND_REQUEST",
        content: notificationContent,
      });

      return friendship;
    }),

  respondToFriendRequest: playerBaseProcedure
    .input(z.object({ senderId: z.string(), accept: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      // Always clear the originating request notification(s) so the invite stops showing once
      // responded to — even on a repeated (double-clicked) submit. senderId is a cuid, so a
      // `contains` match against the JSON content is unambiguous.
      await prisma.notification.updateMany({
        where: {
          playerId: currentPlayer.id,
          type: "FRIEND_REQUEST",
          content: { contains: input.senderId },
        },
        data: { isRead: true },
      });

      const friendship = await prisma.friendship.findUnique({
        where: { senderId_receiverId: { senderId: input.senderId, receiverId: currentPlayer.id } },
      });

      // Already handled by a previous (possibly double-clicked) submit — idempotent no-op.
      if (!friendship) {
        return { ok: true };
      }

      if (input.accept) {
        // Only the real PENDING -> ACCEPTED transition should notify the sender, so a spam of
        // Accept clicks emits exactly one FRIEND_ACCEPT notification.
        const { count } = await prisma.friendship.updateMany({
          where: { id: friendship.id, status: "PENDING" },
          data: { status: "ACCEPTED" },
        });

        if (count === 1) {
          const notificationContent = JSON.stringify({
            senderName: currentPlayer.displayName,
            senderId: currentPlayer.id,
          });
          const notification = await prisma.notification.create({
            data: {
              playerId: input.senderId,
              type: "FRIEND_ACCEPT",
              content: notificationContent,
            },
          });

          emitSocial(input.senderId, {
            type: "NOTIFICATION_NEW",
            notificationId: notification.id,
            alertType: "FRIEND_ACCEPT",
            content: notificationContent,
          });
        }

        return { ok: true };
      }

      // Decline: deleteMany is idempotent (a repeated click on the already-removed row no-ops).
      await prisma.friendship.deleteMany({ where: { id: friendship.id } });
      return { ok: true };
    }),

  getFriendsList: playerBaseProcedure.query(async ({ ctx }) => {
    const { currentPlayer } = ctx;

    const friendships = await prisma.friendship.findMany({
      where: {
        OR: [
          { senderId: currentPlayer.id, status: "ACCEPTED" },
          { receiverId: currentPlayer.id, status: "ACCEPTED" },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, displayName: true } },
        receiver: { select: { id: true, name: true, displayName: true } },
        categories: { select: { id: true, name: true } },
      },
    });

    return friendships.map((f) => {
      const friend = f.senderId === currentPlayer.id ? f.receiver : f.sender;
      return {
        ...friend,
        friendshipId: f.id,
        categories: f.categories,
      };
    });
  }),

  // ─── FRIEND CATEGORIES (SECTIONS) ───

  createCategory: playerBaseProcedure
    .input(z.object({ name: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;
      return prisma.friendCategory.create({
        data: {
          name: input.name,
          ownerId: currentPlayer.id,
        },
      });
    }),

  assignFriendToCategory: playerBaseProcedure
    .input(z.object({ friendshipId: z.string(), categoryId: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.friendCategory.update({
        where: { id: input.categoryId },
        data: {
          friendships: { connect: { id: input.friendshipId } },
        },
      });
    }),

  removeFriendFromCategory: playerBaseProcedure
    .input(z.object({ friendshipId: z.string(), categoryId: z.string() }))
    .mutation(async ({ input }) => {
      return prisma.friendCategory.update({
        where: { id: input.categoryId },
        data: {
          friendships: { disconnect: { id: input.friendshipId } },
        },
      });
    }),

  // ─── UNIFIED MESSAGING WORKFLOWS ───

  getOrCreateDMConversation: playerBaseProcedure
    .input(z.object({ targetPlayerName: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      const target = await prisma.player.findUnique({
        where: { name: input.targetPlayerName },
      });

      if (!target) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      const blockExists = await prisma.block.findFirst({
        where: {
          OR: [
            { blockerId: currentPlayer.id, blockedId: target.id },
            { blockerId: target.id, blockedId: currentPlayer.id },
          ],
        },
      });

      if (blockExists) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Conversation blocked by preferences." });
      }

      // Find existing DM conversation with both participants
      const existing = await prisma.conversation.findFirst({
        where: {
          kind: "DM",
          AND: [
            { participants: { some: { playerId: currentPlayer.id } } },
            { participants: { some: { playerId: target.id } } },
          ],
        },
      });

      if (existing) {
        return existing;
      }

      // Create new DM Conversation
      return prisma.conversation.create({
        data: {
          kind: "DM",
          participants: {
            create: [{ playerId: currentPlayer.id }, { playerId: target.id }],
          },
        },
      });
    }),

  // ─── IN-MATCH CHANNELS (all + team) ───

  // Idempotently get (or create) this match's chat channels for the caller: the whole-match "All"
  // channel and, if the caller is on a team, that team's team-only channel. Participants are seeded
  // from the live match roster, so a Team channel only ever includes teammates — enemies never
  // receive its messages (they aren't participants, and `sendMessage` broadcasts to participants).
  // Returns the conversation ids; the UI then uses the existing send/history/subscribe endpoints.
  getOrCreateMatchChannels: matchBaseProcedure.mutation(async ({ ctx }) => {
    const { match, currentPlayer } = ctx;

    const ensure = async (teamIndex: number, participantIds: string[]) => {
      const existing = await prisma.conversation.findFirst({
        where: { matchId: match.id, teamIndex },
      });

      if (existing) {
        return existing;
      }

      return prisma.conversation.create({
        data: {
          kind: "MATCH",
          matchId: match.id,
          teamIndex,
          name: teamIndex === -1 ? "All" : `Team ${teamIndex + 1}`,
          participants: { create: participantIds.map((playerId) => ({ playerId })) },
        },
      });
    };

    const all = await ensure(
      -1,
      match.getAllPlayers().map((player) => player.data.id),
    );

    const myTeam = match.getPlayerById(currentPlayer.id)?.team;
    const team = myTeam
      ? await ensure(
          myTeam.index,
          myTeam.players.map((player) => player.data.id),
        )
      : null;

    return { allConversationId: all.id, teamConversationId: team?.id ?? null };
  }),

  sendMessage: playerBaseProcedure
    .input(z.object({ conversationId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      // Security check: is a participant?
      const participation = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_playerId: {
            conversationId: input.conversationId,
            playerId: currentPlayer.id,
          },
        },
      });

      if (!participation) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not a member of this conversation." });
      }

      // Post-game chat write window (Epic 5 / FR7): once a match has finished, its channels stay
      // writable only while a participant is still on the End-Game screen. When presence drains, the
      // conversation becomes read-only. Active matches (status != finished) and non-match/DM
      // conversations are never gated here.
      const conversation = await prisma.conversation.findUnique({
        where: { id: input.conversationId },
        select: { kind: true, matchId: true, match: { select: { status: true } } },
      });

      if (
        conversation?.kind === "MATCH" &&
        conversation.matchId !== null &&
        conversation.match?.status === "finished" &&
        !egChatWritable(conversation.matchId)
      ) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Post-game chat has closed." });
      }

      const msg = await prisma.message.create({
        data: {
          conversationId: input.conversationId,
          senderId: currentPlayer.id,
          content: input.content,
        },
      });

      // Sending a message automatically counts as viewing it (updates sender's lastReadAt)
      await prisma.conversationParticipant.update({
        where: {
          conversationId_playerId: {
            conversationId: input.conversationId,
            playerId: currentPlayer.id,
          },
        },
        data: { lastReadAt: msg.createdAt },
      });

      // Retrieve all conversation participants to broadcast updates
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: input.conversationId },
        include: { player: { select: { id: true, displayName: true } } },
      });

      // Check muting per recipient
      for (const p of participants) {
        const mutedUs = await prisma.mute.findUnique({
          where: { muterId_mutedId: { muterId: p.playerId, mutedId: currentPlayer.id } },
        });

        if (!mutedUs) {
          emitSocial(p.playerId, {
            type: "MESSAGE_NEW",
            conversationId: input.conversationId,
            senderId: currentPlayer.id,
            senderName: currentPlayer.displayName,
            content: input.content,
            createdAt: msg.createdAt,
            messageId: msg.id,
          });
        }
      }

      return msg;
    }),

  getConversationHistory: playerBaseProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      // Ensure the player is a member of this conversation
      const participation = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_playerId: {
            conversationId: input.conversationId,
            playerId: currentPlayer.id,
          },
        },
      });

      if (!participation) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Access denied." });
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId: input.conversationId,
          deletedAt: null, // Hide soft-deleted messages
        },
        orderBy: { createdAt: "asc" },
        take: 100,
      });

      // Update current player's view receipt instantly upon reading
      if (messages.length > 0) {
        const readTime = new Date();
        await prisma.conversationParticipant.update({
          where: {
            conversationId_playerId: {
              conversationId: input.conversationId,
              playerId: currentPlayer.id,
            },
          },
          data: { lastReadAt: readTime },
        });

        // Broadcast to other members that player has read up to this message
        const participants = await prisma.conversationParticipant.findMany({
          where: { conversationId: input.conversationId },
        });

        participants.forEach((p) => {
          if (p.playerId !== currentPlayer.id) {
            emitSocial(p.playerId, {
              type: "CONVERSATION_READ",
              conversationId: input.conversationId,
              playerId: currentPlayer.id,
              lastReadAt: readTime,
            });
          }
        });
      }

      // Fetch participants and their read-cursors to compute "viewed by all" dynamically in UI
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: input.conversationId },
        select: { playerId: true, lastReadAt: true },
      });

      return {
        messages,
        participants,
      };
    }),

  editMessage: playerBaseProcedure
    .input(z.object({ messageId: z.string(), content: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      const message = await prisma.message.findUnique({
        where: { id: input.messageId },
      });

      if (!message || message.senderId !== currentPlayer.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot edit this message." });
      }

      const updated = await prisma.message.update({
        where: { id: input.messageId },
        data: { content: input.content, editedAt: new Date() },
      });

      // Emit live edit
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: message.conversationId },
      });
      participants.forEach((p) => {
        emitSocial(p.playerId, {
          type: "MESSAGE_EDIT",
          conversationId: message.conversationId,
          messageId: updated.id,
          content: updated.content,
          editedAt: updated.editedAt!,
        });
      });

      return updated;
    }),

  deleteMessage: playerBaseProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      const message = await prisma.message.findUnique({
        where: { id: input.messageId },
      });

      if (!message || message.senderId !== currentPlayer.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete this message." });
      }

      // Soft-delete
      await prisma.message.update({
        where: { id: input.messageId },
        data: { deletedAt: new Date() },
      });

      // Emit live delete
      const participants = await prisma.conversationParticipant.findMany({
        where: { conversationId: message.conversationId },
      });
      participants.forEach((p) => {
        emitSocial(p.playerId, {
          type: "MESSAGE_DELETE",
          conversationId: message.conversationId,
          messageId: message.id,
        });
      });

      return { success: true };
    }),

  // ─── RECENT COMBATANTS ───

  getRecentCombatants: playerBaseProcedure.query(async ({ ctx }) => {
    const { currentPlayer } = ctx;

    const playerMatches = await prisma.matchPlayer.findMany({
      where: { playerId: currentPlayer.id },
      select: { matchId: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const matchIds = playerMatches.map((m) => m.matchId);

    if (matchIds.length === 0) {
      return [];
    }

    const combatants = await prisma.matchPlayer.findMany({
      where: {
        matchId: { in: matchIds },
        playerId: { not: currentPlayer.id },
      },
      include: {
        player: {
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const seen = new Set<string>();
    const uniqueCombatants: (typeof combatants)[0]["player"][] = [];

    for (const entry of combatants) {
      if (!seen.has(entry.player.id)) {
        seen.add(entry.player.id);
        uniqueCombatants.push(entry.player);
      }
    }

    return uniqueCombatants;
  }),

  // ─── SAFETY: BLOCK & MUTE ───

  blockPlayer: playerBaseProcedure
    .input(z.object({ targetPlayerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      return prisma.block.upsert({
        where: {
          blockerId_blockedId: { blockerId: currentPlayer.id, blockedId: input.targetPlayerId },
        },
        update: {},
        create: { blockerId: currentPlayer.id, blockedId: input.targetPlayerId },
      });
    }),

  unblockPlayer: playerBaseProcedure
    .input(z.object({ targetPlayerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      await prisma.block.deleteMany({
        where: { blockerId: currentPlayer.id, blockedId: input.targetPlayerId },
      });
      return { success: true };
    }),

  mutePlayer: playerBaseProcedure
    .input(z.object({ targetPlayerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      return prisma.mute.upsert({
        where: { muterId_mutedId: { muterId: currentPlayer.id, mutedId: input.targetPlayerId } },
        update: {},
        create: { muterId: currentPlayer.id, mutedId: input.targetPlayerId },
      });
    }),

  unmutePlayer: playerBaseProcedure
    .input(z.object({ targetPlayerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { currentPlayer } = ctx;

      await prisma.mute.deleteMany({
        where: { muterId: currentPlayer.id, mutedId: input.targetPlayerId },
      });
      return { success: true };
    }),

  // ─── SUBSCRIPTION FOR REAL-TIME SOCIAL UPDATES ───

  onSocialEvent: playerBaseProcedure.subscription(({ ctx }) => {
    const { currentPlayer } = ctx;
    return observable<SocialEvent>((emit) => {
      return subscribeSocial(currentPlayer.id, emit.next);
    });
  }),
});
