/* eslint-disable @typescript-eslint/require-await -- in-memory fakes mirror Prisma's async API */
import { describe, expect, it } from "vitest";
import { AdminUsecase } from "server/admin/admin.usecase";

/**
 * `AdminUsecase.forceMatch` — the out-of-match force-match tool. What's locked here is the BRANCH:
 * two already-queued players are paired IN the queue (ready-check), while anyone else spawns an
 * admin-hosted custom lobby. The old direct-to-`setup` `match.create` is gone, so neither path
 * touches the match store.
 */

type ForcedMatchArgs = {
  hostPlayerId: string;
  seatPlayerIds: string[];
  mode: string;
  ruleset: string;
  isRanked: boolean;
  mapId?: string;
};

const actor = { userId: "u-admin", playerId: "p-admin", ip: "127.0.0.1", userAgent: "test" };

const makeUsecase = (opts: {
  players: Record<string, { id: string; name: string }>;
  queued: string[];
}) => {
  const audits: { tool: string; payload: Record<string, unknown> }[] = [];
  const forcePairCalls: [string, string][] = [];
  const forcedMatches: ForcedMatchArgs[] = [];
  const queued = new Set(opts.queued);

  const prisma = {
    player: {
      findUnique: async ({ where }: { where: { id: string } }) => opts.players[where.id] ?? null,
    },
    devToolAudit: {
      create: async ({ data }: { data: { tool: string; payload: Record<string, unknown> } }) => {
        audits.push({ tool: data.tool, payload: data.payload });
        return data;
      },
    },
  };

  const droppedFromQueue: string[] = [];
  const matchmaking = {
    isQueued: (id: string) => queued.has(id),
    forcePair: async (a: string, b: string) => {
      forcePairCalls.push([a, b]);
    },
    dropFromQueue: (id: string) => {
      droppedFromQueue.push(id);
      queued.delete(id);
    },
  };

  const lobbies = {
    createForcedMatch: async (args: ForcedMatchArgs) => {
      forcedMatches.push(args);
      return { id: "lobby-forced" };
    },
  };

  const usecase = new AdminUsecase(prisma as never, {} as never, matchmaking, lobbies);
  return { usecase, audits, forcePairCalls, forcedMatches, droppedFromQueue };
};

const twoPlayers = {
  a: { id: "a", name: "Ada" },
  b: { id: "b", name: "Bo" },
};

describe("AdminUsecase.forceMatch", () => {
  it("pairs two already-queued players from the queue, not into a lobby", async () => {
    const { usecase, forcePairCalls, forcedMatches, audits } = makeUsecase({
      players: twoPlayers,
      queued: ["a", "b"],
    });

    const result = await usecase.forceMatch({ playerAId: "a", playerBId: "b", actor });

    expect(result).toEqual({ kind: "queued", playerAName: "Ada", playerBName: "Bo" });
    expect(forcePairCalls).toEqual([["a", "b"]]);
    expect(forcedMatches).toHaveLength(0);
    expect(audits[0]?.payload.via).toBe("queue");
  });

  it("spawns an admin-hosted lobby (no map — chosen in the setup panel) when not both queued", async () => {
    const { usecase, forcePairCalls, forcedMatches, audits, droppedFromQueue } = makeUsecase({
      players: twoPlayers,
      queued: ["a"], // only A is queued → falls to the custom-match path
    });

    const result = await usecase.forceMatch({ playerAId: "a", playerBId: "b", actor });

    expect(result).toEqual({ kind: "lobby", lobbyId: "lobby-forced" });
    expect(forcePairCalls).toHaveLength(0);
    expect(forcedMatches).toHaveLength(1);
    // Admin hosts (not a seated player); both chosen players are seated; the map is left unset.
    expect(forcedMatches[0]).toMatchObject({
      hostPlayerId: "p-admin",
      seatPlayerIds: ["a", "b"],
      mode: "duel",
      isRanked: false,
    });
    expect(forcedMatches[0]?.mapId).toBeUndefined();
    expect(audits[0]?.payload.via).toBe("lobby");
    // The still-queued player is pulled from the queue, so the pairing tick can't also pair them into
    // a second ready-check while they sit seated in this forced lobby.
    expect(droppedFromQueue).toContain("a");
  });

  it("rejects forcing a player against themselves", async () => {
    const { usecase } = makeUsecase({ players: twoPlayers, queued: [] });

    await expect(usecase.forceMatch({ playerAId: "a", playerBId: "a", actor })).rejects.toThrow(
      /two different players/,
    );
  });

  it("rejects a player that does not exist", async () => {
    const { usecase } = makeUsecase({ players: { a: twoPlayers.a }, queued: [] });

    await expect(usecase.forceMatch({ playerAId: "a", playerBId: "ghost", actor })).rejects.toThrow(
      /does not exist/,
    );
  });
});
