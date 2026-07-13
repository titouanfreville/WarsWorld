# Plan — Engine extraction (`src/shared/match-logic` → `src/server/engine` + `core`)

**Origin:** full-review finding #3 `[sheik]`, confirmed 2026-07-13.

## ✅ DONE 2026-07-13 (this session) — engine relocated, FE decoupled
- **v1 board removed** — deleted `MatchLoader.tsx`, the `?v1` toggle, the `.old` page backup,
  `MatchRenderer` + the whole old pixi runtime (18 files: FrontendUnit, setupApp, renderMap,
  renderUnitSprite, in-game-menus, use-pixi…). Extracted shared tile-size constants →
  `src/pixi/render-constants.ts` (repointed 18 importers). ~22 files removed.
- **FE fully engine-decoupled** — 0 FE files import the engine (was 18 `wrappers` + 8 `match-logic`).
  Architectural decision #2 ("FE never runs the engine") now true in code. v2 board is BE-only.
- **Engine relocated** — `src/shared/match-logic` + `src/shared/wrappers` (114 files) moved to
  `src/server/engine/{rules,events,constants,previews,entities}`. Normalized 256 relative imports to
  absolute first, then moved + rewrote 412 specifiers repo-wide (incl. prisma/scripts). Added an
  ESLint override enforcing the Prisma-free (+ no frontend/pixi) boundary on `src/server/engine/**`.
- **Verified green:** tsc clean · 463 tests pass · engine eslint clean · engine has 0 `@prisma/client`.

## ✅ DONE 2026-07-13 — the `core` kernel (backend), FE on interim shims
- **13 vocabulary schemas moved** `shared/schemas` → `src/server/core/schemas` (action, army, co,
  game-version, match-rules, player-slot, position, spritesheet-data, tile, unit-traits, unit,
  variable-tiles, weather). Repointed 143 specifiers across 65 backend/engine/prisma files → the
  **engine now imports `core`** (44 engine files).
- **FE boundary preserved:** FE imports **0** `server/core`. `src/shared/schemas/*` are now 13
  re-export **shims** (`export * from "server/core/schemas/…"`) so the FE + other `shared/*` keep
  compiling unchanged. The FE's real fix — **fetch vocabulary from the BE and cache it**
  (game-data-in-DB initiative) — replaces the shims later; delete them when it lands.
- **Verified:** tsc clean · 463 tests pass · core/engine/shim eslint clean · core is client-safe
  (only outward imports are type-only: `pixi.js` sprite types + `shared/types/server-match-state`,
  both erased at build).

## ✅ DONE 2026-07-13 (session 2) — shared dissolution + cleanup
- `DispatchedError` → `engine/`; `types/{domain-entities,events}` → `engine/types/`;
  `types/component-data` → FE (then deleted — was dead).
- **`server-match-state` split**: tile-state types (`CapturableTile`/`ChangeableTile`/…) →
  `core/schemas/tile-state.ts`; `PlayerInMatch` + `createNeutralPlayerInMatch` →
  `engine/entities/player-in-match-state.ts`. Resolves the `core → engine` back-edge:
  **core now imports nothing outward.**
- Deleted 14 pre-existing orphans (old calculator, mocks, CreateMatch, IngameInfo, …).
- **`src/shared` is now only 13 schema re-export shims + `utils/logger.ts`** — no domain content left.
- Verified: tsc clean · 463 tests · eslint clean · prettier clean.

### What still blocks fully deleting `src/shared`
- The **13 schema shims** stay until the FE fetches vocabulary from the BE and caches it
  (game-data-in-DB). Then the shims delete and `src/shared/schemas` is gone.
- `utils/logger.ts` is the one intentional keeper (isomorphic, sanctioned re-export).

### Remaining feature-debt (review findings, NOT shared-dissolution)
`#4` social usecase extraction (+ its 5 bugs) · `#11` composition root / cross-feature imports ·
`#12` three match routers · `#13` CO data two sources. See `.ai/review-findings-2026-07-13.md`.

### Notes / minor debt
- `core/schemas/spritesheet-data.ts` imports pixi types (`import type` only — erased). Presentation
  vocabulary per the migration map; a truly framework-free core would inline those two interfaces.
- `core/schemas/tile.ts` imports `shared/types/server-match-state` (type-only) — that type could
  move into core later so core imports nothing outward.
- Still pending (unrelated): 16 pre-existing orphans; pre-existing lint debt in the branch's new
  test/social files (blocks a fully-green `next build`, but is not from this work and is auto-fixable).

---
*(original plan below, for the remaining `core` work)*

