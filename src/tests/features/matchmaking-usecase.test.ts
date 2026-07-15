/* eslint-disable @typescript-eslint/require-await -- the in-memory fake DB mirrors Prisma's async API */
import { beforeEach, describe, expect, it } from "vitest";
import { subscribeQueue, type QueueEvent } from "server/emitter/matchmaking-emitter";
import { MatchmakingUsecase } from "server/matchmaking/matchmaking.usecase";
import { MatchQueue, type Ticket } from "server/matchmaking/queue";
import { defaultSkill } from "server/ranking/skill";

/**
 * The matchmaking lifecycle against an in-memory fake Prisma + fake spawner/rater — no real DB. Drives
 * the full pair → ready-check → map-ban → spawn path, plus the decline / lenient branches. Queue
 * events are captured via the real per-player emitter.
 */

// A tiny fake of just the Prisma surface the usecase touches.
type Member = {
  lobbyId: string;
  playerId: string;
  team: number | null;
  slot: number | null;
  membership: string;
  accepted: boolean;
  isSpectator: boolean;
  bannedMapIds: string[] | null;
  votedMapId: string | null;
};

class FakeDb {
  lobbies = new Map<string, Record<string, unknown>>();
  members: Member[] = [];
  infractions: { playerId: string; type: string; lobbyId?: string }[] = [];
  maps = Array.from({ length: 7 }, (_, i) => ({
    id: `m${i}`,
    name: `Map ${i}`,
    numberOfPlayers: 2,
  }));
  private seq = 0;

  private withMembers(id: string) {
    const lobby = this.lobbies.get(id);

    if (lobby === undefined) {
      return null;
    }

    return {
      ...lobby,
      members: this.members
        .filter((m) => m.lobbyId === id)
        .map((m) => ({ ...m, player: { id: m.playerId, name: m.playerId } })),
    };
  }

  lobby = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const id = `L${++this.seq}`;
      const { members, ...rest } = data as { members?: { create: Partial<Member>[] } };
      this.lobbies.set(id, { id, ...rest });

      for (const m of members?.create ?? []) {
        this.members.push({
          lobbyId: id,
          playerId: m.playerId!,
          team: m.team ?? null,
          slot: m.slot ?? null,
          membership: m.membership ?? "active",
          accepted: false,
          isSpectator: false,
          bannedMapIds: null,
          votedMapId: null,
        });
      }

      return { id, ...rest };
    },
    findUnique: async ({ where, include }: { where: { id: string }; include?: unknown }) =>
      include !== undefined ? this.withMembers(where.id) : (this.lobbies.get(where.id) ?? null),
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const lobby = this.lobbies.get(where.id)!;
      Object.assign(lobby, data);
      return lobby;
    },
    findMany: async ({ where }: { where: { status?: string } }) =>
      [...this.lobbies.values()].filter(
        (l) => where.status === undefined || l.status === where.status,
      ),
  };

  playerInLobby = {
    update: async ({
      where,
      data,
    }: {
      where: { lobbyId_playerId: { lobbyId: string; playerId: string } };
      data: Partial<Member>;
    }) => {
      const m = this.members.find(
        (x) =>
          x.lobbyId === where.lobbyId_playerId.lobbyId &&
          x.playerId === where.lobbyId_playerId.playerId,
      )!;
      Object.assign(m, data);
      return m;
    },
    findMany: async ({ where }: { where: { lobbyId: string } }) =>
      this.members.filter((m) => m.lobbyId === where.lobbyId),
  };

  matchPlayer = { findFirst: async () => null };
  playerInfraction = {
    createMany: async ({ data }: { data: typeof FakeDb.prototype.infractions }) => {
      this.infractions.push(...data);
    },
  };
  wWMap = {
    findMany: async ({ where }: { where?: { id?: { in: string[] } } }) =>
      where?.id ? this.maps.filter((m) => where.id!.in.includes(m.id)) : this.maps,
  };
  $transaction = async (fn: (tx: FakeDb) => Promise<unknown>) => fn(this);
}

const NOW = 2_000_000;
const ticket = (playerId: string, mu = 25): Ticket => ({
  playerId,
  // Settled ratings: a mu gap then means a decisive matchup, which is what these tests set up.
  skill: { mu, sigma: 1.5 },
  ruleset: "standard",
  mode: "duel",
  ranked: true,
  enqueuedAt: NOW,
});

const spawner = () => {
  const calls: unknown[] = [];
  return {
    calls,
    spawnFromLobby: async (req: unknown) => {
      calls.push(req);
      return { matchId: "MATCH1" };
    },
  };
};

const rater = {
  getSkills: async (ids: string[]) => new Map(ids.map((id) => [id, defaultSkill()])),
};

/** Capture queue events for a player over the test's lifetime. */
const listen = (playerId: string, sink: QueueEvent[]) =>
  subscribeQueue(playerId, (e) => sink.push(e));

const firstLobbyId = (db: FakeDb) => [...db.lobbies.keys()][0];

// The deadline handlers are private (only ever invoked by the timer); reach them in tests.
type Internals = {
  onReadyDeadline(lobbyId: string): Promise<void>;
  onMapPhaseDeadline(lobbyId: string): Promise<void>;
  onMapRevealDeadline(lobbyId: string): Promise<void>;
};
const internals = (u: MatchmakingUsecase): Internals => u as unknown as Internals;

