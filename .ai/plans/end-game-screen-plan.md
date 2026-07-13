---
title: End-Game Experience — Victory/Defeat Animation + EG Screen
status: approved (all §12 decisions resolved; ready for Epic 0)
owner: Titouan
created: 2026-07-10
method: BMAD PRD (adapted — no _bmad install in repo) + frontend-design
decisions:
  scope: full plan, phased build
  rank: letter grade S/A/B/C (self-contained per match)
  honor: LoL-style commendations, persisted to profile reputation
  chat: post-game chat only (reuse existing match Conversation/MatchChat)
  flow: animation -> victory/defeat screen holds ~20s (adjustable, skippable) -> auto-loads EG screen
  eg-exit: EG screen does NOT auto-advance out; player leaves manually (rematch / back to lobby)
  spectators: deferred (participants only for now; ties to spectator-mode gap)
---

# End-Game Experience — PRD + Design Plan

## 1. Goal

When a match is decided, replace the current flat "Victory!/Defeat" banner with a
**cinematic victory/defeat moment on the board**. That moment lingers on a **victory/defeat screen**
for a short, **adjustable delay (default ~20s, skippable)**, then **auto-loads a full-screen End-Game
(EG) screen** that tells the player how they did: a **letter grade (S/A/B/C)**, a **stats breakdown**
(days, eco curve, kills, losses…), **post-game chat**, and an **honor / commendation** step. This
turns "the game ended" into a satisfying, shareable payoff and a social hook that pulls players into
the next match.

**Flow:** match decided → victory/defeat animation (Layer A) → victory/defeat screen holds for the
adjustable delay (a visible countdown; "Continue" skips it) → EG screen loads (Layer C rank-stamp).
The **EG screen is the destination — it does NOT auto-advance away**; the player leaves it manually
(Rematch / Back to lobby). Spectator EG is **deferred** (participants only for now).

## 2. Current state (grounded — file references)

| Concern | Today | Implication |
|---|---|---|
| Outcome derivation | `deriveGameOver(match, viewerTeam)` — `src/server/routers/match/game-over.ts` | Reuse as-is. Returns `{ winnerTeamIndex, viewerWon }`, null while contested. |
| Finalize (in-memory) | `finalizeIfGameOver(match)` — `src/server/routers/match/finalize.ts` | Flips status→finished, stamps `player.data.result`. **Already wired on the live action path** (`routers/action.ts`) — the `match.ts:118` "TODO" was stale. Epic 0 made it atomic + stamped `MatchPlayer.result`. |
| Persisted outcome | `Match.winnerTeamIndex`, `Match.finishedAt`, `MatchPlayer.result` (`prisma/schema.prisma:281,282,416`) | ✅ All written at finalize (Epic 0). `matchEnd` emitted to all players. |
| Game-over UI | Static banner overlay in board slot — `MatchBoardV2.tsx:359-378` | Replaced by animation (Epic 1) + EG overlay (Epic 2). |
| Shell / overlay mount | `GameShell` slots: `board`, `hud`, `chat`, `overlay` — used in `MatchBoardV2.tsx:296-381` | EG screen mounts as a new top-level full-screen overlay above the shell. |
| Chat | Unified `Conversation`/`Message`/`ConversationParticipant` (MATCH kind + per-team, `schema.prisma:714-761`); `MatchChat` component already in `GameShell` chat slot | Post-game chat = **reuse**. |
| Per-turn / stats data | Event log = `Event` table (ordered per match, `schema.prisma:322`); `buildTurnSnapshot` computes funds+units — `routers/match/turn-snapshot.ts` | Stats are **derivable by replaying events**; no new capture needed. |
| Ranking | `MMR` per league (`schema.prisma:261`) | Not used for letter grade; available for a later ladder feature. |
| Behavior log | `PlayerInfraction` (`schema.prisma:424`), `Achievement` enum (`schema.prisma:121`) | Honor's negative counterpart + achievement plumbing already exist. |
| Live events | `emit()` — `server/emitter/event-emitter`; client refetches `match.full` on events, learns game-over via derived `gameOver` | Add a dedicated `match-finished` emit so the EG flow triggers reliably for all clients. |
| CO portraits | `SkinAsset.elementKey = "portrait"` (`schema.prisma:611`) | Real CO art available for the animation + EG player cards. |

**Net:** the domain plumbing (outcome, finalize, chat, event log, CO art) is largely present. The new
work is presentation (animation, EG overlay), two computations (grade + stats aggregation), one new
model (commendations), and closing the finalize→persist→emit seam.

## 3. Scope & phasing (decided)

- **Phase 1 (ship first):** Epic 0 (finalize seam) → Epic 1 (animation) → Epic 2 (victory/defeat
  screen + EG shell) → Epic 3 (stats) → Epic 4 (rank/grade).
- **Phase 2 (after):** Epic 5 (post-game chat on EG) → Epic 6 (honor/commendations).

---

## 4. Victory / Defeat animation — design proposal (frontend-design)

