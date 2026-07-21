-- CreateEnum
CREATE TYPE "ArticleCategory" AS ENUM ('basics', 'advance', 'site', 'patch', 'events', 'news', 'maintenance', 'other');

-- CreateEnum
CREATE TYPE "UserState" AS ENUM ('active', 'disabled', 'banned');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('admin', 'moderator', 'dev', 'tester');

-- CreateEnum
CREATE TYPE "CO" AS ENUM ('adder');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('pipeRunner');

-- CreateEnum
CREATE TYPE "Game" AS ENUM ('advanceDatingByWeb');

-- CreateEnum
CREATE TYPE "Achievement" AS ENUM ('fieldTrainingComplete', 'winStreak', 'underdog', 'handicap', 'lightningStrike', 'destroyer', 'fixer', 'goldRush', 'champion', 'grizzledYet');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('setup', 'playing', 'finished', 'cancelled');

-- CreateEnum
CREATE TYPE "LobbyStatus" AS ENUM ('assembling', 'ready_check', 'map_ban', 'map_reveal', 'cancelled', 'started');

-- CreateEnum
CREATE TYPE "LobbyMembership" AS ENUM ('invited', 'active');

-- CreateEnum
CREATE TYPE "GameMode" AS ENUM ('duel', 'teams', 'ffa');

-- CreateEnum
CREATE TYPE "Ruleset" AS ENUM ('standard', 'fog', 'highFunds', 'broken');

-- CreateEnum
CREATE TYPE "Rank" AS ENUM ('cadet', 'private', 'sergeant', 'lieutenant', 'captain', 'major', 'colonel', 'marechal');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('PENDING', 'ACCEPTED');

-- CreateEnum
CREATE TYPE "ConversationKind" AS ENUM ('DM', 'GROUP', 'LOBBY', 'MATCH');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('FRIEND_REQUEST', 'FRIEND_ACCEPT', 'LOBBY_INVITE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MedalType" AS ENUM ('GOOD_CONDUCT', 'MEDAILLE_MILITAIRE', 'CROIX_DE_GUERRE');

-- CreateTable
CREATE TABLE "Article" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "ArticleCategory" NOT NULL,
    "thumbnail" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleAuthors" (
    "articleId" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,

    CONSTRAINT "ArticleAuthors_pkey" PRIMARY KEY ("articleId","authorId")
);

-- CreateTable
CREATE TABLE "ArticleComment" (
    "id" TEXT NOT NULL,
    "articleId" INTEGER NOT NULL,
    "playerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "body" TEXT NOT NULL,

    CONSTRAINT "ArticleComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "state" "UserState" NOT NULL DEFAULT 'active',
    "roles" "Role"[] DEFAULT ARRAY[]::"Role"[],
    "name" TEXT,
    "password" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clan" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "Clan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "secret" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "preferences" JSONB,
    "achievements" "Achievement"[],

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Map" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tiles" JSONB NOT NULL,
    "predeployedUnits" JSONB NOT NULL,
    "numberOfPlayers" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supportedModes" "GameMode"[],
    "rankedModes" "GameMode"[],

    CONSTRAINT "Map_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorId" TEXT NOT NULL,
    "matchId" TEXT,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notes" (
    "content" TEXT NOT NULL,
    "public" BOOLEAN NOT NULL DEFAULT false,
    "playerId" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,

    CONSTRAINT "Notes_pkey" PRIMARY KEY ("playerId","matchId")
);

-- CreateTable
CREATE TABLE "MatchPlayerStats" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "tactics" INTEGER NOT NULL,
    "strength" INTEGER NOT NULL,
    "economy" INTEGER NOT NULL,
    "damageDealt" INTEGER NOT NULL,
    "damageTaken" INTEGER NOT NULL,
    "unitsKilled" INTEGER NOT NULL,
    "unitsLost" INTEGER NOT NULL,
    "captures" INTEGER NOT NULL,
    "producedFunds" INTEGER NOT NULL,
    "incomeEarned" INTEGER NOT NULL,
    "powersUsed" INTEGER NOT NULL,
    "unitBreakdown" JSONB,

    CONSTRAINT "MatchPlayerStats_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateTable
