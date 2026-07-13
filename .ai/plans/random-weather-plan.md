# Random weather effects — implementation plan

## Goal
Make **random weather** actually work. When `weatherSetting === "random"`, weather starts `clear`;
while clear we roll each turn; a non-clear roll locks a weather effect for a random number of **days**
(1 full day = one revolution = player-count turns), guaranteeing equal duration per player. While an
effect is active no new roll happens. When it ends we return to clear and rolling resumes.

Probabilities (per roll): **clear 60% / rain 30% / snow 5% / sandstorm 5%**, with:
- **Drake boost kept**: rain += 7% per non-AWDS Drake CO in play (from clear).
- **sandstorm → snow in non-AWDS**: its 5% folds into snow outside AWDS (so non-AWDS = clear 60 / rain 30 / snow 10).
- **Duration**: uniform random **1–4 days**.

## Current state (why it's broken today)
- `applyMatchStartEvent` **never applies** `event.weather` → every match silently starts (and fixed-weather
  matches stay) `clear`.
- `MatchWrapper.setWeather` always arms `playerToRemoveWeatherEffect` — even for `clear` — so once random
  weather resolves to clear it gets "stuck" and never rolls again.
- Random path hardcodes duration `1` and only carries the drawn weather (no duration) in the `Turn` event.

The day-based countdown (`playerToRemoveWeatherEffect` + `weatherDaysLeft`, decremented once per revolution)
already gives "equal duration per player" and is what CO powers (Olaf/Drake) reuse — we keep it.

## Changes (all in `src/shared` where the code lives today; migration to `engine/` is out of scope)

### 1. `src/shared/match-logic/weather.ts`
- Rewrite `getRandomWeather(match)` to the fixed table:
  - `snowThreshold   = isAWDS ? 5 : 10`  (non-AWDS absorbs sandstorm's 5 into snow)
  - `rainThreshold   = snowThreshold + 30 + 7 * nonAwdsDrakes`
  - `sandstormThreshold = rainThreshold + (isAWDS ? 5 : 0)`
  - `roll < snow → "snow"; < rain → "rain"; < sandstorm → "sandstorm"; else "clear"`
  - keep the existing non-AWDS-Drake count helper.
- Add `getRandomWeatherDurationDays(): number` → integer in `[1,4]`.
- `getWeatherSpecialMovement` unchanged.

### 2. `src/shared/types/events.ts`
- Add optional `newWeatherDays?: number` to the `Turn` type (backward compatible — old events lack it,
  defaults to 1). `newWeather: Weather | null` stays.

### 3. `src/shared/match-logic/events/handlers/passTurn.ts`
- `getNewWeather` returns a partial turn `{ newWeather: Weather | null; newWeatherDays?: number }`:
  - active effect (`playerToRemoveWeatherEffect !== null`): existing logic → `{ newWeather: "clear" }`
    on the ending turn, else `{ newWeather: null }` (persist).
  - clear + `weatherSetting === "random"`: `w = getRandomWeather(match)`; if `clear` → `{ newWeather: null }`,
    else `{ newWeather: w, newWeatherDays: getRandomWeatherDurationDays() }`.
  - otherwise → `{ newWeather: null }`.
- Update the two push sites: `turns.push({ ...getNewWeather(p), eliminationReason: "all-units-crashed" })`
  and `turns.push(getNewWeather(p))`.

### 4. `src/shared/match-logic/events/handlers/passTurn/updateWeather.ts`
- Accept the duration: `updateWeather(nextTurnPlayer, turn.newWeather, turn.newWeatherDays)`.
- `if (newWeather !== null) { match.setWeather(newWeather, newWeatherDays ?? 1); return; }` — rest of the
  decrement/removal path unchanged. Update the call in `passTurn.ts` apply loop accordingly.

### 5. `src/shared/wrappers/match.ts`
- `setWeather`: when `weather === "clear"`, set `playerToRemoveWeatherEffect = null` and `weatherDaysLeft = 0`
  (clear has no pending removal — this is the fix for the "stuck clear" bug so rolling resumes next turn).
  Non-clear branch unchanged (arms removal on current turn player). Vision toggle unchanged.
- Add `setInitialWeather(weather: Weather)`: sets `currentWeather` + AWDS rain-vision, leaves
  `playerToRemoveWeatherEffect = null` / `weatherDaysLeft = 0` (permanent, no countdown) — for match start.

### 6. `src/shared/match-logic/events/handlers/match-start.ts` (+ `apply-event-to-match.ts`)
- `createMatchStartEvent`: `weather = weatherSetting === "random" ? "clear" : weatherSetting` (spec: random
  starts clear; no more dead `getRandomWeather` call at start).
- `applyMatchStartEvent(match, event)`: also `match.setInitialWeather(event.weather)`. Pass the event at the
  call site in `apply-event-to-match.ts`.
  - **Bundled fix (flagged):** this also makes **fixed-weather** matches (e.g. permanent snow/rain) actually
    apply their weather — currently the start weather is ignored and they run at clear. Say so / can be split
    out if you want minimal scope.

### 7. Tests — `src/tests/features/weather-random.test.ts`
- `getRandomWeather` thresholds via `vi.spyOn(Math, "random")`: boundaries for snow/rain/sandstorm/clear,
  Drake boost, sandstorm→snow in non-AWDS.
- `getRandomWeatherDurationDays` ∈ [1,4].
- passTurn integration (scenario helper + stubbed RNG): a non-clear roll locks for N days, each player gets
  exactly N turns of it, then clears and rolling resumes.

## Not changing
Weather *consumers* — movement cost (`getWeatherSpecialMovement`), rain→vision/fog (`isFogOfWar`, `Vision`),
CO-power weather (`co-effects` `setWeather`) — already read `getCurrentWeather()`; untouched.

## Verification
`npm run lint`, `tsc --noEmit`, `vitest run src/tests/features`.