**Aesthetic anchor:** this is Advance-Wars-by-web — 16-bit pixel-art sprites, the `aw2Font` bitmap
font, a deep navy board (`#000b2c`), chunky CO portraits. The animation must read as a *retro
tactical war game*, not a generic web app. No confetti, no purple gradients, no soft drop-shadow
cards. Think **cartridge-era battle-result cutscene**: hard pixel edges, scanline shimmer, a punchy
impact frame, a single bold accent color per outcome.

Palette: **Victory** → gold/emerald on navy, sunrise sweep. **Defeat** → desaturate the board to
ash, deep-red vignette, slow. **Draw** → steel/silver, neutral.

I recommend a **layered sequence** — an immediate on-board reaction, then a transition stamp that
carries the player into the EG screen:

### Layer A — "Battle-Result Sweep" (immediate, on the board) — *recommended core*
0.0s: board input locks, a 1-frame white flash.
0.1s: a diagonal pixel band sweeps across the canvas; the losing army's units on-board flash white
and desaturate.
0.3s: **"VICTORY" / "DEFEAT" / "DRAW"** stamps in `aw2Font`, oversized, with a 2px chromatic
scanline shimmer and a short screen-shake (2–3px) on the stamp frame.
0.5s: the winning CO's **portrait** slides in from the side saluting; on defeat, the *viewer's* CO
portrait darkens / cracks with a red vignette bleed.
Idle: subtle looping shimmer on the word until the transition fires.
Cost: CSS/Motion overlay + one canvas tint pass. Uses existing CO portrait assets. Low risk.

### Layer B — "Board Dissolve" (stretch, in Pixi) — *optional enhancement*
The losing army's units burst into a short pixel-particle scatter and a shockwave ripples out from
the captured HQ before Layer A's stamp lands. Highest cohesion (it happens *on* the board) but needs
a Pixi particle pass in `board-scene` — schedule as a polish story, not a blocker.

### Layer C — "Rank Stamp" transition (into the EG screen) — *recommended*
When the EG screen opens (auto after 20s or on "Continue"), the player's **letter grade** slams down
center-screen — big `S/A/B/C` glyph, impact shake, a radial ink-burst ring, a stamp *thunk*. This
doubles as the EG screen's hero element and makes the grade feel earned. (If Epic 4 isn't shipped
yet, Layer C degrades to a simple outcome title.)

**Motion rules:** one orchestrated entrance (staggered `animation-delay`), not scattered
micro-interactions. Honor `prefers-reduced-motion` (cut shake/particles, keep a crossfade). Keep the
whole Layer A sequence ≤ ~1.2s so it never feels like it's blocking. Use the Motion library for the
React overlay (available in repo), Pixi ticker for any board FX.

**Sound (optional, flagged):** a short victory sting / defeat tone + the stamp thunk would elevate
this a lot; gate behind the existing audio prefs if/when audio lands.

---

## 5. End-Game (EG) screen — design

Two surfaces:

1. **Victory/Defeat screen** (the "moment"): the animation's stamp + CO portrait over a dimmed board,
   with a small **countdown ring (default 20s, adjustable via a constant/pref) → auto-loads the EG
   screen**. A **"Continue"** button skips the wait; the countdown pauses if the player interacts.
2. **EG screen**: a full-screen overlay above `GameShell`, styled as a **battle-report scoreboard**
   in the AW aesthetic (bitmap headings, navy field, army-colored accents, CO portraits). It **does
   not auto-advance away** — the player reads stats / chats / commends and leaves via Rematch or Back
   to lobby.

### LOCKED design (refined via mockup v7 — this is the build target for Epics 3–6)

Interactive mockup (placeholder data): artifact `128cd8e1-1365-4540-a32c-9994a025f1c7` (session
scratchpad `eg-mockup.html`). Sections, top → bottom:

1. **Hero** — match meta (map · ranked/mode · fog · days/turns/duration) · big outcome word ·
   rotated **rank stamp** (the letter grade; Layer C).
2. **Player cards** (winners first) — CO portrait, name (+ "You"), army-colour accent, Won/Lost/Drew,
   the player's **letter grade**, and their **competitive ladder rank** (military chevrons — see
   Ranking below). Losers dimmed.
3. **Performance** — the viewer's overall grade + **Tactics / Strength / Economy** bars, each with a
   one-line rationale (§10).
4. **Summary** — stat tiles (days/turns/duration/powers) + headline numbers (trade ratio, income
   lead, decider) pointing to the analysis.
5. **Match analysis** — a **tabbed** panel, all views **both-players**, charts hover-interactive,
   timelines with event markers:
   - **Global** — income/turn curve + a **key-events timeline** (CO powers ⚡, battles 💥, captures
     🏴, HQ 🏁), per-player.
   - **Military** — army-value-on-field curve + a **units built/lost by class** table, grouped
     **Infantry / Vehicles / Air / Naval** (collapsible), **unit sprites** as the row labels (name on
     hover), per-player.
   - **Control** — properties-owned step chart + a **capture timeline** (city/base/tower/airport/HQ)
     + city/base/tower/HQ tiles.
   - **Damage** — a full breakdown **table** for both players: **Total dealt → Direct / Indirect**,
     then **By unit class** (Infantry/Vehicles/Air/Naval, collapsible, unit sprites) with **% of
     total**, then **Damage healed → CO power / Properties**. See §Healing below.
   - **Economy** — idle-funds-per-turn curve (lower = tighter) + **income vs spend** table with a
     **Repairs** line (= property-heal cost, §Healing) and Net banked.
