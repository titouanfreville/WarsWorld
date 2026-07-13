# Backend implementation plan — Lobby + Match (revised)

Status: **approved; build in progress**. Implements `.ai/plans/lobby-two-phase-design.md`. Emphasis:
the **data model**. Server-authoritative throughout.

**Implementation progress**
- ✅ **Step 1 — Schema (2026-07-09).** Added enums `LobbyStatus`, `LobbyMembership`, `cancelled` on
  `MatchStatus`; models `Lobby`, `PlayerInLobby`, `MatchPlayer`, `PlayerInfraction`; `Match` v2
  columns (`isRanked`, `teamFactions`, `pickEndsAt`, `revealedAt`, `lobbyId @unique`); JSON types
  (`PrismaCoId`, `PrismaPlayerSkins`, `PrismaTeamFactions`, `Preferences.skins`) + `matches/schemas.ts`
  (`teamFactions`) + `players/schemas.ts` (`playerSkins`). Domain `MatchStatus` + FE `MatchCard` union
  widened for `cancelled`. `db push` applied; tsc + lint clean; 145/145 tests pass.
  - **Two deviations from the text below:** (1) the relational table is named **`MatchPlayer`**, not
    `PlayerInMatch`, to avoid a permanent clash with the v1 runtime type `PlayerInMatch`
    (`shared/types/server-match-state`), which we keep. (2) The 1:1 Lobby↔Match link is a single FK
    on **`Match.lobbyId @unique`** with a `Lobby.match` back-relation — no `Lobby.matchId` column.
  - `MatchmakingTicket` intentionally **not** added yet (Phase 2 / step 8 — avoid dead schema).
- ✅ **Step 2 — v2 hydration (2026-07-09).** `match-store.createMatchAndIndex` takes optional
  `MatchPlayer` rows: when present it seeds the runtime `PlayerInMatch[]` from them
  (`matches/match-player.ts` — `matchPlayerToRuntime` + `teamMappingFromRows`), else falls back to
  the v1 `playerState` blob (untouched). `rebuild()` includes `matchPlayers`. Additive branch, no rip-out.
- ✅ **Step 3 — lobby feature (2026-07-09).** `src/server/lobby/` — `lobby.usecase.ts`
  (create/get/join/assignTeam/invite/respondInvite/kick/leave/start), `schemas.ts`, `views.ts`,
  `router.ts`; mounted as `lobby` in `app.ts`. Invites = `membership: invited|active`; self-assign
  switchboard with per-mode layout (`matches/layout.ts`: 1v1/2v2/ffa4). Prisma inline (no dbo yet).
- ✅ **Step 4 — spawn + general-picker (2026-07-09).** `src/server/matches/matches.usecase.ts` —
  `spawnFromLobby` (creates `Match(setup)` + `MatchPlayer` rows, derives `teamMapping`, rolls
  `teamFactions` + distinct armies, sets `pickEndsAt`, indexes in store), `lockCo`, `pickView`
  (enemy-CO hidden until `revealedAt`), `reveal` (→ matchStart + `playing`), `onPickDeadline`
  (all-ready → reveal / else cancel + `abandoned_pick` infractions), server-authoritative
  `pick-timer.ts` (rescheduled from `pickEndsAt` at boot in both main-\* entrypoints). Mounted as
  `matches` (pickView/lockCo). WS events (`pick-started`/`co-locked`/`pick-reveal`/`match-cancelled`)
  typed in `shared/types/events.ts` and broadcast per-player (the emitter is per-player — the old
  single-arg lobby emits were suppressed no-ops).
  - tsc + eslint + prettier clean; **155/155 tests pass** (+10: `lobby-layout`, `match-player-hydration`).
