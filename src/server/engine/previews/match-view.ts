import { maskUnitForViewer } from "server/engine/entities/team";
import type { MatchWrapper } from "server/engine/entities/match";
import { fogViewChangeableTiles } from "server/engine/previews/fog-view";
import { deriveGameOver } from "server/engine/previews/game-over";
import { buildPublicPowerSummary } from "server/engine/previews/turn-snapshot";

/**
 * The full board view for one viewer — the fog-projected, vision-masked snapshot the client renders
 * on load/refetch. Pure engine derivation (no I/O): given the live match and who's looking, it
 * decides which units/tiles are visible, masks concealed HP, nulls opponents' funds under fog, and
 * derives the game-over state. The transport layer just returns this.
 */
export const buildMatchFullView = (match: MatchWrapper, currentPlayerId: string) => {
  const fogOfWar = match.isFogOfWar();
  const viewerTeam = match.getPlayerById(currentPlayerId)?.team;

  // Only send units the viewer can actually see. `canSeeUnitAtPosition` is the single engine rule
  // for both modes: fog off → every non-concealed unit is visible (a concealed sub/stealth only to
  // its owner or an adjacent enemy); fog on → additionally gated by the team's tile vision. A
  // spectator has no team, so it sees the non-fog view minus concealed units.
  const visibleUnits = match.units.filter((unit) =>
    viewerTeam === undefined
      ? !("hidden" in unit.data && unit.data.hidden)
      : viewerTeam.canSeeUnitAtPosition(unit.data.position),
  );

  // Under fog, the tiles the viewer currently has vision of — the client darkens the rest. Empty
  // when fog is off (no overlay) or for a spectator (no team vision to expose).
  const visibleTiles: [number, number][] = [];

  if (fogOfWar && viewerTeam !== undefined) {
    for (let y = 0; y < match.map.height; y++) {
      for (let x = 0; x < match.map.width; x++) {
        if (viewerTeam.isPositionVisible([x, y])) {
          visibleTiles.push([x, y]);
        }
      }
    }
  }

  // Match outcome, DERIVED from the engine's elimination status (see deriveGameOver). We don't flip
  // match.status to "finished" here — that's a separate persistence concern (the passTurn TODO) —
  // this just lets the client show a game-over screen.
  const gameOver = deriveGameOver(match, viewerTeam);

  return {
    id: match.id,
    mode: match.mode,
    ruleset: match.ruleset,
    // Fog-projected: fogged properties show their last-known owner, not the live one, so a capture
    // out of the viewer's vision doesn't leak through this full-board refetch (see fogViewChangeableTiles).
    changeableTiles: fogViewChangeableTiles(match, viewerTeam),
    currentWeather: match.getCurrentWeather(),
    map: match.map.data,
    // Every player's public state + a fog-safe CO-power summary (meter/stars) so the HUD can show
    // each army's charge. Power charge is public in AW. Funds are public too — EXCEPT under fog,
    // where an opponent's exact treasury is secret: we null it on the wire (not just in the HUD) so
    // it can't be read from the payload. The viewer always sees their own funds.
    players: match.getAllPlayers().map((player) => ({
      ...player.data,
      funds: !fogOfWar || player.data.id === currentPlayerId ? player.data.funds : null,
      power: buildPublicPowerSummary(player),
    })),
    rules: match.rules,
    status: match.status,
    turn: match.turn,
    // Sonja hides her units' HP/fuel/ammo from opponents even without fog; mask enemy Sonja units
    // here (own team sees them unchanged) so the board never renders her true HP. See maskUnitForViewer.
    units: visibleUnits.map((u) => maskUnitForViewer(u, viewerTeam ?? null)),
    fogOfWar,
    visibleTiles,
    gameOver,
  };
};