6. **Honor** (prestige, not military — see below) — the viewer's **prestige level + medals with
   progress**, then the **award-a-medal** action for the opponent + the opponent's compact standing.
7. **Post-game chat** — messages + input (presence-based writable, §FR7).
8. **Actions** — Rematch (deferred) · Back to lobby.

**Healing & the repair-cost identity (load-bearing for stats):** a unit repaired on a friendly
property heals HP at a **funds cost = (hpHealed/10) × unitCost** — and the *value* of HP restored is
the **same number**. So property-heal *value* (Damage → healed) **equals** the repair *spend*
(Economy → Repairs); they're one figure surfaced in two views. CO-power healing restores value for
**free** (zero cost). Both computed by replaying the event log (the engine already applies repair +
power heals per turn — instrument those apply points; no new capture).

**Ranking vs Honor — two separate systems (locked):**
- **Ranking** = the competitive ladder — **military ranks with chevrons/galons** (Corporal, Sergeant,
  …), built on the existing `MMR`. Shown as a small rank on player cards / profile. (Its own feature;
  this initiative only *displays* it — full ladder work is out of scope here.)
- **Honor** = a **prestige** track — **named medals** with metal tiers (Bronze→Diamond) and **star**
  sub-ranks (I/II/III), aggregating to an overall **Prestige level** (🎖️). Never uses chevrons.
  Medals (locked names, real-decoration references): 👏 **Good Conduct** · 🤝 **Médaille Militaire** ·
  ⚔️ **Croix de Guerre**. The **award action** carries the medal name (you grant that medal). The
  honor insignia is a **reusable widget** (profile · lobby · champ-select · in-game), so build it
  standalone.

**Timing:** the countdown lives on the **victory/defeat screen** (step 1) and, on expiry, **loads the
EG screen**. Default 20s, adjustable; "Continue" skips it. The EG screen has **no exit timer**.

---

## 6. Functional requirements

- **FR1** When a live match becomes decided, every connected client (both players + spectators)
  receives a `match-finished` signal and plays the victory/defeat animation, then reveals the EG
  screen. Reconnecting to an already-finished match shows the EG screen directly.
- **FR2** After the victory/defeat animation, a victory/defeat screen holds for an **adjustable delay
  (default 20s)** then **auto-loads the EG screen**; a visible countdown can be skipped ("Continue").
  The EG screen itself does **not** auto-advance away — the player leaves via Rematch / Back to lobby.
- **FR3** The EG screen shows each player's outcome (won/lost/drawn), CO, army color.
- **FR3b** Spectator EG is out of scope for now (participants only); revisit with spectator mode.
- **FR4** Each player sees their own **letter grade S/A/B/C** with a Tactics/Strength/Economy
  breakdown (PvP-tuned; no speed/game-length axis — see §10).
- **FR5** The EG screen shows match stats: days/turns count, a per-player **funds-over-time (eco)
  curve**, units built/lost/killed, properties captured, CO powers used.
- **FR6 (Phase 2)** A player may award **at most one commendation per match**, to a **single other
  participant** (no self-commend), from a fixed set of honor tags. It persists and accrues to the
  recipient's profile reputation. **Honor is only available in matchmaking games — never in custom
  matches.** Only participants, only after finish.
- **FR7 (Phase 2)** The EG screen hosts a **post-game chat** reusing the match conversation. It stays
  **writable while at least one participant is still on the EG screen, and becomes read-only once all
  participants have left** (presence-based, not a fixed timer).
- **FR8** Finished-match history (`your-matches`) links to a read-only EG summary for past matches.

## 7. Non-functional requirements

- **NFR1 Server-authoritative:** grade + stats are computed on the **backend** from the event log;
  the client only renders. No game rules/constants on the client (root CLAUDE.md §2).
- **NFR2 Prisma-free engine:** grade/stats computation reads engine domain state (event replay /
  wrappers), not `@prisma/client`; persistence stays at the adapter/router seam.
- **NFR3 Performance:** stats aggregation runs once at finalize (or is memoized per finished match),
  not per client fetch. EG summary is a single query.
- **NFR4 Accessibility:** animation respects `prefers-reduced-motion`; EG screen is keyboard-navigable
  and screen-reader-labeled; countdown has a non-color cue.
- **NFR5 Resilience:** if stats/grade computation fails, the EG screen still renders outcome + chat +
  actions (graceful degradation) — a stats error never blocks leaving the match.
- **NFR6 Idempotency:** finalize persistence + `match-finished` emit fire exactly once per match.

## 8. Data model changes (Prisma)

- **Epic 0:** no new fields — use existing `Match.winnerTeamIndex`, `Match.finishedAt`,
  `MatchPlayer.result`. Just complete the write.
- **Epic 4 (grade):** add `MatchPlayer.grade String?` (e.g. "S"/"A"/"B"/"C") + optional
  `MatchPlayer.gradeBreakdown Json?` so history is cheap and grade is stable (not recomputed).
