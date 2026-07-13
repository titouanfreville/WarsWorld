# Matchmaking — Solo Queue (MMR-based) — plan

Status: **built (2026-07-11)**. Scope: **solo queue only** (1v1). Server-authoritative throughout; reuses the
v2 Lobby / Match / ready-check machinery already built for custom lobbies. Companion to
[`lobby-backend-plan.md`](./lobby-backend-plan.md) — this is that plan's deferred "Phase 2 / step 8",
now specified.

## Goal

A player presses **Play** → joins an MMR-ranged queue → the server pairs them with the closest
available opponent → both get an **AFK ready-check** → a short **map pick & ban** phase → the
existing `spawnFromLobby` general-picker round starts. The acceptable MMR gap **widens the longer a
player waits**. A **wide-gap** pairing gets a **longer, no-penalty** ready-check.

```
Play → Queue (non-blocking, follows you) ─pair→ Ready-check ─both accept→ Map pick&ban (90s) ─both vote→
        Map reveal (30s, study locked map) → spawnFromLobby → Match(setup = CO picker) → playing → finished (→ Elo)
```

Two shaping decisions (from review, 2026-07-10):

- **The queue never blocks the UI.** It's a **persistent docked widget** that rides above whatever
  page the player is on; they can browse matches, read articles, edit preferences while queued.
  Only a found match escalates. Leaving the page they queued from does not drop them — closing the
  tab (dropping the WS subscription) does.
- **No jump straight to CO select.** Players must see the map & rules before committing a general.
  Between ready-check and CO pick sits a timed **map pick & ban**: each player **bans 2**, then
  **votes 1** of the survivors, and the final map is **rolled at random among the votes**. This
  runs in the Lobby (the Match needs a resolved `mapId` before it can exist), reusing the
  "Lobby is not the Match" split.

## What already exists (reused, not rebuilt)

- **Ready-check data model** — `Lobby.status = ready_check`, `Lobby.readyEndsAt`,
  `PlayerInLobby.accepted`. (`prisma/schema.prisma:227,367,387`)
- **Match spawn** — `MatchesUsecase.spawnFromLobby(SpawnRequest{ seats })` creates `Match(setup)` +
  `MatchPlayer` rows and kicks off the picker. (`matches/matches.usecase.ts:60`)
- **Server-authoritative timer pattern** — `pick-timer.ts` (`setTimeout`, `unref()`, DB column is
  source of truth, rebuilt on boot via `reschedulePickDeadlines`). We mirror it for ready-checks and
  the queue tick.
- **Per-player emitter pattern** — `social-emitter.ts` keyed by `playerId`; subscription registers
  `emit.next`, `onData` → refetch. We add a queue emitter in the same shape.
- **Infractions** — `PlayerInfraction` with `type = "missed_ready_check"` already named.
  (`prisma/schema.prisma:424`)
- **MMR table** — `MMR { leagueType, playerId, mmr(800), topMmr(800) }`. Exists but is **dead**:
  nothing reads or writes it today. (`prisma/schema.prisma:261`)

## What's missing (this plan builds it)

1. **Ranking (Elo) — prerequisite.** No code touches `MMR`. Matchmaking is meaningless without live
   ratings, so we build a thin `ranking` feature that updates `MMR` on match finalize and exposes a
   read used by the matchmaker.
2. **The queue itself** — an in-memory matchmaker (tickets, tolerance-over-time, pairing).
3. **A periodic tick** — none exists server-side; add one.
4. **Ready-check leniency** — the wide-gap "longer window, no sanction" behaviour.
5. **A pre-lobby per-player channel** — a queued player has no `lobbyId` yet.
6. **Map pick & ban** — a new timed lobby phase (`map_ban`) between ready-check and CO pick.

---

## Design

### 1. Ranking feature (prerequisite) — `src/server/ranking/`

Thin vertical slice. Makes `MMR` live so the queue has something to range on.

