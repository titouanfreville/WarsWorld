# Ranked — match taxonomy, OpenSkill rating, Merit ladder, seasons — plan

Status: **planned (2026-07-15)**. Scope: the ranked half of the Play/Your-Games split. Companion to
[`matchmaking-plan.md`](./matchmaking-plan.md) (which built the queue) and
[`lobby-backend-plan.md`](./lobby-backend-plan.md). Supersedes the Elo rating that plan deferred to
"finished (→ Elo)".

Prerequisite already shipped: `/your-games` (Live + History). This plan removes the three
compromises that page shipped with — see [§9](#9-what-this-unblocks-in-your-games).

## Goal

A player opens **Play**, picks a mode and a queue, and climbs a **military-rank ladder** by earning
**Military Merit**. Behind it sits a **hidden skill rating** that never reaches the client.

```
finished match ──> denormalise stats (once, at finalize)  ──> history list + battle report (no replay)
              └──> if ranked: OpenSkill rate() ──> hidden μ/σ  ──> Merit delta ──> rank/division
                                                      │
                                                      └──> matchmaking pairing (never displayed)
```

Two numbers, two jobs, never confused:

|                  | Purpose                            | Visible?  | Keyed by                     |
| ---------------- | ---------------------------------- | --------- | ---------------------------- |
| **Skill** (μ/σ)  | pair opponents, size Merit gains   | **never** | `(playerId, mode)`           |
| **Rank + Merit** | progression, identity, leaderboard | yes       | `(playerId, mode, seasonId)` |

---

## 1. Locked decisions

Settled in design; **do not re-litigate**:

1. **Taxonomy is two axes.** The flat `LeagueType` enum conflates a _ruleset_ (`standard`/`fog`/
   `highFunds`/`broken`) with a _team shape_ (`standardTeams`) and a _format_ (`dualLeague`). It
   decomposes into **mode × ruleset**, with `isRanked` (already on `Match`) as the third axis.
   `broken` survives as a ruleset. **`dualLeague` is parked** — a format axis nothing uses.
2. **Rating engine is OpenSkill**, not Elo, not TrueSkill.
3. **Hidden rating is per `mode`, pooled across rulesets.** Fog/Std/High-funds share one ladder per
   mode. Rationale: playerbase size — 3 modes × 4 rulesets × ranked would shard the pool into
   starvation, and core skill transfers across rulesets far more than it diverges. Revisit with data
   (track per-ruleset residuals vs predicted score), not with opinion.
4. **The ladder is military ranks; the currency is Military Merit** (displayed as **"Merit"**).
5. **Full rank enum ships; only four ranks activate.** Activation changes **only at a season
   rollover**, never mid-season.
6. **Percentile bands, not absolute thresholds.** Safe _because_ of (5): activation coincides with
   re-placement, so the re-sort is expected rather than a silent reshuffle.
7. **Stats are denormalised at finalize.** Replaying the event log per row does not scale.
8. **Purpose-built read endpoints** per display, rather than growing one match contract.

### 1.1 Naming — collisions already found the hard way

These are **not** free. Each was checked against the codebase; four candidates were already taken:

| Word                                                                                                       | Status                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `general`                                                                                                  | ❌ **means Commanding Officer** — 38 files, incl. `schema.prisma:225,296,428` ("general-picker round", "enemy generals are hidden", "chosen general") |
| `recruit`                                                                                                  | ❌ honor's pre-Bronze tier — `honor.ts:17`, `HonorInsignia.tsx:19`                                                                                    |
| `commendation`                                                                                             | ❌ a Prisma model (`schema.prisma:796`)                                                                                                               |
| `honor`, `prestige`                                                                                        | ❌ the existing medal/prestige track                                                                                                                  |
| bronze/silver/gold/platinum/diamond                                                                        | ❌ `HonorInsignia.TIER_COLOR` — **including the colours**                                                                                             |
| S / A / B / C                                                                                              | ❌ the per-match grade (`match-grade.ts`) — and canon AW "ranks" ARE these                                                                            |
| `cadet`, `private`, `sergeant`, `lieutenant`, `captain`, `major`, `colonel`, `marechal`, `merit`, `season` | ✅ clean                                                                                                                                              |

Consequences, each load-bearing:

- **Apex is `marechal`, not `general`.** `general` is unusable. French matches the medals
  (`MEDAILLE_MILITAIRE`, `CROIX_DE_GUERRE`) — proper-noun decorations. Enum is ASCII (`marechal`),
  display is accented (**Maréchal**), exactly as `MEDAL_META` renders "Médaille Militaire".
  Other ranks stay English: the UI is English, and _Private_ is a common noun, not a title.
- **Entry rank is `cadet`**, not `recruit`.
- **Rank palette must avoid metals.** `HonorInsignia` renders on profile · lobby · champ-select ·
  in-game — the same surfaces as a rank badge. A gold "Captain" disc beside a gold medal disc reads
  as one system. Ladder takes a **green → blue → violet → orange** ramp.
- **Never abbreviate Merit to "MM".** One letter from `MMR`, the _other number in this system_
  (12 files; `mmrDiff` ships in the queue event payload). "MM gains scale with MMR" is unreadable,
  and `mm` beside `mmr` in code is a latent bug. Every short code is taken anyway: `CP` (capture
  points AND CO power), `MP` (movement), `HP`, `SP` (star/super power).

> `honor.ts:4` already states the split: _"Honor = a PRESTIGE track (distinct from the military-rank
> ladder, which is MMR)."_ This plan is that sentence's other half. **Honor is given by your
> opponent for conduct; Merit is earned by winning.** Different source, different meaning, no
> shared vocabulary and no shared palette.

