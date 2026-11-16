import { describe, expect, it } from "vitest";
import type { MainAction } from "shared/schemas/action";
import type { DevAction } from "server/core/schemas/dev-action";
import { devActionToEvent, applyDevToolEvent } from "server/engine/events/handlers/dev-tool";
import { applyMainEventToMatch } from "server/engine/events/apply-event-to-match";
import type { MatchWrapper } from "server/engine/entities/match";
import { addUnit, createTestMatch, dispatchMainAction, property, tiles } from "../helpers/scenario";

/**
 * Dev tools, exercised through the real action → event → apply path.
 *
 * The pins are the part worth guarding: HP is written by three different mutators and `setHp(0)`
 * kills, so a pin that only covered the obvious setter would look like it worked right up until a
 * "locked" unit died.
 */

const CAPTURE: MainAction = { type: "move", path: [[0, 0]], subAction: { type: "ability" } };

/** Run a dev action the way the router will: validate → event → apply. */
const dispatchDevAction = (match: MatchWrapper, action: DevAction): void => {
  applyDevToolEvent(match, devActionToEvent(match, action, "tester-one"));
};

describe("dev tools — one-shot effects", () => {
  it("adds funds to the targeted player", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 500 }, { slot: 1 }],
    });

    dispatchDevAction(match, { type: "addFunds", playerSlot: 0, amount: 10_000 });

    expect(match.getPlayerBySlot(0)!.data.funds).toBe(10_500);
  });

  it("floors funds at zero rather than going negative", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 500 }, { slot: 1 }],
    });

    dispatchDevAction(match, { type: "addFunds", playerSlot: 0, amount: -9_000 });

    expect(match.getPlayerBySlot(0)!.data.funds).toBe(0);
  });

  it("refuses to target the neutral pseudo-player's slot", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });

    // -1 can't come from the schema (playerSlotForUnitsSchema is 0–7), but getPlayerBySlot(-1)
    // answers with the neutral player rather than undefined, so the handler guards it too.
    expect(() =>
      dispatchDevAction(match, {
        type: "addFunds",
        playerSlot: -1 as 0,
        amount: 100,
      }),
    ).toThrow(/No player in slot/);
  });

  it("fills the power meter to the CO's maximum when no amount is given", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const player = match.getPlayerBySlot(0)!;

    dispatchDevAction(match, { type: "chargePower", playerSlot: 0, amount: null });

    expect(player.data.powerMeter).toBe(player.getMaxPowerMeter());
    expect(player.data.powerMeter).toBeGreaterThan(0);
  });

  it("charges the meter even while a power is active", () => {
    // Regression guard: `gainPowerCharge` silently no-ops unless COPowerState is "no-power", which
    // is exactly the state a tester poking at powers is in. The tool must set the meter directly.
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true, COPowerState: "co-power" }, { slot: 1 }],
    });

    dispatchDevAction(match, { type: "chargePower", playerSlot: 0, amount: 1000 });

    expect(match.getPlayerBySlot(0)!.data.powerMeter).toBeGreaterThan(0);
  });

  it("clamps a charge above the CO's maximum", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const player = match.getPlayerBySlot(0)!;

    dispatchDevAction(match, { type: "chargePower", playerSlot: 0, amount: 999_999 });

    expect(player.data.powerMeter).toBe(player.getMaxPowerMeter());
  });

  it("teleports a unit, ignoring movement range and terrain", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchDevAction(match, { type: "teleportUnit", from: [0, 0], to: [2, 0] });

    expect(match.getUnit([0, 0])).toBeUndefined();
    expect(match.getUnit([2, 0])).toBeDefined();
  });

  it("refuses to teleport onto an occupied tile rather than silently joining", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);
    addUnit(match.getPlayerBySlot(0)!, "infantry", [1, 0]);

    expect(() =>
      dispatchDevAction(match, { type: "teleportUnit", from: [0, 0], to: [1, 0] }),
    ).toThrow(/already a unit at the destination/);
  });

  it("deletes an ENEMY unit — the normal delete action only reaches your own", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    addUnit(match.getPlayerBySlot(1)!, "tank", [0, 0]);

    dispatchDevAction(match, { type: "deleteAnyUnit", position: [0, 0] });

    expect(match.getUnit([0, 0])).toBeUndefined();
  });
});

