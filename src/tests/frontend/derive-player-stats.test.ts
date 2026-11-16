import { describe, expect, it } from "vitest";
import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";
import { derivePlayerStats } from "frontend/components/match/hud/derive-player-stats";

// Minimal fixtures cast past the large inferred wire types (same approach as the other FE tests).
const player = (over: Partial<MatchPlayer> = {}): MatchPlayer =>
  ({ id: "me", slot: 0, funds: 12400, army: "orange-star", ...over }) as unknown as MatchPlayer;

const view = (over: Partial<MatchView> = {}): MatchView =>
  ({
    units: [],
    changeableTiles: [],
    players: [],
    fogOfWar: false,
    ...over,
  }) as unknown as MatchView;

const unitAt = (slot: number) => ({ playerSlot: slot }) as MatchView["units"][number];
const propAt = (slot: number) =>
  ({ type: "city", playerSlot: slot, position: [0, 0] }) as MatchView["changeableTiles"][number];

describe("derivePlayerStats (fog-respecting HUD readout)", () => {
  it("shows the viewer's own funds and marks them as self", () => {
    const me = player({ id: "me", slot: 0, funds: 12400 });
    const stats = derivePlayerStats(view({ players: [me] }), me, "me");

    expect(stats.isSelf).toBe(true);
    expect(stats.funds).toBe(12400);
  });

  it("shows an opponent's funds outside fog of war (public treasury)", () => {
    const enemy = player({ id: "enemy", slot: 1, funds: 99999 });
    const stats = derivePlayerStats(view({ players: [enemy], fogOfWar: false }), enemy, "me");

    expect(stats.isSelf).toBe(false);
    expect(stats.funds).toBe(99999);
  });

  it("hides an opponent's funds (null) in a fog-of-war match, never leaking them", () => {
    const enemy = player({ id: "enemy", slot: 1, funds: 99999 });
    const stats = derivePlayerStats(view({ players: [enemy], fogOfWar: true }), enemy, "me");

    expect(stats.isSelf).toBe(false);
    expect(stats.funds).toBeNull();
  });

  it("counts units of that army — enemy counts reflect only VISIBLE units in the fog-filtered view", () => {
    // `match.full` already drops fog-hidden units, so an enemy's fogged unit simply isn't present.
    const v = view({ units: [unitAt(0), unitAt(0), unitAt(1)] });

    expect(derivePlayerStats(v, player({ slot: 0 }), "me").unitCount).toBe(2);
    expect(derivePlayerStats(v, player({ id: "e", slot: 1 }), "me").unitCount).toBe(1);
  });

  it("counts owned properties and ignores non-property changeable tiles (silo/pipe have no slot)", () => {
    const v = view({
      changeableTiles: [
        propAt(0),
        propAt(0),
        propAt(1),
        {
          type: "unusedSilo",
          fired: false,
          position: [1, 1],
        } as MatchView["changeableTiles"][number],
      ],
    });

    expect(derivePlayerStats(v, player({ slot: 0 }), "me").propertyCount).toBe(2);
    expect(derivePlayerStats(v, player({ id: "e", slot: 1 }), "me").propertyCount).toBe(1);
  });
});
