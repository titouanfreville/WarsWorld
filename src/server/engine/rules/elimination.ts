import type { MatchWrapper } from "server/engine/entities/match";
import type { PlayerInMatchWrapper } from "server/engine/entities/player-in-match";

/**
 * What happens to a player's HOLDINGS when they leave the match.
 *
 * There are four ways out — HQ/lab captured, routed by attack, routed at a turn boundary, resigned —
 * and until now only the capture path did anything about the board. The other three flipped
 * `data.status` and left the player's whole property empire sitting there under their slot forever:
 * uncapturable in practice, producing nothing, and still counted as theirs. At the day limit that
 * abandoned empire could be scored — and win — for a team that had been dead since day 12.
 *
 * So all four paths come through here, and the board ends up in the same shape no matter how someone
 * died. Canon Advance Wars:
 *
 * - **Captured** (`inheritorSlot` given): the capturer inherits everything. Losing your HQ hands your
 *   whole economy to whoever took it — the swing that makes an HQ rush worth attempting.
 * - **Routed or resigned** (`inheritorSlot` null): the properties go NEUTRAL. There is no capturer to
 *   reward — a player can rout to attrition from three opponents at once, or simply concede — so
 *   handing the windfall to anyone would be arbitrary. Back on the board as neutral, they are
 *   contestable again, which is the outcome that keeps a long game moving.
 *
 * In both cases the HQ stops being an HQ and becomes a city. It is no longer anyone's headquarters,
 * and leaving it as one would let its new owner hold two — or, worse, leave a capturable HQ belonging
 * to a player who is already out, a second elimination waiting to fire on a corpse.
 */
export const releaseHoldings = (
  match: MatchWrapper,
  player: PlayerInMatchWrapper,
  inheritorSlot: number | null,
): void => {
  const previousOwnerVision = player.team.vision;
  const newOwnerVision =
    inheritorSlot === null ? undefined : match.getPlayerBySlot(inheritorSlot)?.team.vision;
  const newSlot = inheritorSlot ?? -1;

  for (const tile of match.changeableTiles) {
    if (!("playerSlot" in tile) || !player.owns(tile)) {
      continue;
    }

    // Everyone watching the tile as it changes hands learns its new owner (fog last-known); the
    // losing player always sees their own property flip. Must run BEFORE removeOwnedProperty, while
    // the previous owner still has vision of it.
    match.rememberPropertyOwnerForWatchers(tile.position, newSlot);
    // Hand the property's fog vision over with its ownership: drop it from the eliminated player's
    // team (so a surviving teammate can't keep seeing it) and grant it to the new owner. Without
    // this the next recalculateVision() would rebuild the OLD owner's sight of transferred tiles.
    previousOwnerVision?.removeOwnedProperty(tile.position);

    if (tile.type === "hq") {
      tile.type = "city";
    }

    tile.playerSlot = newSlot;

    // A neutral property is nobody's, so nobody gains vision of it.
    if (inheritorSlot !== null) {
      newOwnerVision?.addOwnedProperty(tile.position);
    }
  }
};