describe("dev tools — HP lock", () => {
  const lockInfantryAt = (match: MatchWrapper, visualHp: number | null): void =>
    dispatchDevAction(match, { type: "setHpLock", playerSlot: 0, unitType: "infantry", visualHp });

  const matchWithInfantry = () => {
    const match = createTestMatch({
      tiles: [[tiles.plain(), tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const unit = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);
    return { match, unit };
  };

  it("sweeps units that already exist onto the pinned value", () => {
    const { match, unit } = matchWithInfantry();

    lockInfantryAt(match, 7);

    // The pin SETS as well as holds — "all inf are at 7HP" must cover units already on the board.
    expect(unit.getVisualHP()).toBe(7);
  });

  it("holds the pin against damage", () => {
    const { match, unit } = matchWithInfantry();
    lockInfantryAt(match, 7);

    unit.damageUntil1HP(5);

    expect(unit.getVisualHP()).toBe(7);
  });

  it("keeps a pinned unit alive when something sets its HP to zero", () => {
    // The load-bearing case: setHp(0) calls remove(), so guarding the value alone would still let a
    // "locked" unit be destroyed.
    const { match, unit } = matchWithInfantry();
    lockInfantryAt(match, 7);

    unit.setHp(0);

    expect(match.getUnit([0, 0])).toBeDefined();
    expect(unit.getVisualHP()).toBe(7);
  });

  it("holds the pin against healing too — it fixes HP in both directions", () => {
    const { match, unit } = matchWithInfantry();
    lockInfantryAt(match, 7);

    unit.heal(3);

    expect(unit.getVisualHP()).toBe(7);
  });

  it("only pins the locked TYPE, leaving other types damageable", () => {
    const { match } = matchWithInfantry();
    const tank = addUnit(match.getPlayerBySlot(0)!, "tank", [1, 0]);
    lockInfantryAt(match, 7);

    tank.damageUntil1HP(4);

    expect(tank.getVisualHP()).toBe(6);
  });

  it("only pins the targeted PLAYER's units", () => {
    const { match } = matchWithInfantry();
    const enemyInfantry = addUnit(match.getPlayerBySlot(1)!, "infantry", [1, 0]);
    lockInfantryAt(match, 7);

    enemyInfantry.damageUntil1HP(4);

    expect(enemyInfantry.getVisualHP()).toBe(6);
  });

  it("releases the unit when the lock is cleared", () => {
    const { match, unit } = matchWithInfantry();
    lockInfantryAt(match, 7);

    lockInfantryAt(match, null);
    unit.damageUntil1HP(2);

    expect(unit.getVisualHP()).toBe(5);
  });
});

describe("dev tools — fuel lock", () => {
  it("stops fuel draining for the pinned type", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const unit = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchDevAction(match, {
      type: "setFuelLock",
      playerSlot: 0,
      unitType: "infantry",
      fuel: 42,
    });
    unit.drainFuel(10);

    expect(unit.getFuel()).toBe(42);
  });
});

describe("dev tools — ammo lock", () => {
  it("holds the pinned ammo for a type that uses ammo", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    // A tank carries ammo (unlike infantry). Pin it low, then spend a shot — it must not drop.
    const tank = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0]);

    dispatchDevAction(match, { type: "setAmmoLock", playerSlot: 0, unitType: "tank", ammo: 3 });
    expect(tank.getAmmo()).toBe(3); // swept onto the pin immediately

    tank.useOneAmmo();
    expect(tank.getAmmo()).toBe(3); // and held against a normal decrement
  });

  it("releases the ammo when the lock is cleared", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const tank = addUnit(match.getPlayerBySlot(0)!, "tank", [0, 0]);

    dispatchDevAction(match, { type: "setAmmoLock", playerSlot: 0, unitType: "tank", ammo: 3 });
    dispatchDevAction(match, { type: "setAmmoLock", playerSlot: 0, unitType: "tank", ammo: null });
    tank.useOneAmmo();

    expect(tank.getAmmo()).toBe(2);
  });

  it("is a harmless no-op on a type that carries no ammo", () => {
    const match = createTestMatch({
      tiles: [[tiles.plain()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
    });
    const infantry = addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchDevAction(match, {
      type: "setAmmoLock",
      playerSlot: 0,
      unitType: "infantry",
      ammo: 5,
    });

    expect(infantry.getAmmo()).toBeNull();
  });
});

