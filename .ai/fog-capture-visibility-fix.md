# Fog-of-war capture visibility fix

## Bug
Under fog of war, capturing a property leaks to enemies who have **no vision** on it.

## Root cause
The live WS event path is CORRECT — `event-to-emittable.ts` (`ability` sub-event) redacts a normal
capture to `wait` for teams without vision, and `fillDiscoveredUnitsAndProperties` only sends
`discoveredProperties` for tiles the team can see.

The leak is in **`match.full`** (`src/server/routers/match.ts`): it returns
`changeableTiles: match.changeableTiles` at FULL truth — every property's current owner, un-fogged.
Units are fog-filtered (`canSeeUnitAtPosition`) and tile visibility rides on `visibleTiles`, but
property ownership is not filtered.

The v2 board refetches `match.full` on **every** event (`useMatchBoard.ts` `onEvent` →
`utils.match.full.invalidate`), so an enemy capture out of your vision arrives via the full refetch
and `render-from-view.ts` draws the new owner (just dimmed by FOG_TINT). The correct live delta is
bypassed.

## Fix (AW-correct: last-known owner)
A property is always drawn (terrain), so a fogged tile can't be omitted — it shows its LAST-KNOWN
owner.

1. `src/shared/wrappers/team.ts` — `TeamWrapper` gains `lastKnownPropertyOwners: Map<string, PlayerSlot>`
   + `rememberPropertyOwner(pos, slot)` / `getLastKnownPropertyOwner(pos)`. Shared per team (correctly
   shares vision memory between teammates).
2. `src/server/routers/match.ts` `full` — map `changeableTiles`:
   - not a property (silo/pipe-seam) → passthrough
   - fog off OR spectator → passthrough (spectator fog is a separate known gap)
   - visible now → `rememberPropertyOwner` + send true owner
   - fogged → send `getLastKnownPropertyOwner(pos) ?? initialOwnerFromMap(pos)`
     (`match.map.data.tiles[y][x].playerSlot`, guaranteed the match-start owner).

### Known limitations (documented, non-leaking)
- Server restart wipes in-memory memory → fogged properties fall back to initial map owner until
  re-scouted (conservative, never leaks current state).
- If a team never fetched `match.full` while a property was visible, its fallback is the initial owner.

### Witnessing rule (refined per user)
- Your OWN property being captured = KNOWN (you have vision on it as it flips) → learn new owner even
  after losing vision. Neutral captured with no vision = unknown until you see/explore.
- Implemented via `MatchWrapper.rememberPropertyOwnerForWatchers(pos, slot)` called in both capture
  sites in `ability.ts` (normal completion + `eliminatePlayerByCapture`), BEFORE vision transfers.

### Out of scope (separate fog TODOs)
- `previews.ts` TODO(fog): reachable/attack previews still compute over full state.
- Spectator fog gap.

---

## Second bug (same session): neutral capture eliminated the neutral player
Capturing a neutral HQ/lab (a "control tower" = lab in-game) handed EVERY neutral property + unit to
the captor. Cause: `getPlayerBySlot(-1)` returns the neutral pseudo-player (not undefined), so the
`previousOwner === undefined` guard in `ability.ts` `infantryOrMechAbilityToEvent` was dead for
neutral → `previousOwnerIsEliminated` fired (neutral always has no HQ + ≤1 lab) → `eliminatePlayerByCapture(neutral)`.
Fix: guard `previousOwner.data.slot < 0`. Regression test: `src/tests/features/neutral-capture-elimination.test.ts`
(verified it fails without the guard).
