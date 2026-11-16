/**
 * Renders the map pool to a browsable HTML gallery: `npm run maps:gallery`.
 *
 * Reviewing 45 maps as CSV is not realistic and the ASCII `--render` is only good for spotting a
 * bug. This produces the visual index: every map drawn to canvas, filterable by category, symmetry
 * and mechanic, with each map's concept and property census beside it.
 *
 * Pure — reads `map-definitions.ts`, touches no database. Output goes to `.ai/map-gallery.html`.
 */
import { writeFile } from "node:fs/promises";
import { flanksOf, mapDefinitions } from "./map-definitions";
import type { MapDefinition } from "./map-definitions";

const OUT = ".ai/map-gallery.html";

type Stats = {
  name: string;
  category: string;
  symmetry: string;
  concept: string;
  width: number;
  height: number;
  players: number;
  tiles: number[][];
  /** Per-player property counts — identical across players, so one column speaks for all. */
  perPlayer: Record<string, number>;
  neutral: Record<string, number>;
  mechanics: string[];
  /** Whether the map gives each player a strong and a weak flank, or an even build-up. */
  flanks: string;
};

const PROPERTY_KINDS = ["city", "base", "airport", "port", "hq"] as const;
const SLOT_START: Record<number, number> = { 0: 38, 1: 43, 2: 48, 3: 53 };

const propertyOf = (code: number): { kind: string; slot: number } | null => {
  for (const [slot, start] of Object.entries(SLOT_START)) {
    if (code >= start && code < start + 5) {
      return { kind: PROPERTY_KINDS[code - start], slot: Number(slot) };
    }
  }

  const neutral: Record<number, string> = {
    34: "city",
    35: "base",
    36: "airport",
    37: "port",
    145: "lab",
    133: "tower",
  };

  return neutral[code] !== undefined ? { kind: neutral[code], slot: -1 } : null;
};

const analyse = (d: MapDefinition): Stats => {
  const tiles = d.tileDataString
    .trim()
    .split("\n")
    .map((l) => l.trim().split(",").map(Number));

  const perPlayer: Record<string, number> = {};
  const neutral: Record<string, number> = {};
  const codes = new Set(tiles.flat());

  for (const code of tiles.flat()) {
    const p = propertyOf(code);

    if (p === null) {
      continue;
    }

    if (p.slot === 0) {
      perPlayer[p.kind] = (perPlayer[p.kind] ?? 0) + 1;
    }

    if (p.slot === -1) {
      neutral[p.kind] = (neutral[p.kind] ?? 0) + 1;
    }
  }

  const has = (list: number[]) => list.some((c) => codes.has(c));
  const mechanics: string[] = [];

  if (has([40, 45, 50, 55, 36])) {
    mechanics.push("air");
  }

  if (has([41, 46, 51, 56, 37])) {
    mechanics.push("naval");
  }

  if (has([145])) {
    mechanics.push("lab");
  }

  if (has([133])) {
    mechanics.push("tower");
  }

  if (has([111])) {
    mechanics.push("silo");
  }

  if (has([101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 113, 114])) {
    mechanics.push("pipe");
  }

  if (mechanics.length === 0) {
    mechanics.push("land");
  }

  return {
    name: d.name,
    category: d.category,
    symmetry: d.symmetry,
    concept: d.concept,
    width: tiles[0].length,
    height: tiles.length,
    players: d.numberOfPlayers,
    tiles,
    perPlayer,
    neutral,
    mechanics,
    flanks: flanksOf(d),
  };
};

const stats = mapDefinitions.map(analyse);

const totals = {
  maps: stats.length,
  byCategory: stats.reduce<Record<string, number>>((a, s) => {
    a[s.category] = (a[s.category] ?? 0) + 1;
    return a;
  }, {}),
  asymmetric: stats.filter((s) => s.symmetry === "asymmetric").length,
  sided: stats.filter((s) => s.flanks === "sided").length,
};

