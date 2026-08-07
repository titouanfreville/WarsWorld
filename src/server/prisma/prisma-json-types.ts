/* eslint-disable @typescript-eslint/no-namespace */
// ^ couldn't find a way around using namespaces yet
// https://www.npmjs.com/package/prisma-json-types-generator#configuration

import type { MatchRules } from "server/core/schemas/match-rules";
import type { Preferences, PlayerSkins } from "server/players/schemas";
import type { TeamFactions } from "server/matches/schemas";
import type { COID } from "server/core/schemas/co";
import type { Tile } from "server/core/schemas/tile";
import type { UnitWithVisibleStats } from "server/core/schemas/unit";
import type { MainEventWithSubEvents } from "server/engine/types/events";
import type { PlayerInMatch } from "server/engine/entities/player-in-match-state";
import type { FairnessReport } from "server/maps/fairness";

declare global {
  namespace PrismaJson {
    type PrismaPreferences = Preferences;
    type PrismaTiles = Tile[][];
    type PrismaUnits = UnitWithVisibleStats[];
    // WWMap.fairnessReport — the last stored verdict from the map checker.
    type MapFairnessReport = FairnessReport;
    // v1 durable player state (kept for the v1 game — see Match.playerState).
    type PrismaPlayerState = PlayerInMatch[];
    type PrismaEvent = MainEventWithSubEvents;
    type PrismaMatchRules = MatchRules;
    // New lobby/match path (v2):
    type PrismaCoId = COID; // MatchPlayer.coId — the chosen general
    type PrismaPlayerSkins = PlayerSkins; // MatchPlayer.skins — per-match cosmetic override
    type PrismaTeamFactions = TeamFactions; // Lobby/Match teamFactions — faction per team index
    // Matchmaking map pick & ban:
    type PrismaMapPool = string[]; // Lobby.mapPool — candidate WWMap ids for the ban phase
    type PrismaBannedMapIds = string[]; // PlayerInLobby.bannedMapIds — this player's bans
    // MatchPlayerStats.unitBreakdown — per-unit-type tallies (engine unit key → count/funds).
    type PrismaUnitBreakdown = {
      built: Record<string, number>;
      lost: Record<string, number>;
      damage: Record<string, number>;
    };
  }
}
