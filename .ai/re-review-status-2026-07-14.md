# Re-review status — `refactor/decouple-engine-from-prisma` (2026-07-14, autonomous session)

Second full-review (sheik + bmad Blind/Edge hunters) ran against the committed refactor. Headline:
**the refactor was validated as regression-free** — sheik confirmed the extraction is real (engine
Prisma-free, core imports nothing outward, FE decoupled), and both bmad hunters verified the
behavioral changes (fuel helper, join fix, server-match-state split, lint sweep) are
behavior-preserving. Findings were pre-existing debt + finer edge cases, not refactor regressions.

Per your instruction (solve all that can be solved, park questions for a full review), I fixed the
safe/bounded items autonomously and deferred the heavy/judgment ones. **All green: tsc · eslint ·
prettier · 463 tests · `next build`.**

## ✅ Fixed tonight (committed)
- **`fix: address re-review findings`** — engine import boundary: removed the engine→trpc edge
  (`WithMatchId` is now engine-owned; trpc/emitter import it from the engine) and tightened the
  engine ESLint override to forbid transport (routers/trpc) + sibling-feature imports; renamed
  `DispatchedError.ts` → `dispatchable-error.ts`; fixed stale `domain-entities` paths in ESLint
  messages; documented the deliberate type-only pixi import in `core/spritesheet-data`. Plus
  edge-case guards: defensive `JSON.parse` for notification payloads (shared helper, no render
  crash); `seed-cos` throws on an unknown unit key; `rollMap` throws on an empty pool; `canBan`
  rejects an already-banned map; QuickChat `startDM` clears the partner on error; `displayName[0]`
  guarded; `getPathFuelCost` typed `Position[]`.
- **`fix(matchmaking)`** — ready-check/vote stale-snapshot stalls: `acceptReadyCheck` + `voteMap`
  now compute completion from state re-read *after* the write (voteMap also ignores spectators).
- **`refactor(server)`** — single `composition-root.ts`; routers + WS entrypoints import their
  usecase from there; no router imports a sibling router's singleton (#11 resolved).
- **`refactor(engine)`** — moved `buildTurnSnapshot`/`buildPublicPowerSummary` out of
  `routers/match/` into `engine/previews/turn-snapshot.ts` (#10 resolved).

## ✅ DONE 2026-07-14 (attended) — #4 social feature
Extracted `social/schemas.ts` + `social.usecase.ts` (prisma injected via the composition root);
`router.ts` is now thin bindings. All 5 bugs fixed with pure usecase tests (12 new, vi.fn Prisma):
#10 ownership on category/friendship mutations; #9 read-cursor moved to a `markConversationRead`
mutation (FE calls it on open/new-message, not per refetch) — `getConversationHistory` is read-only;
#17 `getOrCreateMatchChannels` upserts on the existing `(matchId, teamIndex)` unique (no schema
change needed — the constraint was already there); #19 `sendMessage` closes cancelled-match chat +
throws on a vanished conversation; #20 block/mute reject self + non-existent targets. Green: tsc ·
eslint · prettier · 475 tests.

## ✅ DONE 2026-07-14 (attended) — transport reorg + #12
- **Transport out of domain:** all 8 feature routers moved `src/server/<feature>/router.ts` →
  `src/server/routers/<feature>.ts`; domain folders hold only schemas + usecase. Root + server
  CLAUDE.md updated (transport ≠ domain).
- **#12 converged:** the three match routers (match/matches/matchPreview) unified under one `match`
  namespace in `routers/match/` (lifecycle + `match.previews.*` + `match.pick.*` via mergeRouters);
  `action` moved into the folder but kept as its own namespace. FE call-sites + the 4 inferred
  read-models (now on a `RouterOutput` type) updated.
- **Declutter:** 5 Prisma-free match derivation helpers (fog-view, game-over, finalize, match-stats,
  match-grade) moved out of `routers/match/` into `engine/previews/`. Green: tsc · eslint · 475
  tests · `next build`.

## ⬜ Still deferred to your review (with reasons)
1. (#12 done — see above.)
3. **#13 — CO data three sources (`CO_PROFILES` vs `co-repo`).** Deleting `CO_PROFILES` would break
   the engine (it reads it directly); this is a cutover gated on the game-data-in-DB path becoming
   authoritative.
4. **`banMap` TOCTOU** (`matchmaking.usecase.ts`, flagged in-code with `TODO(review)`) — two
   simultaneous bans of the last two survivors defeat the last-survivor guard. Race-safe fix needs
   an atomicity decision (serializable isolation + retry, or an app-level per-lobby lock).

## Notes
- `.omc/` session state and new untracked `public/img/CO/smoothFull/*.webp` CO-art assets were left
  uncommitted — they aren't my work; commit or gitignore as you see fit.
- Consider adding `.omc/` to `.gitignore` (it's local tooling state, currently tracked).
