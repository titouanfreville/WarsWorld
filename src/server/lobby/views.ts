import type { GameMode, Lobby, LobbyMembership, PlayerInLobby } from "@prisma/client";
import { capacityForMode } from "server/matches/layout";

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
  /**
   * The mode UNION, not `string`. The server knows this is a `GameMode`; widening it here pushed an
   * unchecked `as GameMode` onto every frontend use site, which is an assertion the FE has no
   * standing to make. Narrow on the wire and the FE's own mirror checks structurally instead.
   */
  mode: GameMode;
  ruleset: string;
  isRanked: boolean;
  mapId: string | null;
  status: string;
  capacity: number;
  /** Faction (army) per team index — cosmetic team identity. */
  teamFactions: string[] | null;
  /** Rule highlights the lobby surfaces as chips. */
  rules: {
    fogOfWar: boolean;
    fundsPerProperty: number;
    dayLimit: number;
    /** Turn clock in seconds; null on an untimed match (nothing to advertise). */
    turnBankSeconds: number | null;
    turnIncrementSeconds: number | null;
  };
  matchId: string | null;
  members: LobbyMemberView[];
};

export const lobbyToView = (row: LobbyRow): LobbyView => ({
  id: row.id,
  hostPlayerId: row.hostPlayerId,
  mode: row.mode,
  ruleset: row.ruleset,
  isRanked: row.isRanked,
  mapId: row.mapId,
  status: row.status,
  capacity: capacityForMode(row.mode),
  teamFactions: row.teamFactions ?? null,
  rules: {
    fogOfWar: row.rules.fogOfWar,
    fundsPerProperty: row.rules.fundsPerProperty,
    dayLimit: row.rules.dayLimit,
    turnBankSeconds: row.rules.turnBankSeconds ?? null,
    turnIncrementSeconds: row.rules.turnIncrementSeconds ?? null,
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