CREATE TABLE "PlayerSkill" (
    "playerId" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "mu" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
    "sigma" DOUBLE PRECISION NOT NULL DEFAULT 8.333333333333334,
    "games" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PlayerSkill_pkey" PRIMARY KEY ("playerId","mode")
);

-- CreateTable
CREATE TABLE "PlayerRank" (
    "playerId" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "rank" "Rank" NOT NULL DEFAULT 'cadet',
    "division" INTEGER NOT NULL DEFAULT 5,
    "merit" INTEGER NOT NULL DEFAULT 0,
    "peakRank" "Rank",
    "placementsExempt" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PlayerRank_pkey" PRIMARY KEY ("playerId","mode")
);

-- CreateTable
CREATE TABLE "MeritEvent" (
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "rankAfter" "Rank" NOT NULL,
    "divisionAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeritEvent_pkey" PRIMARY KEY ("matchId","playerId")
);

-- CreateTable
CREATE TABLE "match" (
    "id" TEXT NOT NULL,
    "mode" "GameMode" NOT NULL,
    "ruleset" "Ruleset" NOT NULL,
    "rules" JSONB NOT NULL,
    "status" "MatchStatus" NOT NULL,
    "winnerTeamIndex" INTEGER,
    "endReason" TEXT,
    "finishedAt" TIMESTAMP(3),
    "isRanked" BOOLEAN NOT NULL DEFAULT false,
    "teamFactions" JSONB,
    "pickEndsAt" TIMESTAMP(3),
    "turnEndsAt" TIMESTAMP(3),
    "revealedAt" TIMESTAMP(3),
    "ratedAt" TIMESTAMP(3),
    "statsAt" TIMESTAMP(3),
    "days" INTEGER,
    "durationMs" INTEGER,
    "lobbyId" TEXT,
    "mapId" TEXT NOT NULL,
    "playerState" JSONB NOT NULL,
    "chatIsPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "matchId" TEXT NOT NULL,
    "eventIndex" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("matchId","eventIndex")
);