---

## 2. Why the current model can't do this

`elo.ts` + `ranking.usecase.ts` are ~40 lines of correct, well-tested Elo. They are still wrong here:

- **No uncertainty.** `DEFAULT_MMR = 800`, `ELO_K = 32`. A new player who is really 1600-strength
  needs ~25 games to arrive — and ruins ~25 opponents' matches en route.
- **No inactivity handling.** A rating from eight months ago is treated as fact. In a game where a
  turn takes days, that is the common case, not the edge case.
- **Team-average Elo is a known-bad approximation** for 2v2, and for FFA there is no meaningful
  "opponent average" at all. `ranking.usecase.ts:40` already concedes it: _"Non-1v1 uses team-average
  ratings; only 1v1 is exercised for now."_
- **One number does two jobs** — it is both the pairing input and the displayed rating.

OpenSkill fixes all four with one model.

---

## 3. Schema

`Prisma migrations are deferred` (dev uses `db push`) — so this is the cheap moment.

**Dev data is NOT disposable, and nothing needs to be lost.** Measured 2026-07-15:

```
match 15 (6 finished · 6 playing · 3 cancelled) · Event 1855 · Lobby 10 · MatchPlayer 16 · MMR 2
leagueType in use: standard, fog only   (highFunds / dualLeague / standardTeams / broken: 0 rows)
MMR: both rows "standard", different players → 0 collisions when pooled to duel
```

Two consequences that contradict an earlier draft of this plan:

- **Ratings survive.** Pooling was assumed to collide (two rulesets → one mode → PK conflict). With
  this data it maps 1:1, so the two ratings carry over. Re-check before pushing; the argument is
  data-dependent, not structural.
- **The 6 finished matches + 1855 events are the ONLY battle-report test data** — they're what makes
  `/your-games` history and `/report/[matchId]` testable. Do not `--accept-data-loss` them.

`db push` is schema-only, so adding required `mode`/`ruleset` to populated tables would demand a
wipe. Three steps instead:

1. push `mode`/`ruleset` **optional**, `leagueType` retained → no data loss
2. backfill from `leagueType` per §3.1 (in practice only `standard` + `fog` exist)
3. push again: required, drop `leagueType`

