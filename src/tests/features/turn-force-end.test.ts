import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MatchActionUsecase } from "server/matches/match-action.usecase";
import type { RankingUsecase } from "server/ranking/ranking.usecase";
import type { EndgameUsecase } from "server/endgame/endgame.usecase";
import type { MatchStore } from "server/match-store";
import type { MatchWrapper } from "server/engine/entities/match";
import { bankOf } from "server/engine/rules/turn-clock";
import { createTestMatch, tiles } from "../helpers/scenario";

/**
 * Running out of time ends your turn through the SAME pipeline as pressing the button — validate →
 * apply → emit → persist. A forced end that skipped any of it would leave upkeep (weather, funds,
 * repair, fuel) subtly different depending on how the turn ended.
 */
const stubDeps = (match: MatchWrapper) => {
  const eventContents: { type: string }[] = [];
  const matchUpdates: { turnEndsAt?: Date | null }[] = [];
  const tx = {
    event: {
      aggregate: () => ({ _max: { index: null } }),
      create: ({ data }: { data: { content: { type: string } } }) => {
        eventContents.push(data.content);
      },
    },
    match: {
      update: ({ data }: { data: { turnEndsAt?: Date | null } }) => {
        matchUpdates.push(data);

        return {};
      },
    },
    matchPlayer: { updateMany: () => ({}) },
  };
  const db = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    match: { findMany: () => [] },
  } as unknown as PrismaClient;

  return {
    usecase: new MatchActionUsecase(
      db,
      { applyMatchResult: () => ({}) } as unknown as RankingUsecase,
      { persistStats: () => ({}) } as unknown as EndgameUsecase,
      { get: (id: string) => (id === match.id ? match : undefined) } as unknown as MatchStore,
    ),
    eventContents,
    matchUpdates,
  };
};

const clockedMatch = (): MatchWrapper =>
  createTestMatch({
    tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true },
      { slot: 1, id: "p1" },
    ],
    rules: { turnBankSeconds: 900, turnIncrementSeconds: 120 },
    turn: 3,
  });

describe("forced end of turn", () => {
  it("ends the turn as a real pass-turn event once the deadline has passed", async () => {
    const match = clockedMatch();
    const { usecase, eventContents } = stubDeps(match);

    match.turnEndsAt = Date.now() - 1_000;

    await usecase.forceEndTurn(match.id);

    expect(eventContents.map((e) => e.type)).toEqual(["passTurn"]);
    expect(match.getPlayerById("p1")?.data.hasCurrentTurn).toBe(true);
    // Flagged: nothing left, but the increment carries them into their next turn (see turn-clock).
    expect(bankOf(match.getPlayerById("p0")!)).toBe(0);
  });

  it("re-arms the deadline for the incoming player and persists it with the event", async () => {
    const match = clockedMatch();
    const { usecase, matchUpdates } = stubDeps(match);

    match.turnEndsAt = Date.now() - 1_000;

    await usecase.forceEndTurn(match.id);

    // p1 starts with the full bank + increment, so their deadline is ~17 minutes out.
    const persisted = matchUpdates.at(-1)?.turnEndsAt;

    expect(persisted).toBeInstanceOf(Date);
    expect(match.turnEndsAt).toBe(persisted!.getTime());
    expect(persisted!.getTime() - Date.now()).toBeGreaterThan(1_000_000);
  });

  it("ignores a stale firing whose deadline has since moved", async () => {
    const match = clockedMatch();
    const { usecase, eventContents } = stubDeps(match);

    // The player acted (or another path re-armed), pushing the deadline into the future.
    match.turnEndsAt = Date.now() + 60_000;

    await usecase.forceEndTurn(match.id);

    expect(eventContents).toEqual([]);
    expect(match.getPlayerById("p0")?.data.hasCurrentTurn).toBe(true);
  });

  it("does nothing for an unknown, finished, or untimed match", async () => {
    const match = clockedMatch();
    const { usecase, eventContents } = stubDeps(match);

    await usecase.forceEndTurn("no-such-match");

    match.turnEndsAt = Date.now() - 1_000;
    match.status = "finished";
    await usecase.forceEndTurn(match.id);

    match.status = "playing";
    match.turnEndsAt = null; // untimed
    await usecase.forceEndTurn(match.id);

    expect(eventContents).toEqual([]);
  });
});
