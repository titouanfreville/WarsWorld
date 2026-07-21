import { maskUnitForViewer } from "server/engine/entities/team";
import type { MatchWrapper } from "server/engine/entities/match";
import { fogViewChangeableTiles } from "server/engine/previews/fog-view";
import { deriveGameOver } from "server/engine/previews/game-over";
import { buildPublicPowerSummary } from "server/engine/previews/turn-snapshot";
import { bankOf } from "server/engine/rules/turn-clock";

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
      // Turn clock, public for BOTH players — how long your opponent has left is part of playing a
      // timed game, and hiding it would only make the pressure invisible. Null in an untimed match.
      timeBankMs: bankOf(player),
    })),
    rules: match.rules,
    status: match.status,
    turn: match.turn,
    // When the current turn runs out, as an epoch ms the client counts down from. The SERVER decides
    // what happens at zero (it force-ends the turn); this is only what the clock displays, so a
    // client with a skewed or paused clock can't buy or lose time. Null in an untimed match.
    turnEndsAt: match.turnEndsAt,
    // Per-viewer masked units (see maskUnitForViewer, the single rule): Sonja hides her units'
    // HP/fuel/ammo from opponents even without fog, and under fog an enemy's cargo and consumables are
    // secret too (its HP is not — a unit you can see, you can read). Each unit also carries `supply`,
    // the engine-derived low-fuel/low-ammo flag the board badges from, null wherever the consumables
    // behind it are masked. Own units pass through unchanged.
    units: visibleUnits.map((u) => maskUnitForViewer(u, viewerTeam ?? null)),
    fogOfWar,
    visibleTiles,
    gameOver,
    // Start-of-turn summary (day + repaired/refuelled/crashed units) — only handed to the player whose
    // turn it actually is, and only about their own (always-visible) units, so it leaks nothing under
    // fog. The client plays the start-round animation from it; null otherwise. See turnStartReport.
    turnStart: match.turnStartReport?.playerId === currentPlayerId ? match.turnStartReport : null,
    // Fuel-out crashes from the latest upkeep — sent to BOTH viewers, unlike `turnStart` above, because
    // a unit going down is public in AW and the opponent should see it happen rather than notice it
    // missing. Under fog, masked to tiles this viewer can currently see, so a crash never reveals a
    // unit whose position was secret. That filter is self-correcting: vision is recalculated after the
    // units are removed, so one that was the only source of vision on its own tile drops itself.
    crashes:
      match.turnStartReport === null
        ? null
        : {
            day: match.turnStartReport.day,
            // Whose units went down — lets the client honour an "own units only" animation preference.
            playerId: match.turnStartReport.playerId,
            positions:
              fogOfWar && viewerTeam !== undefined
                ? match.turnStartReport.crashed.filter((position) =>
                    viewerTeam.isPositionVisible(position),
                  )
                : match.turnStartReport.crashed,
          },
    // The latest CO-power activation — sent to BOTH viewers (power activation is public in AW) so the
    // opponent also sees the cinematic. The affected UNITS can leak hidden info, so they're fog-masked
    // to tiles this viewer can see; under fog off / no team, all pass through.
    powerActivation:
      match.powerActivationReport === null
        ? null
        : {
            ...match.powerActivationReport,
            affectedUnits:
              fogOfWar && viewerTeam !== undefined
                ? match.powerActivationReport.affectedUnits.filter((affected) =>
                    viewerTeam.isPositionVisible(affected.position),
                  )
                : match.powerActivationReport.affectedUnits,
            signature:
              match.powerActivationReport.signature === null ||
              !(fogOfWar && viewerTeam !== undefined)
                ? match.powerActivationReport.signature
                : {
                    ...match.powerActivationReport.signature,
                    epicenters: match.powerActivationReport.signature.epicenters.filter(
                      (epicenter) => viewerTeam.isPositionVisible(epicenter),
                    ),
                  },
          },
  };
};