- `elo.ts` (pure, tested): standard Elo. `expected(a,b) = 1/(1+10^((b-a)/400))`,
  `delta = round(K*(score - expected))`, `K = 32`, zero-sum for 1v1. Draw = 0.5. (Team modes:
  average team rating vs average; applied per member. Only 1v1 exercised now.)
- `ranking.usecase.ts`:
  - `applyMatchResult(matchId)` — load `MatchPlayer` rows + `Match.winnerTeamIndex/leagueType`,
    compute per-team scores from `result` (`won`/`lost`/`drawn`), `upsert` each `MMR` row (default
    800), bump `topMmr`. Idempotent-guarded (skip if already applied — see below).
  - `getRatings(playerIds, leagueType)` — batch read, default 800 for missing rows. Used by the
    matchmaker at enqueue time.
- **Wire point:** the finalize transaction that already stamps `MatchPlayer.result` —
  `routers/action.ts:166-188` (and the rebuild path `match-store.ts:148`). Call
  `applyMatchResult` **only when `match.isRanked`**, inside/after that transaction.
- **Idempotency:** finalize can run on both the action path and the rebuild path. Guard so a rating
  isn't applied twice — simplest: a boolean `Match.ratedAt DateTime?` set in the same transaction;
  `applyMatchResult` no-ops if already set. (One tiny column; avoids double-counting on rebuild.)

> This is deliberately minimal (plain per-league Elo, as the lobby plan's resolved open-question #4
> specifies). Glicko/decay/placement games are out of scope.

### 2. Matchmaking feature — `src/server/matchmaking/`

#### 2a. In-memory queue — `queue.ts` (pure, tested)

Authoritative queue lives **in memory** (not the `MatchmakingTicket` table — that stays deferred to
avoid dead schema; a queued player needs a live WS subscription anyway, so nothing meaningful
survives a restart). Structure: buckets keyed by `(leagueType, mode)`.

```ts
type Ticket = {
  playerId: string;
  leagueType: LeagueType;
  mode: "1v1";        // solo queue only for now
  mmr: number;        // snapshot at enqueue (from ranking.getRatings, default 800)
  enqueuedAt: number; // ms; PRESERVED across a requeue so a wronged player keeps their place
};
```

**Tolerance grows with wait time:**
```
tolerance(waitedSec) = min(MAX_TOLERANCE, BASE_TOLERANCE + RATE * waitedSec)
// BASE_TOLERANCE = 100, RATE = 15 /s, MAX_TOLERANCE = 2000  (tunable constants)
```

**Pairing rule (per tick, per bucket):** sort oldest-first; for the oldest unpaired ticket, pick the
**closest-MMR** partner that satisfies the gap. Compatible iff
`|a.mmr - b.mmr| <= min(tolerance(a), tolerance(b))`.

> **`min` (decided):** both players must independently accept the gap — the *stricter/symmetric*
> rule. Neither is dragged into a match wider than their own tolerance. Because both tolerances grow
> with wait time, a mismatched pair still eventually becomes compatible once **both** have waited
> long enough; `MAX_TOLERANCE` is set high (2000) so a long-waiting extreme-rating player is not
> permanently starved. The AFK-check leniency (below) still fires for the wide gaps that `min`
> admits after a long wait.

Greedy oldest-first pairing is fine for solo 1v1; note in a `log()`/comment that it's not globally
optimal (no stable-matching), which is acceptable at this scale.

**Anti-rematch:** keep a short-lived `Set` of recently-declined `{a,b}` pairs (~30s cooldown) so a
declined pair isn't immediately re-offered.

#### 2b. Ready-check lifecycle — `matchmaking.usecase.ts`

On a pair `(A, B)`:

1. Compute `mmrDiff = |A.mmr - B.mmr|` and pick leniency:
   - `mmrDiff <= LENIENT_GAP` (e.g. 400) → `lenient = false`, `readySeconds = 20`.
   - `mmrDiff >  LENIENT_GAP` → `lenient = true`, `readySeconds = 40` (**longer**, **no sanction**).