```prisma
enum GameMode { duel  ffa  teams }
enum Ruleset  { standard  fog  highFunds  broken }

enum Rank {
  cadet        // placements only — no divisions
  private      // ● active
  sergeant     //   dormant
  lieutenant   // ● active
  captain      // ● active
  major        //   dormant
  colonel      //   dormant
  marechal     // ● active — apex, no divisions, merit unbounded
}

/// Hidden skill. NEVER exposed over tRPC — no router selects from this table.
/// OpenSkill μ/σ; pooled across rulesets, split by mode (decision §1.3).
model PlayerSkill {
  player   Player @relation(fields: [playerId], references: [id])
  playerId String
  mode     GameMode
  mu       Float  @default(25.0)
  sigma    Float  @default(8.333333)
  /// Games rated this season — placements gate reads this AND sigma.
  games    Int    @default(0)
  @@id([playerId, mode])
}

/// The displayed ladder position. Per season, so a rollover is a new row, not a mutation.
model PlayerRank {
  player   Player @relation(fields: [playerId], references: [id])
  playerId String
  mode     GameMode
  season   Season @relation(fields: [seasonId], references: [id])
  seasonId Int
  rank     Rank   @default(cadet)
  /// 5..1 (5 = lowest). Meaningless for cadet/marechal — those carry no divisions.
  division Int    @default(5)
  merit    Int    @default(0)
  peakRank Rank?
  @@id([playerId, mode, seasonId])
}

model Season {
  id     Int       @id @default(autoincrement())
  name   String
  startsAt DateTime
  endsAt   DateTime?
  /// Which ranks exist this season. A SET, not a ceiling — the ladder grows in the MIDDLE
  /// (sergeant sits between private and lieutenant), so a max-rank field wouldn't express it.
  activeRanks Rank[]
  ranks    PlayerRank[]
}

/// Per-match Merit movement — the history list's "Merit" column, and an audit trail for the ladder.
/// Absent for casual matches (no row, not a zero).
model MeritEvent {
  match    Match  @relation(fields: [matchId], references: [id])
  matchId  String
  player   Player @relation(fields: [playerId], references: [id])
  playerId String
  delta    Int
  rankAfter     Rank
  divisionAfter Int
  createdAt DateTime @default(now())
  @@id([matchId, playerId])
  @@index([playerId, createdAt])
}

/// Battle-report stats, computed ONCE at finalize (§5). Kills the replay-per-row problem.
model MatchPlayerStats {
  match    Match  @relation(fields: [matchId], references: [id])
  matchId  String
  player   Player @relation(fields: [playerId], references: [id])
  playerId String
  /// computeGrades() output — S/A/B/C + the three axes.
  grade    String
  tactics  Int
  strength Int
  economy  Int
  damageDealt Int
  damageTaken Int
  unitsKilled Int
  unitsLost   Int
  captures    Int
  producedFunds Int
  incomeEarned  Int
  powersUsed    Int
  @@id([matchId, playerId])
}
```

Changed on existing models:

```prisma
model Match {
  // REMOVE: leagueType LeagueType
  mode    GameMode
  ruleset Ruleset
  // isRanked / ratedAt / winnerTeamIndex / finishedAt already exist — unchanged.

  /// Day count at finish. Persisted at finalize so history needn't replay (§6 — fixes turn: 0).
  days       Int?
  durationMs Int?
  stats      MatchPlayerStats[]
  meritEvents MeritEvent[]
}

model Lobby {
  // REMOVE: leagueType LeagueType     (already has `mode`)
  ruleset Ruleset
}

// DELETE: model MMR       — replaced by PlayerSkill (re-keyed, μ/σ instead of Int)
// DELETE: enum LeagueType — replaced by GameMode × Ruleset
```

**Mode is currently unreachable from `Match`** — it lives only on `Lobby`, and `lobbyId` is nullable
(v1 matches have none). `map.numberOfPlayers` cannot substitute: it can't tell 2v2 from FFA-4. This
is why the history mode-filters are blocked, and why `Match.mode` is the first domino.

### 3.1 League → taxonomy mapping

