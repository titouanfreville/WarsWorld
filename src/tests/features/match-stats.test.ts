import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import { createMatchStartEvent } from "server/engine/events/handlers/match-start";
import type { MainAction } from "shared/schemas/action";
import type { MainEventWithSubEvents } from "server/engine/types/events";
import { describe, expect, it } from "vitest";
import { buildMatchStats } from "server/routers/match/match-stats";
import { addUnit, createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";

/**
 * `buildMatchStats` re-derives end-game stats by replaying the event log on a FRESH seed. We drive a
 * short game through the real engine pipeline on one match to collect a valid event sequence, then
 * feed that same sequence to a second, identical seed and assert the aggregated series + counters.
 */
const scenario = () =>
  createTestMatch({
    tiles: [
      [tiles.hq(0), tiles.base(0), tiles.city(0)],
      [tiles.hq(1), tiles.base(1), tiles.plain()],
    ],
    changeableTiles: [
      property("hq", 0, [0, 0]),
      property("base", 0, [1, 0]),
      property("city", 0, [2, 0]),
      property("hq", 1, [0, 1]),
      property("base", 1, [1, 1]),
    ],
    players: [
      { slot: 0, id: "p0", hasCurrentTurn: true, funds: 10000 },
      { slot: 1, id: "p1", funds: 10000 },
    ],
  });

describe("buildMatchStats", () => {
  it("replays the log into per-turn series + build/power counters", () => {
    const live = scenario();
    const events: MainEventWithSubEvents[] = [];

    // matchStart isn't a dispatchable action; apply it directly and record it so the replay matches.
    const start = createMatchStartEvent(live);
    applyMainEventToMatch(live, start);
    events.push(start);

    // p0 builds an infantry on its base, then both players pass a turn.
    events.push(
      dispatchMainAction(live, {
        type: "build",
        unitType: "infantry",
        position: [1, 0],
      }) as MainEventWithSubEvents,
    );
    events.push(dispatchMainAction(live, { type: "passTurn" }) as MainEventWithSubEvents);
    events.push(dispatchMainAction(live, { type: "passTurn" }) as MainEventWithSubEvents);

    const stats = buildMatchStats(scenario(), events);

    // One build by p0, none by p1; no powers used.
    const p0Built = stats.players.find((p) => p.playerId === "p0")!;
    expect(p0Built.built).toBe(1);
    expect(stats.players.find((p) => p.playerId === "p1")?.built).toBe(0);
    expect(stats.players.every((p) => p.powersUsed === 0)).toBe(true);

    // Built by domain + per-unit + production spend (infantry, cost 1000) and income (conservation).
    expect(p0Built.builtByDomain.infantry).toBe(1);
    expect(p0Built.builtByUnit.infantry).toBe(1);
    expect(p0Built.producedFunds).toBe(1000);
    expect(p0Built.incomeEarned).toBeGreaterThan(0);

    // A snapshot per passTurn boundary, stamped with an incrementing turn number (the engine does
    // NOT maintain match.turn — the aggregator counts player-turns itself).
    expect(stats.timeline).toHaveLength(2);
    expect(stats.timeline.map((row) => row.turn)).toEqual([1, 2]);
    expect(stats.turns).toBe(2);

    // p0 owns 3 funds-giving properties + built a unit, so it shows income + army value on field.
    const p0Row = stats.timeline[0].perPlayer.find((p) => p.playerId === "p0");
    expect(p0Row?.income).toBeGreaterThan(0);
    expect(p0Row?.armyValue).toBeGreaterThan(0);
    expect(p0Row?.properties).toBeGreaterThanOrEqual(3);
  });

  it("credits property-repair healing (= repair spend) via HP-diff", () => {
    const damagedInfantry = { stats: { fuel: 50, hp: 50 } } as const;

    const live = scenario();
    // p0 parks a damaged infantry on its own city — a repair facility for foot units.
    addUnit(live.getPlayerBySlot(0)!, "infantry", [2, 0], damagedInfantry);

    const events: MainEventWithSubEvents[] = [];
    const start = createMatchStartEvent(live);
    applyMainEventToMatch(live, start);
    events.push(start);
    events.push(dispatchMainAction(live, { type: "passTurn" }) as MainEventWithSubEvents); // p0 → p1
    events.push(dispatchMainAction(live, { type: "passTurn" }) as MainEventWithSubEvents); // p1 → p0 heals

    const fresh = scenario();
    addUnit(fresh.getPlayerBySlot(0)!, "infantry", [2, 0], damagedInfantry);
    const stats = buildMatchStats(fresh, events);

    const p0 = stats.players.find((p) => p.playerId === "p0");
    // Infantry (cost 1000) heals 2 visual HP on its city → 2 × 1000/10 = 200 funds of value (= spend).
    expect(p0?.healedByProperty).toBe(200);
    expect(p0?.healedByPower).toBe(0);
    expect(p0?.crashed).toBe(0);
  });

  it("credits combat damage, kills and losses from attacks", () => {
    const build = () => {
      const m = createTestMatch({
        tiles: [[tiles.road(), tiles.road()]],
        players: [
          { slot: 0, id: "p0", hasCurrentTurn: true, funds: 0 },
          { slot: 1, id: "p1", funds: 0 },
        ],
      });
      addUnit(m.getPlayerBySlot(0)!, "tank", [0, 0]);
      addUnit(m.getPlayerBySlot(1)!, "infantry", [1, 0], { stats: { fuel: 50, hp: 10 } });
      return m;
    };

    const attack: MainAction = {
      type: "move",
      path: [[0, 0]],
      subAction: { type: "attack", defenderPosition: [1, 0] },
    };

    const live = build();
    const events: MainEventWithSubEvents[] = [];
    const start = createMatchStartEvent(live);
    applyMainEventToMatch(live, start);
    events.push(start);
    events.push(dispatchMainAction(live, attack) as MainEventWithSubEvents);

    const stats = buildMatchStats(build(), events);
    const p0 = stats.players.find((p) => p.playerId === "p0")!;
    const p1 = stats.players.find((p) => p.playerId === "p1")!;

    // Infantry (cost 1000) at 1 visual HP is destroyed → 1 × 1000/10 = 100 funds, direct, vehicle-dealt.
    expect(p0.damageDealt).toBe(100);
    expect(p0.damageDirect).toBe(100);
    expect(p0.damageIndirect).toBe(0);
    expect(p0.damageByDomain.vehicle).toBe(100);
    expect(p0.damageByUnit.tank).toBe(100); // dealt by the tank
    expect(p0.unitsKilled).toBe(1);
    expect(p1.unitsLost).toBe(1);
    expect(p1.lostByDomain.infantry).toBe(1); // the lost unit classed by its domain
    expect(p1.lostByUnit.infantry).toBe(1); // …and by its unit type
    expect(p1.damageDealt).toBe(0); // destroyed before it could counter
    expect(p1.damageTaken).toBe(100); // the 100 funds p0 dealt is p1's loss
    expect(p0.damageTaken).toBe(0);
  });

  it("logs captures when a property changes owner", () => {
    const build = () => {
      const m = createTestMatch({
        tiles: [[tiles.road()]],
        players: [
          { slot: 0, id: "p0", hasCurrentTurn: true },
          { slot: 1, id: "p1" },
        ],
        changeableTiles: [property("city", 1, [0, 0])],
      });
      addUnit(m.getPlayerBySlot(0)!, "infantry", [0, 0], { stats: { fuel: 99, hp: 100 } });
      return m;
    };

    const capture: MainAction = { type: "move", path: [[0, 0]], subAction: { type: "ability" } };
    const pass: MainAction = { type: "passTurn" };

    const live = build();
    const events: MainEventWithSubEvents[] = [];
    const start = createMatchStartEvent(live);
    applyMainEventToMatch(live, start);
    events.push(start);
    events.push(dispatchMainAction(live, capture) as MainEventWithSubEvents); // 20 → 10, still p1
    events.push(dispatchMainAction(live, pass) as MainEventWithSubEvents);
    events.push(dispatchMainAction(live, pass) as MainEventWithSubEvents);
    events.push(dispatchMainAction(live, capture) as MainEventWithSubEvents); // 10 → 0, flips to p0

    const stats = buildMatchStats(build(), events);
    const p0 = stats.players.find((p) => p.playerId === "p0")!;

    expect(p0.captures).toBe(1);
    expect(stats.captureLog).toHaveLength(1);
    expect(stats.captureLog[0]).toMatchObject({ playerId: "p0", property: "city" });
    // The flip happens on p0's second turn (after two passTurns), stamped with a real turn number.
    expect(stats.captureLog[0].turn).toBe(3);
  });
});
