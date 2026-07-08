# Lobby design — two phases (custom + matchmaking)

Design direction agreed 2026-07-08 (mockup: scratchpad `lobby-deployment.html`,
artifact e12d1a8e). Replaces the broken `MatchCardSetup` CO/Army/Slot dropdown entirely.

## Two phases

1. **Player Lobby** — on wide screens the **two team columns flank the central battlefield** (big,
   tall team displays that fill the horizontal space), with rules as a compact chip strip above the
   map and an **Unassigned bench** in a bottom bar; on narrow screens it stacks. Team assembly is
   a **switchboard**. In 2-team modes the bar is 3 columns — **Team 1 | Unassigned | Team 2** —
   and players **self-assign** by **dragging a player onto a team, or clicking an empty slot** (each
   team has exactly the required slots; a full team can't be joined). In **FFA (1v1v1v1)** the bar is
   the four seats directly, and the **latest joiner over the cap defaults to spectator**. **Invite**
   is a small button → a **modal** (add usernames, send them all at once); invitees sit in a
   **bottom-right pending list** (scrollable) until they **accept or reject**. Host can kick and edit
   rules + map. When all seats are filled, **the host starts the Pick phase**. No CO selection here.
2. **Pick phase** — **time-limited** (≈3 min), laid out **LoL champ-select style**: your team on the
   **left**, enemy team on the **right**, and the **generals (COs) centered** as the hero. Hovering a
   general opens a **tabbed dossier** — Overview (description), Powers (CO Power + Super CO Power as
   cards with star cost + effect), Unit stats (a **full AW-style unit grid**: each unit tile shows
   green ▲ buffed / red ▼ nerfed / neutral with the value, plus a summary of the category changes); clicking selects it and the **skin picker
   (map / army / camp) takes the center**, with a "change general" affordance. **Allies' COs are visible; enemies'
   are hidden** until reveal. On all-ready (or the deadline) → lock → staggered **reveal** of every
   commander → **10s launch countdown** → battle start. A compact rules reminder stays at the top of
   the center (generals are the focus, not the map).

**Map preview** carries a **clean legend** (HQ · Factory · City · Airport · Port · Woods · Mountain
· Sea · start unit) with the properties + starting units drawn on it. **Pending invites live in the
team bar** (Unassigned column: `@name · Invited…` with accept/reject), not a floating panel. The
**deploy countdown is a bottom banner**, never covering the revealed generals.

**Team names:** teams are labelled with **random AW faction names** (Orange Star, Blue Moon, Green
Earth, Yellow Comet, Black Hole) and coloured to match, re-rolled per match. Player army skins are
separate (own-side cosmetic).

## Matchmaking reuse (same Pick phase)

Ranked/live play reuses the machinery: create a lobby with your 1 (or 2 for team mode) → **Find a
match** → **AFK ready-check** (~30s accept window; everyone must accept or the match is scrapped and
no-shows flagged as leavers) → **Pick phase** → start. So Pick phase is a shared component fed by
either a host-started custom lobby or the matchmaker.

## Timeout / leaver rule

If the Pick-phase timer expires while slots are open or players aren't ready → **cancel the match**
(don't force-start) and **flag the non-ready players as leavers** for monitoring + later sanctions
if a player leaves too often.

## Skins (visual, own side only — no overlap risk)

Map skin (tileset variant), Army skin (the 5 factions), Camp skin (HQ/building style: AW1/AW2/DS/
DoR). No dedicated skin-asset folder yet — placeholders for now.

## Full-screen layout (Pick phase)

Command bar (map name, mode chip, central countdown + phase, ready count) · left rail (battlefield
preview + rules) · roster (Team Alpha / Bravo columns, your slot highlighted, enemy COs hatched) ·
loadout bar (CO picker + Map/Army/Camp skin swatches + Ready). Keeps the WarsWorld dark-navy +
orange identity. See [[lobby-redesign-direction]].

## Server-authoritative note

Timer, CO-hiding enforcement, AFK check, leaver flagging and reveal are all **BE-driven** when
built (mockup simulates them client-side per the "don't build the timer yet" note).

## ⚠ Implementation TODO — real sprites (not the mockup monograms)

The mockup uses **text-monogram placeholders** only because the hosted artifact can't load repo PNGs.
When implementing, **swap in the real sprites**:

- **CO / general portraits** — `public/img/CO/pixelated/*` (and `smoothFull/*`): use in the champ-select
  general grid tiles, the hero dossier portrait, and each roster slot's CO. Files keyed by CO name
  (e.g. `andy`, `grit`, …).
- **Unit sprites** — `public/img/units/<nation>/*` (per-faction) and/or `public/img/spriteSheet/*`:
  use in the **Unit-stats grid** tiles (replace the INF/TNK/… monograms) and anywhere a unit is shown.
- **Terrain / property tiles** — `public/img/spriteSheet/*`: use to draw the real battlefield preview
  (the mockup draws a procedural canvas); keep the legend mapping to the real tile types.
- **Map/army/camp skins** — no dedicated skin folder yet; wire the skin pickers to real tilesets/
  faction palettes/HQ styles once those assets are organised.

Status (2026-07-08): design **approved globally**; ready for backend implementation planning. See
[[lobby-redesign-direction]].