- **Epic 3 (stats):** the analysis feeds **five views** (Global / Military / Control / Damage /
  Economy — see §5). Prefer **compute-on-demand from the event log** first (no schema change); if
  profiling shows it's heavy, add `Match.statsSummary Json?` written at finalize as a cache.
- **Epic 6 (honor — medals + prestige):** new model. `type` is the **medal** awarded (locked names);
  tier/prestige are **derived from counts** at read time, not stored.
  ```prisma
  enum MedalType { GOOD_CONDUCT  MEDAILLE_MILITAIRE  CROIX_DE_GUERRE }
  model Commendation {
    id         String    @id @default(cuid())
    matchId    String
    fromPlayer Player @relation("commendationsGiven",    fields: [fromId], references: [id])
    fromId     String
    toPlayer   Player @relation("commendationsReceived", fields: [toId],   references: [id])
    toId       String
    medal      MedalType
    createdAt  DateTime @default(now())
    @@unique([matchId, fromId])   // ONE medal awarded per giver per match
    @@index([toId, medal])        // per-medal tallies for tier + prestige
  }
  ```
  - **Medal tier + star sub-rank** = pure function of a player's **count per medal** (thresholds
    tunable; draft Bronze 10 / Silver 30 / Gold 75 / Platinum 150 / Diamond 350, each split into 3
    star sub-ranks). **Prestige level** = a function of the medal collection (e.g. sum of tier
    weights). All computed on read from `count(Commendation where toId, medal)`; denormalize only if
    hot.
  - Unique `(matchId, fromId)` — a giver awards at most one medal per match. Self-award rejected in
    the usecase (fromId ≠ toId). Honor is **gated to matchmaking matches** (§9).
  - **Competitive ladder rank** (military chevrons) is a **separate** concern, derived from the
    existing `MMR` — no new model; this initiative only surfaces it on cards/profile.
- Migrations: follow repo policy — dev uses `db push`; real migrations generated at end of the dev
  series (see memory: prisma-migrations-deferred).

## 9. API surface (tRPC)

- **Epic 0:** in the passTurn / action path, after applying an event call `finalizeIfGameOver`; on a
  non-null result, in one transaction persist `status/winnerTeamIndex/finishedAt` +
  `MatchPlayer.result`, archive from the live store, and `emit({ type: "match-finished", matchId,
  winnerTeamIndex })`. Client subscription surfaces it.
- **New `endgame` feature module** (`src/server/endgame/`, thin slice per server CLAUDE.md):
  - `endgame.summary({ matchId })` → `{ outcome, players: [{ playerId, result, grade,
    gradeBreakdown }], stats: { days, turns, perPlayer: [{ funds: number[], built, lost, killed,
    captured, powersUsed }] } }`. Works for both just-finished and historical matches.
  - `endgame.commend({ matchId, toPlayerId, type })` mutation (Phase 2) — guards: match is
    **matchmaking-origin** (reject custom — the match's lobby has `hostPlayerId == null`, or via
    `Match.isRanked`; confirm the exact signal in Epic 6), match **finished**, giver + recipient are
    both **participants**, `fromId ≠ toId` (no self-commend), and **not already commended this match**
    (the `(matchId, fromId)` unique key). One commendation per giver per match.
  - `endgame.myReputation` / include tally on player profile (Phase 2).
- **Chat (Phase 2):** reuse the existing match `Conversation` router. The conversation stays writable
  **while any participant is still present on the EG screen**; the last participant leaving flips it
  read-only (needs lightweight EG presence tracking — e.g. a per-match "on EG screen" subscription /
  heartbeat, or reuse `ConversationParticipant.lastReadAt` + a presence signal). Verify the unified
  system's send/list endpoints cover this during Epic 5.
- Grade + stats live in the **engine** (pure, from event replay); the `endgame` usecase orchestrates,
  the router is thin (validate → usecase → return).

## 10. Letter-grade model (PvP-tuned, self-contained)

**Speed is intentionally dropped.** It's a campaign metric (racing a par time vs an AI); in PvP there
is no par, a fast win usually signals a mismatch, and rewarding it incentivises all-in rushes and
punishes careful play. Game length is not a skill signal here. Instead, three PvP-honest sub-scores
from the final state + event log, weighted → overall S/A/B/C:

- **Tactics** (technique — highest weight, ~40%) — **trade efficiency**: value destroyed ÷ value lost,
  unit preservation (surviving HP), avoiding overextension. The core competitive skill signal.
- **Strength** (power — ~35%) — aggression + board control: total enemy army value destroyed, damage
  dealt, properties captured/held, map presence.
- **Economy** (~25%) — income lead over the opponent, capture tempo, fund efficiency (not idling cash).

Design notes:
- **A losing player can still score high on Tactics** — grades reflect *play quality*, not just the
  win/loss. This is deliberate and softens grade-toxicity.
- No axis depends on game length; endless turtling is not rewarded (and not penalised as a headline —
  see Q-decision; a small anti-stall nudge was declined in favour of the clean 3-axis model).
- Thresholds tuned so S ≈ all three high. Exact weights/curves are an engine detail to tune in
  Epic 4; keep the computation pure + unit-tested (`src/tests/`).

