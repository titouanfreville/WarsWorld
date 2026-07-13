import { z } from "zod";

/** Default general-picker duration when `rules.pickSeconds` isn't set. */
export const DEFAULT_PICK_SECONDS = 180;

export const lobbyModeSchema = z.enum(["1v1", "2v2", "ffa4"]);
export type LobbyMode = z.infer<typeof lobbyModeSchema>;

export type LobbyLayout = {
  /** number of teams (2 for 1v1/2v2, 4 for a free-for-all) */
  teamCount: number;
  /** seats per team (1 for 1v1/ffa, 2 for 2v2) */
  slotsPerTeam: number;
};

const LAYOUTS: Record<LobbyMode, LobbyLayout> = {
  "1v1": { teamCount: 2, slotsPerTeam: 1 },
  "2v2": { teamCount: 2, slotsPerTeam: 2 },
  ffa4: { teamCount: 4, slotsPerTeam: 1 },
};

export const layoutForMode = (mode: LobbyMode): LobbyLayout => LAYOUTS[mode];

/** Total non-spectator seats a lobby of this mode holds. */
export const capacityForMode = (mode: LobbyMode): number => {
  const { teamCount, slotsPerTeam } = LAYOUTS[mode];
  return teamCount * slotsPerTeam;
};

/**
 * The map player-slot for a seat, grouping teammates: `team * slotsPerTeam + slotWithinTeam`.
 * `rules.teamMapping[matchSlot] = team`, so the engine resolves teams from these slots.
 */
export const matchSlotFor = (mode: LobbyMode, team: number, slotWithinTeam: number): number =>
  team * layoutForMode(mode).slotsPerTeam + slotWithinTeam;

/** Whether a (team, slotWithinTeam) pair is inside the mode's grid. */
export const isValidSeat = (mode: LobbyMode, team: number, slotWithinTeam: number): boolean => {
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
