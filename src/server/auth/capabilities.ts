import type { Role } from "@prisma/client";

/**
 * What a privileged caller is allowed to do. Capabilities — not roles — are what call sites check,
 * so the role→power mapping stays in this file only.
 */
export type Capability =
  /** fabricate game state in a match: funds, power, teleports, deletions… */
  | "devTools"
  /** account/ladder/match administration: modify rank, force a match, force an outcome */
  | "adminTools"
  /** content & social moderation. Deliberately grants NO power over game state. */
  | "moderationTools";

/**
 * Roles that grant each capability, EXCLUDING `admin` — which passes everything via `can`.
 *
 * `tester` grants `devTools` here, but that is only half the check: a tester is additionally
 * confined to a custom match that opted into testing tools. That second half is a property of the
 * *match*, not of the user, so it lives in the dev-tools usecase (see `assertDevToolsAllowed`) and
 * cannot be expressed in this table.
 */
const GRANTS: Record<Capability, readonly Role[]> = {
  devTools: ["dev", "tester"],
  adminTools: [],
  moderationTools: ["moderator"],
};

/**
 * `admin` short-circuits every capability — the only implication between roles. Notably `moderator`
 * is orthogonal: a moderator moderates content and has no power over game state.
 */
export const can = (roles: readonly Role[], capability: Capability): boolean =>
  roles.includes("admin") || GRANTS[capability].some((role) => roles.includes(role));

/**
 * True when the caller's dev-tool reach is limited to matches that opted in (`testingTools`).
 *
 * A tester is confined; a dev or admin is not. Someone holding both `tester` and `dev` is not
 * confined — the broader role wins, which is why this asks "is dev/admin absent" rather than "is
 * tester present".
 */
export const isConfinedToTestingMatches = (roles: readonly Role[]): boolean =>
  !roles.includes("admin") && !roles.includes("dev");