## 11. Epics & sequenced stories

**Epic 0 — Finalize seam (foundation). ✅ DONE (2026-07-10).**
Reality check: the seam was **already wired** on the live action path (`routers/action.ts`) — the
`match.ts:118` "TODO" comment was stale. `finalizeIfGameOver` runs after every action, persisting
`status/winnerTeamIndex/finishedAt/playerState` and emitting a **`matchEnd`** event (reused instead
of a new `match-finished`). Real gaps found + fixed:
- 0.1 ✅ Event write + outcome write now wrapped in **one `prisma.$transaction`** (a crash between
  them would have stranded a decided match as "playing").
- 0.2 ✅ **`MatchPlayer.result` now stamped** at finalize (v2 relational store — `updateMany` keyed
  by matchId+playerId, a no-op on v1 matches). Previously only the v1 `playerState` blob got it,
  despite the schema comment claiming `MatchPlayer.result` is "set at finalize".
- 0.3 (deferred to Epic 3) historical-match summary verified when `endgame.summary` lands.
- Verified: `finalize-game-over` + `win-loss` + `pass-turn` + `no-units-defeat` tests green (14/14),
  `tsc --noEmit` clean. FE handling of `matchEnd` → Epic 1/2.

**Epic 1 — Victory/Defeat animation.** 🚧 Layers A + B done.
1.1 ✅ `GameOverOverlay` (`frontend/components/match/hud/GameOverOverlay.tsx`) — Layer A sweep + stamp,
driven by the BE-derived `gameOver` flag (desync-proof; no new wiring — replaces the static banner in
`MatchBoardV2.tsx`). Styles in `styles/match/gameOver.scss` (RussoOne stamp, per-outcome gold/red/steel
theming, CRT scanline).
1.2 ✅ **CO versus-lineup** — ALL generals line up along the bottom, each themed by its own
`player.result`: winners in full colour + glow + a rising overshoot, losers drained to grey + slumped
tilt, draws muted. No CO ships a real victory/defeat pose, so the feeling is **derived in CSS**; art
uses the smooth full-body set (`coArtUrl` → `Awds-<name>.webp`, all 28 COs) degrading to the pixel
mug then hidden. Viewer's CO gets a "You" tag. Wired via `gameOverCos` in `MatchBoardV2.tsx`
(from `player.result` — no team math needed).
1.2b ✅ **Pose-art pipeline wired** — `coPoseUrl(name, "win"|"lose")` resolves optional dedicated
pose art (`Awds-<name>-win/lose.webp` or DB skin `<co>:artWin/Lose`); `CoFigure` walks candidates
pose → neutral art → mug → hidden. Authoring spec for an image model/artist: `docs/co-pose-art-spec.md`
(smooth style, 400×1000, transparent, full-colour; 56 files; drops in with no code change). CSS mood
tint applies regardless.
1.3 ✅ Reduced-motion handled (crossfade fallback). tsc + eslint clean.
1.3b ⏳ input-lock + final timing polish. 1.4 ⏳ (stretch) Pixi board-dissolve.
**Not yet visually verified in a running match** (needs a live game-over); previewed via artifact.

**Epic 2 — Victory/defeat screen + EG shell.** ✅ Shell done.
2.1 ✅ Countdown + skip on the "moment" — `useEndGameFlow` (`frontend/components/match/useEndGameFlow.ts`)
sequences none → moment → endgame; `GameOverOverlay` renders the "Results in Ns / Continue →" control
(default 20s hold, `holdSeconds` param). 2.2 ✅ Full-screen `EndGameScreen`
(`frontend/components/match/hud/EndGameScreen.tsx`, styles `styles/match/endGame.scss`) mounts above
`GameShell` on `phase === "endgame"`; hero = outcome + a Layer C grade **slot** (stub until Epic 4);
**no exit timer** — Back-to-lobby routes to `/your-matches`, Rematch stubbed/disabled.
2.3 ✅ Player result cards (CO portrait / army colour / won-lost-drawn, winners first, "You" tag).
2.4 ✅ Reconnect-to-finished skips the moment (sawLive ref). 2.5 ⏳ history link from `your-matches`
→ read-only EG summary (needs the Epic 3 summary endpoint).
Data panels (Performance/Stats/Honor/Chat) are **labelled stubs** filled in Epics 3–6. tsc + eslint clean.

**Epic 3 — Match stats (the tabbed analysis). 🚧 IN PROGRESS**
Engine stats aggregation from the event-log replay, feeding the five views (§5). All per-player,
both-players.
3.1a ✅ **Replay-harness foundation** — `buildMatchStats(seedMatch, events)`
(`src/server/routers/match/match-stats.ts`, pure/Prisma-free): re-applies the log on a fresh seed and
reads engine state (never trusts payload numbers). Done: turns/days, **per-turn series** (funds /
army value / properties / income) snapshotted at each passTurn boundary, and **built + powersUsed**
counters. Test `src/tests/features/match-stats.test.ts` (drives a real game → collects events →
re-seeds → asserts). tsc + test green.
3.1b ⏳ **Remaining metrics, via state-deltas during replay (no engine change — DECIDED).** Damage
(attack HP deltas → funds, direct/indirect by unit class), kills/losses, captures + event timeline,
and **healing**. Healing uses **HP-diff**: property repair = per-unit HP increase across a `passTurn`
(× unitCost/10 = repair funds spent = healed value → Economy Repairs); power heal = actor's units' HP
increase across a `coPower` (free). Safe because `passTurn`/`coPower` don't relocate units, so a
position-keyed before/after diff is unambiguous; attack damage is captured around the attack subevent
at known positions. **Heal-events were considered and DEFERRED** — power heal is entangled in the
in-flight CO-effect migration (`co-effects.ts` declarative interpreter ↔ procedural, pinned by
`co-effects-verify`), so first-classing heal now would fork that migration. Revisit heal-events as one
uniform pass alongside the replay/animation feature (then the aggregator reads them instead of
diffing). A dedicated healing analysis view can come later if wanted.