| `LeagueType`    | → mode  | → ruleset               |
| --------------- | ------- | ----------------------- |
| `standard`      | `duel`  | `standard`              |
| `fog`           | `duel`  | `fog`                   |
| `highFunds`     | `duel`  | `highFunds`             |
| `broken`        | `duel`  | `broken`                |
| `standardTeams` | `teams` | `standard`              |
| `dualLeague`    | —       | — parked, drop the rows |

~24 files touch `leagueType` (`ranking`, `matchmaking`, `lobby`, `matches`, `engine/entities/match`,
`routers/*`, 4 test files, `player-profile/*`). `MatchWrapper.leagueType` (`match.ts:61`) is on the
engine entity — `mode`/`ruleset` are game vocabulary and belong in `core`; **`isRanked` must NOT
follow them onto the wrapper** (ranking metadata, not match state — engine scope is strict).

---

## 4. Rating — OpenSkill

`openskill@5.0.1` · **MIT** (TrueSkill is patented by Microsoft — do not reach for it) · ships
`.d.ts` · deps `ramda`, `sort-unwind`, two `@stdlib` maths packages. **Server-only** — never
imported into `src/frontend`.

API: `rating()`, `rate(teams, opts)`, `ordinal()`, `predictWin()`, `predictDraw()`.
Defaults: Plackett-Luce, μ 25, σ 8.333.

One call covers all three modes — this is the whole reason for the choice:

```ts
rate([[a], [b]]); // duel: a beat b
rate([teamA, teamB], { rank: [2, 1] }); // teams: B won; credit split by rating
rate([[p1], [p2], [p3], [p4]], { rank: [1, 2, 3, 4] }); // ffa: finishing order
rate([[a], [b]], { score: [1, 1] }); // draw: equal score
```

Replaces `ranking.usecase.applyMatchResult`'s team-average block wholesale.

### 4.1 Scale — the matchmaker constants do NOT survive

`matchmaking/constants.ts` is in **400-scale Elo points**; OpenSkill μ is on a **25-scale**. Roughly
**8.7 μ ≈ 400 Elo**, so ~46 Elo per μ point.

| Constant         | Elo  | → μ-space |
| ---------------- | ---- | --------- |
| `BASE_TOLERANCE` | 100  | ~2.2      |
| `TOLERANCE_RATE` | 15/s | ~0.33/s   |
| `LENIENT_GAP`    | 400  | ~8.7      |
| `MAX_TOLERANCE`  | 2000 | ~43.6     |

Convert for the port (keeps `queue.ts` and its tests structurally intact). **Then** switch the gate
to `predictWin ≈ 0.5`, which is more principled because it accounts for σ — a wide-σ newcomer should
match more loosely than a settled veteran at the same μ. Two steps, not one; don't do both at once.

`mmrDiff` in the queue event payload (`matchmaking-emitter`, consumed by `matchmaking.tsx`) is
μ-space after this. It is a _gap_, not a rating — it may stay on the wire.

---

## 5. Merit — the displayed ladder

**Store Merit; do not derive it from μ.** A pure function of skill makes rank yo-yo and destroys
progression. Merit is nudged _toward_ skill instead:

```ts
E = predictWin([mine, theirs])[0]; // 0..1
S = 1 | 0.5 | 0; // win | draw | loss
BASE = 20;

skillTerm = BASE * 2 * (S - E); // signed — covers both outcomes
gap = ordinal(skill) - anchorOrdinal(currentRank); // rank chases skill
convergence = clamp(gap / K_CONV, -10, +10);

meritDelta = skillTerm + convergence;
meritDelta = S > 0.5 ? clamp(meritDelta, +5, +40) : clamp(meritDelta, -40, -5);
```

| Situation                  | Win     | Loss    |
| -------------------------- | ------- | ------- |
| Even match, rank converged | **+20** | **−20** |
| Beat a favourite (E=0.2)   | **+32** | −8      |
| Beat an underdog (E=0.85)  | +6      | **−34** |
| Underranked (gap high)     | +30     | −10     |
| Overranked (gap low)       | +10     | −30     |

