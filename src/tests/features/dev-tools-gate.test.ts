import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { Role } from "@prisma/client";
import { can, isConfinedToTestingMatches } from "server/auth/capabilities";
import type { GatedMatch } from "server/dev-tools/dev-tools-gate";

/**
 * The authorisation gate for tools that fabricate game state.
 *
 * Worth testing beyond its size because it is the whole safety story for a feature whose tools are
 * "give yourself funds" and "delete the enemy's units", and because the bug it replaces was exactly
 * a gate that looked present and wasn't (`token.userRole = "admin"` for every user).
 *
 * `dev-tools-gate` reads config at module load, so each ranked case re-imports it under a fresh
 * env via `vi.resetModules()` rather than mutating shared state.
 */

const loadGate = async () => {
  const gate = await import("server/dev-tools/dev-tools-gate");
  return gate.assertDevToolsAllowed;
};

const match = (over: Partial<GatedMatch> = {}): GatedMatch => ({
  isRanked: false,
  rules: { testingTools: false },
  ...over,
});

describe("capabilities", () => {
  it("admin passes every capability without holding the specific roles", () => {
    const roles: Role[] = ["admin"];

    expect(can(roles, "devTools")).toBe(true);
    expect(can(roles, "adminTools")).toBe(true);
    expect(can(roles, "moderationTools")).toBe(true);
  });

  it("moderator is orthogonal: it grants no power over game state", () => {
    const roles: Role[] = ["moderator"];

    expect(can(roles, "moderationTools")).toBe(true);
    expect(can(roles, "devTools")).toBe(false);
    expect(can(roles, "adminTools")).toBe(false);
  });

  it("dev and tester both reach devTools, but neither reaches adminTools", () => {
    expect(can(["dev"], "devTools")).toBe(true);
    expect(can(["tester"], "devTools")).toBe(true);
    expect(can(["dev"], "adminTools")).toBe(false);
    expect(can(["tester"], "adminTools")).toBe(false);
  });

  it("no roles grants nothing", () => {
    expect(can([], "devTools")).toBe(false);
    expect(can([], "adminTools")).toBe(false);
    expect(can([], "moderationTools")).toBe(false);
  });

  it("holding dev alongside tester lifts the confinement — the broader role wins", () => {
    expect(isConfinedToTestingMatches(["tester"])).toBe(true);
    expect(isConfinedToTestingMatches(["tester", "dev"])).toBe(false);
    expect(isConfinedToTestingMatches(["tester", "admin"])).toBe(false);
  });
});

describe("assertDevToolsAllowed", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.DEV_TOOLS_ALLOW_RANKED;
  });

  afterEach(() => {
    delete process.env.DEV_TOOLS_ALLOW_RANKED;
  });

  it("allows a dev in an ordinary unranked match", async () => {
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match(), ["dev"])).not.toThrow();
  });

  it("refuses a tester in a match that did not opt in", async () => {
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match(), ["tester"])).toThrow(/testing tools/i);
  });

  it("allows a tester once the match opted in", async () => {
    const assertDevToolsAllowed = await loadGate();

    expect(() =>
      assertDevToolsAllowed(match({ rules: { testingTools: true } }), ["tester"]),
    ).not.toThrow();
  });

  it("refuses even an admin in a ranked match by default", async () => {
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match({ isRanked: true }), ["admin"])).toThrow(/ranked/i);
  });

  it("refuses a ranked match that somehow has testingTools set — ranked is checked first", async () => {
    const assertDevToolsAllowed = await loadGate();

    expect(() =>
      assertDevToolsAllowed(match({ isRanked: true, rules: { testingTools: true } }), ["admin"]),
    ).toThrow(/ranked/i);
  });

  it("only the config override opens ranked — and it opens it for a plain dev too", async () => {
    process.env.DEV_TOOLS_ALLOW_RANKED = "true";
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match({ isRanked: true }), ["dev"])).not.toThrow();
  });

  it("the ranked override does not lift a tester's confinement — the gates are independent", async () => {
    process.env.DEV_TOOLS_ALLOW_RANKED = "true";
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match({ isRanked: true }), ["tester"])).toThrow(
      /testing tools/i,
    );
  });

  it('treats any value other than the literal "true" as off', async () => {
    process.env.DEV_TOOLS_ALLOW_RANKED = "false";
    const assertDevToolsAllowed = await loadGate();

    expect(() => assertDevToolsAllowed(match({ isRanked: true }), ["admin"])).toThrow(/ranked/i);
  });
});