3.1b.1 ✅ **Healing + crashes via HP-diff** — `healedByProperty` (= repair spend, verified
200 = 2HP×1000/10), `healedByPower` (free), fuel-out `crashed` losses.
3.1b.2 ✅ **Combat + captures** — around the attack subevent (two known positions): `damageDealt`
(funds), `damageDirect`/`damageIndirect`, `damageByDomain` (infantry/vehicle/air/naval), `unitsKilled`
/`unitsLost` (incl. counters); around `ability` subevents: `captures` + a `captureLog` (via property
ownership-change diff). Tests cover damage/kill/loss + a two-turn capture. **tsc clean; 319/319 tests
pass**; lint clean.
3.1b.3 ⏳ optional polish — the Global "key events" timeline (power activations + HQ captures + big
battles) as a first-class list, if the UI wants it beyond the per-metric timelines already derivable.
Otherwise 3.1 (aggregator) is functionally complete → move to 3.2 (endpoint) + 3.3 (FE wiring).

3.1b (detail) — during replay compute, per player —
3.1 **Engine aggregator** (pure, Prisma-free, unit-tested): replay events and accumulate, per player,
per day: income & funds-idle; army value on field; units built/lost/killed by unit (→ class);
properties owned + captures (by kind); damage dealt (direct/indirect, by attacker unit→class);
damage healed (power vs property) + **repair spend = property-heal value** (§Healing); powers used;
key events (powers/battles/captures/HQ) for the timelines. Instrument the existing repair + power-heal
apply points rather than re-deriving.
3.2 ✅ `endgame.summary({ matchId })` — new **`endgame` feature module** (`src/server/endgame/`:
usecase + router + schemas, mounted in `routers/app.ts`). Rebuilds a fresh seed from the DB (extracted
`buildMatchWrapper` from `match-store`), replays the ordered `Event` log via `buildMatchStats`, returns
`{ matchId, status, winnerTeamIndex, finishedAt, isRanked, players[{playerId,name,army,coName,result,
team}], stats }`. `publicBaseProcedure` (works after the match leaves the live store); v2 matchPlayers
+ v1 playerState fallback. tsc + lint clean, 319 tests green.
3.3 🚧 **Analysis UI** — `MatchAnalysis` (`frontend/components/match/hud/MatchAnalysis.tsx`) queries
`trpc.endgame.summary` (typed via `inferTRPCOutput` — the sanctioned FE↔BE contract, no server import)
and is mounted in `EndGameScreen`. 3.3a ✅ **Damage breakdown table** — both-players, real data:
Total dealt → Direct/Indirect → by unit class (Infantry/Vehicle/Air/Naval) with **% of total**, plus
Damage healed (property/power). Days/turns header. tsc + lint clean.
3.3b ✅ **Charted views** — reusable `LineChart` (`frontend/components/match/hud/LineChart.tsx`,
dependency-free SVG, area fill + endpoint dots + hover crosshair/tooltip). `MatchAnalysis` is now a
**tabbed** panel: Global (income) · Military (army value) · Control (properties, stepped) · Economy
(funds banked) — each fed from `stats.timeline`, coloured by army — plus the Damage table. tsc + lint
clean.
3.3c ✅ DONE (2026-07-11) — analysis polish across three tabs, all both-players, real replay data:
- **Control** → **capture timeline** under the properties chart (from `stats.captureLog`: `T{turn} ·
  army-dot · {player} captured a {property}`; empty-state when none changed hands).
- **Military** → **units built & lost by domain** table under the army-value chart (Infantry/Vehicles/
  Air/Naval; lost = combat losses + fuel-out crashes).
- **Economy** → **income vs spend** table under the idle-funds chart: Income earned · Production ·
  Repairs (= property-heal value) · Net banked.
- Aggregator extensions (`match-stats.ts`): `builtByDomain`, `lostByDomain`, `producedFunds`
  (funds-diff on build, CO discounts included), `incomeEarned` (by **funds conservation**: banked +
  produced + repaired − starting — no per-turn instrumentation). Tests extended (built-by-domain +
  production spend + income>0; lost-by-domain on a kill). tsc + lint clean, **377 tests**.
- Per-unit damage sub-rows: **declined** (kept the class-level breakdown — per-unit rows add table
  noise for little signal; revisit only if asked).
