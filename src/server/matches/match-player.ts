import type { MatchPlayer } from "@prisma/client";
import { INITIAL_FUNDS } from "server/engine/constants/funds";
import type { Army } from "server/core/schemas/army";
import type { COID } from "server/core/schemas/co";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";

/**
 * v2 relational membership joined with the owning player's identity. This is the shape the hydration
 * and spawn paths work with (a bare `MatchPlayer` row has no player name).
 */
export type MatchPlayerRow = MatchPlayer & { player: { id: string; name: string } };

/**
 * Placeholder general for a seat that hasn't locked a CO yet (during the `setup`/picker round the
 * `MatchPlayer.coId` column is null). The engine wrapper needs *a* COID to exist; the real pick is
 * written onto the wrapper at lock/reveal, and by the time a match is `playing` every seat has one.
 */
const PLACEHOLDER_CO: COID = { name: "andy", version: "AW2" };

/**
 * Build the engine's runtime `PlayerInMatch` seed from a relational `MatchPlayer` row (the v2 path),
 * mirroring what the v1 create flow writes into `playerState`. Volatile fields (funds beyond the
 * initial grant, power meter, turn) are re-derived by replaying the event log on top of this seed —
 * so day-1 income must NOT be baked in here (see applyMatchStartEvent).
 */
export const matchPlayerToRuntime = (row: MatchPlayerRow): PlayerInMatch => ({
  slot: row.slot,
  // Slot 0 opens the game; passTurn events move the turn from there on replay.
  hasCurrentTurn: row.slot === 0,
  id: row.playerId,
  name: row.player.name,
  ready: row.ready,
  coId: row.coId ?? PLACEHOLDER_CO,
  status: "alive",
  result: (row.result as PlayerInMatch["result"]) ?? undefined,
  funds: INITIAL_FUNDS,
  powerMeter: 0,
  timesPowerUsed: 0,
  army: row.army as Army,
  COPowerState: "no-power",
});

/**
 * `team` on `MatchPlayer` is authoritative; the engine wrapper still reads teams via
 * `rules.teamMapping[slot]`, so we derive that mapping from the rows at spawn/hydration.
 * `teamMapping[slot] = teamIndex`.
 */
export const teamMappingFromRows = (rows: Pick<MatchPlayer, "slot" | "team">[]): number[] => {
  const mapping: number[] = [];

  for (const row of rows) {
    mapping[row.slot] = row.team;
  }

  return mapping;
};
