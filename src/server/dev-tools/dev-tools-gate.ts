import type { Role } from "@prisma/client";
import { devToolsConfig } from "server/core/config/dev-tools-config";
import { isConfinedToTestingMatches } from "server/auth/capabilities";
import { DispatchableError } from "server/engine/dispatchable-error";

/**
 * The match facts the gate needs.
 *
 * Structural rather than a `MatchWrapper`, so this is testable without building a whole match — and
 * so this feature doesn't import the engine.
 */
export type GatedMatch = {
  isRanked: boolean;
  /** `testingTools` is optional in the rules schema; absent means off. */
  rules: { testingTools?: boolean };
};

/**
 * Decides whether privileged game-state tools may run against THIS match.
 *
 * This is the *match* half of the gate; the caller's capability is the user half
 * (`requireCapability("devTools")` on the procedure). Both must pass — a dev is still refused in a
 * ranked match, and a tester is still refused in a match that didn't opt in.
 *
 * Order matters. Ranked is checked first and independently of role, so no privilege level can talk
 * its way past it; only the process-wide config can, and that is unreachable from a request.
 */
export const assertDevToolsAllowed = (match: GatedMatch, roles: readonly Role[]): void => {
  if (match.isRanked && !devToolsConfig.allowInRankedMatches) {
    throw new DispatchableError("Dev tools are disabled in ranked matches");
  }

  if (isConfinedToTestingMatches(roles) && match.rules.testingTools !== true) {
    throw new DispatchableError(
      "Dev tools are only available in a custom match that enabled testing tools",
    );
  }
};