- **Visual verification in a live finished match** still pending — batched with the Epic 1–5 pass
  (needs matchmaking matches with real events).

**3.5 — Design-alignment pass to the mockup. ✅ DONE (2026-07-11).** First live render (via a new
dev route `/eg-preview?matchId=…&playerId=…`, screenshotted in-browser) showed the built screen had
drifted from the mockup — translucent wash over the app chrome, dashed "stub" panels, a centered
header (no hero), flex player cards with no grade, and no Summary panel. Rebuilt `endGameScreen`
to the mockup:
- **Design tokens + opaque ground** (`--egs-bg #060a18`, `--egs-surface #0d1428`, gold/emerald/red/
  steel), **solid surface panels** (was dashed), radial-gradient navy background (was 0.94-alpha
  wash).
- **3-column hero**: match meta (map · Ranked/Custom · fog · days/turns/duration) · outcome word ·
  **rotated circular rank stamp** with the viewer's grade glyph. Needed `endgame.summary` to also
  return `mapName`, `fog`, `createdAt`.
- **2-up player cards** (solid, army-accent left border) with a **per-player grade letter** (gold for
  the winner, steel otherwise) beside the result.
- **New Summary panel** (Days/Turns/Duration/Powers stat tiles + a headline) beside Performance;
  Honor + Chat moved to their own 2-col row below the analysis.
- **Bug fixed:** the app's global `header { height: 70px }` (navbar) was squashing every EG `<header>`
  (hero + panel heads), clipping the hero and overflowing the title into the player cards — scoped
  override `.egs header { height: auto }`.
- Removed the now-unused `RankStamp` (stamp is inline in the hero). tsc + lint clean, **378 tests**.
- `/eg-preview` is a **dev-only** route (unlinked, safe to delete) — it also seeds the future FR8
  read-only history view.

**3.6 — Analysis interaction + fidelity pass (from live review). ✅ DONE (2026-07-11).**
- **Chart hover now follows the pointer:** crosshair line + a per-series **dot on each line** at the
  hovered turn, a `cursor: crosshair` cue, and the color-coded value tooltip (`LineChart.tsx`). (Was:
  crosshair-only, no on-line indicator, default cursor.)
- **Unit sprites in the breakdown tables:** Military (built/lost) and Damage (by class) are now
  **grouped, collapsible tables with per-unit sprite sub-rows** (`unitSpriteUrl`), matching the
  mockup's `.gt`. Needed per-unit aggregation: `builtByUnit` / `lostByUnit` / `damageByUnit`
  (engine-keyed) added to `match-stats.ts`; the FE groups them by domain via a local unit→domain map.
  (Was: flat text rows by class.)
- **Capture timeline is now the horizontal design** (Control): a baseline with circular
  property-glyph marks positioned by turn + army-coloured, T0/Tn ticks, and a player legend. (Was: a
  plain text list.)
- Tests extended (built/lost/damage by unit type). tsc + lint clean, **378 tests**. Verified live in
  `/eg-preview`.
- **Turn-counter bug fixed:** the engine does **not** maintain `match.turn` (turn ownership is tracked
  via `hasCurrentTurn` flags; `applyPassTurnEvent` never increments a counter), so it stayed `0` all
  replay — collapsing every timeline row, capture and the `turns`/`days` totals to 0 (all timeline
  marks piled at T0). The aggregator now counts player-turns itself (`turnNo += event.turns.length`
  per passTurn); captures stamp the in-progress turn (`turnNo + 1`). Live: header now reads the real
  `Day 17 · 32 turns`, the chart x-axis runs 1→32, and the capture marks spread across the timeline.
  Tests assert the stamped turn numbers (`timeline` turns `[1,2]`; capture at turn 3).

**3.7 — Duration + descriptive phrases (from live review). ✅ DONE (2026-07-11).**
- **Duration** now surfaces (hero meta + Summary tile). `endgame.summary` returns `durationMs`:
  `finishedAt` when set, else the **last event's timestamp** (so a played-but-never-`finished`
  match still shows a real span), minus `createdAt`. FE `formatDuration` (`45s` · `18 min` · `1h 4m`).
- **"How it was won" phrases** (`eg-phrases.ts`, pure + unit-tested): per-axis rationale notes on the
  Performance bars (Tactics = trade ratio, Strength = kills/captures, Economy = earned/produced/
  banked) and a Summary **decider** line — HQ-capture turn → army wipe → board decision → stalemate,
  derived from `captureLog` + final army value. 4 phrase tests. tsc + lint clean, **382 tests**.

(Original spec:) the tabbed panel + 5 views: reusable line-chart (hover crosshair) + event
timeline + grouped/collapsible breakdown tables with **unit sprites** and **% of total** (follow the
`dataviz` skill). Mirror the mockup.
3.4 Perf: memoize per finished match / optional `Match.statsSummary` cache at finalize.
3.5 History: wire `your-matches` → read-only summary (also covers Epic 2.5).