const html = `<title>WarsWorld — Map Pool</title>
<style>
  :root {
    --plain: #cfd3a8;   --mountain: #a08560; --forest: #4a7a4a;  --river: #86b0cf;
    --road: #ded8c4;    --bridge: #b09a72;   --sea: #3d6a99;     --shoal: #e6ddb4;
    --pipe: #878d99;    --silo: #9aa2ac;     --neutral: #b6bac2;
    --p0: #e08a2e; --p1: #4a7fd4; --p2: #4aa84a; --p3: #e0c93a;

    --accent: #5b7f8f;
    --ground: #f5f4ef;
    --panel: #ffffff;
    --ink: #23282c;
    --ink-soft: #5f676e;
    --line: #ddd9cf;
    --shadow: 0 1px 2px rgba(35, 40, 44, .07), 0 6px 18px rgba(35, 40, 44, .05);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --accent: #7fa8b8;
      --ground: #14181b;
      --panel: #1c2124;
      --ink: #e6e6e2;
      --ink-soft: #949ca3;
      --line: #2c3438;
      --shadow: 0 1px 2px rgba(0,0,0,.4), 0 6px 18px rgba(0,0,0,.3);
    }
  }
  :root[data-theme="dark"] {
    --accent: #7fa8b8; --ground: #14181b; --panel: #1c2124; --ink: #e6e6e2;
    --ink-soft: #949ca3; --line: #2c3438;
    --shadow: 0 1px 2px rgba(0,0,0,.4), 0 6px 18px rgba(0,0,0,.3);
  }
  :root[data-theme="light"] {
    --accent: #5b7f8f; --ground: #f5f4ef; --panel: #ffffff; --ink: #23282c;
    --ink-soft: #5f676e; --line: #ddd9cf;
    --shadow: 0 1px 2px rgba(35,40,44,.07), 0 6px 18px rgba(35,40,44,.05);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--ground); color: var(--ink);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.5;
  }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 40px 24px 96px; }

  header { display: flex; flex-direction: column; gap: 8px; margin-bottom: 28px; }
  h1 {
    margin: 0; font-size: clamp(26px, 3.4vw, 38px); font-weight: 700;
    letter-spacing: -.02em; text-wrap: balance;
  }
  .lede { margin: 0; color: var(--ink-soft); max-width: 62ch; }

  .figures { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 26px; }
  .figure {
    background: var(--panel); border: 1px solid var(--line); border-radius: 3px;
    padding: 10px 16px; min-width: 104px; box-shadow: var(--shadow);
  }
  .figure b {
    display: block; font-size: 24px; font-weight: 650;
    font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .figure span {
    font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: var(--ink-soft);
  }

  .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 24px; }
  .controls .sep { width: 1px; height: 22px; background: var(--line); margin: 0 4px; }
  button.chip {
    font: inherit; font-size: 12px; letter-spacing: .04em;
    background: var(--panel); color: var(--ink-soft);
    border: 1px solid var(--line); border-radius: 3px; padding: 5px 11px; cursor: pointer;
    transition: background .12s, color .12s, border-color .12s;
  }
  button.chip:hover { border-color: var(--accent); color: var(--ink); }
  button.chip[aria-pressed="true"] {
    background: var(--accent); border-color: var(--accent); color: #fff;
  }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .grid {
    display: grid; gap: 16px;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  }
  .card {
    background: var(--panel); border: 1px solid var(--line); border-radius: 3px;
    overflow: hidden; box-shadow: var(--shadow); cursor: pointer; text-align: left;
    font: inherit; color: inherit; padding: 0; display: flex; flex-direction: column;
    transition: transform .12s, border-color .12s;
  }
  .card:hover { transform: translateY(-2px); border-color: var(--accent); }
  .card canvas { display: block; width: 100%; height: auto; image-rendering: pixelated; }
  .card .meta { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 7px; }
  .card h3 { margin: 0; font-size: 14px; font-weight: 650; letter-spacing: -.01em; }
  .tags { display: flex; flex-wrap: wrap; gap: 5px; }
  .tag {
    font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
    padding: 2px 6px; border-radius: 2px; border: 1px solid var(--line); color: var(--ink-soft);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .tag.cat { border-color: var(--accent); color: var(--accent); }
  .tag.asym { border-color: #c2724a; color: #c2724a; }
  .tag.sided { border-color: #7a6aa8; color: #7a6aa8; }
  .dims {
    font-size: 11px; color: var(--ink-soft); font-variant-numeric: tabular-nums;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  dialog {
    border: 1px solid var(--line); border-radius: 4px; background: var(--panel); color: var(--ink);
    max-width: min(940px, 94vw); padding: 0; box-shadow: 0 24px 70px rgba(0,0,0,.3);
  }
  dialog::backdrop { background: rgba(10, 14, 16, .58); }
  .detail { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(230px, .65fr); }
  @media (max-width: 720px) { .detail { grid-template-columns: 1fr; } }
  .detail .canvaswrap { background: var(--ground); padding: 18px; overflow-x: auto; }
  .detail canvas { display: block; margin: 0 auto; image-rendering: pixelated; max-width: 100%; }
  .detail .side { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
  .detail h2 { margin: 0; font-size: 19px; letter-spacing: -.015em; text-wrap: balance; }
  .detail p { margin: 0; font-size: 13px; color: var(--ink-soft); }
  .census { display: grid; grid-template-columns: 1fr auto; gap: 3px 12px; font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-variant-numeric: tabular-nums; }
  .census .k { color: var(--ink-soft); }
  .census .h { grid-column: 1 / -1; font-size: 10px; text-transform: uppercase;
    letter-spacing: .1em; color: var(--ink); margin-top: 8px; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11px; color: var(--ink-soft); }
  .legend i { width: 10px; height: 10px; border-radius: 1px; display: inline-block;
    margin-right: 5px; vertical-align: -1px; }
  .closebar { display: flex; justify-content: flex-end; padding: 10px 12px 0; }
  .empty { color: var(--ink-soft); padding: 40px 0; text-align: center; }
</style>

<div class="wrap">
  <header>
    <h1>WarsWorld map pool</h1>
    <p class="lede">
      Every map is built on an exact symmetry or, where it is asymmetric, on measured parity:
      identical property census, identical distances from each HQ to what matters by foot
      <em>and</em> by tread, and matching terrain mix. Most give each player a strong flank —
      more production and a faster route to the middle — and a weak one to defend.
      Click a plate for the full read.
    </p>
  </header>

  <div class="figures">
    <div class="figure"><b>${totals.maps}</b><span>maps</span></div>
    <div class="figure"><b>${totals.byCategory["1v1"] ?? 0}</b><span>1v1</span></div>
    <div class="figure"><b>${totals.byCategory["2v2"] ?? 0}</b><span>2v2</span></div>
    <div class="figure"><b>${totals.byCategory.ffa ?? 0}</b><span>free-for-all</span></div>
    <div class="figure"><b>${totals.asymmetric}</b><span>asymmetric</span></div>
    <div class="figure"><b>${totals.sided}</b><span>strong / weak flank</span></div>
  </div>

  <div class="controls" id="controls"></div>
  <div class="grid" id="grid"></div>
  <p class="empty" id="empty" hidden>No maps match those filters.</p>
</div>

<dialog id="detail">
  <div class="closebar"><button class="chip" id="close">Close</button></div>
  <div class="detail">
    <div class="canvaswrap"><canvas id="bigmap"></canvas></div>
    <div class="side" id="side"></div>
  </div>
</dialog>

<script>
const MAPS = ${JSON.stringify(stats)};

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Terrain first, then properties on top — properties are drawn as a tinted cell plus a glyph. */
function tileFill(code) {
  if (code === 1) return css('--plain');
  if (code === 2) return css('--mountain');
  if (code === 3) return css('--forest');
  if (code >= 4 && code <= 14) return css('--river');
  if (code >= 15 && code <= 25) return css('--road');
  if (code === 26 || code === 27) return css('--bridge');
  if (code === 28 || code === 33) return css('--sea');
  if (code >= 29 && code <= 32) return css('--shoal');
  if (code >= 101 && code <= 116) return css('--pipe');
  if (code === 111 || code === 112) return css('--silo');
  return css('--plain');
}

const KINDS = ['city', 'base', 'airport', 'port', 'hq'];
const STARTS = { 0: 38, 1: 43, 2: 48, 3: 53 };
const NEUTRALS = { 34: 'city', 35: 'base', 36: 'airport', 37: 'port', 145: 'lab', 133: 'tower' };
const GLYPH = { city: 'C', base: 'B', airport: 'A', port: 'P', hq: 'H', lab: 'L', tower: 'T' };

function propOf(code) {
  for (const [slot, start] of Object.entries(STARTS)) {
    if (code >= start && code < start + 5) return { kind: KINDS[code - start], slot: +slot };
  }
  if (NEUTRALS[code]) return { kind: NEUTRALS[code], slot: -1 };
  return null;
}

function draw(canvas, tiles, cell) {
  const w = tiles[0].length, h = tiles.length;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * cell * dpr;
  canvas.height = h * cell * dpr;
  canvas.style.width = (w * cell) + 'px';
  canvas.style.height = (h * cell) + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '600 ' + Math.max(6, Math.round(cell * 0.62)) + 'px ui-monospace, Menlo, monospace';

  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const code = tiles[r][c];
      const p = propOf(code);
      const x = c * cell, y = r * cell;

      ctx.fillStyle = tileFill(code);
      ctx.fillRect(x, y, cell, cell);

      if (p) {
        ctx.fillStyle = p.slot < 0 ? css('--neutral') : css('--p' + p.slot);
        ctx.fillRect(x, y, cell, cell);
        if (cell >= 11) {
          ctx.fillStyle = p.slot === 3 ? '#3a3320' : (p.slot < 0 ? '#2c3036' : '#ffffff');
          ctx.fillText(GLYPH[p.kind], x + cell / 2, y + cell / 2 + 0.5);
        }
      }
      if (code === 111 || code === 112) {
        ctx.fillStyle = '#2c3036';
        ctx.beginPath();
        ctx.arc(x + cell / 2, y + cell / 2, Math.max(1.2, cell * 0.2), 0, 6.284);
        ctx.fill();
      }
    }
  }
}

// ── filters ────────────────────────────────────────────────────────────────
const FILTERS = [
  { key: 'category', label: 'Mode', values: ['1v1', '2v2', 'ffa'] },
  { key: 'symmetry', label: 'Symmetry', values: ['rotate180', 'mirrorBoth', 'rotate90', 'asymmetric'] },
  { key: 'flanks', label: 'Flanks', values: ['sided', 'balanced'] },
  { key: 'mechanics', label: 'Features', values: ['air', 'naval', 'lab', 'tower', 'silo', 'pipe', 'land'] },
];
const active = { category: null, symmetry: null, flanks: null, mechanics: null };

const controls = document.getElementById('controls');
FILTERS.forEach((f, i) => {
  if (i) { const s = document.createElement('span'); s.className = 'sep'; controls.appendChild(s); }
  f.values.forEach((v) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.type = 'button';
    b.textContent = v;
    b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      active[f.key] = active[f.key] === v ? null : v;
      controls.querySelectorAll('button').forEach((btn) => {
        const own = FILTERS.find((ff) => ff.values.includes(btn.textContent));
        btn.setAttribute('aria-pressed', String(active[own.key] === btn.textContent));
      });
      render();
    };
    controls.appendChild(b);
  });
});

const grid = document.getElementById('grid');
const empty = document.getElementById('empty');

function matches(m) {
  if (active.category && m.category !== active.category) return false;
  if (active.symmetry && m.symmetry !== active.symmetry) return false;
  if (active.flanks && m.flanks !== active.flanks) return false;
  if (active.mechanics && !m.mechanics.includes(active.mechanics)) return false;
  return true;
}

function render() {
  grid.textContent = '';
  const shown = MAPS.filter(matches);
  empty.hidden = shown.length > 0;

  shown.forEach((m) => {
    const card = document.createElement('button');
    card.className = 'card';
    card.type = 'button';

    const cv = document.createElement('canvas');
    card.appendChild(cv);

    const meta = document.createElement('div');
    meta.className = 'meta';
    const h3 = document.createElement('h3');
    h3.textContent = m.name;
    const tags = document.createElement('div');
    tags.className = 'tags';
    const t1 = document.createElement('span');
    t1.className = 'tag cat';
    t1.textContent = m.category;
    tags.appendChild(t1);
    const t2 = document.createElement('span');
    t2.className = 'tag' + (m.symmetry === 'asymmetric' ? ' asym' : '');
    t2.textContent = m.symmetry;
    tags.appendChild(t2);
    const t3 = document.createElement('span');
    t3.className = 'tag' + (m.flanks === 'sided' ? ' sided' : '');
    t3.textContent = m.flanks;
    tags.appendChild(t3);
    m.mechanics.forEach((x) => {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = x;
      tags.appendChild(t);
    });
    const dims = document.createElement('div');
    dims.className = 'dims';
    dims.textContent = m.width + '×' + m.height + ' · ' + m.players + ' players';

    meta.append(h3, tags, dims);
    card.appendChild(meta);
    card.onclick = () => openDetail(m);
    grid.appendChild(card);

    draw(cv, m.tiles, Math.max(5, Math.min(11, Math.floor(248 / m.width))));
  });
}

// ── detail ─────────────────────────────────────────────────────────────────
const dialog = document.getElementById('detail');
const side = document.getElementById('side');
document.getElementById('close').onclick = () => dialog.close();
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

const LEGEND = [
  ['--plain', 'plain'], ['--forest', 'forest'], ['--mountain', 'mountain'],
  ['--river', 'river'], ['--sea', 'sea'], ['--shoal', 'shoal'],
  ['--road', 'road'], ['--pipe', 'pipe'], ['--neutral', 'neutral property'],
];

function openDetail(m) {
  side.textContent = '';

  const h2 = document.createElement('h2');
  h2.textContent = m.name;
  const p = document.createElement('p');
  p.textContent = m.concept;
  const dims = document.createElement('div');
  dims.className = 'dims';
  dims.textContent =
    m.width + '×' + m.height + ' · ' + m.players + ' players · ' + m.symmetry + ' · ' + m.flanks;

  const census = document.createElement('div');
  census.className = 'census';
  const addHead = (t) => { const d = document.createElement('div'); d.className = 'h'; d.textContent = t; census.appendChild(d); };
  const addRow = (k, v) => {
    const a = document.createElement('div'); a.className = 'k'; a.textContent = k;
    const b = document.createElement('div'); b.textContent = String(v);
    census.append(a, b);
  };
  addHead('Each player owns');
  Object.entries(m.perPlayer).forEach(([k, v]) => addRow(k, v));
  addHead('Neutral, to capture');
  Object.entries(m.neutral).forEach(([k, v]) => addRow(k, v));

  const legend = document.createElement('div');
  legend.className = 'legend';
  LEGEND.forEach(([varName, label]) => {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = css(varName);
    s.append(i, document.createTextNode(label));
    legend.appendChild(s);
  });

  side.append(h2, dims, p, census, legend);
  draw(document.getElementById('bigmap'), m.tiles, Math.max(12, Math.min(26, Math.floor(560 / m.width))));
  dialog.showModal();
}

render();
new MutationObserver(render).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
</script>
`;

await writeFile(OUT, html, "utf-8");
console.info(`Wrote ${OUT} — ${stats.length} maps`);
