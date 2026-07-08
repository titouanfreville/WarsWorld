# Backend implementation plan — Lobby + Match (revised)

Status: **draft for review** (revised per feedback 2026-07-08). Implements
`.ai/plans/lobby-two-phase-design.md`. Emphasis: the **data model**. Server-authoritative throughout.

## The key structural decision — Lobby is NOT the Match

A **Lobby** is a **pre-room** whose job is to *get players together*; the **Match** is the game
itself. They are **separate entities with separate tables**.

- **Lobby** — assemble players (custom host-invite **or** matchmaking), assign teams, run the **AFK
  ready-check**. Lives before any match exists.
- **Match** — created **only once every player has accepted** (ready-check passed / host started).
  The Match's existing **`setup` status = the general-picker round** (timed CO selection, enemies
  hidden), then `playing` → `finished`/`cancelled`. **No `lobby`/`picking` status on Match** — the
  general picker is `setup`, and the pre-room is the separate Lobby.

```
Lobby(assembling) ──host start / all-accept──▶ Match(setup = general picker)
     │ (custom invite  or  matchmaking → ready_check)                   │ lock COs → reveal → 10s
     ▼                                                                  ▼
  cancelled (nobody / declined)                              Match(playing) ─▶ finished / cancelled
```

## Relational, not JSON