**Origin (original):** the branch
`refactor/decouple-engine-from-prisma` never actually created `src/server/engine` or
`src/server/core` (`git log --all -- src/server/engine` is empty), and *adds* ~2k new lines into the
deprecated `src/shared/match-logic`. This plan is the real extraction, to run as its **own branch**,
not bundled with unrelated fixes.

## Current state (evidence, re-verified 2026-07-13)
- `src/server/engine` and `src/server/core` **do not exist**. Engine is still one monolith:
  `src/shared/match-logic` (**108 files, ~10k lines**) + `src/shared/wrappers` (6 entity files, ~1,116).
- **It is the LIVE engine, not backup.** `match-store.ts` (hot state store) and `routers/action.ts`
  (live action pipeline) import it directly. **12** server files import `match-logic`, **12** import
  `wrappers`. No parallel/v2 engine exists — the only `MatchWrapper`/`UnitWrapper` classes are here.
- **Prisma decoupling is ALREADY DONE** (correction to the first draft): there is **no real
  `@prisma/client` import anywhere in `src/shared`**. Wrappers define their own entity types
  (`shared/types/domain-entities.ts`); adapters map DB rows at the boundary. The hard coupling is
  already broken — the remaining work is **physical relocation + module split**, not decoupling.
- This branch still *modifies* shared (21 files, +469 lines) and *adds* ~2k lines into it — so shared
  is not being treated as frozen backup in practice, contrary to the stated intent.
- The "v1/v2" refactor was **persistence + FE board** (v1 `playerState` blob vs v2 relational
  `MatchPlayer`; the `?v1` toggle). Both run through the SAME shared engine — it never relocated it.

## Target (per root + `src/server/CLAUDE.md` migration map)
- `src/server/core` — game vocabulary + cross-domain utils. Framework-free, Prisma-free, imports nothing.
  - from `shared/schemas/{action,army,co,game-version,match-rules,player-slot,position,tile,unit,unit-traits,variable-tiles,weather,spritesheet-data}`, `shared/math-utils.ts`.
- `src/server/engine` — the rich game feature, Prisma-free:
  - `rules/` ← `match-logic/` (damage, movement, weather, CO, hooks)
  - `previews/` ← `match-logic/{pathfinding,combat-forecast}` + turn-snapshot/previews
  - `events/` ← `match-logic/events/` + `handlers/`
  - `constants/` ← `match-logic/game-constants/`
  - `entities/` ← `wrappers/{match,unit,player-in-match,team,vision}`, **decoupled from Prisma**
  - engine + game-presentation types ← `shared/types/{events,server-match-state,component-data}`
- `DispatchedError.ts` → `engine`; `math-utils.ts` → `core`.

## Phased approach (each phase compiles + tests green before the next)
This is a **move + repoint** job (Prisma is already decoupled), so lean on re-export shims to keep
`main` releasable per phase rather than a big-bang.
1. **Stand up `core`** — move the pure schemas + `math-utils` into `src/server/core`, leave
   re-export shims in `src/shared/schemas/*` so nothing breaks yet. Repoint engine + feature imports
   to `core` incrementally.
2. **Relocate entities** — move `shared/wrappers/*` + `shared/types/domain-entities.ts` →
   `server/engine/entities`; keep the adapter mappers in `server/adapters` (they already exist — this
   is a move, not a rewrite, since there's no `@prisma/client` to strip out).
3. **Move rules/constants/events/previews** → `engine/{rules,constants,events,previews}`, updating the
   12 `match-logic` + 12 `wrappers` importers. Keep handlers free of cross-handler imports.
4. **Engine router** — give the engine feature its own transport binding; begin converging the three
   coexisting match routers (finding #12) under it.
5. **Delete the `src/shared` shims** once no importer remains; `grep -r "shared/" src` should only
   hit the sanctioned FE logger re-export. Only then is shared truly "backup/gone" as intended.

## Risks / notes
- The 1361-line hardcoded `CO_PROFILES` vs DB `co-repo.ts` (finding #13) intersects here — decide
  whether the engine reads the DB adapter or the file *before* moving constants, so we don't move a
  soon-dead file.
- Big-bang is risky; prefer the shim-and-repoint approach so `main` stays releasable per-phase.
- Test discipline: engine tests stay pure (no DB/network) — they already are; keep them passing at
  each phase as the regression net.

## Related deferred findings folded in here
#11 (cross-feature composition root), #12 (match-router convergence), #13 (CO data source of truth),
#22 (file-size). See `.ai/review-findings-2026-07-13.md`.
