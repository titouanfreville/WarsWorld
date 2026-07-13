# CO Pose Art — Authoring Spec (End-Game Screen)

Turnkey spec for producing **victory / defeat pose art** for each Commanding Officer, used by the
end-of-match screen (`GameOverOverlay`). Hand this to an image model or artist; the game wiring,
fallback, and CSS mood-treatment already exist — deliver files that match the naming + format below
and they drop straight in.

## What's needed

For each CO, **two** new full-body poses:

- **Win pose** — triumphant / confident (arms raised, salute, smirk, fist, etc. — in character).
- **Lose pose** — defeated / dejected (slumped, kneeling, head down, gritted, etc. — in character).

These join the existing **neutral** art already in the repo, which is your **style + framing
reference** for each CO:

```
public/img/CO/smoothFull/Awds-<name>.webp        ← existing neutral art (reference)
```

## Style & format (match the existing art exactly)

| Property | Value |
|---|---|
| Style | AWDS-era smooth full-body character art (same as the existing `Awds-*.webp`) — **not** pixel art |
| Canvas | **400 × 1000 px** (portrait 2:5), same as the neutral art |
| Background | **Fully transparent** (alpha) — no backdrop, no ground shadow baked in |
| Framing | **Full body, bottom-aligned** (feet near the bottom edge) — the figures stand on the board's bottom edge and line up side by side |
| Color | **Full color.** Do NOT pre-desaturate the lose pose — the engine applies the grey/darken "defeat" tint itself (see below). Deliver both poses in full color |
| Lighting/scale | Consistent with the neutral art so a win + a lose pose sit together without looking mismatched |
| Format | **WebP**, transparent, comparable file size to the neutral art (~35–95 KB) |

> The client greys + slumps losers and lifts + glows winners in CSS (`styles/match/gameOver.scss`).
> So supply **neutral-lit, full-color** poses; the mood is applied at runtime. (If you'd rather the
> lose art carry its own somber grade, tell me and I'll ease off the CSS `grayscale` for CO's that
> have custom pose art.)

## Naming & location

Drop files here, one pair per CO:

```
public/img/CO/smoothFull/Awds-<name>-win.webp
public/img/CO/smoothFull/Awds-<name>-lose.webp
```

The resolver (`coPoseUrl` in `src/frontend/utils/sprites/co.ts`) already looks for exactly these
paths. Anything missing falls back automatically to the neutral art, then the pixel mugshot — so you
can deliver COs incrementally; partial coverage is fine.

(Optional, later: these can also be served as SQL-managed skins under element keys `<co>:artWin` /
`<co>:artLose` via the `SkinAsset` table — but the file convention above needs no DB work.)

## CO checklist (28)

`<name>` is the lowercase key used in filenames (note the hyphen in `von-bolt`):

adder · andy · colin · drake · eagle · flak · grimm · grit · hachi · hawke · jake · javier · jess ·
jugger · kanbei · kindle · koal · lash · max · nell · olaf · rachel · sami · sasha · sensei · sonja ·
sturm · von-bolt

That's **56 files** total (28 × win/lose).

## Acceptance

- Transparent background, 400×1000, bottom-aligned, full color, WebP.
- Recognizably the same CO as `Awds-<name>.webp`, same art style.
- Win reads triumphant / lose reads defeated at a glance, even before the CSS tint.
- Filename matches `Awds-<name>-{win,lose}.webp` exactly.

Once dropped in `public/img/CO/smoothFull/`, they appear automatically on the end-game screen — no
code change required.