The `+5` floor guarantees **a win never yields nothing**. The expectation term _is_ "balanced by
expected result" — it's Elo's `(S − E)` rescaled to Merit.

**FFA generalisation.** For N players finishing at place `p`, normalise placement to a 0..1 score:

```
S = (N - p) / (N - 1)      // 1st → 1, last → 0, middle → 0.5
E = predictWin(teams)[i]   // verified: predictWin takes ANY number of teams,
                           // returning each team's relative win odds (sums to 1)
```

`E` is then each player's win probability, and for N=2 it collapses to exactly the duel case — so
the Merit formula above is **unchanged across all three modes**.

> Verified against `openskill@5.0.1`: the exports are exactly `rating`, `rate`, `ordinal`,
> `predictWin`, `predictDraw`. **There is no `predictRank`** — an earlier draft of this plan assumed
> one. `predictWin`'s multi-team support is what makes it unnecessary.
>
> Caveat to settle in phase 4: for N>2, `predictWin` gives P(win outright), which is **not** the
> expectation of `S` — a player who reliably places 2nd of 4 has a low win probability but a
> mid-range `S`. Either accept the mismatch (it biases Merit toward outright wins — arguably
> desirable in FFA) or normalise `E` across the field. Decide with the pure `merit.ts` in hand;
> it's a one-line change and it's unit-testable either way.

### 5.1 Ladder

Four **active** ranks; the rest ship dormant. Five divisions (V→I), 100 Merit each → 2100 Merit of
range. Percentile bands, recomputed per season.

| Rank           | Divisions | Band       | Colour            |
| -------------- | --------- | ---------- | ----------------- |
| **Cadet**      | —         | placements | `#64748b`         |
| **Private**    | V–I       | bottom 40% | `#4ade80`         |
| _Sergeant_     | V–I       | _dormant_  | —                 |
| **Lieutenant** | V–I       | next 35%   | `#60a5fa`         |
| **Captain**    | V–I       | next 20%   | `#a78bfa`         |
| _Major_        | V–I       | _dormant_  | —                 |
| _Colonel_      | V–I       | _dormant_  | —                 |
| **Maréchal**   | —         | top 5%     | `#e47220` (brand) |

Maréchal is apex: no divisions, **Merit unbounded**, so the top still sorts. Promotion at ≥100
(`merit -= 100`, division−1); demotion at <0 with a grace window at 0.

**Placements**: while `sigma > 4.0` (≈ first 10 games — a threshold, not a count; OpenSkill tells us
when it's confident, which is a better story than Elo's arbitrary N). Rank hidden, seeded from
`ordinal()` via the anchor inverse on exit.

### 5.2 Seasons

Rollover: **soft reset** — keep μ, re-inflate σ (`σ = max(σ, 6.0)`) → fast re-convergence, not a
wipe. `PlayerRank` gets a fresh row; Merit → 0; `activeRanks` may change. **Activation happens here
and only here** — that's what keeps percentile bands honest.

---

## 6. Finalize — one write, then never replay

Today `endgame.summary` rebuilds a throwaway match and replays the whole event log **on every read**.
Fine for one battle report; fatal for a 10-row list. Move it to write-once:

`match-lifecycle` finalize (already transactional, already has the `ratedAt` idempotency guard):

```
finalize(tx, matchId):
  1. buildMatchStats(seed, events)          ← already exists
  2. computeGrades(stats)                   ← already exists
  3. INSERT MatchPlayerStats[]              ← new — denormalised
  4. UPDATE Match.days, Match.durationMs    ← new — fixes turn: 0 (§6.1)
  5. if isRanked:  OpenSkill rate() → PlayerSkill
  6. if isRanked:  meritDelta → PlayerRank + MeritEvent
  7. SET ratedAt                            ← existing guard covers 5+6
```