- ⬜ **Not built:** MMR-on-finalize (step 5's ranking half), skins preference endpoints (step 6), the
  FE screens (step 7), matchmaking (step 8). Lobby-phase live WS (before the Match exists) deferred
  until the FE consumes it — lobby mutations return the fresh view to the caller for now.

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

## Relational, not JSON — and the v1 coexistence rule

**`playerState` is NOT retired.** A **v1 of the game still exists** and there will be a transition
period where both run; v1 keeps reading/writing `Match.playerState` unchanged. The rule is
**directional**: the **new lobby / match / picker path must not depend on `playerState`** — it reads
and writes the relational `MatchPlayer` table exclusively. The two systems **coexist**; the new
code just never reaches back into the old blob.

Per-player match facts for the **new path** live in a **real associative table** (`MatchPlayer`) so
quick SQL checks (who's ready, which CO, which team, W/L) don't parse JSON. The **volatile engine
runtime** (funds, power meter, unit positions/HP, whose turn) stays **event-sourced** (the `Event`
log + in-memory `match-store`) — unchanged. The relational rows hold the **durable/queryable** facts;
the event log holds the **game simulation**; `playerState` remains the **v1** durable store.

> **Boundary check:** any new lobby/matches usecase, view, or WS emit reads identity/team/CO/result
> from `MatchPlayer`. `playerState` may only be touched by legacy v1 code paths (and the one-off
> backfill that *seeds* `MatchPlayer` from it). No new read of `playerState`.

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

enum LobbyMembership { invited active }   // invited = pending invite; active = joined

model PlayerInLobby {
  id          String          @id @default(cuid())
  lobby       Lobby           @relation(fields: [lobbyId], references: [id], onDelete: Cascade)
  lobbyId     String
  player      Player          @relation(fields: [playerId], references: [id])
  playerId    String
  membership  LobbyMembership @default(active)  // invited row = pending; accept → active, reject → delete
  team        Int?            // self-assigned team index (null = unassigned bench)
  slot        Int?            // slot within team (or overall for FFA)
  isSpectator Boolean         @default(false)   // FFA overflow / explicit spectator
  accepted    Boolean         @default(false)   // AFK ready-check accepted (matchmaking only)
  joinedAt    DateTime        @default(now())
  @@unique([lobbyId, playerId])
  @@index([playerId])
}
```

Invites (custom lobby): **decided — a `pending`-style flag on `PlayerInLobby`** (no separate table).
An invitee is a `PlayerInLobby` row whose membership is `invited`; **accept** flips it to active,
**reject** deletes the row. One table, whole roster (members + pending) in one query. Add a
`membership` field below (`invited | active`) rather than the separate `LobbyInvite` table.

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

  players      MatchPlayer[]  // ← relational, the durable store for the NEW match path
  // playerState JSON is KEPT for v1 (transition period). New code reads MatchPlayer, never playerState.
}

model MatchPlayer {
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
  rename). `MatchPlayer` is the queryable authority for membership/team/CO/result **in the new path**.
- **`playerState` is kept** (v1 durable store, transition period). For the **new match path**, the
  in-memory `MatchWrapper` hydrates identity/team/CO from `MatchPlayer` rows + runtime from replayed
  events — it does **not** read `playerState`. v1 matches keep hydrating from `playerState` as today.
  How the two hydration paths cohabit in `match-store` (branch on `players.length > 0` vs a
  `Match.schemaVersion` flag) is the one thing to nail down in build step 2 — but it's **additive**,
  not a risky rip-out of the old code.

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
- **Per-match override:** `MatchPlayer.skins` (nullable). In the picker, the control **defaults to
  the preference** and can be changed for that match only. Visual, own-side, gameplay-irrelevant.

### 5. Ranking / MMR — wired now

On `finalizeIfGameOver` (already exists), if `isRanked`: compute rating deltas from `winnerTeamIndex`
+ each `MatchPlayer.result`, update per-league `MMR` in the same transaction, and write the new
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
- **CO-hiding (fog for generals):** a read filter strips other-team `MatchPlayer.coId` while
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
  `matchToFrontend` reading `MatchPlayer` (+ CO-hiding), `finalize` (+ MMR).
- **`src/server/players/`** — skins in preferences (`getSkins`/`setSkins`).
- Engine stays Prisma-free; the `matches`/`lobby` usecases own persistence + timers.

## Migration & backfill

- New tables: `Lobby`, `PlayerInLobby`, `MatchPlayer`, `PlayerInfraction`, `MatchmakingTicket`
  (Phase 2); `LobbyStatus` enum; `Match` columns (`isRanked`, `teamFactions`, `pickEndsAt`,
  `revealedAt`, `lobbyId`); JSON-type additions (`Preferences.skins`, `MatchRules.pickSeconds/mode`,
  `PrismaPlayerSkins`, `PrismaCoId`, `PrismaTeamFactions`).
- **Backfill playerState → MatchPlayer (seed, non-destructive):** for every existing match, explode
  `playerState` JSON into `MatchPlayer` rows (slot, team via `teamMapping`, army, coId, result).
  One-off script (reuse the backfill pattern). `playerState` **stays in place** — the backfill only
  *reads* it to seed the relational rows so old matches are visible to the new query path too. Column
  is not dropped (v1 still uses it).
- Use `rtk proxy npx prisma db push` (the rtk/prisma gotcha).

## Testing

- Lobby: team-assign validity, invite/accept, ready-check timeout → `missed_ready_check` infraction,
  spawn-match-on-accept.
- Match setup: lock→reveal (all-locked vs deadline), cancel + `abandoned_pick`, CO-hiding filter
  (enemy coId null before reveal / present after).
- Rebuild: a `setup` match reconstructs `pickEndsAt`; a `playing` match hydrates identity from
  `MatchPlayer` + runtime from events.
- Finalize: MMR deltas per `result` on a ranked match.

## Build order

1. **Schema**: Lobby/PlayerInLobby, MatchPlayer, PlayerInfraction, Match columns, enums, JSON types
   + migration + **playerState→MatchPlayer seed backfill** (non-destructive; `playerState` kept).
2. **New-path hydration (additive)**: `match-store` gains a branch that builds `MatchWrapper` from
   `MatchPlayer` + event log for new matches, **leaving the v1 `playerState` path untouched**. Guard
   the branch (e.g. `players.length > 0` or a `schemaVersion` flag). Behind tests; no rip-out.
3. **Lobby feature**: assemble/team/invite/kick + lobby view (custom path).
4. **Spawn Match(setup) + general-picker**: pick timer, `lockCo`, CO-hiding, reveal → play.
5. **Cancel + PlayerInfraction**; **MMR on finalize**.
6. **Skins** (preferences + per-match override).
7. **FE**: replace `MatchCardSetup`; wire the mockup screens with **real CO/unit sprites**.
8. **Phase 2**: matchmaking tickets + ready-check.

## Open questions — all resolved (2026-07-08)

1. **playerState retirement** — **KEPT** (v1 coexistence). New path uses `MatchPlayer` exclusively;
   backfill only *seeds* from it; new-path hydration is additive.
2. **Invites** — **`membership: invited|active` flag on `PlayerInLobby`** (no separate table).
3. **Custom lobby ready-check** — **matchmaking only.** Custom host presses Start → `Match(setup)`;
   the picker timer still catches AFK. `readyEndsAt`/`accepted` are matchmaking-only.
4. **Rating function** — **plain Elo per-league** (expected-score, fixed K, symmetric zero-sum).
   Refine (Glicko/decay) later.
5. **Team vs slot** — **`team` on `MatchPlayer` is authoritative**; `teamMapping` is derived from the
   rows at spawn (and for any legacy/engine consumer that still reads it). No dual-write.