describe("matchmaking usecase", () => {
  let db: FakeDb;
  let queue: MatchQueue;
  let spawn: ReturnType<typeof spawner>;
  let usecase: MatchmakingUsecase;
  const events: Record<string, QueueEvent[]> = {};
  const unsubs: (() => void)[] = [];

  beforeEach(() => {
    db = new FakeDb();
    queue = new MatchQueue();
    spawn = spawner();
    usecase = new MatchmakingUsecase(db as never, rater, spawn, queue);
    events.A = [];
    events.B = [];
    unsubs.push(listen("A", events.A), listen("B", events.B));
  });

  it("runs the full happy path: pair → both accept → both vote → reveal → spawn", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));

    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    expect(db.lobbies.get(lobbyId)!.status).toBe("ready_check");
    expect(events.A.at(-1)).toMatchObject({ type: "ready-check-started", lenient: false });

    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B");
    expect(db.lobbies.get(lobbyId)!.status).toBe("map_ban");

    // No bans → all 7 maps survive; both vote the same one.
    await usecase.voteMap(lobbyId, "A", "m0");
    await usecase.voteMap(lobbyId, "B", "m0");

    // Both voted → the map is locked and revealed; the match is NOT spawned yet.
    expect(db.lobbies.get(lobbyId)!.status).toBe("map_reveal");
    expect(db.lobbies.get(lobbyId)!.mapId).toBe("m0");
    expect(spawn.calls).toHaveLength(0);

    // Reveal window elapses → spawn on the locked map.
    await internals(usecase).onMapRevealDeadline(lobbyId);

    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]).toMatchObject({
      lobbyId,
      mapId: "m0",
      isRanked: true,
      seats: [
        { playerId: "A", team: 0, slotWithinTeam: 0 },
        { playerId: "B", team: 1, slotWithinTeam: 0 },
      ],
    });
    expect(db.lobbies.get(lobbyId)!.status).toBe("started");
    expect(events.A.at(-1)).toMatchObject({ type: "match-found", matchId: "MATCH1" });
  });

  it("bans then a vote must dodge the banned maps", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B");

    await usecase.banMap(lobbyId, "A", "m0");
    await expect(usecase.voteMap(lobbyId, "B", "m0")).rejects.toThrow(); // m0 is banned
    await usecase.voteMap(lobbyId, "A", "m1");
    await usecase.voteMap(lobbyId, "B", "m1");
    // Both voted → reveal locks m1; spawn happens only after the reveal window.
    expect(db.lobbies.get(lobbyId)!.mapId).toBe("m1");
    await internals(usecase).onMapRevealDeadline(lobbyId);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]).toMatchObject({ mapId: "m1" });
  });

  it("ready-check timeout flags the non-acceptor and requeues the acceptor", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await usecase.acceptReadyCheck(lobbyId, "A"); // B never accepts → deadline fires
    await internals(usecase).onReadyDeadline(lobbyId);

    expect(db.lobbies.get(lobbyId)!.status).toBe("cancelled");
    expect(db.infractions).toEqual([{ playerId: "B", type: "missed_ready_check", lobbyId }]);
    expect(queue.has("A")).toBe(true);
    expect(queue.get("A")!.enqueuedAt).toBe(NOW); // original wait preserved
    expect(queue.has("B")).toBe(false);
    expect(events.A.at(-1)).toMatchObject({ type: "requeued" });
    expect(events.B.at(-1)).toMatchObject({ type: "dismissed" });
  });

  it("forbids declining a normal (non-lenient) ranked ready-check", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3)); // near-even → not lenient
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await expect(usecase.declineReadyCheck(lobbyId, "B")).rejects.toThrow();
    expect(db.lobbies.get(lobbyId)!.status).toBe("ready_check"); // still live
    expect(db.infractions).toHaveLength(0);
  });

  it("lenient (wide-gap) decline is allowed, writes no infraction, and requeues the other player", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 35)); // ~95% favourite → past LENIENT_GAP
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    expect(db.lobbies.get(lobbyId)!.readyCheckLenient).toBe(true);

    await usecase.declineReadyCheck(lobbyId, "B");

    expect(db.infractions).toHaveLength(0);
    expect(db.lobbies.get(lobbyId)!.status).toBe("cancelled");
    expect(queue.has("A")).toBe(true); // the willing player goes back to searching
  });

  it("forbids declining once you've accepted", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 35)); // lenient, so decline would otherwise be allowed
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await usecase.acceptReadyCheck(lobbyId, "B");
    await expect(usecase.declineReadyCheck(lobbyId, "B")).rejects.toThrow();
  });

  it("map-ban deadline cancels + flags whoever didn't pick, requeuing the other", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B"); // → map_ban

    await usecase.voteMap(lobbyId, "A", "m0"); // A picks, B goes AFK
    await internals(usecase).onMapPhaseDeadline(lobbyId);

    expect(db.lobbies.get(lobbyId)!.status).toBe("cancelled");
    expect(db.infractions).toEqual([{ playerId: "B", type: "abandoned_map_ban", lobbyId }]);
    expect(spawn.calls).toHaveLength(0); // no match spawned
    expect(queue.has("A")).toBe(true);
    expect(queue.has("B")).toBe(false);
  });

  it("rejects joining the queue twice", async () => {
    await usecase.joinQueue("A", { mode: "duel", ruleset: "standard", ranked: true });
    await expect(
      usecase.joinQueue("A", { mode: "duel", ruleset: "standard", ranked: true }),
    ).rejects.toThrow();
    expect(usecase.status("A")).toMatchObject({ inQueue: true, mode: "duel", ranked: true });
  });
});
