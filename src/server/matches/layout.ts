import type { GameMode } from "server/core/schemas/game-mode";

/** Default general-picker duration when `rules.pickSeconds` isn't set. */
export const DEFAULT_PICK_SECONDS = 180;

export type LobbyLayout = {
  /** number of teams (2 for duel/teams, 4 for a free-for-all) */
  teamCount: number;
  /** seats per team (1 for duel/ffa, 2 for teams) */
  slotsPerTeam: number;
};

/**
 * The seat grid per mode — the single owner of "how many seats, split how". `core`'s game-mode
 * schema is vocabulary only and deliberately does NOT restate these numbers.
 */
const LAYOUTS: Record<GameMode, LobbyLayout> = {
  duel: { teamCount: 2, slotsPerTeam: 1 },
  teams: { teamCount: 2, slotsPerTeam: 2 },
  ffa: { teamCount: 4, slotsPerTeam: 1 },
};

export const layoutForMode = (mode: GameMode): LobbyLayout => LAYOUTS[mode];

/** Total non-spectator seats a lobby of this mode holds. */
export const capacityForMode = (mode: GameMode): number => {
  const { teamCount, slotsPerTeam } = LAYOUTS[mode];
  return teamCount * slotsPerTeam;
};

/**
 * The map player-slot for a seat, grouping teammates: `team * slotsPerTeam + slotWithinTeam`.
 * `rules.teamMapping[matchSlot] = team`, so the engine resolves teams from these slots.
 */
export const matchSlotFor = (mode: GameMode, team: number, slotWithinTeam: number): number =>
  team * layoutForMode(mode).slotsPerTeam + slotWithinTeam;

/** Whether a (team, slotWithinTeam) pair is inside the mode's grid. */
export const isValidSeat = (mode: GameMode, team: number, slotWithinTeam: number): boolean => {
  const { teamCount, slotsPerTeam } = LAYOUTS[mode];
  return (
    Number.isInteger(team) &&
    Number.isInteger(slotWithinTeam) &&
    team >= 0 &&
    team < teamCount &&
    slotWithinTeam >= 0 &&
    slotWithinTeam < slotsPerTeam
  );
};