**Epic 4 — Rank / letter grade. ✅ DONE.**
4.1 ✅ **Engine grade** `computeGrades` (`routers/match/match-grade.ts`, pure + tested): PvP
**Tactics/Strength/Economy → S/A/B/C**, RELATIVE to the field (even split ≈ 50, dominating ≈ 100) so a
losing player who fought well still grades on Tactics. Weights 0.40/0.35/0.25; thresholds S≥85/A≥70/
B≥50/C. Needed a `damageTaken` addition to the aggregator (trade-ratio denominator). Tests: dominant
player A/S vs beaten C, neutral→B.
4.2 **Compute-on-read** in the summary (not persisted to `MatchPlayer.grade`) — stats are already
computed there; persistence deferred (cheap history read is a later optimisation).
4.3 ✅ Grade in `endgame.summary` — per player `{ overall, overallScore, tactics/strength/economy
{score,letter} }`.
4.4 ✅ UI — `PerformancePanel` (overall + 3 axis bars) + `RankStamp` header (viewer's overall grade),
sharing one cached query. tsc + lint clean, 364/364 tests. (The animated Layer-C stamp *slam* is a
polish item; the stamp shows the real grade now.)

**Epic 5 — Post-game chat (Phase 2). ✅ DONE (2026-07-11).**
5.1 ✅ **`EndGameChat`** on the EG screen — reuses the shared `social` conversation plumbing via
`useMatchChat` (All channel: history + live `MESSAGE_NEW` + send), replacing the Chat stub. Styled to
match the EG panels (`.egs-chat*`), sits in the grid beside Performance/Honor.
5.2 ✅ **Presence-based write window** (FR7), server-enforced. Ephemeral in-memory registry
(`adapters/eg-presence.ts`: `markEgPresent`/`egPresentPlayers`/`egChatWritable`, 20s heartbeat TTL,
rebuilt empty on boot). `endgame.chatHeartbeat` (playerBaseProcedure, participants-only) marks the
viewer present; the FE beats every 7s while the panel is mounted. `social.sendMessage` gates
**finished** MATCH conversations on `egChatWritable` → once every participant's heartbeat lapses, the
conversation is read-only ("Post-game chat has closed"). Active matches + DMs are never gated. Pure
unit-tested (`src/tests/features/eg-presence.test.ts`, 5 cases).
5.3 🚧 `EndGameChat` accepts a `readOnly` prop that renders the transcript with no compose box — the
seam for the historical view. Wiring it from `your-matches` is **FR8** (out of Epic 5 scope; the live
`getOrCreateMatchChannels`/heartbeat path requires the match to still be in the live store, which
holds until reboot — historical/post-reboot needs the read-only transcript path).
tsc + lint clean, 377 tests.

**Epic 6 — Honor: medals + prestige. ✅ DONE (schema pushed pending).**
6.1 ✅ `MedalType` enum + `Commendation` model (`@@unique([matchId, fromId])`, `@@index([toId,
medal])`) + Player back-relations; `prisma validate` + `generate` clean. ⚠ **`npm run prisma:push`
still needed** to create the table (DB not up in this session).
6.3 ✅ **Pure compute** `computeStanding` (`src/server/honor/honor.ts`): per-medal count → metal tier
(Bronze 10/Silver 30/Gold 75/Plat 150/Diamond 350) + **star sub-rank I–III** → overall **Prestige**
(sum of tier indices). Tested.
6.2 ✅ **`honor` feature module** (`src/server/honor/`): `honor.award` (playerBaseProcedure; guards
finished + **isRanked matchmaking proxy** + participants + no-self + one-per-match) and
`honor.standing` (public); mounted in `app.ts`.
6.4 ✅ **Reusable `HonorInsignia`** widget (prestige + medals + stars + progress; `compact` variant) —
drop-in for profile/lobby/champ-select/in-game.
6.5 ✅ **`HonorPanel`** on the EG screen — viewer's own standing + award buttons per opponent (medal
names/emoji), one-per-match lockout, error surfacing; replaces the Honor stub. tsc + lint clean,
368 tests.
Ranking (military chevrons) stays a **separate** system (`ranking`/`MMR`, now built in parallel).

## 12. Open questions / risks

- **Q1 (RESOLVED)** The 20s is the delay on the victory/defeat screen *before* the EG screen loads
  (adjustable, skippable). The EG screen doesn't auto-advance out; exits are Rematch / Back-to-lobby.
- **Q2 (RESOLVED)** Grades are computed **per player individually** — even in 2v2/FFA, each player's
  Tactics/Strength/Economy come from their own units/trades/economy (no team averaging). Applies to
  every result, winner or loser.
- **Q3 (RESOLVED — deferred)** Spectator EG is out of scope for now; participants only. Revisit with
  spectator mode (memory: spectator-mode-todo).
- **Q4 (RESOLVED)** Honor: **no self-commend**, **one commendation per giver per match** (pick a
  single participant), and **matchmaking-only** — custom games award no honor. Reputation = aggregate
  tally per type on the profile.
- **Q5 (RESOLVED)** Post-game chat is **presence-based**: writable while any participant is still on
  the EG screen, read-only once all have left (no fixed timer).
- **R1** Epic 0 is load-bearing: the live-path finalize persistence is currently a TODO — everything
  auto-triggering depends on it. Do it first and test it hard.
- **R2** Stats from event replay must handle fog/masking correctly (don't leak hidden info into a
  spectator's stats view).