2. Build a **map pool**: pick `MAP_POOL_SIZE` (7) random `WWMap`s with `numberOfPlayers >= 2` for
   the league. (`mapId` is left **null** on the lobby — it's resolved by the ban phase, not now.)
3. Create a **matchmaking Lobby**: `hostPlayerId = null`, `mode = "1v1"`, `isRanked = true`,
   `status = ready_check`, `readyEndsAt = now + readySeconds`, `readyCheckLenient = lenient`,
   `mapPool` (the 7 ids), rolled `teamFactions`, `rules` (league defaults). Two `PlayerInLobby`
   rows, `accepted = false`, auto-seated (A → team 0/slot 0, B → team 1/slot 0).
4. Remove both tickets from the queue; `schedule` a ready-check deadline (mirrors `pick-timer`);
   emit `ready-check-started { lobbyId, readyEndsAt, lenient, mmrDiff }` to both via the queue
   emitter.
5. **Accept** (`acceptReadyCheck(lobbyId, playerId)`): set `accepted = true`. When **both** accepted
   → cancel the ready-check timer → **enter the map pick & ban phase** (§2b-bis), *not* the match
   yet: `Lobby.status = map_ban`, `mapPhaseEndsAt = now + MAP_PHASE_SECONDS`, emit
   `map-phase-started { lobbyId }`. The player now has a `lobbyId`, so this phase is driven by the
   **existing `lobby.onUpdate` subscription** (refetch the lobby view), not the queue emitter.
6. **Accept is a commitment.** Declining (`declineReadyCheck`) is **only offered on a wide-gap
   (lenient) match** — a normal ranked check must be accepted or it times out. And once you've
   accepted you **can't back out** (decline after accept is rejected). So the only way to fail a
   *normal* check is the **timeout**; `decline` is a penalty-free bail reserved for wide-gap matches.
7. **Decline (lenient only) or timeout** (deadline with someone unaccepted):
   - `Lobby.status = cancelled`.
   - For each non-accepter: **if `!lenient`** (only possible via timeout), write
     `PlayerInfraction(missed_ready_check)`; a lenient decline/timeout writes **no infraction**.
   - **Requeue every accepter** with their **original `enqueuedAt`** (keep their wait/tolerance) and
     record the pair in the anti-rematch cooldown; emit `requeued` to them and `dismissed` to the
     non-accepter.

`readyCheckLenient` is stored on the Lobby (not just in memory) so an in-flight ready-check survives
a restart the same way pick deadlines do.

#### 2b-bis. Map pick & ban — the lobby phase before the Match

Runs entirely in the Lobby (`status = map_ban`), because a Match row requires a non-null `mapId`
that this phase produces. Three steps, one shared deadline (`Lobby.mapPhaseEndsAt`):

1. **Ban** — each player bans **2** of the 7 pooled maps. Bans stored on `PlayerInLobby.bannedMapIds`
   (Json `string[]`). With 2 players × 2 bans (distinct), **≥3 survive**.
2. **Vote** — each player votes for **1** surviving map (`PlayerInLobby.votedMapId`). A player can't
   vote a banned map; the server rejects it.
3. **Roll** — once both have voted (or the deadline fires), the final map is chosen **at random from
   the set of voted maps**. Both voted the same → that map; split → coin-flip between the two. This
   makes a shared favourite *likely but not guaranteed* (avoids deterministic map-gaming).

`resolveMapBan(lobbyId)` (reached once **both have voted**): roll the winner among the votes, then
**enter the reveal** — `Lobby.status = map_reveal`, `Lobby.mapId = winner`, a fresh
`MAP_REVEAL_SECONDS` (30s) deadline — so both players see the locked map's full dossier before the
CO pick. `onMapRevealDeadline` then `spawnFromLobby({ mapId, seats, ... })` → `Lobby.status = started`
→ emit `match-found { matchId }` → FE redirects into the CO picker. The FE map screen
(`MapBanScreen`) is a CO-picker/war-room hybrid: a roster of candidate maps drawn as **real terrain
thumbnails** (`MapThumbnail`, shared palette with the board minimap), a focused-map **dossier**
(size, players, rules chips, property legend, forces) and a **confirm** action for each ban/vote — so
selections are always reviewed before they commit. `mapBanView` is enriched with each map's terrain
grid + details + the chosen map. **Deadline = abandonment, not auto-fill:** `onMapPhaseDeadline`
cancels the lobby and writes a `PlayerInfraction(abandoned_map_ban)` for anyone who didn't vote
(same treatment as a non-lenient missed ready-check), requeues the player(s) who *did* pick (original
`enqueuedAt` preserved), and emits `dismissed` / `requeued`. No vote is ever cast on a player's
behalf. Server validates every ban/vote (owns the pool, rejects duplicates / banned / foreign map
ids). Map-phase mutations (`banMap`, `voteMap`) go through the `matchmaking` usecase and notify via
`emitLobby` (reusing the lobby room bus), so the board is just another `lobby.onUpdate` refetch.

The pick-timer-style scheduler (`lobby-phase-timer.ts`, below) also holds `map_ban` deadlines keyed
by `lobbyId` → `resolveMapBan`. Rebuilt on boot from `Lobby{ status: map_ban, mapPhaseEndsAt }`
alongside the ready-checks.

#### 2c. Timers & tick — `lobby-phase-timer.ts` + queue tick

- `lobby-phase-timer.ts`: copy of `pick-timer.ts` (`setTimeout`, `unref()`, cancel/reschedule),
  keyed by `lobbyId`, holding **both** the ready-check (`readyEndsAt` → timeout) and the map-ban
  (`mapPhaseEndsAt` → `resolveMapBan`) deadlines. `rescheduleLobbyPhases()` rebuilds both from
  `Lobby{ status: ready_check|map_ban }` on boot.
- **Queue tick:** a self-rescheduling `setTimeout` (`unref()`), interval ~2s, calling
  `usecase.tick()` (pair everything pairable this pass). Started from **both** entrypoints after
  `matchStore.rebuild()`:
  - `main-wss-development.ts` and `main-production.ts`, right after `reschedulePickDeadlines()`:
    `await matchmakingUsecase.rescheduleLobbyPhases(); matchmakingUsecase.startQueueTick();`

#### 2d. Transport — emitter, subscription, router

- `src/server/emitter/matchmaking-emitter.ts` — keyed by `playerId` (clone of `social-emitter`).
  Drives the **pre-lobby** part (before a `lobbyId` exists). Events: `queue-updated`
  (size/elapsed), `ready-check-started { lobbyId, readyEndsAt, lenient, mmrDiff }`,
  `match-found { matchId }`, `requeued`, `dismissed`, `left`. Once a lobby exists (ready-check → map
  ban), the board rides the **existing `lobby.onUpdate`** bus — no duplication.
- `matchmaking/schemas.ts` — `joinQueueSchema { leagueType, mode: "1v1" }`, `withLobbyIdSchema`,
  `mapActionSchema { lobbyId, mapId }`.
- `matchmaking/router.ts` (all `playerBaseProcedure`):
  - `join` → `enqueue(currentPlayer.id, input)` (rejects if already queued or in a live match).
  - `leave` → `dequeue(currentPlayer.id)`.
  - `onQueueEvent` → `subscription` registering the per-player emitter listener; **its teardown
    dequeues** the player (leaving the search screen / disconnect = leave queue).
  - `acceptReadyCheck` / `declineReadyCheck` → the usecase methods above.
  - `banMap` / `voteMap` → the map-phase mutations (§2b-bis); validate against `Lobby.mapPool`.
  - `status` (query) → current ticket state (in queue? elapsed? est. range) for the search screen.
- Mount as `matchmaking` in `routers/app.ts`.

### 3. Frontend (backend-first; specified, built last)

Mockup: `.ai/plans/` companion (published artifact) — persistent widget + ready-check + map-ban board.

- **Play button** (on `your-matches` / home) → mode/league select → `matchmaking.join`.
- **Persistent queue widget** — a **global** component mounted once in `_app.tsx` (via a small
  `QueueProvider` context) so it survives page navigation, not tied to any route. It holds the
  `matchmaking.onQueueEvent` subscription and renders a **docked, non-blocking** card:
  - *Searching* — elapsed timer + a live-widening "acceptable ±N MMR" band; **Cancel** → `leave`.
  - *Match found* — Accept / Decline with a ring countdown from `readyEndsAt`; when `lenient`, the
    amber "wide skill gap — decline without penalty" banner and the longer window.
- **Map pick & ban screen** — on `map-phase-started` the widget routes into the lobby view (drives
  off `lobby.onUpdate`): the 7-map board, ban-2 → vote-1, deadline bar, and the read-only rules
  strip so the player sees the game before choosing a CO.
- On `match-found { matchId }` → redirect into the existing CO-picker route.

---

## Schema changes (minimal)

- `LobbyStatus` enum: add **`map_ban`** (between `ready_check` and `started`).
- `Lobby.readyCheckLenient Boolean @default(false)` — drives the no-sanction / longer-window path,
  restart-resilient.
- `Lobby.mapPool Json?` — the 7 candidate map ids for the ban phase (`mapId` stays null until roll).
- `Lobby.mapPhaseEndsAt DateTime?` — map-ban deadline (mirrors `readyEndsAt`).
- `PlayerInLobby.bannedMapIds Json?` (string[]) and `PlayerInLobby.votedMapId String?` — the
  per-player ban/vote choices.
- *(optional)* `Lobby.mmrDiff Int?` — audit/display of the gap that produced the match.
- `Match.ratedAt DateTime?` — idempotency guard for the MMR update.
- **No `MatchmakingTicket` table** — queue stays in memory (avoids dead schema; consistent with the
  lobby plan's "avoid dead schema" principle). `MMR` already exists; `Lobby.mapId` is already
  nullable.
- Apply with `rtk proxy npx prisma db push` (the rtk/prisma gotcha in root `CLAUDE.md`).

## Module layout (per `src/server/CLAUDE.md`)

```
src/server/ranking/
  elo.ts               pure Elo math (tested)
  ranking.usecase.ts   applyMatchResult · getRatings   (deps: prisma)
  router.ts            optional read endpoints (rating/leaderboard) — thin
src/server/matchmaking/
  queue.ts             in-memory tickets + tolerance + pairing (pure, tested)
  map-ban.ts           pure ban/vote/roll resolution (pure, tested)
  lobby-phase-timer.ts setTimeout/unref, reschedule-on-boot (ready-check + map-ban; mirror pick-timer)
  matchmaking.usecase.ts  enqueue · dequeue · tick · createReadyCheck · accept · decline ·
                          banMap · voteMap · resolveMapBan · rescheduleLobbyPhases · startQueueTick
                          (deps: prisma, ranking usecase, matches usecase [spawnFromLobby])
  schemas.ts · router.ts
src/server/emitter/matchmaking-emitter.ts   per-player pre-lobby queue events
```

Matchmaking imports **`ranking`** (ratings) and **`matches`** (`spawnFromLobby`) through their
usecase methods — narrow cross-feature contracts, like `lobby → matches` already does. Engine stays
untouched.

## Constants (tunable, one place)

`BASE_TOLERANCE=100`, `RATE=15/s`, `MAX_TOLERANCE=2000`, `LENIENT_GAP=400`, `READY_SECONDS=20`,
`READY_SECONDS_LENIENT=40`, `TICK_MS=2000`, `REMATCH_COOLDOWN_MS=30000`, `ELO_K=32`,
`MAP_POOL_SIZE=7`, `BANS_PER_PLAYER=2`, `SECONDS_PER_MAP_DECISION=30` →
`MAP_PHASE_SECONDS=(BANS_PER_PLAYER+1)*30=90`, `MAP_REVEAL_SECONDS=30`.

## Testing (pure where it matters)

- `elo.ts` — expected score symmetry, zero-sum 1v1, K, draw = 0.5, default-800 upset delta.
- `queue.ts` — tolerance grows with wait; pairing picks the closest partner; respects
  `(league,mode)` buckets; `min`-rule gap; anti-rematch cooldown; requeue preserves `enqueuedAt`.
- `map-ban.ts` — 2 distinct bans leave ≥3 survivors; can't ban/vote outside the pool; roll picks
  only among voted survivors (same vote → deterministic, split → one of the two; a vote banned out
  at the last moment is skipped).
- `matchmaking.usecase` — pair → ready-check → both accept → **map ban** → both vote →
  `spawnFromLobby` called with the rolled `mapId` + correct seats; ready-check **timeout** →
  `missed_ready_check` + acceptor requeued; **decline forbidden** on a normal check and **after
  accept**; lenient decline → **no** infraction + other player requeued; **map-phase deadline** →
  `abandoned_map_ban` for the non-voter + picker requeued + no spawn; reschedule both phases on boot.
- `ranking.usecase` — MMR delta on a ranked finalize, `topMmr` bump, default-800 seeding,
  `ratedAt` idempotency (no double apply on rebuild).

## Build order

1. **Ranking**: `elo.ts` + `ranking.usecase` + wire into `action.ts` finalize (gated on `isRanked`)
   + `Match.ratedAt`. Tests. *(Prerequisite — makes MMR move.)*
2. **Schema**: `LobbyStatus.map_ban`, `Lobby.readyCheckLenient`/`mapPool`/`mapPhaseEndsAt`
   (+ optional `mmrDiff`), `PlayerInLobby.bannedMapIds`/`votedMapId`, `Match.ratedAt`; `db push`.
3. **Queue core**: `queue.ts` (tolerance + `min` pairing) + tests.
4. **Ready-check lifecycle**: `matchmaking.usecase` create/accept/decline/timeout, infractions,
   requeue + `lobby-phase-timer.ts` + tests.
5. **Map pick & ban**: `map-ban.ts` (ban/vote/roll) + usecase `banMap`/`voteMap`/`resolveMapBan`
   → `spawnFromLobby` with the rolled map; map-phase deadline + reschedule + tests.
6. **Transport + boot**: `matchmaking-emitter`, `router` (+ subscription teardown dequeue), mount in
   `app.ts`, queue tick + `rescheduleLobbyPhases` in both `main-*` entrypoints.
7. **Frontend**: global `QueueProvider` + persistent widget (searching / ready-check), map-ban
   screen, redirect into the CO picker.
8. `npm run lint` + full test suite green.

## Decisions (resolved 2026-07-10)

1. **Pairing tolerance rule** — **`min`** (stricter/symmetric; both players must accept the gap).
   `MAX_TOLERANCE` kept high (2000) so long-waiting extreme-rating players aren't starved.
2. **Ranking/Elo prerequisite** — **included** (step 1). MMR is made live before the queue relies
   on it.
3. **Map selection** — **map pick & ban** (§2b-bis), superseding the earlier "random single map"
   idea (review 2026-07-10): a 7-map random pool → each player bans 2 → votes 1 → random roll among
   the votes. Pool is drawn from eligible 2-player `WWMap`s for the league; no curated pool yet.
4. **Queue is non-blocking** — a persistent, page-independent widget (global `QueueProvider`), not a
   full-screen search. See the published mockup.
