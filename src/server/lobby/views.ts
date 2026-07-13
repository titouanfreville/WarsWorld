import type { Lobby, LobbyMembership, PlayerInLobby } from "@prisma/client";
import { capacityForMode, type LobbyMode } from "server/matches/layout";

type LobbyMemberRow = PlayerInLobby & { player: { id: string; name: string } };
export type LobbyRow = Lobby & {
  members: LobbyMemberRow[];
  match: { id: string } | null;
};

export type LobbyMemberView = {
  playerId: string;
  name: string;
  membership: LobbyMembership;
  team: number | null;
  slot: number | null;
  isSpectator: boolean;
  accepted: boolean;
};

export type LobbyView = {
  id: string;
  hostPlayerId: string | null;
  mode: string;
  leagueType: string;
  isRanked: boolean;
  mapId: string | null;
  status: string;
  capacity: number;
  /** Faction (army) per team index — cosmetic team identity. */
  teamFactions: string[] | null;
  /** Rule highlights the lobby surfaces as chips. */
  rules: { fogOfWar: boolean; fundsPerProperty: number; dayLimit: number };
  matchId: string | null;
  members: LobbyMemberView[];
};

export const lobbyToView = (row: LobbyRow): LobbyView => ({
  id: row.id,
  hostPlayerId: row.hostPlayerId,
  mode: row.mode,
  leagueType: row.leagueType,
  isRanked: row.isRanked,
  mapId: row.mapId,
  status: row.status,
  capacity: capacityForMode(row.mode as LobbyMode),
  teamFactions: row.teamFactions ?? null,
  rules: {
    fogOfWar: row.rules.fogOfWar,
    fundsPerProperty: row.rules.fundsPerProperty,
    dayLimit: row.rules.dayLimit,
  },
  matchId: row.match?.id ?? null,
  members: row.members.map((member) => ({
    playerId: member.playerId,
    name: member.player.name,
    membership: member.membership,
    team: member.team,
    slot: member.slot,
    isSpectator: member.isSpectator,
    accepted: member.accepted,
  })),
});