**`endgame.summary` keeps replaying — do NOT point it at `MatchPlayerStats`.** (An earlier draft of
this plan said to; that was wrong.) `summary` returns `stats.timeline` (a per-turn snapshot of every
player's funds/army-value/properties/income) and `stats.captureLog`, which the per-player table does
not hold and shouldn't — they're a time series, not a row. Replaying for ONE match on demand was
never the problem; **N replays for a list** was.

So the split is:

| Consumer                          | Source                      | Why                                          |
| --------------------------------- | --------------------------- | -------------------------------------------- |
| `match.history` list (§7)         | `MatchPlayerStats` + `days` | 10 rows/page — replay is fatal               |
| `/report/[matchId]` battle report | `endgame.summary` (replays) | one match, on demand, and needs the timeline |

Old finished rows have no stats row — backfill with a one-off replay script (`utils/`), the same
shape as the league backfill. There are 6 finished matches; that's the whole job.

> The `ratedAt` guard covers rating only. Steps 3–4 need their **own** idempotency — a `statsAt`
> marker (skips the replay entirely on a repeat) plus `upsert` (self-heals a partial write). Finalize
> is reachable more than once: on the deciding action, and on rebuild.
>
> Note the rebuild path (`match-store.ts:163`) finalizes **in memory only** and deliberately does not
> persist — its comment already defers to "the backfill script". So `action.ts`'s transaction is the
> single write point.

### 6.1 The `turn: 0` bug

`finishedRowToFrontend` (`lifecycle-helpers.ts:44`) hardcodes `turn: 0`, and its comment rationalises
it: _"`turn` isn't persisted for archived matches — the history UI keys off the result, not the day
count."_ **That's the bug, not the design** — it's why `MatchHistoryRow` guarded day behind
`match.turn > 0`, and why day never rendered.

`Match.days` (step 4) fixes it at the source. Then **audit every stats/history route** that reports a
turn or day count and point it at the persisted value:

- `finishedRowToFrontend` — drop `turn: 0`, use `row.days`
- `endgame.summary` — `stats.days` already correct (it replays); make it prefer the stored value
- any route surfacing day/turn for a finished match

---

## 7. Read endpoints — purpose-built per display

Rather than growing one match contract until every consumer over-fetches:

```ts
// routers/match/history.ts — Your Games → History. One query, no replay, everything the row shows.
match.history: playerBaseProcedure
  .input({ page: number, filter?: {...} })
  .query() -> {
    rows: {
      id, map: { name, numberOfPlayers },
      finishedAt, days, durationMs,
      mode, ruleset, isRanked,
      result: "won" | "lost" | "drawn",
      grade: "S" | "A" | "B" | "C",
      tactics, strength, economy,
      damageDealt, unitsKilled, captures,
      meritDelta: number | null,        // null = casual
      viewer:    { coName, army },
      opponents: [{ name, coName, army }],
    }[],
    total: number,
  }

// routers/ranking.ts — Play → progress panel. Displayed ladder ONLY; μ/σ never leave the server.
ranking.myRank: playerBaseProcedure
  .query() -> { mode, rank, division, merit, meritToNext, peakRank,
                placement: { inPlacements, sigma } | null }[]
```

Both are **server-side paginated and filtered** — the current page filters and pages in the browser
over the full list, which is fine at 48 rows and not at 500.

This retires the `leagueType`/`isRanked`/`finishedAt` fields added to `finishedRowToFrontend` for
the interim Your Games build; that contract goes back to being the _live_ match list only.

---

## 8. Phases

Each is independently shippable and leaves the tree green.

| #     | Phase                                                                                                                                          | Touches                                 | Unblocks                      |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------- |
| **1** | **Match representation** — `mode`/`ruleset` on `Match`+`Lobby`, **re-key `MMR` to `(playerId, mode)`** (§8.1), drop `LeagueType`, map per §3.1 | ~30 files, schema                       | mode filters; everything else |
| **2** | **Stats denormalisation + `days`** — `MatchPlayerStats`, finalize writes, `turn: 0` fix, route audit                                           | `matches`, `endgame`, `engine/previews` | grade on the collapsed row    |
| **3** | **`match.history` endpoint** — server-side page/filter, `MatchHistoryCard` reads it                                                            | `routers/match`, FE                     | full history UI               |
| **4** | **OpenSkill** — `PlayerSkill`, replace `elo.ts`, convert queue constants to μ                                                                  | `ranking`, `matchmaking`                | ranked FFA/2v2                |
| **5** | **Merit ladder** — `Rank`, `PlayerRank`, `MeritEvent`, `ranking.myRank`                                                                        | `ranking`, FE panel                     | Play progress panel           |
| **6** | **Seasons** — `Season`, `activeRanks`, rollover + soft reset                                                                                   | `ranking`                               | rank activation               |
| **7** | **Play page** — mode rail, queues, `mode`/`ranked` on `matchmaking.join`                                                                       | `matchmaking`, FE                       | the other nav half            |

**Phases 1–3 alone finish Your Games.** 4–7 are the ladder.

Also in 7, from the Play design and not yet possible: `matchmaking.join` takes
`mode: z.literal("1v1")` (widen to `GameMode`), has **no `ranked` axis** (so "Ranked Std" and "Std"
are the same queue today), and queue population isn't exposed.

---

## 9. What this unblocks in Your Games

`/your-games` shipped with three compromises, each forced by missing data. Each has an owner above:

1. **Filters are Ranked/Casual/Standard/Fog/High-funds, not 1v1/2v2/FFA** — no `Match.mode` → **§3 / phase 1**.
2. **Grade + stats are expand-only** — replay cost → **§6 / phase 2**, then they move to the collapsed row.
3. **No day count on collapsed rows** — `turn: 0` → **§6.1 / phase 2**.

---

## 10. Testing

- `elo.test.ts` **retires with `elo.ts`**. Its shape is the model to copy: pure numbers in, numbers
  out, no DB.
- **`merit.ts` must be pure** (`(E, S, gap) → delta`) and exhaustively tested — every row of §5's
  table is a case, plus both clamps and the draw.
- **Rank/band mapping pure**: `(ordinal, activeRanks) → rank+division`, incl. dormant ranks being
  unreachable and the apex having no divisions.
- **Don't unit-test OpenSkill itself** (it's a tested library) — test _our_ wiring: a duel updates
  both players symmetrically; a 2v2 rates four; an FFA respects finishing order; a draw is
  `score: [1,1]`; an unranked match writes nothing.