-- CreateTable
CREATE TABLE "Lobby" (
    "id" TEXT NOT NULL,
    "hostPlayerId" TEXT,
    "isRanked" BOOLEAN NOT NULL DEFAULT false,
    "mode" "GameMode" NOT NULL,
    "ruleset" "Ruleset" NOT NULL,
    "rules" JSONB NOT NULL,
    "mapId" TEXT,
    "teamFactions" JSONB,
    "status" "LobbyStatus" NOT NULL DEFAULT 'assembling',
    "readyEndsAt" TIMESTAMP(3),
    "readyCheckLenient" BOOLEAN NOT NULL DEFAULT false,
    "fairnessGap" INTEGER,
    "mapPool" JSONB,
    "mapPhaseEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerInLobby" (
    "id" TEXT NOT NULL,
    "lobbyId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "membership" "LobbyMembership" NOT NULL DEFAULT 'active',
    "team" INTEGER,
    "slot" INTEGER,
    "isSpectator" BOOLEAN NOT NULL DEFAULT false,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "bannedMapIds" JSONB,
    "votedMapId" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerInLobby_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchPlayer" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "team" INTEGER NOT NULL,
    "army" TEXT NOT NULL,
    "coId" JSONB,
    "ready" BOOLEAN NOT NULL DEFAULT false,
    "isSpectator" BOOLEAN NOT NULL DEFAULT false,
    "skins" JSONB,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerInfraction" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "matchId" TEXT,
    "lobbyId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerInfraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitGroup" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "UnitGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "facility" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "movementPoints" INTEGER NOT NULL,
    "vision" INTEGER NOT NULL,
    "fuel" INTEGER NOT NULL,
    "ammo" INTEGER,
    "cost" INTEGER NOT NULL,
    "attackRangeMin" INTEGER,
    "attackRangeMax" INTEGER,

    CONSTRAINT "UnitType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerrainKind" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "defenseStars" INTEGER NOT NULL,
    "isProperty" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TerrainKind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerrainMovementCost" (
    "id" TEXT NOT NULL,
    "terrainId" TEXT NOT NULL,
    "movementType" TEXT NOT NULL,
    "cost" INTEGER,

    CONSTRAINT "TerrainMovementCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "terrainId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fundsPerTurn" INTEGER NOT NULL,
    "repairsFacility" TEXT,
    "buildsFacility" TEXT,
    "vision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Co" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "gameVersion" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,

    CONSTRAINT "Co_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoPhase" (
    "id" TEXT NOT NULL,
    "coId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "name" TEXT,
    "stars" DOUBLE PRECISION,
    "description" TEXT NOT NULL,
    "luckGood" INTEGER,
    "luckBad" INTEGER,
    "visualKey" TEXT,

    CONSTRAINT "CoPhase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoModifier" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "unitGroupKey" TEXT,
    "unitTypeId" TEXT,
    "attackPct" INTEGER,
    "defensePct" INTEGER,
    "rangeDelta" INTEGER,
    "movementDelta" INTEGER,
    "visionDelta" INTEGER,
    "buildCostPct" INTEGER,
    "terrainStarsPct" INTEGER,
    "terrainStarsDelta" INTEGER,
    "terrainStarsMult" INTEGER,
    "movementCostAll" INTEGER,
    "onTerrainKey" TEXT,
    "onProperty" BOOLEAN NOT NULL DEFAULT false,
    "onWeather" TEXT,
    "notWeather" TEXT,
    "onFacility" TEXT,
    "facilityNot" TEXT,
    "requiresWeapon" BOOLEAN NOT NULL DEFAULT false,
    "vsGroup" TEXT,
    "scaleStat" TEXT,
    "scaleVariable" TEXT,
    "scaleDivisor" INTEGER,
    "scaleFactor" INTEGER,

    CONSTRAINT "CoModifier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CoPhaseEffect" (
    "id" TEXT NOT NULL,
    "phaseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "params" JSONB,

    CONSTRAINT "CoPhaseEffect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkinType" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "SkinType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skin" (
    "id" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "group" TEXT,

    CONSTRAINT "Skin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkinAsset" (
    "id" TEXT NOT NULL,
    "skinId" TEXT NOT NULL,
    "elementKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,

    CONSTRAINT "SkinAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Friendship" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FriendCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FriendCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "blockerId" TEXT NOT NULL,
    "blockedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mute" (
    "id" TEXT NOT NULL,
    "muterId" TEXT NOT NULL,
    "mutedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Mute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "content" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "kind" "ConversationKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "matchId" TEXT,
    "teamIndex" INTEGER,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "conversationId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("conversationId","playerId")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commendation" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "medal" "MedalType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Commendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DevToolAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "matchId" TEXT,
    "playerId" TEXT,
    "capability" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevToolAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_member" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_MatchToPlayer" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_UnitGroupToUnitType" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "_CategoryFriendships" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_name_key" ON "Player"("name");

-- CreateIndex
CREATE INDEX "MatchPlayerStats_playerId_idx" ON "MatchPlayerStats"("playerId");

-- CreateIndex
CREATE INDEX "MeritEvent_playerId_createdAt_idx" ON "MeritEvent"("playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "match_lobbyId_key" ON "match"("lobbyId");

-- CreateIndex
CREATE INDEX "PlayerInLobby_playerId_idx" ON "PlayerInLobby"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInLobby_lobbyId_playerId_key" ON "PlayerInLobby"("lobbyId", "playerId");

-- CreateIndex
CREATE INDEX "MatchPlayer_playerId_idx" ON "MatchPlayer"("playerId");

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayer_matchId_playerId_key" ON "MatchPlayer"("matchId", "playerId");

-- CreateIndex
CREATE INDEX "PlayerInfraction_playerId_idx" ON "PlayerInfraction"("playerId");

-- CreateIndex
CREATE INDEX "PlayerInfraction_playerId_type_idx" ON "PlayerInfraction"("playerId", "type");

-- CreateIndex
CREATE INDEX "PlayerInfraction_playerId_createdAt_idx" ON "PlayerInfraction"("playerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UnitGroup_key_key" ON "UnitGroup"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UnitType_key_key" ON "UnitType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TerrainKind_key_key" ON "TerrainKind"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TerrainMovementCost_terrainId_movementType_key" ON "TerrainMovementCost"("terrainId", "movementType");

-- CreateIndex
CREATE UNIQUE INDEX "Property_terrainId_key" ON "Property"("terrainId");

-- CreateIndex
CREATE UNIQUE INDEX "Property_key_key" ON "Property"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Co_key_gameVersion_key" ON "Co"("key", "gameVersion");

-- CreateIndex
CREATE UNIQUE INDEX "CoPhase_coId_phase_key" ON "CoPhase"("coId", "phase");

-- CreateIndex
CREATE INDEX "CoModifier_phaseId_idx" ON "CoModifier"("phaseId");

-- CreateIndex
CREATE INDEX "CoPhaseEffect_phaseId_idx" ON "CoPhaseEffect"("phaseId");

-- CreateIndex
CREATE UNIQUE INDEX "SkinType_key_key" ON "SkinType"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Skin_typeId_key_key" ON "Skin"("typeId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SkinAsset_skinId_elementKey_key" ON "SkinAsset"("skinId", "elementKey");

-- CreateIndex
CREATE INDEX "Friendship_senderId_idx" ON "Friendship"("senderId");

-- CreateIndex
CREATE INDEX "Friendship_receiverId_idx" ON "Friendship"("receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "Friendship_senderId_receiverId_key" ON "Friendship"("senderId", "receiverId");

-- CreateIndex
CREATE INDEX "FriendCategory_ownerId_idx" ON "FriendCategory"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "FriendCategory_ownerId_name_key" ON "FriendCategory"("ownerId", "name");

-- CreateIndex
CREATE INDEX "Block_blockerId_idx" ON "Block"("blockerId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_blockerId_blockedId_key" ON "Block"("blockerId", "blockedId");

-- CreateIndex
CREATE INDEX "Mute_muterId_idx" ON "Mute"("muterId");

-- CreateIndex
CREATE UNIQUE INDEX "Mute_muterId_mutedId_key" ON "Mute"("muterId", "mutedId");

-- CreateIndex
CREATE INDEX "Notification_playerId_isRead_createdAt_idx" ON "Notification"("playerId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_kind_updatedAt_idx" ON "Conversation"("kind", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_matchId_teamIndex_key" ON "Conversation"("matchId", "teamIndex");

-- CreateIndex
CREATE INDEX "ConversationParticipant_playerId_idx" ON "ConversationParticipant"("playerId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Commendation_toId_medal_idx" ON "Commendation"("toId", "medal");

-- CreateIndex
CREATE UNIQUE INDEX "Commendation_matchId_fromId_key" ON "Commendation"("matchId", "fromId");

-- CreateIndex
CREATE INDEX "DevToolAudit_userId_createdAt_idx" ON "DevToolAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DevToolAudit_matchId_idx" ON "DevToolAudit"("matchId");

-- CreateIndex
CREATE UNIQUE INDEX "_member_AB_unique" ON "_member"("A", "B");

-- CreateIndex
CREATE INDEX "_member_B_index" ON "_member"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_MatchToPlayer_AB_unique" ON "_MatchToPlayer"("A", "B");

-- CreateIndex
CREATE INDEX "_MatchToPlayer_B_index" ON "_MatchToPlayer"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_UnitGroupToUnitType_AB_unique" ON "_UnitGroupToUnitType"("A", "B");

-- CreateIndex
CREATE INDEX "_UnitGroupToUnitType_B_index" ON "_UnitGroupToUnitType"("B");

-- CreateIndex
CREATE UNIQUE INDEX "_CategoryFriendships_AB_unique" ON "_CategoryFriendships"("A", "B");

-- CreateIndex
CREATE INDEX "_CategoryFriendships_B_index" ON "_CategoryFriendships"("B");

-- AddForeignKey
ALTER TABLE "ArticleAuthors" ADD CONSTRAINT "ArticleAuthors_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleAuthors" ADD CONSTRAINT "ArticleAuthors_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleComment" ADD CONSTRAINT "ArticleComment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleComment" ADD CONSTRAINT "ArticleComment_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clan" ADD CONSTRAINT "Clan_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Player" ADD CONSTRAINT "Player_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notes" ADD CONSTRAINT "Notes_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notes" ADD CONSTRAINT "Notes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayerStats" ADD CONSTRAINT "MatchPlayerStats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayerStats" ADD CONSTRAINT "MatchPlayerStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSkill" ADD CONSTRAINT "PlayerSkill_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerRank" ADD CONSTRAINT "PlayerRank_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeritEvent" ADD CONSTRAINT "MeritEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeritEvent" ADD CONSTRAINT "MeritEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match" ADD CONSTRAINT "match_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_hostPlayerId_fkey" FOREIGN KEY ("hostPlayerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lobby" ADD CONSTRAINT "Lobby_mapId_fkey" FOREIGN KEY ("mapId") REFERENCES "Map"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInLobby" ADD CONSTRAINT "PlayerInLobby_lobbyId_fkey" FOREIGN KEY ("lobbyId") REFERENCES "Lobby"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInLobby" ADD CONSTRAINT "PlayerInLobby_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchPlayer" ADD CONSTRAINT "MatchPlayer_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerInfraction" ADD CONSTRAINT "PlayerInfraction_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerrainMovementCost" ADD CONSTRAINT "TerrainMovementCost_terrainId_fkey" FOREIGN KEY ("terrainId") REFERENCES "TerrainKind"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_terrainId_fkey" FOREIGN KEY ("terrainId") REFERENCES "TerrainKind"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoPhase" ADD CONSTRAINT "CoPhase_coId_fkey" FOREIGN KEY ("coId") REFERENCES "Co"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoModifier" ADD CONSTRAINT "CoModifier_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "CoPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoModifier" ADD CONSTRAINT "CoModifier_unitTypeId_fkey" FOREIGN KEY ("unitTypeId") REFERENCES "UnitType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoPhaseEffect" ADD CONSTRAINT "CoPhaseEffect_phaseId_fkey" FOREIGN KEY ("phaseId") REFERENCES "CoPhase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skin" ADD CONSTRAINT "Skin_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "SkinType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkinAsset" ADD CONSTRAINT "SkinAsset_skinId_fkey" FOREIGN KEY ("skinId") REFERENCES "Skin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FriendCategory" ADD CONSTRAINT "FriendCategory_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_muterId_fkey" FOREIGN KEY ("muterId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mute" ADD CONSTRAINT "Mute_mutedId_fkey" FOREIGN KEY ("mutedId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commendation" ADD CONSTRAINT "Commendation_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commendation" ADD CONSTRAINT "Commendation_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevToolAudit" ADD CONSTRAINT "DevToolAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_member" ADD CONSTRAINT "_member_A_fkey" FOREIGN KEY ("A") REFERENCES "Clan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_member" ADD CONSTRAINT "_member_B_fkey" FOREIGN KEY ("B") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MatchToPlayer" ADD CONSTRAINT "_MatchToPlayer_A_fkey" FOREIGN KEY ("A") REFERENCES "match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_MatchToPlayer" ADD CONSTRAINT "_MatchToPlayer_B_fkey" FOREIGN KEY ("B") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UnitGroupToUnitType" ADD CONSTRAINT "_UnitGroupToUnitType_A_fkey" FOREIGN KEY ("A") REFERENCES "UnitGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UnitGroupToUnitType" ADD CONSTRAINT "_UnitGroupToUnitType_B_fkey" FOREIGN KEY ("B") REFERENCES "UnitType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryFriendships" ADD CONSTRAINT "_CategoryFriendships_A_fkey" FOREIGN KEY ("A") REFERENCES "FriendCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CategoryFriendships" ADD CONSTRAINT "_CategoryFriendships_B_fkey" FOREIGN KEY ("B") REFERENCES "Friendship"("id") ON DELETE CASCADE ON UPDATE CASCADE;