Per-player match facts move from the `Match.playerState` JSON blob to a **real associative table**
so quick SQL checks (who's ready, which CO, which team, W/L) don't parse JSON. The **volatile engine
runtime** (funds, power meter, unit positions/HP, whose turn) stays **event-sourced** (the `Event`
log + in-memory `match-store`) — that's unchanged. The relational rows hold the **durable/queryable**
facts; the event log holds the **game simulation**.

## Data model

### 1. Lobby (new)

```prisma
enum LobbyStatus { assembling ready_check cancelled started }

model Lobby {
  id           String        @id @default(cuid())
  hostPlayerId String?       // set for custom lobbies; null for matchmaking
  isRanked     Boolean       @default(false)
  mode         String        // "1v1" | "2v2" | "ffa4" (drives team count + slots)
  leagueType   LeagueType
  rules        Json          // MatchRules draft (fog, funds, pickSeconds, teamMapping…)
  mapId        String?       // WWMap (host-chosen; matchmaking assigns)
  map          WWMap?        @relation(fields: [mapId], references: [id])
  teamFactions Json?         // random AW faction label/color per team index (cosmetic)
  status       LobbyStatus   @default(assembling)
  readyEndsAt  DateTime?     // AFK ready-check deadline (matchmaking, ~30s)
  matchId      String?       @unique  // the Match spawned from this lobby (once started)
  createdAt    DateTime      @default(now())
  members      PlayerInLobby[]
}

model PlayerInLobby {
  id          String   @id @default(cuid())
  lobby       Lobby    @relation(fields: [lobbyId], references: [id], onDelete: Cascade)
  lobbyId     String
  player      Player   @relation(fields: [playerId], references: [id])
  playerId    String
  team        Int?     // self-assigned team index (null = unassigned bench)
  slot        Int?     // slot within team (or overall for FFA)
  isSpectator Boolean  @default(false)   // FFA overflow / explicit spectator
  accepted    Boolean  @default(false)   // AFK ready-check accepted
  joinedAt    DateTime @default(now())
  @@unique([lobbyId, playerId])
  @@index([playerId])
}
```

Invites (custom lobby): an invitee is a pending `PlayerInLobby`-adjacent record until they respond.
Simplest: a small `LobbyInvite { lobbyId, playerId (or username), status, createdAt }` table, or a
`pending` flag on `PlayerInLobby`. (Open Q.)

### 2. Match — refined + relational players

```prisma
model Match {
  // existing: id, leagueType, rules, status(setup|playing|finished|cancelled), map, mapId,
  //           winnerTeamIndex, finishedAt
  status       MatchStatus     // setup = general-picker round · playing · finished · cancelled
  isRanked     Boolean  @default(false)
  teamFactions Json?           // carried from the Lobby
  pickEndsAt   DateTime?        // general-picker deadline (setup only); FE renders pickEndsAt-now
  revealedAt   DateTime?        // CO reveal gate (null → enemy COs hidden)
  lobbyId      String?  @unique // provenance

  players      PlayerInMatch[]  // ← relational, replaces the durable part of playerState JSON
  // Match.playerState JSON is retired: durable facts → PlayerInMatch; volatile runtime → event log.
}

model PlayerInMatch {
  id        String   @id @default(cuid())
  match     Match    @relation(fields: [matchId], references: [id], onDelete: Cascade)
  matchId   String
  player    Player   @relation(fields: [playerId], references: [id])
  playerId  String
  slot      Int
  team      Int                              // explicit team field (per feedback)
  army      Army                             // faction color
  coId      Json?                            // [PrismaCoId] chosen general — NULL until picked;
                                             //   hidden from enemies in queries until Match.revealedAt
  ready     Boolean  @default(false)         // CO locked in during the setup/picker round
  isSpectator Boolean @default(false)
  /// [PrismaPlayerSkins]  { map; army; camp } — per-match override; defaults from Player.preferences
  skins     Json?
  result    String?                          // "won" | "lost" | "drawn" (set at finalize)
  createdAt DateTime @default(now())
  @@unique([matchId, playerId])
  @@index([playerId])          // fast "player X's matches", W/L, CO usage
}
```

- `MatchStatus.cancelled` already planned; **`setup` is reused as the general-picker round** (no
  rename). `PlayerInMatch` is the queryable authority for membership/team/CO/result.
- **Retire `Match.playerState` JSON**: durable fields → `PlayerInMatch`; volatile runtime (funds,
  powerMeter, COPowerState, hasCurrentTurn, hasBuiltUnit, units) is derived from the event log by
  `match-store` on rebuild. This is the **heaviest refactor** — the in-memory `MatchWrapper` must be
  hydrated from `PlayerInMatch` rows (identity/team/CO) + replayed events (runtime), instead of from
  `playerState`. Sequence it carefully (see build order).

### 3. Behavior / moderation log (durable, cross-cutting)

Not just leavers — a long-term record of **all** bad behaviour for monitoring + sanctions:

```prisma
model PlayerInfraction {
  id        String   @id @default(cuid())
  player    Player   @relation(fields: [playerId], references: [id])
  playerId  String
  type      String   // "afk_ingame" | "missed_ready_check" | "left_lobby" | "abandoned_pick" | "chat_harassment" | …
  severity  Int      @default(1)          // weight for sanction thresholds
  matchId   String?                       // context when applicable
  lobbyId   String?
  detail    Json?                         // freeform (e.g., turns missed, message id)
  createdAt DateTime @default(now())
  @@index([playerId])
  @@index([playerId, type])
  @@index([playerId, createdAt])
}
```

Optional denormalised gate on `Player` (`recentInfractions Int`, or computed) for cheap matchmaking
throttling. This replaces the narrow `MatchAbandon` idea and covers in-game AFK, chat, etc.

### 4. Skins — preference default + per-match override

- **Global default:** add `skins { map; army; camp }` to `Preferences` (`Player.preferences`, already
  a Json field). Player sets these once.
- **Per-match override:** `PlayerInMatch.skins` (nullable). In the picker, the control **defaults to
  the preference** and can be changed for that match only. Visual, own-side, gameplay-irrelevant.

### 5. Ranking / MMR — wired now

On `finalizeIfGameOver` (already exists), if `isRanked`: compute rating deltas from `winnerTeamIndex`
+ each `PlayerInMatch.result`, update per-league `MMR` in the same transaction, and write the new
rating snapshot. (Simple Elo/rating fn first; refine later.) The relational `result` makes this a
clean per-row update.

### 6. Matchmaking (Phase 2)

```prisma
model MatchmakingTicket {
  id         String     @id @default(cuid())
  playerId   String     @unique
  partyId    String?                       // 2-stack shares a partyId
  mode       String
  leagueType LeagueType
  rating     Int
  enqueuedAt DateTime   @default(now())
}
```

Matchmaker pairs tickets → creates a **Lobby** in `ready_check` (30 s). All accept → start the Match
(`setup`). Decline/timeout → `PlayerInfraction(missed_ready_check)` for no-shows, dissolve, requeue.

## Server-authoritative mechanics

- **Pick timer:** `Match.pickEndsAt` (setup) and `Lobby.readyEndsAt` (ready-check) are the sources of
  truth. Per-match `setTimeout` in the WS server, rebuilt on boot from the columns. FE only renders
  the deadline.
- **CO-hiding (fog for generals):** a read filter strips other-team `PlayerInMatch.coId` while
  `revealedAt === null`; WS emits `co-locked { playerId }` (no coId) until `pick-reveal`.
- **Reveal → launch:** all `ready` (or deadline with full rosters) → set `revealedAt`, emit reveal,
  10 s → `matchStart` event + `status = playing`.
- **Cancel + flag:** deadline with anyone unready → `status = cancelled`, write
  `PlayerInfraction(abandoned_pick)` per offender, emit `match-cancelled`.

## WS events (`shared/types/events`)

Add: `player-joined-lobby` / `-left-lobby`, `player-changed-team`, `lobby-invite` /
`invite-accepted` / `invite-declined`, `ready-check-started {readyEndsAt}` / `ready-check-accepted`,
`pick-started {pickEndsAt}`, `co-locked {playerId}` (no coId), `pick-reveal {players:[{id,coId}]}`,
`match-cancelled {leaverIds}`. Reuse `matchStart` / `matchEnd`. Filter CO info before emit.

## Feature modules (per src/server/CLAUDE.md)

- **`src/server/lobby/`** — `lobby.usecase.ts` (create · join · assignTeam · invite · respondInvite ·
  kick · startReadyCheck · accept · start→spawnMatch · cancel), `dbo.ts` (Lobby + PlayerInLobby +
  invites + tickets), `schemas.ts`, `router.ts`, `views.ts` (lobby view).
- **`src/server/matches/`** — extend: `spawnFromLobby`, `lockCo`, `onPickDeadline`, reveal, cancel,
  `matchToFrontend` reading `PlayerInMatch` (+ CO-hiding), `finalize` (+ MMR).
- **`src/server/players/`** — skins in preferences (`getSkins`/`setSkins`).
- Engine stays Prisma-free; the `matches`/`lobby` usecases own persistence + timers.

## Migration & backfill

- New tables: `Lobby`, `PlayerInLobby`, `PlayerInMatch`, `PlayerInfraction`, `MatchmakingTicket`
  (Phase 2); `LobbyStatus` enum; `Match` columns (`isRanked`, `teamFactions`, `pickEndsAt`,
  `revealedAt`, `lobbyId`); JSON-type additions (`Preferences.skins`, `MatchRules.pickSeconds/mode`,
  `PrismaPlayerSkins`, `PrismaCoId`, `PrismaTeamFactions`).
- **Backfill playerState → PlayerInMatch:** for every existing match, explode `playerState` JSON into
  `PlayerInMatch` rows (slot, team via `teamMapping`, army, coId, result). One-off script
  (reuse the backfill pattern). Then `playerState` can be dropped once `match-store` hydrates from the
  new sources.
- Use `rtk proxy npx prisma db push` (the rtk/prisma gotcha).

## Testing

- Lobby: team-assign validity, invite/accept, ready-check timeout → `missed_ready_check` infraction,
  spawn-match-on-accept.
- Match setup: lock→reveal (all-locked vs deadline), cancel + `abandoned_pick`, CO-hiding filter
  (enemy coId null before reveal / present after).
- Rebuild: a `setup` match reconstructs `pickEndsAt`; a `playing` match hydrates identity from
  `PlayerInMatch` + runtime from events.
- Finalize: MMR deltas per `result` on a ranked match.

## Build order

1. **Schema**: Lobby/PlayerInLobby, PlayerInMatch, PlayerInfraction, Match columns, enums, JSON types
   + migration + **playerState→PlayerInMatch backfill**.
2. **Match hydration refactor**: `match-store` builds `MatchWrapper` from `PlayerInMatch` + event log
   (retire `playerState`). ← highest-risk; do behind tests first.
3. **Lobby feature**: assemble/team/invite/kick + lobby view (custom path).
4. **Spawn Match(setup) + general-picker**: pick timer, `lockCo`, CO-hiding, reveal → play.
5. **Cancel + PlayerInfraction**; **MMR on finalize**.
6. **Skins** (preferences + per-match override).
7. **FE**: replace `MatchCardSetup`; wire the mockup screens with **real CO/unit sprites**.
8. **Phase 2**: matchmaking tickets + ready-check.

## Open questions

1. **playerState retirement** — full move to `PlayerInMatch` + event-derived runtime now (clean,
   heavier), or keep `playerState` as a runtime cache and add `PlayerInMatch` alongside for
   queryability (lower risk, some duplication)?
2. **Invites** — dedicated `LobbyInvite` table vs a `pending` flag on `PlayerInLobby`?
3. **Custom lobby ready-check** — do host-made lobbies also get the 30 s accept step, or only
   matchmaking (host just presses start)?
4. **Rating function** — which model for MMR deltas (plain Elo to start)?
5. **Team vs slot** — is `team` authoritative on `PlayerInMatch` and `teamMapping` derived from it at
   spawn, or keep both in sync?