describe("dev tools — free production", () => {
  it("lets a broke player build, without driving funds negative", () => {
    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 0 }, { slot: 1 }],
    });

    dispatchDevAction(match, { type: "setFreeProduction", playerSlot: 0, enabled: true });
    dispatchMainAction(match, { type: "build", unitType: "infantry", position: [0, 0] });

    expect(match.getUnit([0, 0])).toBeDefined();
    // The funds check and the debit must agree: skipping only the check would go negative here.
    expect(match.getPlayerBySlot(0)!.data.funds).toBe(0);
  });

  it("pins units built AFTER the lock was set", () => {
    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 10_000 }, { slot: 1 }],
    });

    dispatchDevAction(match, {
      type: "setHpLock",
      playerSlot: 0,
      unitType: "infantry",
      visualHp: 3,
    });
    dispatchMainAction(match, { type: "build", unitType: "infantry", position: [0, 0] });

    expect(match.getUnit([0, 0])!.getVisualHP()).toBe(3);
  });

  it("still charges normally once free production is turned back off", () => {
    const match = createTestMatch({
      tiles: [[tiles.base(0)]],
      players: [{ slot: 0, hasCurrentTurn: true, funds: 10_000 }, { slot: 1 }],
    });

    dispatchDevAction(match, { type: "setFreeProduction", playerSlot: 0, enabled: true });
    dispatchDevAction(match, { type: "setFreeProduction", playerSlot: 0, enabled: false });
    dispatchMainAction(match, { type: "build", unitType: "infantry", position: [0, 0] });

    expect(match.getPlayerBySlot(0)!.data.funds).toBe(9_000);
  });
});

describe("dev tools — direct capture", () => {
  it("completes a capture in one action, like Sami's super power", () => {
    const match = createTestMatch({
      tiles: [[tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, [0, 0])],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchDevAction(match, { type: "setDirectCapture", playerSlot: 0, enabled: true });
    dispatchMainAction(match, CAPTURE);

    // Normally 20 points / 10 visual HP = two turns; direct capture flips it on the first.
    expect(match.getTile([0, 0])).toMatchObject({ playerSlot: 0 });
  });

  it("captures at a damaged unit's slow rate again once turned off", () => {
    const match = createTestMatch({
      tiles: [[tiles.road()]],
      players: [{ slot: 0, hasCurrentTurn: true }, { slot: 1 }],
      changeableTiles: [property("city", 1, [0, 0])],
    });
    addUnit(match.getPlayerBySlot(0)!, "infantry", [0, 0]);

    dispatchDevAction(match, { type: "setDirectCapture", playerSlot: 0, enabled: false });
    dispatchMainAction(match, CAPTURE);

    expect(match.getTile([0, 0])).toMatchObject({ playerSlot: 1 });
  });
});

describe("dev tools — event sourcing", () => {
  it("replays to the same state, so the log and the live match can't diverge", () => {
    // The whole reason dev tools are events rather than direct mutations.
    const build = (): MatchWrapper =>
      createTestMatch({
        tiles: [[tiles.plain(), tiles.plain()]],
        players: [{ slot: 0, hasCurrentTurn: true, funds: 100 }, { slot: 1 }],
      });

    const live = build();
    addUnit(live.getPlayerBySlot(0)!, "infantry", [0, 0]);

    const events = [
      devActionToEvent(live, { type: "addFunds", playerSlot: 0, amount: 5_000 }, "tester-one"),
      devActionToEvent(
        live,
        { type: "setHpLock", playerSlot: 0, unitType: "infantry", visualHp: 4 },
        "tester-one",
      ),
      devActionToEvent(live, { type: "teleportUnit", from: [0, 0], to: [1, 0] }, "tester-one"),
    ];

    events.forEach((event) => applyDevToolEvent(live, event));

    // Same events, fresh match — as the server does when rebuilding from the Event log on boot.
    const replayed = build();
    addUnit(replayed.getPlayerBySlot(0)!, "infantry", [0, 0]);
    events.forEach((event) => applyMainEventToMatch(replayed, event));

    expect(replayed.getPlayerBySlot(0)!.data.funds).toBe(live.getPlayerBySlot(0)!.data.funds);
    expect(replayed.getPlayerBySlot(0)!.data.devModifiers).toEqual(
      live.getPlayerBySlot(0)!.data.devModifiers,
    );
    expect(replayed.getUnit([1, 0])!.getVisualHP()).toBe(live.getUnit([1, 0])!.getVisualHP());
    expect(replayed.getUnit([0, 0])).toBeUndefined();
  });
});
