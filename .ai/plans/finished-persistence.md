# Plan — persist match outcome (`finished` + per-player result)

Status: **IMPLEMENTED & verified** (2026-07-08). Chosen shape: per-player `result` + match columns.

Verified: app+server tsc 0 errors, eslint/prettier clean, `finalize-game-over.test.ts` 4/4 pass,
and the backfill promoted a decided match (winnerTeamIndex=1; playerState results won/lost written).
Files: `prisma/schema.prisma`, `shared/types/server-match-state.ts` (`result`),
`server/routers/match/finalize.ts`, `action.ts` (finalize+persist+`matchEnd` emit),
`match-store.ts` (rebuild finalize + `getAllMatches`), `match/util.ts` (`finishedRowToFrontend`),
`match.ts` (`getPlayerFinishedMatches`), FE `your-matches.tsx` + `MatchHistoryRow.tsx`,
`prisma/scripts/backfill-finished.ts`, `src/tests/features/finalize-game-over.test.ts`.

## Decisions (locked)

1. **Derive-and-finalize** (Approach A) — integrate into the current action flow. No `game-over`
   event in the log for now.
2. **Emit a live `match-finished`** notification so open boards flip to a result screen in real time.
3. **MMR** — confirmed **not wired anywhere** (`model MMR` exists, never written). Left as a separate
   follow-up PR; `finalizeIfGameOver` is where it will hook in later.
4. **Backfill** — provide a one-off script to finalize already-decided matches.

## ⚠ Critical finding — finished matches leave the hot store

`match-store.rebuild()` loads only `status: { not: "finished" }`. So once we persist a match as
`finished`, **on the next server boot it is not replayed into memory** — it's archived. But
`getPlayerMatches` reads the in-memory `playerMatchIndex`, so **History (finished games) must read
from the DB**, or it goes empty after a restart. This matches the original intent (finished =
archived). Added to the read-path below.

## Goal

Stop deriving the match outcome on every read. Persist a durable, queryable outcome:

- `Match.status = "finished"` (enum value already exists, currently never set)
- `Match.winnerTeamIndex` (`null` = draw)
- `Match.finishedAt`
- per-player `result: "won" | "lost" | "drawn"` inside `playerState`

Downstream consumers: lobby History/filters (already reads `finished`), and **ranking/MMR**
(needs per-player win/loss — see `model MMR`).

## Current state (why this is non-trivial)

- **Outcome is fully derived**: `matchToFrontend` → `deriveGameOver(match) !== null`
  (`src/server/routers/match/util.ts:29`, `.../match/game-over.ts`). Keys off engine elimination
  status (`PlayerInMatch.status: "alive" | "routed" | "captured"`).
- **In-game actions persist only the EVENT**, not match state: `action.ts` ends with
  `prisma.event.create(...)` and never writes `match.status`/`playerState`. Match state is held in
  `match-store` and **rebuilt by replaying the event log** on boot.
- **DB snapshot columns** (`match.status`, `match.playerState`) are written only at
  `create` (setup), `join`/`leave`/`switchOptions`, and `setReady` (→ `playing`). **Never
  `finished`.** DB currently: 7 matches, 0 finished.
- Consequence: elimination lives only in the replayed event stream + derived state. There is no
  single authoritative "this game is over, X won" record.

## Chosen data model

### Prisma migration (`Match`)

```prisma
model Match {
  // ...existing...
  status          MatchStatus   // now actually set to `finished`
  winnerTeamIndex Int?          // null while playing; null when finished => draw
  finishedAt      DateTime?
}
```

Migration: `npx prisma migrate dev --name match-outcome`. Two nullable columns → safe, no backfill
required for existing rows (all still `playing`/`setup`).

### Per-player `result` (no column — lives in `playerState` JSON)

`playerState` is `Json` typed as `PlayerInMatch[]` via `prisma-json-types-generator`
(`src/server/prisma/prisma-json-types.ts`). Add one optional field to `PlayerInMatch`
(`src/shared/types/server-match-state.ts`):

```ts
export type PlayerInMatch = {
  // ...existing...
  status: "alive" | "routed" | "captured";
  result?: "won" | "lost" | "drawn"; // set once, at finish
};
```

No migration for this (JSON), only a type change. `result` is set at finish; before that it's
`undefined`.

## Where the flip happens (engine derives, `matches` feature persists)

Per the layering rules the engine stays Prisma-free: `deriveGameOver` already lives in the
`matches` router area, not the engine. Add one shared helper:

```
src/server/routers/match/finalize.ts
  finalizeIfGameOver(match): { winnerTeamIndex: number | null } | null
    - if match.status !== "playing" -> return null
    - const go = deriveGameOver(match, undefined); if (go === null) return null
    - match.status = "finished"
    - for each player: player.data.result =
        go.winnerTeamIndex === null ? "drawn"
        : player.team.index === go.winnerTeamIndex ? "won" : "lost"
    - return { winnerTeamIndex: go.winnerTeamIndex }
```

