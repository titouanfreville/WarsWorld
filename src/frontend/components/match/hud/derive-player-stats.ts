import type { MatchPlayer, MatchView } from "frontend/components/match/match-view";

/**
 * Battlefield stats for one army, derived from the authoritative `match.full` view — the single,
 * fog-respecting source the HUD and the intel overlay both render. Pure (no React, no network) so it
 * unit-tests directly. The fog rules mirror Advance Wars:
 *
 * - **funds**: public outside fog of war — every army's treasury is known when the match isn't
 *   fogged. Under fog an opponent's funds are hidden (`null`); the viewer always sees their own.
 *   (`match.full` ships enemy funds on the wire; we gate them here so a fog match never leaks them.)
 * - **unitCount**: units of that army the viewer can actually SEE. `match.full` already fog-filters
 *   `units`, so an enemy's count is its visible units only (fogged units aren't counted or leaked).
 * - **propertyCount**: capturable tiles that army owns (public — property control isn't fogged).
 */
export type PlayerBattleStats = {
  isSelf: boolean;
  /** Army's funds; `null` only for opponents in a fog-of-war match (own funds are always known). */
  funds: number | null;
  /** Units of this army currently visible to the viewer (own army = all its units). */
  unitCount: number;
  /** Properties (capturable tiles) this army holds. */
  propertyCount: number;
};

export const derivePlayerStats = (
  view: MatchView,
  player: MatchPlayer,
  viewerPlayerId: string,
): PlayerBattleStats => {
  const isSelf = player.id === viewerPlayerId;

  const unitCount = view.units.filter((unit) => unit.playerSlot === player.slot).length;

  const propertyCount = view.changeableTiles.filter(
    (tile) => "playerSlot" in tile && tile.playerSlot === player.slot,
  ).length;

  return {
    isSelf,
    // Funds are public unless the match is fogged; then only the viewer sees their own.
    funds: isSelf || !view.fogOfWar ? player.funds : null,
    unitCount,
    propertyCount,
  };
};
