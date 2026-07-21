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
  // m0..m5 are ranked-legal; `m6` is playable in duel but NOT ranked-legal — the case the ranked
  // pool filter has to exclude. Both counts stay at or under MAP_POOL_SIZE (7) on purpose: the
  // pool is shuffled and sliced to that cap, so a larger eligible set would make "does the pool
  // contain m6" depend on the shuffle and the test would flake.
  maps = [
    ...Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      name: `Map ${i}`,
      numberOfPlayers: 2,
      supportedModes: ["duel"],
      rankedModes: i === 6 ? [] : ["duel"],
      tiles: [
        [{ type: "plain" }, { type: "city" }],
        [{ type: "base" }, { type: "plain" }],
      ],
    })),
    // Four-seat maps, for the 2v2 / free-for-all queues. Five of them because `minMapPoolSize(4)`
    // is 5 — below that `createReadyCheck` refuses to start a ban phase at all.
    ...Array.from({ length: 5 }, (_, i) => ({
      id: `q${i}`,
      name: `Quad ${i}`,
      numberOfPlayers: 4,
      supportedModes: ["teams", "ffa"],
      rankedModes: ["teams", "ffa"],
      // A 2×2 terrain grid: `mapBanView` summarises every pool map for the board's thumbnails, so
      // the row needs the same shape the real column has.
      tiles: [
        [{ type: "plain" }, { type: "city" }],
        [{ type: "base" }, { type: "plain" }],
      ],
    })),
  ];
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
    /** Conditional write: applies only when every field in `where` matches (see enterMapVote). */
    updateMany: async ({
      where,
      data,
    }: {
      where: { id: string; status?: string };
      data: Record<string, unknown>;
    }) => {
      const lobby = this.lobbies.get(where.id);

      if (lobby === undefined || (where.status !== undefined && lobby.status !== where.status)) {
        return { count: 0 };
      }

      Object.assign(lobby, data);

      return { count: 1 };
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

  /** Live matches this player sits in, as (playerId, isRanked) — drives the one-ranked-at-a-time gate. */
  activeMatches: { playerId: string; isRanked: boolean }[] = [];
  matchPlayer = {
    findFirst: async ({
      where,
    }: {
      where: { playerId: string; match?: { isRanked?: boolean } };
    }) => {
      const wantRanked = where.match?.isRanked;
      const hit = this.activeMatches.find(
        (m) =>
          m.playerId === where.playerId && (wantRanked === undefined || m.isRanked === wantRanked),
      );

      return hit === undefined ? null : { matchId: "existing" };
    },
    // Recent-opponents lookup at join. These tests set up no finished-match history, so it's empty.
    findMany: async () => [] as unknown[],
  };
  playerInfraction = {
    createMany: async ({ data }: { data: typeof FakeDb.prototype.infractions }) => {
      this.infractions.push(...data);
    },
  };
  wWMap = {
    // Honours the mode filters, not just the id lookup: `buildMapPool` decides which maps a queue
    // can roll, so a fake that ignored `rankedModes` would let a broken ranked filter pass unseen.
    findMany: async ({
      where,
    }: {
      where?: {
        id?: { in: string[] };
        numberOfPlayers?: number;
        supportedModes?: { has: string };
        rankedModes?: { has: string };
      };
    }) =>
      this.maps.filter((m) => {
        if (where?.id) {
          return where.id.in.includes(m.id);
        }

        if (where?.numberOfPlayers !== undefined && m.numberOfPlayers !== where.numberOfPlayers) {
          return false;
        }

        if (where?.supportedModes && !m.supportedModes.includes(where.supportedModes.has)) {
          return false;
        }

        if (where?.rankedModes && !m.rankedModes.includes(where.rankedModes.has)) {
          return false;
        }

        return true;
      }),
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
  rank: null,
  recentOpponents: {},
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
  // These tests exercise the queue/ready-check plumbing, not the rank band — everyone places.
  rankFor: async () => null,
};

/** Capture queue events for a player over the test's lifetime. */
const listen = (playerId: string, sink: QueueEvent[]) =>
  subscribeQueue(playerId, (e) => sink.push(e));

const firstLobbyId = (db: FakeDb) => [...db.lobbies.keys()][0];

/** The lobby's current phase deadline, in ms (the fake DB stores lobby columns untyped). */
const mapDeadline = (db: FakeDb, lobbyId: string): number =>
  (db.lobbies.get(lobbyId)!.mapPhaseEndsAt as Date).getTime();

/**
 * Wind the phase deadline into the past, the way real elapsed time would, before invoking the
 * handler directly.
 *
 * `onMapPhaseDeadline` ignores a firing whose persisted deadline is still in the future — that's how
 * it tells a genuine timeout from the stale ban-phase timer that is briefly still armed when the
 * last ban opens voting. Calling the handler without this asks it to treat a live phase as expired.
 */
const expireMapPhase = (db: FakeDb, lobbyId: string): void => {
  db.lobbies.get(lobbyId)!.mapPhaseEndsAt = new Date(Date.now() - 1000);
};

/**
 * Spend everyone's bans so the stage flips to voting. Bans are blind, so nothing may be voted until
 * every player has used all of theirs — most tests only care about reaching the vote.
 */
const spendBans = async (
  usecase: MatchmakingUsecase,
  lobbyId: string,
  bans: Record<string, string[]>,
): Promise<void> => {
  for (const [playerId, mapIds] of Object.entries(bans)) {
    for (const mapId of mapIds) {
      await usecase.banMap(lobbyId, playerId, mapId);
    }
  }
};

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

  describe("four-player queues", () => {
    /** The four-seat modes need four listeners, not the two the outer suite sets up. */
    const quad = ["A", "B", "C", "D"];

    const queueAll = (mode: "teams" | "ffa", mus: number[]) => {
      quad.forEach((id, i) => queue.add({ ...ticket(id, mus[i]), mode }));
    };

    it("forms a FOUR-player 2v2 lobby and seats it as two teams of two", async () => {
      queueAll("teams", [25, 25.1, 25.2, 25.3]);

      await usecase.tick();

      const lobbyId = firstLobbyId(db);
      const members = db.members.filter((m) => m.lobbyId === lobbyId);

      expect(members).toHaveLength(4);
      expect(db.lobbies.get(lobbyId)!.mode).toBe("teams");

      // Two teams of two, each seat distinct — this is what `allMatchSlotsReady` needs downstream,
      // and what a 2-member lobby on a 4-player map could never satisfy.
      const seats = members.map((m) => `${m.team}:${m.slot}`).sort();

      expect(seats).toEqual(["0:0", "0:1", "1:0", "1:1"]);
      expect(new Set(members.map((m) => m.playerId))).toEqual(new Set(quad));
    });

    it("balances the teams rather than seating them in queue order", async () => {
      // Queue order would pair the two strongest together (A+B vs C+D) and hand them the match.
      // The fair split puts one strong and one weak player on each side.
      queueAll("teams", [30, 29.5, 20.5, 20]);

      await usecase.tick();

      const lobbyId = firstLobbyId(db);
      const teamOf = new Map(
        db.members.filter((m) => m.lobbyId === lobbyId).map((m) => [m.playerId, m.team]),
      );

      expect(teamOf.get("A")).not.toBe(teamOf.get("B"));
      expect(teamOf.get("C")).not.toBe(teamOf.get("D"));
    });

    it("seats a free-for-all as four separate teams", async () => {
      queueAll("ffa", [25, 25.1, 25.2, 25.3]);

      await usecase.tick();

      const lobbyId = firstLobbyId(db);
      const members = db.members.filter((m) => m.lobbyId === lobbyId);

      expect(members.map((m) => m.team).sort()).toEqual([0, 1, 2, 3]);
      expect(members.every((m) => m.slot === 0)).toBe(true);
    });

    it("will not form a group it cannot fill, and leaves those players queued", async () => {
      // Three waiting for a four-seat mode is not a match. A half-formed lobby would strand them.
      ["A", "B", "C"].forEach((id) => queue.add({ ...ticket(id), mode: "teams" }));

      await usecase.tick();

      expect(db.lobbies.size).toBe(0);
      expect(queue.size()).toBe(3);
    });

    it("runs a 2v2 through one ban each to a spawned match", async () => {
      queueAll("teams", [25, 25.1, 25.2, 25.3]);
      await usecase.tick();

      const lobbyId = firstLobbyId(db);

      for (const id of quad) {
        await usecase.acceptReadyCheck(lobbyId, id);
      }

      expect(db.lobbies.get(lobbyId)!.status).toBe("map_ban");

      // ONE ban each at four players — four bans of a five-map pool still leaves one to vote on.
      const pool = db.lobbies.get(lobbyId)!.mapPool as string[];

      await spendBans(usecase, lobbyId, {
        A: [pool[0]],
        B: [pool[1]],
        C: [pool[2]],
        D: [pool[3]],
      });

      for (const id of quad) {
        await usecase.voteMap(lobbyId, id, pool[4]);
      }

      expect(db.lobbies.get(lobbyId)!.status).toBe("map_reveal");
      expect(db.lobbies.get(lobbyId)!.mapId).toBe(pool[4]);

      await internals(usecase).onMapRevealDeadline(lobbyId);

      expect(spawn.calls).toHaveLength(1);
      expect((spawn.calls[0] as { seats: unknown[] }).seats).toHaveLength(4);
    });
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

    // Bans are blind and voting is gated on both players spending them.
    await spendBans(usecase, lobbyId, { A: ["m4", "m5"], B: ["m2", "m3"] });

    // m0..m1 survive; both vote the same one.
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

    await spendBans(usecase, lobbyId, { A: ["m0", "m2"], B: ["m3", "m4"] });

    await expect(usecase.voteMap(lobbyId, "B", "m0")).rejects.toThrow(); // m0 is banned
    await usecase.voteMap(lobbyId, "A", "m1");
    await usecase.voteMap(lobbyId, "B", "m1");
    // Both voted → reveal locks m1; spawn happens only after the reveal window.
    expect(db.lobbies.get(lobbyId)!.mapId).toBe("m1");
    await internals(usecase).onMapRevealDeadline(lobbyId);
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0]).toMatchObject({ mapId: "m1" });
  });

  it("keeps bans blind: no voting until both have banned, and the view masks the opponent", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B");

    await usecase.banMap(lobbyId, "A", "m0");
    await usecase.banMap(lobbyId, "A", "m1");

    // A is done, B hasn't started. A may not vote yet — the bans haven't revealed.
    await expect(usecase.voteMap(lobbyId, "A", "m2")).rejects.toThrow();

    await usecase.banMap(lobbyId, "B", "m3");

    // What B sees of A mid-stage: a count, and nothing else.
    const midView = await usecase.mapBanView(lobbyId, "B");
    const aAsSeenByB = midView.players.find((p) => p.playerId === "A")!;
    expect(midView.stage).toBe("ban");
    expect(midView.bansRevealed).toBe(false);
    expect(aAsSeenByB.bannedMapIds).toEqual([]);
    expect(aAsSeenByB.banCount).toBe(2);
    // ...while B's own bans come back in full.
    expect(midView.players.find((p) => p.playerId === "B")!.bannedMapIds).toEqual(["m3"]);

    // B's last ban completes the stage → bans reveal, voting opens, the clock restarts.
    const banDeadline = mapDeadline(db, lobbyId);
    await usecase.banMap(lobbyId, "B", "m4");

    const voteView = await usecase.mapBanView(lobbyId, "B");
    expect(voteView.stage).toBe("vote");
    expect(voteView.bansRevealed).toBe(true);
    expect(voteView.players.find((p) => p.playerId === "A")!.bannedMapIds).toEqual(["m0", "m1"]);
    expect(mapDeadline(db, lobbyId)).not.toBe(banDeadline);

    // Votes stay blind in their turn: A's vote is withheld from B until the map is rolled.
    await usecase.voteMap(lobbyId, "A", "m2");
    const votingView = await usecase.mapBanView(lobbyId, "B");
    const aVoting = votingView.players.find((p) => p.playerId === "A")!;
    expect(votingView.votesRevealed).toBe(false);
    expect(aVoting.votedMapId).toBeNull();
    expect(aVoting.hasVoted).toBe(true);

    // Both voted → rolled and revealed → the votes finally become public.
    await usecase.voteMap(lobbyId, "B", "m2");
    const revealView = await usecase.mapBanView(lobbyId, "B");
    expect(revealView.votesRevealed).toBe(true);
    expect(revealView.players.find((p) => p.playerId === "A")!.votedMapId).toBe("m2");
  });

  it("lets both players waste a ban on the same map rather than leaking it", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B");

    // A banned m0; B banning it too must be ACCEPTED — a rejection would tell B what A picked.
    await spendBans(usecase, lobbyId, { A: ["m0", "m1"], B: ["m0", "m2"] });

    const view = await usecase.mapBanView(lobbyId, "A");
    expect(view.stage).toBe("vote");
    // The overlap wasted a ban: 4 bans removed only 3 maps, so m3 survives alongside m4..m5.
    await usecase.voteMap(lobbyId, "A", "m3");
    await usecase.voteMap(lobbyId, "B", "m3");
    expect(db.lobbies.get(lobbyId)!.mapId).toBe("m3");
  });

  it("ban-stage deadline flags the player who didn't ban, not the one waiting on them", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B"); // → map_ban

    // A bans on time and is then blocked waiting for B, who goes AFK. A must not be punished for a
    // vote they were never allowed to cast.
    await usecase.banMap(lobbyId, "A", "m0");
    await usecase.banMap(lobbyId, "A", "m1");
    expireMapPhase(db, lobbyId);
    await internals(usecase).onMapPhaseDeadline(lobbyId);

    expect(db.lobbies.get(lobbyId)!.status).toBe("cancelled");
    expect(db.infractions).toEqual([{ playerId: "B", type: "abandoned_map_ban", lobbyId }]);
    expect(queue.has("A")).toBe(true);
    expect(queue.has("B")).toBe(false);
  });

  it("ignores the stale ban timer that is still armed when the last ban opens voting", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    await usecase.acceptReadyCheck(lobbyId, "A");
    await usecase.acceptReadyCheck(lobbyId, "B"); // → map_ban

    // BOTH players spend every ban, just before the ban deadline. That opens voting on a fresh
    // deadline — but the original ban timer is still armed and about to fire.
    await usecase.banMap(lobbyId, "A", "m0");
    await usecase.banMap(lobbyId, "A", "m1");
    await usecase.banMap(lobbyId, "B", "m2");
    await usecase.banMap(lobbyId, "B", "m3");

    // The stale firing. Left unguarded it sees the bans complete, switches to the vote predicate,
    // finds neither player has voted — voting opened milliseconds ago — and cancels the match,
    // flagging BOTH for abandoning a phase they were never given time to play.
    await internals(usecase).onMapPhaseDeadline(lobbyId);

    expect(db.lobbies.get(lobbyId)!.status).toBe("map_ban");
    expect(db.infractions).toEqual([]);
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

  /**
   * The AFK bug: a missed check is not a rejection, so it must NOT cool the pair down — otherwise, in
   * a two-player pool, the player who stepped away can never rematch the one opponent available.
   */
  it("leaves no rematch cooldown after a timeout — the pair can meet again at once", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3));
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await usecase.acceptReadyCheck(lobbyId, "A"); // B goes AFK
    await internals(usecase).onReadyDeadline(lobbyId);

    queue.add(ticket("B", 25.3)); // B comes back and re-queues
    await usecase.tick();

    expect(queue.size()).toBe(0); // both pulled straight into a fresh ready-check — no cooldown
  });

  it("DOES cool the pair down after an explicit decline", async () => {
    const casualTicket = (playerId: string, mu = 25) => ({
      ...ticket(playerId, mu),
      ranked: false,
    });
    queue.add(casualTicket("A"));
    queue.add(casualTicket("B", 35)); // wide casual gap → lenient → declinable
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await usecase.declineReadyCheck(lobbyId, "B");

    queue.add(casualTicket("B", 35)); // B re-queues immediately
    await usecase.tick();

    expect(queue.has("A")).toBe(true); // still waiting — the just-declined pair is on cooldown
    expect(queue.has("B")).toBe(true);
  });

  it("forbids declining a normal (non-lenient) ready-check", async () => {
    queue.add(ticket("A"));
    queue.add(ticket("B", 25.3)); // near-even → not lenient
    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    await expect(usecase.declineReadyCheck(lobbyId, "B")).rejects.toThrow();
    expect(db.lobbies.get(lobbyId)!.status).toBe("ready_check"); // still live
    expect(db.infractions).toHaveLength(0);
  });

  /** The wide-gap escape hatch is casual-only. A lopsided RANKED check is still a commitment. */
  it("never makes a ranked wide-gap check lenient — no free decline", async () => {
    queue.add(ticket("A")); // ranked (helper default)
    queue.add(ticket("B", 35)); // ~95% favourite, but ranked

    await usecase.tick();
    const lobbyId = firstLobbyId(db);

    expect(db.lobbies.get(lobbyId)!.readyCheckLenient).toBe(false);
    expect(events.A.at(-1)).toMatchObject({ type: "ready-check-started", lenient: false });
    await expect(usecase.declineReadyCheck(lobbyId, "B")).rejects.toThrow();
  });

  const casual = (playerId: string, mu = 25) => ({ ...ticket(playerId, mu), ranked: false });

  /**
   * The map pool a queue rolls from is what decides which maps can affect ratings, so the ranked
   * queue has to draw from `rankedModes` and not merely from "any map that seats two". `m6` is
   * playable in duel but not ranked-legal there.
   */
  describe("map pool eligibility", () => {
    it("keeps a ranked-excluded map out of a ranked queue's pool", async () => {
      queue.add(ticket("A"));
      queue.add(ticket("B"));
      await usecase.tick();

      const pool = db.lobbies.get(firstLobbyId(db))!.mapPool as string[];

      expect(pool).not.toContain("m6");
      expect(pool).toHaveLength(6);
    });

    it("still offers that map in a casual queue", async () => {
      queue.add(casual("A"));
      queue.add(casual("B"));
      await usecase.tick();

      const pool = db.lobbies.get(firstLobbyId(db))!.mapPool as string[];

      expect(pool).toContain("m6");
      expect(pool).toHaveLength(7);
    });
  });

  it("casual wide-gap decline is allowed, writes no infraction, and requeues the other player", async () => {
    queue.add(casual("A"));
    queue.add(casual("B", 35)); // ~95% favourite → past LENIENT_GAP, and casual → lenient
    await usecase.tick();
    const lobbyId = firstLobbyId(db);
    expect(db.lobbies.get(lobbyId)!.readyCheckLenient).toBe(true);

    await usecase.declineReadyCheck(lobbyId, "B");

    expect(db.infractions).toHaveLength(0);
    expect(db.lobbies.get(lobbyId)!.status).toBe("cancelled");
    expect(queue.has("A")).toBe(true); // the willing player goes back to searching
  });

  it("forbids declining once you've accepted", async () => {
    queue.add(casual("A"));
    queue.add(casual("B", 35)); // lenient, so decline would otherwise be allowed
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

    await spendBans(usecase, lobbyId, { A: ["m4", "m5"], B: ["m2", "m3"] });
    await usecase.voteMap(lobbyId, "A", "m0"); // A picks, B goes AFK
    expireMapPhase(db, lobbyId);
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

  /**
   * One ranked match at a time, and ONLY ranked. This is correspondence: concurrent games are the
   * product (Your Games → Live is a list of them), so a blanket "finish your current match first"
   * would break it. Ranked is the exception — each concurrent ranked game would be paired against
   * the same mu, so the second one's opponent was chosen on information the first invalidated.
   */
  describe("one ranked match at a time", () => {
    it("blocks a ranked join while a ranked match is live", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: true });

      await expect(
        usecase.joinQueue("A", { mode: "duel", ruleset: "standard", ranked: true }),
      ).rejects.toThrow(/ranked match/i);
      expect(queue.has("A")).toBe(false);
    });

    it("does NOT block a casual join while a ranked match is live", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: true });

      await usecase.joinQueue("A", { mode: "duel", ruleset: "standard", ranked: false });
      expect(queue.has("A")).toBe(true);
    });

    it("does NOT let a casual match block a ranked join", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: false });

      await usecase.joinQueue("A", { mode: "duel", ruleset: "standard", ranked: true });
      expect(queue.has("A")).toBe(true);
    });

    it("lets a player stack casual queues alongside live casual games", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: false });
      db.activeMatches.push({ playerId: "A", isRanked: false });

      await usecase.joinQueue("A", { mode: "duel", ruleset: "highFunds", ranked: false });
      expect(queue.has("A")).toBe(true);
    });

    it("accepts a 4-seat mode now that the queue can fill one", async () => {
      await usecase.joinQueue("A", { mode: "teams", ruleset: "standard", ranked: false });
      expect(queue.has("A")).toBe(true);
    });

    // The Play page reads eligibility to grey the ranked cards out BEFORE the click. It must agree
    // with the join guard: block only on a live ranked match, and be blind to casual ones.
    it("eligibility reports the live ranked match so the client can disable the buttons", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: true });

      expect(await usecase.eligibility("A")).toEqual({ activeRankedMatchId: "existing" });
    });

    it("eligibility is clear when only casual matches are live", async () => {
      db.activeMatches.push({ playerId: "A", isRanked: false });

      expect(await usecase.eligibility("A")).toEqual({ activeRankedMatchId: null });
    });
  });
});
