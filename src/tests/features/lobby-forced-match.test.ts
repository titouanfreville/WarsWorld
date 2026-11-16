/* eslint-disable @typescript-eslint/require-await -- in-memory fake db mirrors Prisma's async API */
import { describe, expect, it } from "vitest";
import { LobbyUsecase } from "server/lobby/lobby.usecase";
import type { MatchRules } from "server/core/schemas/match-rules";

/**
 * `LobbyUsecase.createForcedMatch` — the admin force-match custom path. What's locked: the host is
 * benched (an organizer, no seat) while the chosen players are seated across the mode's grid, and a
 * host who is also a chosen player takes the seat rather than colliding with the benched host row.
 */

type MemberCreate = {
  playerId: string;
  membership: string;
  team: number | null;
  slot: number | null;
};

const RULES: MatchRules = {
  unitCapPerPlayer: 50,
  fogOfWar: false,
  fundsPerProperty: 1000,
  labUnitTypes: [],
  bannedUnitTypes: [],
  captureLimit: 50,
  dayLimit: 50,
  weatherSetting: "clear",
  teamMapping: [],
};

type CreatedData = {
  members: { create: MemberCreate[] };
  hostPlayerId: string;
  mapId?: string;
};

const makeUsecase = () => {
  let created: CreatedData | null = null;

  const db = {
    wWMap: {
      findUnique: async () => ({ id: "map-1", numberOfPlayers: 2, supportedModes: ["duel"] }),
    },
    lobby: {
      create: async ({ data }: { data: CreatedData }) => {
        created = data;

        // Echo a minimal LobbyRow back so lobbyToView can render it.
        return {
          id: "lobby-1",
          hostPlayerId: data.hostPlayerId,
          mode: "duel",
          ruleset: "standard",
          isRanked: false,
          mapId: data.mapId ?? null,
          status: "assembling",
          teamFactions: ["orange-star", "blue-moon"],
          rules: RULES,
          match: null,
          members: data.members.create.map((m) => ({
            ...m,
            isSpectator: false,
            accepted: false,
            player: { id: m.playerId, name: m.playerId },
          })),
        };
      },
    },
  };

  const usecase = new LobbyUsecase(db as never, {} as never);
  return { usecase, created: () => created };
};

describe("LobbyUsecase.createForcedMatch", () => {
  it("benches the host and seats the two players on opposing teams", async () => {
    const { usecase, created } = makeUsecase();

    const view = await usecase.createForcedMatch({
      hostPlayerId: "admin",
      seatPlayerIds: ["a", "b"],
      mode: "duel",
      ruleset: "standard",
      isRanked: false,
      mapId: "map-1",
      rules: RULES,
    });

    expect(view.hostPlayerId).toBe("admin");

    const members = created()!.members.create;
    const host = members.find((m) => m.playerId === "admin")!;
    const a = members.find((m) => m.playerId === "a")!;
    const b = members.find((m) => m.playerId === "b")!;

    // Host is an active organizer with no seat; the two players sit on teams 0 and 1.
    expect(host).toMatchObject({ membership: "active", team: null, slot: null });
    expect(a).toMatchObject({ team: 0, slot: 0 });
    expect(b).toMatchObject({ team: 1, slot: 0 });
  });

  it("creates the lobby without a map when none is given — the host picks it in the setup panel", async () => {
    const { usecase, created } = makeUsecase();

    const view = await usecase.createForcedMatch({
      hostPlayerId: "admin",
      seatPlayerIds: ["a", "b"],
      mode: "duel",
      ruleset: "standard",
      isRanked: false,
      rules: RULES,
    });

    expect(created()!.mapId).toBeUndefined();
    expect(view.mapId).toBeNull();
  });

  it("gives a host who is also a chosen player the seat, not a duplicate benched row", async () => {
    const { usecase, created } = makeUsecase();

    await usecase.createForcedMatch({
      hostPlayerId: "a", // admin forces themselves in as player A
      seatPlayerIds: ["a", "b"],
      mode: "duel",
      ruleset: "standard",
      isRanked: false,
      mapId: "map-1",
      rules: RULES,
    });

    const members = created()!.members.create;
    const rowsForA = members.filter((m) => m.playerId === "a");

    // Exactly one row for A, and it's the seat — no unique-constraint collision.
    expect(rowsForA).toHaveLength(1);
    expect(rowsForA[0]).toMatchObject({ team: 0, slot: 0 });
  });

  it("rejects a seat count that doesn't match the mode capacity", async () => {
    const { usecase } = makeUsecase();

    await expect(
      usecase.createForcedMatch({
        hostPlayerId: "admin",
        seatPlayerIds: ["a"], // duel needs two
        mode: "duel",
        ruleset: "standard",
        isRanked: false,
        mapId: "map-1",
        rules: RULES,
      }),
    ).rejects.toThrow(/seats 2 players/);
  });
});

const makeSetMapUsecase = (opts: { host: string; status: string }) => {
  let mapId: string | null = null;

  const row = () => ({
    id: "lobby-1",
    hostPlayerId: opts.host,
    mode: "duel",
    ruleset: "standard",
    isRanked: false,
    mapId,
    status: opts.status,
    teamFactions: ["orange-star", "blue-moon"],
    rules: RULES,
    match: null,
    members: [],
  });

  const db = {
    lobby: {
      findUnique: async () => row(),
      update: async ({ data }: { data: { mapId: string } }) => {
        mapId = data.mapId;
        return row();
      },
    },
    wWMap: {
      findUnique: async () => ({ id: "map-9", numberOfPlayers: 2, supportedModes: ["duel"] }),
    },
    playerInLobby: { findMany: async () => [] },
  };

  const usecase = new LobbyUsecase(db as never, {} as never);
  return { usecase };
};

describe("LobbyUsecase.setMap", () => {
  it("lets the host set the lobby map before starting", async () => {
    const { usecase } = makeSetMapUsecase({ host: "admin", status: "assembling" });

    const view = await usecase.setMap("lobby-1", "admin", "map-9");

    expect(view.mapId).toBe("map-9");
  });

  it("rejects a non-host trying to set the map", async () => {
    const { usecase } = makeSetMapUsecase({ host: "admin", status: "assembling" });

    await expect(usecase.setMap("lobby-1", "someone-else", "map-9")).rejects.toThrow(
      /Only the host/,
    );
  });
});
