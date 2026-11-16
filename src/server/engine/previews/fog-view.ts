import type { ChangeableTile } from "server/core/schemas/tile-state";
import type { MatchWrapper } from "server/engine/entities/match";
import type { TeamWrapper } from "server/engine/entities/team";

/**
 * Fog-project the match's changeable tiles for one viewer.
 *
 * Property ownership is fog-sensitive: a property is always drawn (it's terrain), so a tile the
 * viewer can't currently see must show its LAST-KNOWN owner. If we sent the live owner instead, a
 * capture happening outside the viewer's vision would leak through `match.full` — the board refetches
 * it on every event, so the (correctly fogged) live delta is bypassed by the full snapshot.
 *
 * - Silos / pipe-seams carry no owner → passthrough.
 * - Fog off, or a spectator (no team) → live tiles unchanged (spectator fog is a separate known gap).
 * - Currently visible → record the true owner as the team's last-known owner, and send the truth.
 * - Fogged → send the last owner this team saw, defaulting to the map's INITIAL owner for a property
 *   the team has never had vision of (so a capture that happened before they ever saw it stays hidden).
 *
 * Captures the team WITNESSED (its own property being taken; a neutral flipping next to a scout) are
 * recorded at capture time by `MatchWrapper.rememberPropertyOwnerForWatchers`, so they persist even
 * after the tile leaves vision. This function's own recording additionally covers plain exploration:
 * moving into vision of an already-captured tile updates the last-known owner on the next fetch.
 *
 * Side effect: records last-known owners on `viewerTeam` for every property it can currently see —
 * which is why it takes the live team wrapper, not a snapshot.
 */
export function fogViewChangeableTiles(
  match: MatchWrapper,
  viewerTeam: TeamWrapper | undefined,
): ChangeableTile[] {
  if (!match.isFogOfWar() || viewerTeam === undefined) {
    return match.changeableTiles;
  }

  return match.changeableTiles.map((tile) => {
    // Only properties have an owner; silos and pipe-seams are ownerless terrain.
    if (!("playerSlot" in tile)) {
      return tile;
    }

    if (viewerTeam.isPositionVisible(tile.position)) {
      viewerTeam.rememberPropertyOwner(tile.position, tile.playerSlot);
      return tile;
    }

    const [x, y] = tile.position;
    const mapTile = match.map.data.tiles[y][x];
    // The static map tile is the match-start ownership (changeableTiles are built from it), so it's
    // the correct "never seen" fallback. Non-property map tiles can't underlie a property → neutral.
    const initialOwner = "playerSlot" in mapTile ? mapTile.playerSlot : -1;

    return {
      ...tile,
      playerSlot: viewerTeam.getLastKnownPropertyOwner(tile.position) ?? initialOwner,
    };
  });
}
