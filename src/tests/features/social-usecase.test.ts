import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import { SocialUsecase } from "server/social/social.usecase";

/**
 * Pure tests for the social bug fixes surfaced by the full-review (ownership, self/target
 * validation, the cancelled-match chat gate, and the read-cursor moving out of the history query).
 * Prisma is a per-test `vi.fn()` fake — no DB — so each test only stubs the calls it exercises.
 */

const me = { id: "me", displayName: "Me" };

// Build a fake Prisma exposing just the model methods a test needs; everything else throws if hit.
const fakeDb = (models: Record<string, Record<string, unknown>>): PrismaClient =>
  models as unknown as PrismaClient;

describe("assignFriendToCategory / removeFriendFromCategory ownership (#10)", () => {
  it("rejects a category the player does not own", async () => {
    const update = vi.fn();
    const social = new SocialUsecase(
      fakeDb({
        friendCategory: {
          findUnique: vi.fn().mockResolvedValue({ ownerId: "someone-else" }),
          update,
        },
      }),
    );

    await expect(social.assignFriendToCategory("me", "friendship1", "cat1")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a friendship the player is not part of", async () => {
    const update = vi.fn();
    const social = new SocialUsecase(
      fakeDb({
        friendCategory: { findUnique: vi.fn().mockResolvedValue({ ownerId: "me" }), update },
        friendship: {
          findUnique: vi.fn().mockResolvedValue({ senderId: "a", receiverId: "b" }),
        },
      }),
    );

    await expect(
      social.removeFriendFromCategory("me", "friendship1", "cat1"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(update).not.toHaveBeenCalled();
  });

  it("allows an owned category + own friendship", async () => {
    const update = vi.fn().mockResolvedValue({ id: "cat1" });
    const social = new SocialUsecase(
      fakeDb({
        friendCategory: { findUnique: vi.fn().mockResolvedValue({ ownerId: "me" }), update },
        friendship: { findUnique: vi.fn().mockResolvedValue({ senderId: "me", receiverId: "b" }) },
      }),
    );

    await social.assignFriendToCategory("me", "friendship1", "cat1");
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("block / mute self+target validation (#20)", () => {
  it("rejects blocking yourself", async () => {
    const social = new SocialUsecase(fakeDb({}));
    await expect(social.blockPlayer("me", "me")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects muting a non-existent player", async () => {
    const social = new SocialUsecase(
      fakeDb({ player: { findUnique: vi.fn().mockResolvedValue(null) } }),
    );
    await expect(social.mutePlayer("me", "ghost")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("blocks a real other player", async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const social = new SocialUsecase(
      fakeDb({
        player: { findUnique: vi.fn().mockResolvedValue({ id: "them" }) },
        block: { upsert },
      }),
    );
    await social.blockPlayer("me", "them");
    expect(upsert).toHaveBeenCalledOnce();
  });
});

describe("sendMessage chat gate (#19)", () => {
  const participant = { findUnique: vi.fn().mockResolvedValue({ lastReadAt: new Date() }) };

  it("closes chat for a cancelled match", async () => {
    const social = new SocialUsecase(
      fakeDb({
        conversationParticipant: participant,
        conversation: {
          findUnique: vi
            .fn()
            .mockResolvedValue({ kind: "MATCH", matchId: "m1", match: { status: "cancelled" } }),
        },
      }),
    );
    await expect(social.sendMessage(me, "c1", "hi")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("throws NOT_FOUND when the conversation vanished mid-flight", async () => {
    const social = new SocialUsecase(
      fakeDb({
        conversationParticipant: participant,
        conversation: { findUnique: vi.fn().mockResolvedValue(null) },
      }),
    );
    await expect(social.sendMessage(me, "c1", "hi")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("read cursor moved out of the history query (#9)", () => {
  it("getConversationHistory does not write the read cursor", async () => {
    const update = vi.fn();
    const social = new SocialUsecase(
      fakeDb({
        conversationParticipant: {
          findUnique: vi.fn().mockResolvedValue({ lastReadAt: new Date() }),
          findMany: vi.fn().mockResolvedValue([{ playerId: "me", lastReadAt: new Date() }]),
          update,
        },
        message: { findMany: vi.fn().mockResolvedValue([{ id: "msg1" }]) },
      }),
    );

    await social.getConversationHistory("me", "c1");
    expect(update).not.toHaveBeenCalled();
  });

  it("markConversationRead advances the cursor", async () => {
    const update = vi.fn().mockResolvedValue({});
    const social = new SocialUsecase(
      fakeDb({
        conversationParticipant: {
          findUnique: vi.fn().mockResolvedValue({ lastReadAt: new Date() }),
          findMany: vi.fn().mockResolvedValue([{ playerId: "me" }]),
          update,
        },
      }),
    );

    await social.markConversationRead("me", "c1");
    expect(update).toHaveBeenCalledOnce();
  });
});

describe("match channels are get-or-created idempotently via upsert (#17)", () => {
  it("upserts on (matchId, teamIndex) instead of findFirst+create", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "conv" });
    const social = new SocialUsecase(fakeDb({ conversation: { upsert } }));

    await social.getOrCreateMatchChannels({
      matchId: "m1",
      allPlayerIds: ["me", "them"],
      myTeam: { index: 0, playerIds: ["me"] },
    });

    // Once for the "All" channel (teamIndex -1) and once for the team channel (index 0).
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { matchId_teamIndex: { matchId: "m1", teamIndex: -1 } },
    });
  });
});

// Sanity: the usecase raises typed TRPCErrors (transport maps them).
it("throws TRPCError instances", async () => {
  const social = new SocialUsecase(fakeDb({}));
  await expect(social.blockPlayer("me", "me")).rejects.toBeInstanceOf(TRPCError);
});
