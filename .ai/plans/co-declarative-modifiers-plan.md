# Declarative CO modifiers — plan

Status: **draft for review**. Goal: make CO stat modifiers **declarative data** that (a) the combat
hooks read from, and (b) the UI (champ-select dossier) reads from directly — one source, no drift.
Migrate all COs across AW1/AW2/AWDS. Data sourced from a **swappable repository** (code constants
now; DB-backed cache addable via an adapter) so the read path is identical for the server engine and
the v1 client-side engine.

## Why

Today each CO encodes modifiers as **procedural hooks** (`attack: ({attacker}) => attacker.isIndirect() ? 90 : 120`).
That means the exact per-unit up/down can't be read for display without executing the engine. We
want a **table** the hook reads AND the dossier reads.

## Principles

- **One source of truth per CO/version** — a declarative profile. Hooks consume it; the codex returns it.
- **Hot path stays synchronous.** `getCOProperties` is called constantly in combat. The engine reads
  from an in-memory cache; it never awaits I/O mid-combat.
- **Engine has no direct Prisma import.** Data reaches it through a repository seam. The seam is filled
  from code constants at import time, and (server-only, later) can be re-filled from the DB at boot.
- **v1 coexistence.** The v1 board bundles the engine into the browser (no DB). So the **default source
  must be code constants**; DB is an optional server-side override that repopulates the same cache.
- **Bit-identical combat.** Migration must not change any combat number. Guarded by golden regression tests.

## Data model

```ts
// unit buckets a modifier can target; derived from unit-properties (facility/attackRange/movementType)
type UnitCategory = "infantry" | "directVehicle" | "indirect" | "air" | "sea";

type StatMods = {
  attack?: number;    // firepower delta in %, e.g. +20, -10  (base 100)
  defense?: number;   // % delta
  range?: number;     // +1 tiles (indirects)
  movement?: number;  // +1 tiles
  vision?: number;
  buildCostPct?: number; // Colin -50, etc.
};

type COModifierSet = {
  description: string;
  units: Partial<Record<UnitCategory, StatMods>>;  // ← the readable table
  luck?: { good?: number; bad?: number };          // Nell/Rachel/Flak/Jugger/Sonja
  /** Effects that aren't simple stat deltas (heal, funds, AoE, fuel, hide-HP …) stay procedural. */
  instant?: (player: PlayerInMatchWrapper, positions?: Position[]) => void;
  special?: Partial<Hooks>;                         // escape hatch for exotic per-CO hooks
};

type COProfile = {
  displayName: string;
  gameVersion: GameVersion;
  dayToDay?: COModifierSet;
  coPower?: COModifierSet & { name: string; stars: number };
  superCoPower?: COModifierSet & { name: string; stars: number };
};
```

**What's declarative vs procedural.** Table-driven: `attack`, `defense`, `attackRange`,
`movementPoints`, `vision`, `buildCost`, luck. Stays procedural (via `instant`/`special`): Andy heal,
Colin/Sasha funds, Drake HP+fuel AoE, Sturm enemy movement-cost, Sonja hide-HP/luck/vision quirks,
Sensei spawn, Hachi discount edge cases, missiles (Rachel/vonBolt/Sturm), etc. The dossier renders the
**table**; the procedural bits are described in text (as today).

## Unit categorization

A single `unitCategory(type): UnitCategory` derived from `unitPropertiesMap` (indirect = `attackRange[1] > 1`;
infantry/mech; air/sea by `movementType`/facility; else directVehicle). Used by BOTH the generic hooks
(to pick the right `StatMods` for the combatant) and the FE (to place each unit in the grid). Lives in
engine constants so server + FE agree.

## The repository seam (source-swappable)

```
engine/constants/co/
  profiles/<co>-<version>.ts   ← authored declarative COProfile (the default source)
  co-repository.ts             ← in-memory cache: Map<version, Map<CO, COProfile>>, seeded from profiles
  hooks-from-profile.ts        ← generic hook factories that read a COProfile
```

