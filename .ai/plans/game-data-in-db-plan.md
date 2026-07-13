# Game reference data in the DB — design

Status: **design for discussion** (supersedes `co-declarative-modifiers-plan.md`, which becomes the
first slice of this). Goal: move **all game reference data** — COs, units, unit groups, terrain,
properties, skins, and every stat/modifier — into the **DB as the source of truth**, manageable via
SQL, while keeping combat correct and the engine free of direct Prisma calls.

## Core architecture (load-bearing)

- **DB = source of truth.** All reference data lives in relational tables, editable by SQL.
- **Engine reads a synchronous cache, not Prisma.** An **adapter** loads the tables at boot and fills
  an in-memory `gameData` repository (`Map`s keyed by version/key). The engine reads it synchronously —
  no `await` on the combat hot path, no `@prisma/client` import inside engine code.
- **Provider seam.** Engine constant access (`unitPropertiesMap[type]`, `getCOProperties`,
  terrain/property lookups) is refactored to go through a `gameData` provider interface. Server fills
  it from DB; that's the only source that changes.
- **v1 client engine.** The `?v1` board runs the engine in the browser (no DB). Decision below — the
  simplest is to **freeze v1 on the current bundled constants** (it's legacy) and point only the
  server (v2) engine at the DB-backed provider. (Alternatives: build-time snapshot, or a runtime
  bootstrap API.)

## Proposed schema (ERD sketch)

Versioning: most game data varies by `GameVersion` (AW1/AW2/AWDS), so version is a column/FK where it
matters (COs and their modifiers; some unit/terrain stats).

```prisma
// ---- Units ----
model UnitGroup {        // infantry · directVehicle · indirect · air · sea
  id String @id
  key String @unique
  displayName String
  units UnitType[]
}

model UnitType {
  id String @id
  key String @unique           // "infantry", "mdTank"
  displayName String
  group UnitGroup @relation(...)
  groupId String
  facility String              // base | airport | port
  movementType String          // foot | boots | tires | treads | air | sea | lander | pipe
  movementPoints Int
  vision Int
  fuel Int
  ammo Int?
  cost Int
  attackRangeMin Int?
  attackRangeMax Int?
  // per-version stat overrides, if any, via UnitStatByVersion
}

// ---- Terrain & properties ----
model TerrainKind {
  id String @id
  key String @unique           // "plain","road","woods","mountain","sea","river",...
  displayName String
  defenseStars Int
  isProperty Boolean @default(false)
  movementCosts TerrainMovementCost[]   // per movementType
  property Property?
}

model TerrainMovementCost { terrainId String; movementType String; cost Int?  /* null = impassable */ }

model Property {               // capturable buildings (subset of terrain)
  id String @id
  terrain TerrainKind @relation(fields:[terrainId],references:[id])
  terrainId String @unique
  key String @unique           // "hq","city","base","airport","port","commtower","lab"
  fundsPerTurn Int
  repairsFacility String?      // which units it repairs
  buildsFacility String?       // which facility it produces from
  vision Int
}

// ---- Commanders ----
model Co {
  id String @id
  key String                   // "max"
  gameVersion String           // AW1|AW2|AWDS  (unique with key)
  displayName String
  description String           // day-to-day passive text
  coPowerName String?;  coPowerStars Int?;  coPowerDescription String?
  scoPowerName String?; scoPowerStars Int?; scoPowerDescription String?
  modifiers CoModifier[]
  @@unique([key, gameVersion])
}

// "general modification over units" — the associative stat table
model CoModifier {
  id String @id
  co Co @relation(...)
  coId String
  phase String                 // dayToDay | coPower | superCoPower
  // target: a group OR a specific unit (override); exactly one set
  unitGroupKey String?
  unitTypeKey  String?
  attackPct   Int?             // +20, -10
  defensePct  Int?
  rangeDelta  Int?
  movementDelta Int?
  visionDelta Int?
  buildCostPct Int?
  @@index([coId, phase])
}
// Non-stat / exotic effects (heal, funds, AoE, hide-HP, missiles) stay procedural in code, keyed by
// (co,version,phase). Optional CoPhaseFlag table can mark luck {good,bad} and simple typed effects.

// ---- Skins ----
model SkinType { id String @id; key String @unique }   // map | army | camp | co
model Skin {
  id String @id
  type SkinType @relation(...)
  typeId String
  key String                   // "aw2","ds","orange-star",...
  displayName String
  group String?                // optional grouping
  assets SkinAsset[]
  @@unique([typeId, key])
}
model SkinAsset {              // association: skin part -> public/img path
  id String @id
  skin Skin @relation(...)
  skinId String
  elementKey String            // "infantry-0","tile-city","hq","portrait"
  path String                  // "/img/units/orangeStar/Infantry-0.png"
  @@unique([skinId, elementKey])
}
```

## What stays procedural

Table-driven: unit/terrain/property base stats, CO stat modifiers (attack/defense/range/movement/
vision/cost), luck. **Procedural (code, keyed by co/version/phase):** instant/exotic effects — Andy
heal, Colin/Sasha funds, Drake AoE+fuel, Sturm enemy movement, Sonja hide-HP, Sensei spawn, missiles.
The dossier renders the table; procedural effects show as description text. (Open Q3: push as many as
cleanly possible into typed flags vs leave in code.)

## Read path & caching

```
src/server/adapters/game-data/    load tables -> build gameData cache (boot, once)
engine .../game-data-provider.ts  sync interface the engine reads (unit/terrain/property/co getters)
```
`getCOProperties(coId)` keeps its signature; internally it reads the cached `Co`+`CoModifier`s and
builds the existing `Hooks` via generic factories + merges procedural effects. `unitPropertiesMap`,
terrain lookups likewise become provider reads. **No downstream call-site changes** beyond the provider swap.

## Migration & regression

- **Seed from current code constants → DB** (one script per domain: units, terrain, properties, COs,
  skins). The existing `unit-properties.ts`, `terrain-properties.ts`, CO files, and the sprite paths
  are the seed source, so the DB starts bit-identical to today.
- **Golden regression**: snapshot current combat outputs (attack/defense/range/move/luck across
  version×CO×phase×attacker×defender×terrain, and unit/terrain lookups) BEFORE; assert the DB-backed
  provider reproduces them EXACTLY after. This is what makes moving ~58 COs + all units/terrain safe.

## Suggested phasing (each phase shippable + regression-green)

1. **Provider seam + CO declarative layer, code-sourced** (the prior plan): types, `unitCategory`,
   `co-repository`, generic hooks, migrate CO stat hooks → declarative sets, golden tests, FE ▲▼ grid.
   *No DB yet* — proves the read-path swap safely.
2. **DB for COs**: `Co`+`CoModifier` tables + seed + boot adapter filling the cache (override). Manage
   COs from SQL. FE unchanged (reads codex).
3. **DB for units + unit groups**: `UnitType`/`UnitGroup` + seed + provider swap for `unitPropertiesMap`.
4. **DB for terrain + properties** + provider swap.
5. **DB for skins**: `SkinType/Skin/SkinAsset` + seed from `public/img` + wire the FE sprite system to
   resolve paths from skins (per-match skin override already modelled on `MatchPlayer.skins`).
6. **(Later) damage tables** (`base-damage`) if we want those SQL-managed too.

## Decisions (locked 2026-07-09)

1. **CO-modifier targeting** — **group + per-unit override.** `CoModifier` rows target a `unitGroupKey`;
   an optional `unitTypeKey` row overrides for oddballs.
2. **v1 client engine data** — **runtime bootstrap API.** The engine reads a `gameData` provider that
   is filled from the DB on the server AND from `GET /api/gameData` (cached) on the client. So the
   engine becomes fully data-driven on both sides; no hardcoded constants as the primary source. The
   client must bootstrap the provider before running the engine (affects the v1 board boot path).
3. **Phasing** — **big-bang.** Full schema + seeds + provider swap in one delivery (built internally in
   a safe order: schema → seed → golden harness → provider swap → bootstrap API → FE grid).
4. **Exotic CO effects** — **typed effect flags in DB.** `CoPhaseEffect { kind, params Json }`; the
   engine has a small interpreter per kind. All *stat* modifiers (incl. conditional ones) stay in
   `CoModifier`.

### CoPhaseEffect vocabulary (finalized 2026-07-09)

- `heal { hp }` — always self (own units).
- `damage { hp, zone?, count?, filter?, friendlyFire? }` — ONE structure for enemy-damage / AoE /
  missiles / meteor. `zone` = radius (absent/1 = single tile at each target, N = radius N; absent +
  no positions = all units matching filter). `count` = apply N times (Rachel = 3). `filter` = extra
  eligibility ("onProperty" | null). `friendlyFire` = include own units (default false). **Visual is
  NOT here** — the power's animation is owned by the phase (`CoPhase.visualKey`), since in AW each
  power/super power has its own activation animation.
- `drain { type, percent }` — unified fuel/power. `type` = "fuel" | "power". (Enemy-targeted.)
- `setWeather { weather, days? }` — Olaf snow, Drake rain.
- `resupply` — Jess, self, no params.
- `refreshUnits { exclude? }` — Eagle (non-foot act again).
- `spawnUnits { unitType, hp, on }` — Sensei (on = "ownedCities").
- `multiplyFunds { factor }` — Colin Gold Rush.
- `stun` — Von Bolt (targets can't move next turn).
- `hideUnitStats` / `firstStrikeOnDefense` — Sonja.
**Injectable variables (finalized 2026-07-09).** The engine exposes a registry of named runtime
variables — `funds`, `commTowers`, `powerMeter`, `unitCount`, … — resolved at eval time. Both scaling
modifiers and effect params reference them, so funds/tower-scaled behaviour is declarative:
- **Scaling modifiers** (on `CoModifier`): `scaleStat` gains `scalePctPerUnit` % per unit of
  `scaleVariable` (engine floors). Colin SCOP = attack × funds; Javier = defense × commTowers. No
  longer bespoke code.
- **Effects** referencing variables (params Json): Sasha War Bonds `fundsFromDamage`, Sasha Market
  Crash `drain { type:"power", scaleVariable:"funds", … }`. Only the *produce-funds / drain-by-funds*
  behaviours remain effects; the pure stat-scaling ones are now modifiers.

**Visual per power:** `CoPhase.visualKey` holds the power's activation animation ("missile" | "meteor"
| "blast" | "healWave" | …) — one per power/super power, not per effect.

### CoModifier — conditional / terrain fields (added 2026-07-09)

`terrainStarsPct` (Lash — scale defense by terrain stars), `movementCostAll` (Sturm — flat move cost),
`onTerrainKey` (Jake — "plain"), `onProperty` (Kindle day-to-day). Keeps those declarative/queryable
instead of code.

## Internal build order (even for big-bang, this sequence keeps combat safe)

1. **Golden regression harness first** — snapshot current effective stats (attack/defense/range/move/
   luck per version×CO×phase×attacker×defender×terrain, + unit/terrain/property lookups) using the
   engine as it is TODAY. This fixture is the contract the DB-backed provider must reproduce exactly.
2. **Schema** — all tables (additive; nothing reads them yet).
3. **Seeds** — serialize current code constants + a `public/img` scan → DB (units, groups, terrain,
   properties, COs + modifiers + effect-flags, skins). Extract CO modifiers by transcribing each
   procedural hook file into `CoModifier` rows + `CoPhaseEffect` flags.
4. **Provider seam** — `gameData` sync cache + interface; boot adapter fills it from DB (server).
5. **Provider swap** — engine constant access (`unitPropertiesMap`, `getCOProperties`, terrain/
   property) reads the provider; generic hooks built from `CoModifier`. Golden tests must stay green.
6. **Bootstrap API** — `GET /api/gameData` returns the cached payload; client engine fills its provider
   from it before running (v1 board boot).
7. **API + FE** — extend `matches.coCodex` (or a `gameData`/`co` query) to return modifiers + unit
   categories; champ-select **Forces tab ▲▼ grid** with Day-to-day / COP / SCOP toggle.
8. **Skins** — wire the FE sprite system to resolve `/img/...` paths from `Skin`/`SkinAsset`
   (per-match override already on `MatchPlayer.skins`).