- **Finalize idempotency**: run it twice, assert one `MatchPlayerStats` row and one `MeritEvent`.
- Season rollover: soft reset inflates σ, preserves μ, opens a fresh `PlayerRank`.

---

## 11. Tuning — guesses, flagged as such

No data behind any of these. All are single-table changes; revisit on a real distribution:

- Percentile bands **40/35/20/5**.
- **Five** divisions × 100 Merit (2100 range) — may be one division too many for the playerbase.
- `BASE = 20`, convergence clamp **±10**, `K_CONV = 40`.
- Placement exit at `sigma > 4.0`.
- Soft-reset floor `σ = max(σ, 6.0)`.
- OpenSkill's own β/τ — left at defaults for the first calibration.

## 12. Risks

- **FFA expectation is approximate** (§5) — `predictWin` gives P(win outright), not E[placement
  score]. Bounded and testable; decide in phase 4.
- **Ladder reset at phase 4.** `MMR` → `PlayerSkill` changes units (Int → μ/σ), so ratings genuinely
  reset _there_ — 800-scale Elo has no honest conversion to a 25-scale μ. Phase 1's re-key does not
  (§3). Cheap now, expensive once real migrations start (`prisma-migrations-deferred`).
- **Scope.** This began as "split a nav link". Play now depends on seasons. That's the right design,
  but phases 1–3 deliver the user-visible win and 4–7 can wait.
- **The codebase keeps knowing more than we assume.** `endgame.summary` already existed;
  `computeGrades` already owned S/A/B/C; `honor` already owned Recruit _and_ the metals; `general`
  already meant CO. **Re-read `honor`, `ranking`, `matchmaking` and the schema before each phase** —
  every naming collision so far was with a feature already in the repo.
