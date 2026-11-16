import { describe, expect, it } from "vitest";
import {
  EG_HEARTBEAT_TTL_MS,
  egChatWritable,
  egPresentPlayers,
  markEgPresent,
} from "server/adapters/eg-presence";

// Each test uses its own matchId so the module-level registry stays isolated between cases, and an
// explicit `now` so the TTL window is deterministic (no wall-clock).
describe("eg-presence", () => {
  it("marks a participant present and reports the chat writable within the TTL", () => {
    const t0 = 1_000_000;
    markEgPresent("m-present", "p1", t0);

    expect(egPresentPlayers("m-present", t0 + 5_000)).toEqual(["p1"]);
    expect(egChatWritable("m-present", t0 + 5_000)).toBe(true);
  });

  it("drains to read-only once every heartbeat has lapsed", () => {
    const t0 = 2_000_000;
    markEgPresent("m-drain", "p1", t0);

    const afterTtl = t0 + EG_HEARTBEAT_TTL_MS + 1;

    expect(egChatWritable("m-drain", afterTtl)).toBe(false);
    expect(egPresentPlayers("m-drain", afterTtl)).toEqual([]);
  });

  it("stays writable while one participant is still present as another lapses", () => {
    const t0 = 3_000_000;
    markEgPresent("m-mixed", "p1", t0);
    // p2 beats later, so its window outlives p1's.
    markEgPresent("m-mixed", "p2", t0 + 15_000);

    const whenP1Lapsed = t0 + EG_HEARTBEAT_TTL_MS + 1; // past p1's window, inside p2's

    expect(egChatWritable("m-mixed", whenP1Lapsed)).toBe(true);
    expect(egPresentPlayers("m-mixed", whenP1Lapsed)).toEqual(["p2"]);
  });

  it("refreshes a player's window on re-beat", () => {
    const t0 = 4_000_000;
    markEgPresent("m-refresh", "p1", t0);
    markEgPresent("m-refresh", "p1", t0 + 15_000); // re-beat before lapse extends the window

    // Would have lapsed under the first beat, still alive under the second.
    expect(egChatWritable("m-refresh", t0 + EG_HEARTBEAT_TTL_MS + 1)).toBe(true);
  });

  it("reports an untracked match as empty and read-only", () => {
    expect(egPresentPlayers("m-unknown", 5_000_000)).toEqual([]);
    expect(egChatWritable("m-unknown", 5_000_000)).toBe(false);
  });
});
