/**
 * How much board animation the viewer wants, AWDS-style. Mirrors the `animations` player preference
 * (see server/players/schemas.ts) as an FE-local type — the BE re-validates the value on save, so
 * drift between the two shows up as a tsc error at the settings mutation rather than at runtime.
 *
 * Scope is deliberately narrow: this gates the one-shot flourishes (fuel-out crashes, the
 * start-of-turn upkeep motes) — the decorative beats a player might want to skip on a fast game. It
 * does NOT gate the persistent badges (HP, capture, low fuel/ammo): those are information, and
 * hiding them would change what the player knows rather than how long they wait.
 */
export type AnimationScope = "all" | "own" | "none";

const SCOPES: readonly AnimationScope[] = ["all", "own", "none"];

/**
 * The viewer's setting, defaulting to "all" — an unset preference (or a value written by an older
 * client) means the player never opted out, so they get the full show.
 */
export const readAnimationScope = (preferences: unknown): AnimationScope => {
  const value = (preferences as { animations?: unknown } | null | undefined)?.animations;

  return SCOPES.find((scope) => scope === value) ?? "all";
};

/**
 * Whether a flourish belonging to `ownerPlayerId` should play for `viewerPlayerId`.
 *
 * `own` keys off who the animation is ABOUT, not who is on turn — a fuel-out crash is reported with
 * the army it happened to, so "only mine" correctly shows your own units going down and stays quiet
 * for the opponent's.
 */
export const shouldAnimate = (
  scope: AnimationScope,
  ownerPlayerId: string,
  viewerPlayerId: string,
): boolean => {
  if (scope === "none") {
    return false;
  }

  return scope === "all" || ownerPlayerId === viewerPlayerId;
};