Two call sites:

1. **On action apply → persist snapshot** (`action.ts`, right after `prisma.event.create`):
   ```ts
   const finished = finalizeIfGameOver(match);
   if (finished !== null) {
     await prisma.match.update({
       where: { id: match.id },
       data: {
         status: "finished",
         winnerTeamIndex: finished.winnerTeamIndex,
         finishedAt: new Date(),
         playerState: match.getAllPlayers().map((p) => p.data), // now carries result
       },
     });
     // (optional) emit a "match-finished" event to live clients
   }
   ```
2. **On rebuild** (`match-store` hydrate, after replaying events): call `finalizeIfGameOver(match)`
   (no DB write needed — DB already has the snapshot) so the in-memory `status` matches what the DB
   says. This keeps a rebooted server consistent with the persisted outcome.

### Read path

**Active matches (in-memory)** — `matchToFrontend` reads the stored value, drops per-read
derivation:

```ts
state: match.status,                        // now authoritative
finished: match.status === "finished",      // was deriveGameOver(...) !== null
// players already carry `result`; also expose winnerTeamIndex if the FE wants it
```

**Finished matches (archived, DB-only)** — new query `getPlayerFinishedMatches({ playerId })` in the
`matches` router that reads the DB directly (finished matches aren't in `playerMatchIndex`):

```ts
// pseudo — matches feature dbo
prisma.match.findMany({
  where: { status: "finished", playerState: { array_contains: [{ id: playerId }] } },
  include: { map: true },
  orderBy: { finishedAt: "desc" },
}).then(rows => rows.map(rowToFrontend)); // rowToFrontend mirrors matchToFrontend from JSON
```

> Note: `playerState` is JSON; the membership filter may need a raw/`array_contains` predicate or a
> post-fetch filter, since `_MatchToPlayer` relation rows are currently empty. Simplest correct
> version: fetch finished matches and filter in JS by `playerState.some(p => p.id === playerId)`.
> (Revisit if finished-match volume grows — then populate the relation table on finish.)

**Frontend** — `your-matches.tsx` fetches the DB-backed finished list for the History view and feeds
it into `categorizeMatches`'s `history` bucket (or bypasses categorize for history). Active views
keep using the in-memory `getPlayerMatches`. `deriveLobbyStatus` already reads `finished` +
per-player `status`; it can switch to the explicit `result` later.

### Backfill (one-off)

Script `prisma/scripts/backfill-finished.ts` (run once): load each non-finished match, replay its
events (reuse the rebuild path), `finalizeIfGameOver`, and if decided write
`status/winnerTeamIndex/finishedAt/playerState(result)` to the DB. Idempotent (skips already
`finished`). Dev DB currently has 0 finished, ~2 derived-decided → this promotes them.

## Replay-consistency note (the one real design risk)

Two ways to keep the event log the source of truth:

- **A. Derive-and-finalize (this plan).** Finish is deterministically derivable from state
  (`deriveGameOver`), so both the action path and rebuild reach the same result. DB columns are a
  queryable projection. Lowest effort; the snapshot write is a cache.
- **B. `game-over` event (cleaner long-term).** Append a real `game-over` event to the log (the
  commented-out `playerEliminatedEvent` TODO in `action.ts:145` gestures at this). Rebuild
  reproduces `finished` purely by replaying, no special finalize on load.

Recommendation: ship **A** now (small, correct, unblocks History/ranking), and note **B** as the
event-sourcing-pure follow-up. Both produce identical DB columns, so **A → B is not a breaking
change.**

## Ranking / MMR (out of scope here, but this unblocks it)

`model MMR` exists but isn't updated on finish. With per-player `result` persisted, a follow-up can
update MMR in the same `finalizeIfGameOver` transaction (won/lost/drawn → rating delta). Flagged,
not built here.

## Draws

`winnerTeamIndex === null` && `status === "finished"` ⇒ draw ⇒ every player `result = "drawn"`.
`deriveGameOver` already returns `winnerTeamIndex: null` when zero teams remain in play.

## Test plan

- Unit: `finalizeIfGameOver` — 2-team elimination → winner `won` / loser `lost`; mutual
  elimination → all `drawn`; still-contested → returns null, status unchanged; idempotent when
  already finished.
- Rebuild: replay a finished match's events → in-memory `status === "finished"` and results match
  the DB snapshot.
- Read: `matchToFrontend` returns `finished: true` + results without calling `deriveGameOver`.

## Open questions for you

1. **A vs B** — ship derive-and-finalize now (recommended), or go straight to a `game-over` event?
2. **`match-finished` live event** — emit one to connected clients on finish (so an open board
   flips to a result screen live), or rely on next fetch?
3. **MMR** — wire rating updates into the same finish transaction now, or a separate PR?
4. **Backfill** — any dev matches to retro-finalize, or leave existing rows as-is?
```
