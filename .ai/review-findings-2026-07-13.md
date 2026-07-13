# Full-review findings — `refactor/decouple-engine-from-prisma` (2026-07-13)

Two passes: **sheik** (architecture/guideline) + **bmad** (Blind Hunter + Edge Case Hunter, correctness/edge).
Tags: `[sheik]` `[bmad]` `[both]`.

## Active — being handled now (1–4)

1. `[bmad]` **Fuel check vs drain in `move.ts`** — INVESTIGATED: *not actually a bug.*
   Validation (`move.ts:50`) uses `path.length` where `const [unitPosition, ...path] = action.path`
   → excludes start = tiles entered. Apply (`move.ts:282`) uses `event.path.length - 1` where
   `event.path` includes start → also tiles entered. **Both = `(action.path.length-1)*cost`, consistent.**
   Blind Hunter conflated two different `path` variables. Real issue = confusing dual representation
   → unify expression / add clarity so the start tile is obviously ignored on both sides. Low risk.

2. `[bmad]` **Small map pool → both players ban every survivor → both flagged offenders**
   `matchmaking/map-ban.ts:26` (`canBan`, no last-survivor guard) + `matchmaking.usecase.ts:1576`
   (`buildMapPool`, no min-pool guard). Fewer than 5 two-player maps → pool empties → `voteMap`
   rejects all → `failMapBan` writes `abandoned_map_ban` against players who couldn't vote.
   → ACTION: add min-pool guard (createReadyCheck) and/or last-survivor guard in `canBan`.

3. `[sheik]` **Engine never extracted** — CONFIRMED: `src/server/engine` and `src/server/core` do
   NOT exist and never existed in git history (`git log --all -- src/server/engine` empty).
   12 `src/server` files still import `shared/match-logic`; 36 import `shared/` at all. Branch
   *adds* ~2k new lines into deprecated `src/shared/match-logic`. The FE has a v2 board, but the
   BE engine extraction was never done. → Needs to be a real planned effort in the v2 base.

4. `[both]` **`social/router.ts` — structural + concrete bugs** — 689-line transport, 46 inline
   prisma calls, no `usecase.ts`/`schemas.ts`. Concrete bugs within: #10, #9, #17, #19, #20.
   → ACTION: extract usecase + schemas, add ownership/authz guards.

## Deferred — watch after (5–22)

5.  `[both bmad]` Stale-snapshot races in `acceptReadyCheck`/`voteMap` (`matchmaking.usecase.ts:1151,1322`) — phase stalls to deadline. **High-confidence (both hunters).**
6.  `[bmad]` Concurrent bans read stale `bannedMapIds` → a ban silently lost (`matchmaking.usecase.ts:1288`).
7.  `[bmad]` `finalizeIfGameOver` mutates in-memory match before persist transaction (`action.ts:2142`) → memory/DB divergence on tx failure.
8.  `[bmad]` `onMapRevealDeadline` strands lobby in `map_reveal` if `spawnFromLobby` throws (`matchmaking.usecase.ts:1453`).
9.  `[bmad]` `getConversationHistory` (a tRPC query) performs writes + emits (`social/router.ts:3827`).
10. `[bmad]` `assignFriendToCategory`/`removeFriendFromCategory` no ownership check (`social/router.ts:3592`).
11. `[sheik]` Cross-feature router imports + composition via mutable module singletons (`matchmaking/router.ts`, `lobby/router.ts`).
12. `[sheik]` Three coexisting match routers (`routers/match.ts` + `routers/match/*` + `matches/`).
13. `[sheik]` CO data two sources of truth (hardcoded `CO_PROFILES` vs `co-repo.ts`).
14. `[both]` Team Elo score taken from first member only (`ranking.usecase.ts:2015`) — 0/0 on all-null results. **High-confidence (both hunters).**
15. `[bmad]` `spawnFromLobby` seat hazards: unchecked `armies[i]`; no `matchSlot===0` seat → `getCurrentTurnPlayer()` throws (`matches.usecase.ts:284`, `match-player.ts:184`).
16. `[bmad]` `pickView`/`mapBanView` leak roster/faction/ban state to non-participants (`matches.usecase.ts:396`, `matchmaking.usecase.ts:1496`).
17. `[bmad]` `getOrCreateMatchChannels` duplicate conversations under concurrency (`social/router.ts:3678`).
18. `[bmad]` `resolveMapBan` double-resolve re-rolls map non-deterministically (`matchmaking.usecase.ts:1409`).
19. `[bmad]` `sendMessage` gate ignores `cancelled` status + null conversation (`social/router.ts:3737`).
20. `[bmad]` `block`/`mutePlayer` no target-existence/self validation (`social/router.ts:3987`).
21. `[bmad]` `days` off-by-one at round boundaries (`match-stats.ts:3004`).
22. `[sheik]` File-size discipline (`co-profiles.ts` 1361, `matchmaking.usecase.ts` 773, `social/router.ts` 689).

Note (from Blind Hunter): fog/masking changes (`maskUnitForViewer`, `fogViewChangeableTiles`,
`continue` fix in `vision-update.ts`, `Map`-keyed `ownedProperties` in `vision.ts`) reviewed and
found correct — no defects.
