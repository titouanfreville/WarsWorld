import { Prisma, type Friendship, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { egChatWritable } from "server/adapters/eg-presence";
import { emitSocial } from "./social-emitter";

/** Request-scoped identity handed in from the tRPC ctx (never constructed here). */
type CurrentPlayer = { id: string; displayName: string };

/** The whole-match "All" channel uses teamIndex -1; a team channel uses the team's index. */
type MatchRoster = {
  matchId: string;
  allPlayerIds: string[];
  myTeam: { index: number; playerIds: string[] } | null;
};

/**
 * The `social` feature: friends & requests, friend categories, DM + in-match messaging, block/mute,
 * and the notification feed. Prisma is injected; live updates go through the feature emitter. The
 * router binds tRPC procedures to these methods and does nothing else.
 */
export class SocialUsecase {
  constructor(private readonly db: PrismaClient) {}

  // ── Notifications ───────────────────────────────────────────────────────────

  getNotifications(playerId: string, onlyUnread: boolean) {
    return this.db.notification.findMany({
      where: { playerId, ...(onlyUnread ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  markNotificationRead(playerId: string, notificationId: string) {
    return this.db.notification.updateMany({
      where: { id: notificationId, playerId },
      data: { isRead: true },
    });
  }

  // ── Friend requests & friends ───────────────────────────────────────────────

  async sendFriendRequest(currentPlayer: CurrentPlayer, targetPlayerName: string) {
    const target = await this.db.player.findUnique({ where: { name: targetPlayerName } });

    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
    }

    if (target.id === currentPlayer.id) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot friend yourself." });
    }

    if (await this.isBlockedEitherWay(currentPlayer.id, target.id)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Action blocked by security preferences.",
      });
    }

    // Idempotent: a friendship (pending or accepted) in either direction already covers this
    // relationship. Return it without spamming a second request row or notification.
    const existing = await this.db.friendship.findFirst({
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
      friendship = await this.db.friendship.create({
        data: { senderId: currentPlayer.id, receiverId: target.id, status: "PENDING" },
      });
    } catch (error) {
      // Lost a concurrent double-submit race on the unique (senderId, receiverId) index —
      // treat it as the same idempotent no-op and return the row the winning call created.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return this.db.friendship.findUniqueOrThrow({
          where: { senderId_receiverId: { senderId: currentPlayer.id, receiverId: target.id } },
        });
      }

      throw error;
    }

    // A genuinely new request — notify the target exactly once.
    await this.notify(target.id, "FRIEND_REQUEST", currentPlayer);
    return friendship;
  }

  async respondToFriendRequest(currentPlayer: CurrentPlayer, senderId: string, accept: boolean) {
    // Always clear the originating request notification(s) so the invite stops showing once
    // responded to — even on a repeated (double-clicked) submit. senderId is a cuid, so a
    // `contains` match against the JSON content is unambiguous.
    await this.db.notification.updateMany({
      where: {
        playerId: currentPlayer.id,
        type: "FRIEND_REQUEST",
        content: { contains: senderId },
      },
      data: { isRead: true },
    });

    const friendship = await this.db.friendship.findUnique({
      where: { senderId_receiverId: { senderId, receiverId: currentPlayer.id } },
    });

    // Already handled by a previous (possibly double-clicked) submit — idempotent no-op.
    if (!friendship) {
      return { ok: true };
    }

    if (!accept) {
      // deleteMany is idempotent (a repeated click on the already-removed row no-ops).
      await this.db.friendship.deleteMany({ where: { id: friendship.id } });
      return { ok: true };
    }

    // Only the real PENDING -> ACCEPTED transition should notify the sender, so a spam of Accept
    // clicks emits exactly one FRIEND_ACCEPT notification.
    const { count } = await this.db.friendship.updateMany({
      where: { id: friendship.id, status: "PENDING" },
      data: { status: "ACCEPTED" },
    });

    if (count === 1) {
      await this.notify(senderId, "FRIEND_ACCEPT", currentPlayer);
    }

    return { ok: true };
  }

  async getFriendsList(playerId: string) {
    const friendships = await this.db.friendship.findMany({
      where: {
        OR: [
          { senderId: playerId, status: "ACCEPTED" },
          { receiverId: playerId, status: "ACCEPTED" },
        ],
      },
      include: {
        sender: { select: { id: true, name: true, displayName: true } },
        receiver: { select: { id: true, name: true, displayName: true } },
        categories: { select: { id: true, name: true } },
      },
    });

    return friendships.map((f) => {
      const friend = f.senderId === playerId ? f.receiver : f.sender;
      return { ...friend, friendshipId: f.id, categories: f.categories };
    });
  }

  // ── Friend categories ───────────────────────────────────────────────────────

  createCategory(playerId: string, name: string) {
    return this.db.friendCategory.create({ data: { name, ownerId: playerId } });
  }

  async assignFriendToCategory(playerId: string, friendshipId: string, categoryId: string) {
    await this.assertOwnsCategoryAndFriendship(playerId, categoryId, friendshipId);
    return this.db.friendCategory.update({
      where: { id: categoryId },
      data: { friendships: { connect: { id: friendshipId } } },
    });
  }

  async removeFriendFromCategory(playerId: string, friendshipId: string, categoryId: string) {
    await this.assertOwnsCategoryAndFriendship(playerId, categoryId, friendshipId);
    return this.db.friendCategory.update({
      where: { id: categoryId },
      data: { friendships: { disconnect: { id: friendshipId } } },
    });
  }

  // ── Conversations & messaging ───────────────────────────────────────────────

  async getOrCreateDMConversation(currentPlayer: CurrentPlayer, targetPlayerName: string) {
    const target = await this.db.player.findUnique({ where: { name: targetPlayerName } });

    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
    }

    if (await this.isBlockedEitherWay(currentPlayer.id, target.id)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Conversation blocked by preferences." });
    }

    const existing = await this.db.conversation.findFirst({
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

    return this.db.conversation.create({
      data: {
        kind: "DM",
        participants: { create: [{ playerId: currentPlayer.id }, { playerId: target.id }] },
      },
    });
  }

  /**
   * Idempotently get-or-create this match's chat channels: the whole-match "All" channel and, if the
   * caller is on a team, that team's channel. Uses upsert on the unique (matchId, teamIndex) so two
   * players opening chat at once can't create duplicate rooms (previously findFirst + create raced).
   */
  async getOrCreateMatchChannels(roster: MatchRoster) {
    const all = await this.ensureMatchChannel(roster.matchId, -1, roster.allPlayerIds);
    const team = roster.myTeam
      ? await this.ensureMatchChannel(roster.matchId, roster.myTeam.index, roster.myTeam.playerIds)
      : null;

    return { allConversationId: all.id, teamConversationId: team?.id ?? null };
  }

  async sendMessage(currentPlayer: CurrentPlayer, conversationId: string, content: string) {
    await this.assertParticipant(
      conversationId,
      currentPlayer.id,
      "Not a member of this conversation.",
    );
    await this.assertChatWritable(conversationId);

    const msg = await this.db.message.create({
      data: { conversationId, senderId: currentPlayer.id, content },
    });

    // Sending a message automatically counts as viewing it (advances the sender's read cursor).
    await this.db.conversationParticipant.update({
      where: { conversationId_playerId: { conversationId, playerId: currentPlayer.id } },
      data: { lastReadAt: msg.createdAt },
    });

    const participants = await this.db.conversationParticipant.findMany({
      where: { conversationId },
      select: { playerId: true },
    });

    // Broadcast to every participant who hasn't muted the sender.
    for (const p of participants) {
      const mutedUs = await this.db.mute.findUnique({
        where: { muterId_mutedId: { muterId: p.playerId, mutedId: currentPlayer.id } },
      });

      if (!mutedUs) {
        emitSocial(p.playerId, {
          type: "MESSAGE_NEW",
          conversationId,
          senderId: currentPlayer.id,
          senderName: currentPlayer.displayName,
          content,
          createdAt: msg.createdAt,
          messageId: msg.id,
        });
      }
    }

    return msg;
  }

  /** Read-only: the read cursor advance moved to `markConversationRead` (a query must not write). */
  async getConversationHistory(playerId: string, conversationId: string) {
    await this.assertParticipant(conversationId, playerId, "Access denied.");

    const messages = await this.db.message.findMany({
      where: { conversationId, deletedAt: null },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    const participants = await this.db.conversationParticipant.findMany({
      where: { conversationId },
      select: { playerId: true, lastReadAt: true },
    });

    return { messages, participants };
  }

  /** Advance the caller's read cursor and tell the others — a mutation, so it never fires on a refetch. */
  async markConversationRead(playerId: string, conversationId: string) {
    await this.assertParticipant(conversationId, playerId, "Access denied.");

    const readTime = new Date();
    await this.db.conversationParticipant.update({
      where: { conversationId_playerId: { conversationId, playerId } },
      data: { lastReadAt: readTime },
    });

    const participants = await this.db.conversationParticipant.findMany({
      where: { conversationId },
      select: { playerId: true },
    });

    for (const p of participants) {
      if (p.playerId !== playerId) {
        emitSocial(p.playerId, {
          type: "CONVERSATION_READ",
          conversationId,
          playerId,
          lastReadAt: readTime,
        });
      }
    }

    return { ok: true };
  }

  async editMessage(playerId: string, messageId: string, content: string) {
    const message = await this.assertOwnMessage(playerId, messageId, "Cannot edit this message.");

    const updated = await this.db.message.update({
      where: { id: messageId },
      data: { content, editedAt: new Date() },
    });

    await this.broadcastToConversation(message.conversationId, (recipientId) =>
      emitSocial(recipientId, {
        type: "MESSAGE_EDIT",
        conversationId: message.conversationId,
        messageId: updated.id,
        content: updated.content,
        editedAt: updated.editedAt!,
      }),
    );

    return updated;
  }

  async deleteMessage(playerId: string, messageId: string) {
    const message = await this.assertOwnMessage(playerId, messageId, "Cannot delete this message.");

    await this.db.message.update({ where: { id: messageId }, data: { deletedAt: new Date() } });

    await this.broadcastToConversation(message.conversationId, (recipientId) =>
      emitSocial(recipientId, {
        type: "MESSAGE_DELETE",
        conversationId: message.conversationId,
        messageId: message.id,
      }),
    );

    return { success: true };
  }

  // ── Recent combatants ───────────────────────────────────────────────────────

  async getRecentCombatants(playerId: string) {
    const playerMatches = await this.db.matchPlayer.findMany({
      where: { playerId },
      select: { matchId: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const matchIds = playerMatches.map((m) => m.matchId);

    if (matchIds.length === 0) {
      return [];
    }

    const combatants = await this.db.matchPlayer.findMany({
      where: { matchId: { in: matchIds }, playerId: { not: playerId } },
      include: { player: { select: { id: true, name: true, displayName: true } } },
      orderBy: { createdAt: "desc" },
    });

    const seen = new Set<string>();
    const unique: (typeof combatants)[number]["player"][] = [];

    for (const entry of combatants) {
      if (!seen.has(entry.player.id)) {
        seen.add(entry.player.id);
        unique.push(entry.player);
      }
    }

    return unique;
  }

  // ── Block & mute ────────────────────────────────────────────────────────────

  async blockPlayer(playerId: string, targetPlayerId: string) {
    await this.assertRealOtherPlayer(playerId, targetPlayerId);
    return this.db.block.upsert({
      where: { blockerId_blockedId: { blockerId: playerId, blockedId: targetPlayerId } },
      update: {},
      create: { blockerId: playerId, blockedId: targetPlayerId },
    });
  }

  async unblockPlayer(playerId: string, targetPlayerId: string) {
    await this.db.block.deleteMany({ where: { blockerId: playerId, blockedId: targetPlayerId } });
    return { success: true };
  }

  async mutePlayer(playerId: string, targetPlayerId: string) {
    await this.assertRealOtherPlayer(playerId, targetPlayerId);
    return this.db.mute.upsert({
      where: { muterId_mutedId: { muterId: playerId, mutedId: targetPlayerId } },
      update: {},
      create: { muterId: playerId, mutedId: targetPlayerId },
    });
  }

  async unmutePlayer(playerId: string, targetPlayerId: string) {
    await this.db.mute.deleteMany({ where: { muterId: playerId, mutedId: targetPlayerId } });
    return { success: true };
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const block = await this.db.block.findFirst({
      where: {
        OR: [
          { blockerId: a, blockedId: b },
          { blockerId: b, blockedId: a },
        ],
      },
    });

    return block !== null;
  }

  private async notify(
    playerId: string,
    type: "FRIEND_REQUEST" | "FRIEND_ACCEPT",
    from: CurrentPlayer,
  ): Promise<void> {
    const content = JSON.stringify({ senderName: from.displayName, senderId: from.id });
    const notification = await this.db.notification.create({ data: { playerId, type, content } });

    emitSocial(playerId, {
      type: "NOTIFICATION_NEW",
      notificationId: notification.id,
      alertType: type,
      content,
    });
  }

  /** A ban that reaches this point already passed authz; ownership is what's checked here. */
  private async assertOwnsCategoryAndFriendship(
    playerId: string,
    categoryId: string,
    friendshipId: string,
  ): Promise<void> {
    const category = await this.db.friendCategory.findUnique({
      where: { id: categoryId },
      select: { ownerId: true },
    });

    if (!category || category.ownerId !== playerId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "That category isn't yours." });
    }

    const friendship = await this.db.friendship.findUnique({
      where: { id: friendshipId },
      select: { senderId: true, receiverId: true },
    });

    if (!friendship || (friendship.senderId !== playerId && friendship.receiverId !== playerId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "That friendship isn't yours." });
    }
  }

  private async ensureMatchChannel(matchId: string, teamIndex: number, participantIds: string[]) {
    return this.db.conversation.upsert({
      where: { matchId_teamIndex: { matchId, teamIndex } },
      update: {},
      create: {
        kind: "MATCH",
        matchId,
        teamIndex,
        name: teamIndex === -1 ? "All" : `Team ${teamIndex + 1}`,
        participants: { create: participantIds.map((playerId) => ({ playerId })) },
      },
    });
  }

  private async assertParticipant(
    conversationId: string,
    playerId: string,
    message: string,
  ): Promise<void> {
    const participation = await this.db.conversationParticipant.findUnique({
      where: { conversationId_playerId: { conversationId, playerId } },
    });

    if (!participation) {
      throw new TRPCError({ code: "FORBIDDEN", message });
    }
  }

  /**
   * Post-game chat write window (Epic 5 / FR7): a *finished* match's channels stay writable only
   * while a participant is still on the End-Game screen (presence); a *cancelled* match is aborted
   * with no such window, so its chat is closed outright. Active matches and DMs are never gated.
   */
  private async assertChatWritable(conversationId: string): Promise<void> {
    const conversation = await this.db.conversation.findUnique({
      where: { id: conversationId },
      select: { kind: true, matchId: true, match: { select: { status: true } } },
    });

    if (conversation === null) {
      // Deleted between the participation check and here.
      throw new TRPCError({ code: "NOT_FOUND", message: "Conversation no longer exists." });
    }

    if (conversation.kind !== "MATCH" || conversation.matchId === null) {
      return;
    }

    const status = conversation.match?.status;

    if (status === "cancelled") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This match was cancelled — chat is closed.",
      });
    }

    if (status === "finished" && !egChatWritable(conversation.matchId)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Post-game chat has closed." });
    }
  }

  private async assertOwnMessage(playerId: string, messageId: string, message: string) {
    const found = await this.db.message.findUnique({ where: { id: messageId } });

    if (!found || found.senderId !== playerId) {
      throw new TRPCError({ code: "FORBIDDEN", message });
    }

    return found;
  }

  private async broadcastToConversation(
    conversationId: string,
    emit: (recipientId: string) => void,
  ): Promise<void> {
    const participants = await this.db.conversationParticipant.findMany({
      where: { conversationId },
      select: { playerId: true },
    });

    participants.forEach((p) => emit(p.playerId));
  }

  private async assertRealOtherPlayer(playerId: string, targetPlayerId: string): Promise<void> {
    if (targetPlayerId === playerId) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "You can't do that to yourself." });
    }

    const target = await this.db.player.findUnique({
      where: { id: targetPlayerId },
      select: { id: true },
    });

    if (!target) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
    }
  }
}