- `coRepository.get(version, co)` → `COProfile` (sync, from cache).
- Seeded from the code `profiles/*` at import — works in the browser (v1) with zero I/O.
- **Server DB override (optional, later):** a `co` adapter (`src/server/adapters`) loads `CoProfile`
  rows at boot and calls `coRepository.override(...)`. Engine still only reads the cache. Gated behind
  the v1 constraint: the code constants remain the fallback/default.

`getCOProperties` is refactored to build its `COProperties` (existing shape: `powers` with real hooks)
by wrapping the profile through `hooks-from-profile.ts` + attaching the profile's `instant`/`special`.
**Its external signature and return shape stay the same**, so nothing downstream changes.

## Generic hooks

`hooks-from-profile.ts` turns a `COModifierSet` into the current `Hooks`:

```ts
attack: ({ attacker }) => applyPct(100, set.units[unitCategory(attacker.type)]?.attack),
defense: ({ defender }) => applyPct(100, set.units[unitCategory(defender.type)]?.defense),
attackRange: (v, u) => v + (set.units[unitCategory(u.type)]?.range ?? 0) || undefined,
movementPoints: (v, u) => v + (set.units[unitCategory(u.type)]?.movement ?? 0) || undefined,
// vision, buildCost, luck similarly
```

`undefined` when no modifier (preserves today's "no change" semantics exactly). Instant/special are
merged in unchanged.

## API + FE

- `matches.coCodex` extended: each entry gains `dayToDay/coPower/superCoPower = { description, units }`
  (+ stars/name for powers). The FE already has the codex query.
- FE dossier **Forces tab** becomes the real ▲▼ grid: map each unit → `unitCategory` → look up the
  selected phase's `units[category]`, render green ▲ / red ▼ with the value; neutral otherwise. A
  phase toggle (Day-to-day / COP / SCOP) shows how the grid shifts.
- Unit categorization mirrored FE-side in the sprite system (or returned by the codex to avoid drift —
  preferred: codex returns each unit's category so the FE doesn't re-derive engine rules).

## Migration (all versions)

Per CO/version file: read the existing hooks, express the stat deltas as a `COProfile`, move exotic
logic into `instant`/`special`, delete the hand-written stat hooks. ~58 files. Order: AW2 (live) →
AWDS → AW1. Batch by CO family to keep diffs reviewable.

## Regression strategy (load-bearing)

Combat numbers must not move. Before refactoring:

1. **Golden test**: for every (version, CO, phase, attacker-type, defender-type, terrain) of interest,
   snapshot `attack`/`defense`/`range`/`movement`/luck from the CURRENT hooks into a fixture.
2. Refactor to profiles.
3. Assert the profile-driven hooks reproduce the snapshot exactly. Any diff = a mis-transcribed table.

This makes the "did I copy Max's numbers right" question mechanical, per CO.

## DB (optional, phase 2)

`model CoProfile { version, co, data Json }` + a seed that serializes the code `profiles/*` → DB, +
a boot adapter that loads → `coRepository.override`. Engine stays Prisma-free (reads cache only). Only
turned on server-side; v1 FE keeps the code constants. Deferred until the code-constant layer ships.

## Build order

1. Types + `unitCategory` + `co-repository` + `hooks-from-profile` (no behaviour change yet).
2. Golden regression harness over current hooks.
3. Migrate AW2 CO profiles; flip `getCOProperties` (AW2) to profile-driven; green golden tests.
4. Extend `coCodex` + FE ▲▼ grid (lights up immediately for AW2).
5. Migrate AWDS, then AW1; golden tests stay green.
6. (Phase 2) DB model + seed + boot override adapter.

## Risks

- **Transcription errors** across 58 files → mitigated by golden tests.
- **Exotic hooks** that resist the table (luck/vision/fuel/AoE) → kept procedural via `special`/`instant`;
  the table only claims what it can render truthfully.
- **v1 FE engine** must keep working → code constants stay the default source; DB is server-only override.
- **Hot path** → all reads from the in-memory cache; no async in combat.

## Open questions

1. Codex returns each unit's category (FE doesn't re-derive) — agree? (Recommended: yes.)
2. DB phase-2 now or after the code-constant layer proves out? (Recommended: after.)
3. Any COs whose day-to-day you'd rather keep fully procedural (e.g. Sonja) rather than force into the table?
