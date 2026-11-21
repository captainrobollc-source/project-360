// Prism Breaker: an original neon glass brick breaker for the Project 360 arcade.
//
// One glowing well, one paddle, a wall of cut-glass prisms. Glass bricks take 1-3 hits and crack
// as they weaken, steel never breaks, volatile bricks blow up their neighbours. Broken bricks drop
// capsules. Ten handcrafted layouts, then procedurally generated ones for as long as you last.

const W = 1920;
const H = 1080;
const WL = 360;              // well inner edges
const WR = 1560;
const WT = 128;
const COLS = 13;
const MAXROWS = 12;
const CW = 88;               // grid cell
const CH = 40;
const BW = 82;               // brick inside its cell
const BH = 32;
const GX = WL + (WR - WL - COLS * CW) / 2;
const GY = WT + 70;
const PY = 990;              // paddle top
const PH = 20;
const PADDLE_W = 172;
const PADDLE_MAX = 1750;     // px/s at full stick
const BALL_R = 11;
const MAX_BALLS = 12;
const ACCENT = '#5ad8ff';

const COLORS = { r: '#ff3d5e', o: '#ff8a2b', y: '#ffd43b', g: '#3df28b', c: '#2fe0ff', b: '#4c7dff', p: '#a35dff', m: '#ff52d4', w: '#dcefff' };
const ORDER = 'roygcbpm';
const STEEL = '#a9b8cc';
const BOMB = '#ff7424';
const NOTE_INDEX = { r: 0, o: 1, y: 2, g: 3, c: 4, b: 5, p: 6, m: 7, w: 8, steel: 4, bomb: 0 };
const NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

// ------------------------------------------------------------------ levels
// 13 columns. Lowercase = glass (1 hit), uppercase = tempered glass (2 hits), W = crystal (3 hits),
// # = steel (never breaks), * = volatile (breaks its neighbours), . = empty.
const LEVELS = [
  { name: 'Sunrise', rows: [
    '.............',
    '....yyyyy....',
    '..ooooooooo..',
    '.rrrrrrrrrrr.',
    'mmmmmmmmmmmmm',
    '.............',
    'ccccccccccccc',
    '.bbbbbbbbbbb.',
  ] },
  { name: 'Facet', rows: [
    '......W......',
    '.....cCc.....',
    '....cbBbc....',
    '...cbpPpbc...',
    '..cbpmMmpbc..',
    '.cbpm*W*mpbc.',
    '..cbpmMmpbc..',
    '...cbpPpbc...',
    '....cbBbc....',
    '.....cCc.....',
    '......c......',
  ] },
  { name: 'Heartglass', rows: [
    '..mmm...mmm..',
    '.mMMMm.mMMMm.',
    'mMrrrMmMrrrMm',
    'mMrrrrMrrrrMm',
    'mMrrrrrrrrrMm',
    '.mMrrrrrrrMm.',
    '..mMrrrrrMm..',
    '...mMrrrMm...',
    '....mMrMm....',
    '.....mMm.....',
    '......m......',
  ] },
  { name: 'Bastion', rows: [
    'o.o.o...o.o.o',
    'ooooo...ooooo',
    'oYYYo...oYYYo',
    'oY*Yo.g.oY*Yo',
    'ooooo.g.ooooo',
    '.....ggg.....',
    '..#.ggggg.#..',
    '.##ggg*ggg##.',
    '.....ggg.....',
  ] },
  { name: 'Fuse Box', rows: [
    'ccccccccccccc',
    'c*.........*c',
    'c.ppppppppp.c',
    'c.p*.....*p.c',
    'c.p.YYYYY.p.c',
    'c.p.Y***Y.p.c',
    'c.p.YYYYY.p.c',
    'c.p.......p.c',
    'c.ppppppppp.c',
    'ccccccccccccc',
  ] },
  { name: 'Hourglass', rows: [
    'BBBBBBBBBBBBB',
    '.bbbbbbbbbbb.',
    '..ccccccccc..',
    '...ggggggg...',
    '....yyyyy....',
    '.....#o#.....',
    '....yyyyy....',
    '...ggggggg...',
    '..ccccccccc..',
    '.bbbbbbbbbbb.',
    'BBBBBBBBBBBBB',
  ] },
  { name: 'Pipe Organ', rows: [
    'W.W.W.W.W.W.W',
    'p.m.r.o.y.g.c',
    'P.M.R.O.Y.G.C',
    'p.m.r.o.y.g.c',
    'P.M.R.O.Y.G.C',
    'p.m.r.o.y.g.c',
    'P.M.R.O.Y.G.C',
    '#...#...#...#',
  ] },
  { name: 'Crown', rows: [
    'y.....y.....y',
    'yy...yWy...yy',
    'yYy.yYYYy.yYy',
    'yYYyYYYYYyYYy',
    'YYYYYYYYYYYYY',
    'r*rbr*rbr*rbr',
    'YYYYYYYYYYYYY',
    '.............',
    '.o.o.o.o.o.o.',
  ] },
  { name: 'Eclipse', rows: [
    '....ccccc....',
    '..cc.....cc..',
    '.c..bbbbb..c.',
    'c..b.....b..c',
    'c.b..pWp..b.c',
    'c.b..WWW..b.c',
    'c.b..pWp..b.c',
    'c..b.....b..c',
    '.c..bbbbb..c.',
    '..cc.....cc..',
    '....ccccc....',
  ] },
  { name: 'Cage', rows: [
    '#############',
    '#.....W.....#',
    '#.ccccccccc.#',
    '#.c*******c.#',
    '#.ccccccccc.#',
    '#.mmm...mmm.#',
    '###.......###',
  ] },
];
const GEN_NAMES = ['Refraction', 'Lattice', 'Mirage', 'Halo', 'Aurora', 'Shardfall', 'Kaleido', 'Lumen', 'Parallax', 'Spectra', 'Afterglow', 'Quartz'];

function cellFor(ch) {
  if (ch === '#') return { k: 'steel', c: 'steel', hp: 1 };
  if (ch === '*') return { k: 'bomb', c: 'bomb', hp: 1 };
  if (ch === 'W') return { k: 'glass', c: 'w', hp: 3 };
  const low = ch.toLowerCase();
  if (low !== 'w' && COLORS[low]) return { k: 'glass', c: low, hp: ch === low ? 1 : 2 };
  return null;
}

function parseLevel(def) {
  const rows = Math.min(MAXROWS, def.rows.length);
  const spec = new Array(rows * COLS).fill(null);
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) spec[r * COLS + c] = cellFor(def.rows[r][c] || '.');
  prune(spec, rows);
  return { spec, rows, name: def.name };
}

// Remove breakable bricks the ball could never reach (walled in by steel).
function prune(spec, rows) {
  const R = rows + 2, C = COLS + 2;
  const seen = new Uint8Array(R * C);
  const open = (r, c) => {
    if (r === 0 || c === 0 || r === R - 1 || c === C - 1) return true;
    const cell = spec[(r - 1) * COLS + (c - 1)];
    return !cell || cell.k !== 'steel';
  };
  const stack = [0];
  seen[0] = 1;
  while (stack.length) {
    const i = stack.pop();
    const r = Math.floor(i / C), c = i % C;
    for (const [nr, nc] of [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]) {
      if (nr < 0 || nc < 0 || nr >= R || nc >= C) continue;
      const j = nr * C + nc;
      if (seen[j] || !open(nr, nc)) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c < COLS; c++) {
    const cell = spec[r * COLS + c];
    if (cell && cell.k !== 'steel' && !seen[(r + 1) * C + (c + 1)]) spec[r * COLS + c] = null;
  }
}

function genLevel(n) {
  const d = n - LEVELS.length;
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = rng32(n * 7919 + attempt * 104729 + 13);
    const rows = Math.min(MAXROWS, 8 + Math.floor(r() * 3) + Math.min(2, Math.floor(d / 4)));
    const type = Math.floor(r() * 7);
    const pal = shuffle(ORDER.split(''), r).slice(0, 3 + Math.floor(r() * 3));
    const hp2 = Math.min(0.45, 0.14 + d * 0.025);
    const hp3 = Math.min(0.22, d * 0.014);
    const steelP = Math.min(0.09, 0.015 + d * 0.006);
    const bombP = 0.035 + r() * 0.03;
    const spec = new Array(rows * COLS).fill(null);
    const cy = (rows - 1) / 2, ph = r() * 6.28, fq = 0.6 + r() * 0.6;
    for (let y = 0; y < rows; y++) for (let x = 0; x <= 6; x++) {
      const dx = 6 - x, dy = y - cy;
      let on = false, band = 0;
      switch (type) {
        case 0: on = (x + y) % 2 === 0 || y % 4 === 0; band = y; break;                                   // lattice
        case 1: { const q = Math.hypot(dx * 0.9, dy * 1.5); on = Math.floor(q) % 2 === 0; band = Math.floor(q / 2); break; } // rings
        case 2: on = Math.abs(dy - Math.sin(x * fq + ph) * cy * 0.7) < 1.5 || y === 0; band = x; break;     // wave
        case 3: on = dx * 0.8 + Math.abs(dy) * 1.2 < cy + 2.4 && (dx + Math.round(Math.abs(dy))) % 3 !== 2; band = Math.floor(dx + Math.abs(dy)); break; // gem
        case 4: on = y % 3 !== 2 && x % 4 !== 3; band = Math.floor(y / 3) + (x % 2); break;              // blocks
        case 5: on = Math.floor(dx * 0.5 + y) % 3 !== 2; band = Math.floor(dx * 0.5 + y); break;        // chevrons
        default: on = r() < 0.62; band = Math.floor(r() * 9);                                              // scatter
      }
      if (!on) continue;
      const roll = r();
      let cell;
      if (roll < steelP && y < rows - 1) cell = { k: 'steel', c: 'steel', hp: 1 };
      else if (roll < steelP + bombP) cell = { k: 'bomb', c: 'bomb', hp: 1 };
      else { const q = r(); cell = { k: 'glass', c: pal[band % pal.length], hp: q < hp3 ? 3 : q < hp3 + hp2 ? 2 : 1 }; }
      spec[y * COLS + x] = cell;
      spec[y * COLS + (COLS - 1 - x)] = { ...cell };
    }
    prune(spec, rows);
    if (spec.filter((c) => c && c.k !== 'steel').length >= 26) return { spec, rows, name: GEN_NAMES[n % GEN_NAMES.length] };
  }
  return parseLevel(LEVELS[n % LEVELS.length]);
}

// ------------------------------------------------------------------ small helpers
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(hex, to, t, a = 1) {
  const c = rgbOf(hex), e = rgbOf(to);
  return `rgba(${Math.round(c[0] + (e[0] - c[0]) * t)},${Math.round(c[1] + (e[1] - c[1]) * t)},${Math.round(c[2] + (e[2] - c[2]) * t)},${a})`;
}
const tint = (hex, t, a = 1) => mix(hex, '#ffffff', t, a);
const shade = (hex, t, a = 1) => mix(hex, '#000000', t, a);
const rgba = (hex, a) => mix(hex, hex, 0, a);
const colorOf = (key) => (key === 'steel' ? STEEL : key === 'bomb' ? BOMB : COLORS[key]);

// ------------------------------------------------------------------ glass brick painter
// P(u, v) maps brick-local [0..1]² to canvas coordinates: flat for the game, projected for the art.
function poly(ctx, P, pts) {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { const [x, y] = P(pts[i][0], pts[i][1]); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath();
}
function seg(ctx, P, a, b) {
  const [x0, y0] = P(a[0], a[1]), [x1, y1] = P(b[0], b[1]);
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
}
function vgrad(ctx, P, stops) {
  const [x0, y0] = P(0.5, 0), [x1, y1] = P(0.5, 1);
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(clamp(o, 0, 1), c);
  return g;
}

function cracks(ctx, P, stage, seed, k) {
  const r = rng32(seed * 7919 + stage * 613);
  const ox = 0.3 + r() * 0.4, oy = 0.35 + r() * 0.3;
  const n = stage === 1 ? 4 : 7;
  const paths = [];
  for (let i = 0; i < n; i++) {
    let a = (i / n) * Math.PI * 2 + r() * 0.7, u = ox, v = oy;
    const pts = [[u, v]];
    const segs = 2 + Math.floor(r() * 3) + (stage > 1 ? 1 : 0);
    const len = (stage === 1 ? 0.085 : 0.11) * (0.7 + r() * 0.6);
    for (let j = 0; j < segs; j++) {
      a += (r() - 0.5) * 1.1;
      u += Math.cos(a) * len; v += Math.sin(a) * len * 2.5;
      if (u < 0.03 || u > 0.97 || v < 0.06 || v > 0.94) { pts.push([clamp(u, 0.03, 0.97), clamp(v, 0.06, 0.94)]); break; }
      pts.push([u, v]);
    }
    paths.push(pts);
  }
  if (stage > 1) {
    const ring = [];
    for (let j = 0; j <= 7; j++) { const a = (j / 7) * Math.PI * 2; ring.push([ox + Math.cos(a) * 0.06 * (0.8 + r() * 0.4), oy + Math.sin(a) * 0.15 * (0.8 + r() * 0.4)]); }
    paths.push(ring);
  }
  for (const [st, lw] of [['rgba(8,0,24,0.6)', 2.4], ['rgba(255,255,255,0.92)', 1]]) {
    ctx.strokeStyle = st; ctx.lineWidth = lw * k; ctx.beginPath();
    for (const pts of paths) pts.forEach(([u, v], i) => { const [x, y] = P(u, v); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
  const [x, y] = P(ox, oy);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath(); ctx.arc(x, y, 1.4 * k * stage, 0, Math.PI * 2); ctx.fill();
}

function paintBrick(ctx, P, kind, color, hp = 1, maxHp = 1, seed = 1) {
  const [ax, ay] = P(0, 0.5), [bx, by] = P(1, 0.5);
  const k = Math.max(0.5, Math.hypot(bx - ax, by - ay) / BW);
  const bu = 0.07, bv = 0.17;
  const O = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const I = [[bu, bv], [1 - bu, bv], [1 - bu, 1 - bv], [bu, 1 - bv]];
  const facets = (top, left, right, bottom) => {
    ctx.fillStyle = top; poly(ctx, P, [O[0], O[1], I[1], I[0]]); ctx.fill();
    ctx.fillStyle = left; poly(ctx, P, [O[0], I[0], I[3], O[3]]); ctx.fill();
    ctx.fillStyle = right; poly(ctx, P, [O[1], O[2], I[2], I[1]]); ctx.fill();
    ctx.fillStyle = bottom; poly(ctx, P, [O[3], I[3], I[2], O[2]]); ctx.fill();
  };
  const gloss = (a) => {
    ctx.fillStyle = vgrad(ctx, P, [[bv, `rgba(255,255,255,${a})`], [0.5, 'rgba(255,255,255,0.03)'], [0.51, 'rgba(255,255,255,0)']]);
    poly(ctx, P, [I[0], I[1], [1 - bu, 0.5], [bu, 0.5]]); ctx.fill();
  };
  ctx.save();
  ctx.lineJoin = 'round';
  if (kind === 'steel') {
    ctx.fillStyle = vgrad(ctx, P, [[0, '#f1f6fc'], [0.48, '#9ba9ba'], [0.52, '#7e8b9d'], [1, '#384150']]);
    poly(ctx, P, O); ctx.fill();
    facets('rgba(255,255,255,0.5)', 'rgba(255,255,255,0.18)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.42)');
    ctx.fillStyle = vgrad(ctx, P, [[bv, '#b3bfce'], [0.5, '#8a97a9'], [1 - bv, '#677385']]);
    poly(ctx, P, I); ctx.fill();
    ctx.lineWidth = 0.8 * k;
    for (let i = 0; i < 6; i++) {
      const v = bv + ((1 - 2 * bv) * (i + 0.5)) / 6;
      ctx.strokeStyle = i % 2 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
      seg(ctx, P, [bu + 0.03, v], [1 - bu - 0.03, v]);
    }
    for (const [u, v] of [[bu * 2.2, bv * 2.3], [1 - bu * 2.2, bv * 2.3], [bu * 2.2, 1 - bv * 2.3], [1 - bu * 2.2, 1 - bv * 2.3]]) {
      const [x, y] = P(u, v);
      ctx.fillStyle = '#29303b'; ctx.beginPath(); ctx.arc(x, y, 2.6 * k, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#eef3fa'; ctx.beginPath(); ctx.arc(x - 0.6 * k, y - 0.6 * k, 1.2 * k, 0, Math.PI * 2); ctx.fill();
    }
    gloss(0.3);
    ctx.strokeStyle = 'rgba(232,242,255,0.9)'; ctx.lineWidth = 1.1 * k; poly(ctx, P, O); ctx.stroke();
    ctx.restore();
    return;
  }
  if (kind === 'bomb') {
    ctx.fillStyle = vgrad(ctx, P, [[0, '#ffb661'], [0.45, '#c4381b'], [1, '#3a0905']]);
    poly(ctx, P, O); ctx.fill();
    facets('rgba(255,230,180,0.45)', 'rgba(255,200,150,0.15)', 'rgba(0,0,0,0.25)', 'rgba(0,0,0,0.45)');
    ctx.fillStyle = 'rgba(34,4,0,0.6)'; poly(ctx, P, I); ctx.fill();
    for (const [a0, a1] of [[bu, 0.28], [0.72, 1 - bu]]) {
      ctx.save();
      poly(ctx, P, [[a0, bv], [a1, bv], [a1, 1 - bv], [a0, 1 - bv]]); ctx.clip();
      ctx.fillStyle = 'rgba(255,176,40,0.85)';
      for (let u = a0 - 0.12; u < a1 + 0.02; u += 0.075) { poly(ctx, P, [[u, 1 - bv], [u + 0.036, 1 - bv], [u + 0.106, bv], [u + 0.07, bv]]); ctx.fill(); }
      ctx.restore();
    }
    const [cx, cy] = P(0.5, 0.5), [ex, ey] = P(0.5, bv);
    const rr = Math.max(2, Math.hypot(ex - cx, ey - cy));
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr * 1.5);
    rg.addColorStop(0, '#fff8d2'); rg.addColorStop(0.35, '#ffc43c'); rg.addColorStop(0.75, 'rgba(255,90,20,0.7)'); rg.addColorStop(1, 'rgba(255,60,0,0)');
    ctx.fillStyle = rg;
    poly(ctx, P, [[0.5, bv + 0.02], [0.6, 0.5], [0.5, 1 - bv - 0.02], [0.4, 0.5]]); ctx.fill();
    ctx.strokeStyle = 'rgba(255,240,200,0.9)'; ctx.lineWidth = 1 * k; ctx.stroke();
    gloss(0.32);
    ctx.strokeStyle = '#ffc98c'; ctx.lineWidth = 1.1 * k; poly(ctx, P, O); ctx.stroke();
    ctx.restore();
    return;
  }
  // glass prism (crystal = the 3-hit iridescent kind)
  const crystal = kind === 'crystal';
  const dense = crystal ? 0 : maxHp >= 3 ? 0.22 : maxHp === 2 ? 0.08 : 0;
  const stage = Math.max(0, maxHp - hp);
  ctx.fillStyle = crystal
    ? vgrad(ctx, P, [[0, '#ffffff'], [0.42, '#bfe2ff'], [1, '#5a64b8']])
    : vgrad(ctx, P, [[0, tint(color, 0.55)], [0.42, shade(color, dense)], [1, shade(color, 0.62)]]);
  poly(ctx, P, O); ctx.fill();
  facets('rgba(255,255,255,0.4)', 'rgba(255,255,255,0.13)', 'rgba(0,0,0,0.22)', 'rgba(0,0,0,0.4)');
  ctx.fillStyle = crystal
    ? vgrad(ctx, P, [[bv, 'rgba(70,90,190,0.55)'], [0.55, 'rgba(120,170,255,0.3)'], [1 - bv, 'rgba(230,245,255,0.5)']])
    : vgrad(ctx, P, [[bv, shade(color, 0.18 + dense, 0.6)], [0.55, shade(color, 0.05 + dense * 0.5, 0.35)], [1 - bv, tint(color, 0.25, 0.45)]]);
  poly(ctx, P, I); ctx.fill();
  if (crystal) {
    const [x0, y0] = P(bu, bv), [x1, y1] = P(1 - bu, 1 - bv);
    const ig = ctx.createLinearGradient(x0, y0, x1, y1);
    ['#ff3d5e', '#ff8a2b', '#ffd43b', '#3df28b', '#2fe0ff', '#4c7dff', '#a35dff', '#ff52d4'].forEach((c, i) => ig.addColorStop(i / 7, rgba(c, 0.5)));
    ctx.fillStyle = ig; poly(ctx, P, I); ctx.fill();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  poly(ctx, P, [[0.15, bv], [0.29, bv], [0.21, 1 - bv], [0.07, 1 - bv]]); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  poly(ctx, P, [[0.35, bv], [0.39, bv], [0.31, 1 - bv], [0.27, 1 - bv]]); ctx.fill();
  if (stage) { ctx.fillStyle = `rgba(255,255,255,${0.07 * stage})`; poly(ctx, P, I); ctx.fill(); }
  gloss(0.45);
  if (maxHp >= 2) {
    ctx.strokeStyle = tint(color, 0.7, 0.55); ctx.lineWidth = 1 * k;
    poly(ctx, P, [[bu * 2.3, bv * 2.3], [1 - bu * 2.3, bv * 2.3], [1 - bu * 2.3, 1 - bv * 2.3], [bu * 2.3, 1 - bv * 2.3]]); ctx.stroke();
  }
  if (maxHp >= 3) {
    ctx.strokeStyle = tint(color, 0.85, 0.75); ctx.lineWidth = 1 * k;
    poly(ctx, P, [[0.5, bv * 2.5], [0.62, 0.5], [0.5, 1 - bv * 2.5], [0.38, 0.5]]); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    poly(ctx, P, [[0.5, bv * 2.5], [0.62, 0.5], [0.5, 0.5]]); ctx.fill();
  }
  if (stage) cracks(ctx, P, stage, seed, k);
  ctx.strokeStyle = tint(color, 0.6, 0.95); ctx.lineWidth = 1.1 * k; poly(ctx, P, O); ctx.stroke();
  const [sx, sy] = P(bu * 1.3, bv * 1.3);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.beginPath(); ctx.arc(sx, sy, 1.5 * k, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// Game sprites: each brick look is painted once into a small canvas.
const spriteCache = new Map();
function brickSprite(kind, ckey, hp, maxHp, variant) {
  const key = `${kind}|${ckey}|${hp}|${maxHp}|${variant}`;
  let c = spriteCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = BW + 4; c.height = BH + 4;
  paintBrick(c.getContext('2d'), (u, v) => [2 + u * BW, 2 + v * BH], ckey === 'w' ? 'crystal' : kind, colorOf(ckey), hp, maxHp, variant * 17 + 3);
  spriteCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ playfield backdrop (painted once)
let bgCanvas = null;
function wellPath(g, o) {
  g.beginPath();
  g.moveTo(WL - o, H + 10); g.lineTo(WL - o, WT - o); g.lineTo(WR + o, WT - o); g.lineTo(WR + o, H + 10);
}
function background() {
  if (bgCanvas) return bgCanvas;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#04060e'); gr.addColorStop(0.55, '#070a19'); gr.addColorStop(1, '#030409');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const r = rng32(77);
  // spectral beams through the side panels
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 8; i++) {
    const col = COLORS[ORDER[i]];
    for (const side of [-1, 1]) {
      const x0 = side < 0 ? 30 + i * 24 : W - 30 - i * 24;
      const lg = g.createLinearGradient(0, 0, 0, H);
      lg.addColorStop(0, rgba(col, 0)); lg.addColorStop(0.45, rgba(col, 0.07)); lg.addColorStop(1, rgba(col, 0));
      g.fillStyle = lg;
      g.beginPath(); g.moveTo(x0, 0); g.lineTo(x0 - side * 16, 0); g.lineTo(x0 - side * 196, H); g.lineTo(x0 - side * 180, H); g.closePath(); g.fill();
    }
  }
  for (let i = 0; i < 140; i++) {
    const x = r() < 0.5 ? r() * (WL - 40) : WR + 40 + r() * (W - WR - 40);
    const y = r() * H, a = 0.15 + r() * 0.5;
    g.fillStyle = `rgba(200,235,255,${a})`;
    g.fillRect(x, y, r() < 0.15 ? 2 : 1, r() < 0.15 ? 2 : 1);
  }
  g.globalCompositeOperation = 'source-over';
  // the well
  gr = g.createLinearGradient(0, WT, 0, H);
  gr.addColorStop(0, '#091231'); gr.addColorStop(0.55, '#060b1e'); gr.addColorStop(1, '#0a1834');
  g.fillStyle = gr; g.fillRect(WL, WT, WR - WL, H - WT);
  g.strokeStyle = 'rgba(90,216,255,0.05)'; g.lineWidth = 1;
  g.beginPath();
  for (let x = GX; x <= GX + COLS * CW + 0.5; x += CW) { g.moveTo(x + 0.5, WT); g.lineTo(x + 0.5, H); }
  for (let y = GY; y < H; y += CH) { g.moveTo(WL, y + 0.5); g.lineTo(WR, y + 0.5); }
  g.stroke();
  g.globalCompositeOperation = 'lighter';
  let rg = g.createRadialGradient(W / 2, H + 40, 0, W / 2, H + 40, 760);
  rg.addColorStop(0, 'rgba(90,216,255,0.16)'); rg.addColorStop(1, 'rgba(90,216,255,0)');
  g.fillStyle = rg; g.fillRect(WL, WT, WR - WL, H - WT);
  rg = g.createRadialGradient(W / 2, WT, 0, W / 2, WT, 700);
  rg.addColorStop(0, 'rgba(160,120,255,0.10)'); rg.addColorStop(1, 'rgba(160,120,255,0)');
  g.fillStyle = rg; g.fillRect(WL, WT, WR - WL, 600);
  g.globalCompositeOperation = 'source-over';
  // glowing walls (shadowBlur is fine here: this canvas is painted once)
  const wg = g.createLinearGradient(WL, 0, WR, 0);
  wg.addColorStop(0, ACCENT); wg.addColorStop(0.5, '#b993ff'); wg.addColorStop(1, ACCENT);
  g.save();
  g.lineJoin = 'round';
  g.shadowColor = ACCENT; g.shadowBlur = 28;
  g.strokeStyle = wg; g.lineWidth = 6;
  wellPath(g, 4); g.stroke(); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(240,252,255,0.95)'; g.lineWidth = 1.8;
  wellPath(g, 4); g.stroke();
  g.strokeStyle = 'rgba(90,216,255,0.22)'; g.lineWidth = 2;
  wellPath(g, 20); g.stroke();
  g.restore();
  for (const [x, y] of [[WL - 4, WT - 4], [WR + 4, WT - 4]]) {
    rg = g.createRadialGradient(x, y, 0, x, y, 40);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.2, 'rgba(150,230,255,0.6)'); rg.addColorStop(1, 'rgba(90,216,255,0)');
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = rg; g.fillRect(x - 40, y - 40, 80, 80);
  }
  bgCanvas = c;
  return c;
}

// ------------------------------------------------------------------ capsules
const CAPS = {
  multi: { label: 'M', name: 'Multi-ball', color: '#2fe0ff', weight: 22 },
  wide: { label: 'W', name: 'Wide paddle', color: '#3df28b', weight: 18 },
  laser: { label: 'L', name: 'Laser', color: '#ff3d5e', weight: 15 },
  slow: { label: 'S', name: 'Slow ball', color: '#ffd43b', weight: 14 },
  life: { label: '+', name: 'Extra ball', color: '#ff52d4', weight: 3 },
  shrink: { label: '−', name: 'Shrink', color: '#8d7bb0', weight: 13 },
};
const CAP_TOTAL = Object.values(CAPS).reduce((s, c) => s + c.weight, 0);
const TIMED = { wide: 18, shrink: 12, laser: 10, slow: 10 };

function drawCapsule(ctx, x, y, type, clock, scale = 1) {
  const def = CAPS[type];
  const w = 64 * scale, h = 26 * scale;
  const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
  g.addColorStop(0, tint(def.color, 0.65)); g.addColorStop(0.45, def.color); g.addColorStop(1, shade(def.color, 0.55));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.fill();
  // rolling band
  const band = ((clock * 1.6) % 1) * w - w / 2;
  ctx.save();
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.clip();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(x + band - 5 * scale, y - h / 2, 10 * scale, h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x - w / 2 + 8 * scale, y - h / 2 + 3 * scale, w - 16 * scale, 4 * scale);
  ctx.restore();
  if (type === 'shrink') {
    ctx.strokeStyle = `rgba(255,70,90,${0.6 + 0.4 * Math.sin(clock * 12)})`;
    ctx.lineWidth = 2.5 * scale;
  } else {
    ctx.strokeStyle = tint(def.color, 0.7, 0.95);
    ctx.lineWidth = 1.5 * scale;
  }
  ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `800 ${Math.round(18 * scale)}px "Segoe UI", sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(def.label, x, y + 1 * scale);
}

// ------------------------------------------------------------------ box art
function fitFont(ctx, text, size, weight, spacing, maxW) {
  ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${spacing}px`;
  const wd = ctx.measureText(text).width;
  if (wd > maxW) { size *= maxW / wd; spacing *= maxW / wd; ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`; ctx.letterSpacing = `${spacing}px`; }
  return size;
}

function paintArt(ctx, w, h, portrait) {
  const s = portrait ? w / 600 : h / 720;
  const R = rng32(portrait ? 4242 : 9090);
  const ix = portrait ? w * 0.56 : w * 0.665;
  const iy = portrait ? h * 0.5 : h * 0.43;
  const L = Math.hypot(w, h);
  ctx.save();
  ctx.lineJoin = 'round';

  // backdrop
  ctx.fillStyle = '#02030a'; ctx.fillRect(0, 0, w, h);
  let g = ctx.createRadialGradient(ix, iy, 0, ix, iy, L * 0.75);
  g.addColorStop(0, '#24358a'); g.addColorStop(0.28, '#0e1440'); g.addColorStop(0.65, '#05071a'); g.addColorStop(1, '#020309');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // spectral rays fanning out of the impact
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 30; i++) {
    const a = R() * Math.PI * 2, wd = 0.012 + R() * 0.045;
    const col = COLORS[ORDER[i % 8]];
    const rg = ctx.createRadialGradient(ix, iy, 0, ix, iy, L * (0.45 + R() * 0.5));
    rg.addColorStop(0, rgba(col, 0.34)); rg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rg;
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.arc(ix, iy, L, a - wd, a + wd); ctx.closePath(); ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  // a wall of glass tilted away from the viewer, projected in perspective
  const f = (portrait ? 700 : 820) * s;
  const T = 0.9, cT = Math.cos(T), sT = Math.sin(T);
  const cw = 96, ch = 46, bw = 88, bh = 38, vI = 5.4 * ch, Z0 = 1000;
  const proj = (u, v, push = 0, du = 0, dv = 0) => {
    const X = u + du, Y = (vI - v) * cT + dv, Z = Z0 + (v - vI) * sT - push;
    return [ix + (f * X) / Z, iy + (f * Y) / Z];
  };
  const rowCols = ['c', 'b', 'p', 'm', 'r', 'o', 'y', 'g', 'c', 'b', 'p', 'm', 'r'];
  const holeR = 150;
  const quads = [];
  for (let row = 12; row >= -1; row--) {
    for (let col = -8; col <= 8; col++) {
      const u0 = col * cw - bw / 2, v0 = row * ch + (ch - bh) / 2;
      const cu = col * cw, cv = v0 + bh / 2;
      const d = Math.hypot(cu, (cv - vI) * 1.3);
      if (d < holeR + R() * 40) continue;
      const near = Math.max(0, 1 - (d - holeR) / 190);
      const push = near * near * 170;
      const dx = cu / d, dy = ((vI - cv) * cT) / d;
      const du = dx * push * 0.35, dv = dy * push * 0.35;
      const c00 = proj(u0, v0 + bh, push, du, dv), c10 = proj(u0 + bw, v0 + bh, push, du, dv);
      const c01 = proj(u0, v0, push, du, dv), c11 = proj(u0 + bw, v0, push, du, dv);
      if (Math.max(c00[0], c10[0], c01[0], c11[0]) < -20 || Math.min(c00[0], c10[0], c01[0], c11[0]) > w + 20) continue;
      const P = (a, b) => [lerp(lerp(c00[0], c10[0], a), lerp(c01[0], c11[0], a), b), lerp(lerp(c00[1], c10[1], a), lerp(c01[1], c11[1], a), b)];
      let kind = 'glass', ckey = rowCols[(row + 13) % 13], maxHp = 1;
      const q = R();
      if (q < 0.035) { kind = 'bomb'; ckey = 'bomb'; } else if (q < 0.06) { kind = 'steel'; ckey = 'steel'; } else if (q < 0.12) { ckey = 'w'; maxHp = 3; } else if (q < 0.35) maxHp = 2;
      const stage = kind === 'glass' ? (near > 0.55 ? 2 : near > 0.2 ? 1 : 0) : 0;
      maxHp = Math.max(maxHp, stage + 1);
      quads.push({ P, kind: ckey === 'w' ? 'crystal' : kind, color: colorOf(ckey), hp: maxHp - stage, maxHp, seed: (col + 20) * 31 + row, c: P(0.5, 0.5), wd: Math.hypot(c10[0] - c00[0], c10[1] - c00[1]) });
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const qd of quads) {
    const rr = qd.wd * 0.8;
    const rg = ctx.createRadialGradient(qd.c[0], qd.c[1], 0, qd.c[0], qd.c[1], rr);
    rg.addColorStop(0, rgba(qd.color, qd.kind === 'steel' ? 0.08 : 0.3)); rg.addColorStop(1, rgba(qd.color, 0));
    ctx.fillStyle = rg; ctx.fillRect(qd.c[0] - rr, qd.c[1] - rr, rr * 2, rr * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const qd of quads) paintBrick(ctx, qd.P, qd.kind, qd.color, qd.hp, qd.maxHp, qd.seed);

  // neon rails of the well, converging into the distance
  ctx.save();
  ctx.shadowColor = ACCENT; ctx.shadowBlur = 18 * s; ctx.strokeStyle = 'rgba(120,225,255,0.9)'; ctx.lineWidth = 3 * s;
  const ue = 8.5 * cw, vt = 13.3 * ch;
  ctx.beginPath();
  let p = proj(-ue, -14 * ch); ctx.moveTo(p[0], p[1]);
  p = proj(-ue, vt); ctx.lineTo(p[0], p[1]);
  p = proj(ue, vt); ctx.lineTo(p[0], p[1]);
  p = proj(ue, -14 * ch); ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.restore();

  // light bursting through the hole
  ctx.globalCompositeOperation = 'lighter';
  g = ctx.createRadialGradient(ix, iy, 0, ix, iy, 330 * s);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.1, 'rgba(225,250,255,0.95)'); g.addColorStop(0.3, 'rgba(90,216,255,0.45)');
  g.addColorStop(0.6, 'rgba(120,90,255,0.15)'); g.addColorStop(1, 'rgba(90,216,255,0)');
  ctx.fillStyle = g; ctx.fillRect(ix - 330 * s, iy - 330 * s, 660 * s, 660 * s);

  // flying shards (small, far) and fragments (large, near)
  for (let i = 0; i < 190; i++) {
    const a = R() * Math.PI * 2, dist = Math.pow(R(), 0.7) * 520 * s;
    const x = ix + Math.cos(a) * dist, y = iy + Math.sin(a) * dist * 0.85;
    const z = (2 + (dist / s) * 0.022 + R() * 5) * s;
    const col = R() < 0.25 ? '#ffffff' : COLORS[ORDER[Math.floor(R() * 8)]];
    ctx.fillStyle = rgba(col, 0.5 + R() * 0.5);
    const rot = R() * 6.28;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(rot) * z, y + Math.sin(rot) * z);
    ctx.lineTo(x + Math.cos(rot + 2.2) * z * 0.6, y + Math.sin(rot + 2.2) * z * 0.6);
    ctx.lineTo(x + Math.cos(rot + 4.1) * z * 0.8, y + Math.sin(rot + 4.1) * z * 0.8);
    ctx.fill();
  }
  // keep the big pieces off the title
  const box = portrait ? [0, w, 0, 292 * s] : [0, 76 * s + w * 0.44, h * 0.5 - 170 * s, h * 0.5 + 170 * s];
  const frags = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + R() * 0.35, dist = (95 + R() * 330) * s;
    const fr = { a, dist, x: ix + Math.cos(a) * dist, y: iy + Math.sin(a) * dist * 0.85, size: (14 + dist / s * 0.09 + R() * 14) * s, rot: R() * 6.28, col: COLORS[ORDER[i % 8]], whole: i % 3 === 0 };
    const m = fr.size * (fr.whole ? 1.3 : 1);
    if (fr.x + m > box[0] && fr.x - m < box[1] && fr.y + m > box[2] && fr.y - m < box[3]) continue;
    frags.push(fr);
  }
  frags.sort((a, b) => a.size - b.size);
  for (const fr of frags) {
    // motion streaks back towards the impact
    const ex = fr.x - Math.cos(fr.a) * fr.size * 4.5, ey = fr.y - Math.sin(fr.a) * fr.size * 4.5 * 0.85;
    const sg = ctx.createLinearGradient(fr.x, fr.y, ex, ey);
    sg.addColorStop(0, rgba(fr.col, 0.55)); sg.addColorStop(1, rgba(fr.col, 0));
    ctx.strokeStyle = sg; ctx.lineWidth = fr.size * 0.35; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(fr.x, fr.y); ctx.lineTo(ex, ey); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const fr of frags) {
    const cs = Math.cos(fr.rot), sn = Math.sin(fr.rot);
    if (fr.whole) {
      const fw = fr.size * 2.4, fh = fr.size * 0.95;
      const P = (u, v) => { const lx = (u - 0.5) * fw, ly = (v - 0.5) * fh; return [fr.x + lx * cs - ly * sn, fr.y + lx * sn + ly * cs]; };
      paintBrick(ctx, P, 'glass', fr.col, 2, 3, Math.floor(fr.size));
    } else {
      // a faceted glass shard: each facet catches the light differently
      const z = fr.size;
      const pts = [[1.1, 0], [-0.35, 0.6], [-0.85, -0.2], [0.05, -0.65]].slice(0, 3 + (fr.size > 30 * s ? 1 : 0));
      const v = pts.map(([px, py]) => [fr.x + (px * cs - py * sn) * z, fr.y + (px * sn + py * cs) * z]);
      const cx = v.reduce((t, p) => t + p[0], 0) / v.length, cy = v.reduce((t, p) => t + p[1], 0) / v.length;
      const tones = [tint(fr.col, 0.55, 0.92), rgba(fr.col, 0.82), shade(fr.col, 0.35, 0.85), tint(fr.col, 0.2, 0.85)];
      v.forEach((p, j) => {
        const q = v[(j + 1) % v.length];
        ctx.fillStyle = tones[j % tones.length];
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.lineTo(cx, cy); ctx.closePath(); ctx.fill();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 0.8 * s;
      ctx.beginPath(); v.forEach((p) => { ctx.moveTo(cx, cy); ctx.lineTo(p[0], p[1]); }); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.3 * s;
      ctx.beginPath(); v.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      const gl = ctx.createRadialGradient(v[0][0], v[0][1], 0, v[0][0], v[0][1], z * 0.5);
      gl.addColorStop(0, 'rgba(255,255,255,0.9)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gl; ctx.fillRect(v[0][0] - z * 0.5, v[0][1] - z * 0.5, z, z);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  // the paddle and the ball's light trail
  const pX = portrait ? w * 0.38 : w * 0.56, pY = portrait ? h * 0.86 : h * 0.87;
  const pw = 230 * s, ph = 24 * s;
  const cX = portrait ? w * 0.12 : w * 0.38, cY = portrait ? h * 0.66 : h * 0.68;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i <= 80; i++) {
    const t = i / 80, mt = 1 - t;
    const x = mt * mt * pX + 2 * mt * t * cX + t * t * ix, y = mt * mt * (pY - ph) + 2 * mt * t * cY + t * t * iy;
    const rr = (8 + 18 * t) * s;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, `rgba(220,250,255,${0.08 + 0.3 * t})`); rg.addColorStop(0.4, `rgba(90,216,255,${0.05 + 0.18 * t})`); rg.addColorStop(1, 'rgba(90,216,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  ctx.strokeStyle = 'rgba(235,252,255,0.75)'; ctx.lineWidth = 2.5 * s;
  ctx.beginPath(); ctx.moveTo(pX, pY - ph); ctx.quadraticCurveTo(cX, cY, ix, iy); ctx.stroke();
  g = ctx.createRadialGradient(pX, pY, 0, pX, pY, pw);
  g.addColorStop(0, 'rgba(90,216,255,0.5)'); g.addColorStop(1, 'rgba(90,216,255,0)');
  ctx.save(); ctx.translate(pX, pY); ctx.scale(1, 0.32); ctx.translate(-pX, -pY);
  ctx.fillStyle = g; ctx.fillRect(pX - pw, pY - pw, pw * 2, pw * 2);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  g = ctx.createLinearGradient(0, pY - ph / 2, 0, pY + ph / 2);
  g.addColorStop(0, '#f2fdff'); g.addColorStop(0.45, ACCENT); g.addColorStop(1, '#14527c');
  ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(pX - pw / 2, pY - ph / 2, pw, ph, ph / 2); ctx.fill();
  g = ctx.createLinearGradient(0, pY - ph / 2, 0, pY + ph / 2);
  g.addColorStop(0, '#ffc2f1'); g.addColorStop(0.5, '#ff52d4'); g.addColorStop(1, '#6a1660');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.roundRect(pX - pw / 2, pY - ph / 2, 30 * s, ph, [ph / 2, 0, 0, ph / 2]); ctx.fill();
  ctx.beginPath(); ctx.roundRect(pX + pw / 2 - 30 * s, pY - ph / 2, 30 * s, ph, [0, ph / 2, ph / 2, 0]); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(pX - pw / 2 + 16 * s, pY - ph / 2 + 3 * s, pw - 32 * s, 3 * s);
  ctx.strokeStyle = 'rgba(230,250,255,0.9)'; ctx.lineWidth = 1.2 * s;
  ctx.beginPath(); ctx.roundRect(pX - pw / 2, pY - ph / 2, pw, ph, ph / 2); ctx.stroke();

  // the ball of light
  ctx.globalCompositeOperation = 'lighter';
  ctx.save(); ctx.translate(ix, iy); ctx.scale(1, 0.05);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 520 * s);
  g.addColorStop(0, 'rgba(255,255,255,0.8)'); g.addColorStop(0.3, 'rgba(120,225,255,0.35)'); g.addColorStop(1, 'rgba(90,216,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-520 * s, -520 * s, 1040 * s, 1040 * s);
  ctx.restore();
  ctx.save(); ctx.translate(ix, iy); ctx.rotate(0.6); ctx.scale(0.04, 1);
  g = ctx.createRadialGradient(0, 0, 0, 0, 0, 220 * s);
  g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(-220 * s, -220 * s, 440 * s, 440 * s);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  g = ctx.createRadialGradient(ix - 5 * s, iy - 5 * s, 0, ix, iy, 22 * s);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.6, '#e8fdff'); g.addColorStop(1, '#8be9ff');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(ix, iy, 21 * s, 0, Math.PI * 2); ctx.fill();

  // vignette
  g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, L * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // title
  let tx, y1, y2, size1, size2, maxW, align;
  if (portrait) {
    g = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    g.addColorStop(0, 'rgba(2,3,10,0.92)'); g.addColorStop(0.6, 'rgba(2,3,10,0.55)'); g.addColorStop(1, 'rgba(2,3,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.4);
    g = ctx.createLinearGradient(0, h * 0.84, 0, h);
    g.addColorStop(0, 'rgba(2,3,10,0)'); g.addColorStop(1, 'rgba(2,3,10,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.84, w, h * 0.16);
    tx = w / 2; align = 'center'; size1 = 156 * s; y1 = 176 * s; size2 = 70 * s; y2 = 258 * s; maxW = w * 0.9;
  } else {
    g = ctx.createLinearGradient(0, 0, w * 0.64, 0);
    g.addColorStop(0, 'rgba(2,3,10,0.94)'); g.addColorStop(0.5, 'rgba(2,3,10,0.72)'); g.addColorStop(1, 'rgba(2,3,10,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w * 0.64, h);
    tx = 76 * s; align = 'left'; size1 = 176 * s; y1 = h * 0.5 + 6 * s; size2 = 76 * s; y2 = y1 + 92 * s; maxW = w * 0.46;
  }
  const lines = [
    { text: 'PRISM', size: size1, weight: 900, spacing: size1 * 0.04, y: y1 },
    { text: 'BREAKER', size: size2, weight: 700, spacing: size2 * 0.3, y: y2 },
  ];
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const o = off.getContext('2d');
  o.textAlign = align; o.textBaseline = 'alphabetic';
  for (const ln of lines) {
    ln.size = fitFont(o, ln.text, ln.size, ln.weight, ln.spacing, maxW);
    ln.font = o.font; ln.ls = o.letterSpacing;
    const fg = o.createLinearGradient(0, ln.y - ln.size * 0.74, 0, ln.y);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.5, '#dff8ff'); fg.addColorStop(0.52, '#8fe8ff'); fg.addColorStop(1, '#3aa6f0');
    o.fillStyle = fg;
    o.fillText(ln.text, tx, ln.y);
  }
  // a band of refracted colour running through the letters
  o.globalCompositeOperation = 'source-atop';
  const bx0 = portrait ? w * 0.15 : tx, bx1 = portrait ? w * 0.85 : tx + maxW;
  const sg = o.createLinearGradient(bx0, y1 - size1, bx1, y2);
  const spec = ['#ff3d5e', '#ff8a2b', '#ffd43b', '#3df28b', '#2fe0ff', '#4c7dff', '#a35dff'];
  sg.addColorStop(0, 'rgba(0,0,0,0)'); sg.addColorStop(0.3, 'rgba(0,0,0,0)');
  spec.forEach((c, i) => sg.addColorStop(0.36 + i * 0.035, rgba(c, 0.55)));
  sg.addColorStop(0.62, 'rgba(0,0,0,0)'); sg.addColorStop(1, 'rgba(0,0,0,0)');
  o.fillStyle = sg; o.fillRect(0, 0, w, h);
  o.globalCompositeOperation = 'source-over';
  // chromatic fringe + glow behind the letters
  ctx.save();
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'lighter';
  for (const ln of lines) {
    ctx.font = ln.font; ctx.letterSpacing = ln.ls;
    const dx = ln.size * 0.028;
    ctx.fillStyle = 'rgba(255,40,120,0.6)'; ctx.fillText(ln.text, tx - dx, ln.y + dx * 0.3);
    ctx.fillStyle = 'rgba(40,170,255,0.6)'; ctx.fillText(ln.text, tx + dx, ln.y - dx * 0.3);
  }
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(90,216,255,0.85)'; ctx.shadowBlur = 30 * s;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  ctx.drawImage(off, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gx = portrait ? w * 0.27 : tx + size1 * 0.6, gy = y1 - size1 * 0.66;
  for (const [sx, sy] of [[1, 0.06], [0.06, 1]]) {
    ctx.save(); ctx.translate(gx, gy); ctx.scale(sx, sy);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60 * s);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-60 * s, -60 * s, 120 * s, 120 * s);
    ctx.restore();
  }
  ctx.restore();

  // tagline
  ctx.save();
  ctx.textBaseline = 'middle';
  const tagSize = 22 * s;
  ctx.font = `600 ${tagSize}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${tagSize * 0.42}px`;
  const tag = 'BRICK BREAKER';
  const tw = ctx.measureText(tag).width;
  const ty = portrait ? h - 46 * s : y2 + 56 * s;
  const tl = portrait ? w / 2 - tw / 2 : tx;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(225,245,255,0.92)';
  ctx.fillText(tag, tl, ty);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2 * s;
  ctx.beginPath();
  if (portrait) {
    ctx.moveTo(tl - 70 * s, ty); ctx.lineTo(tl - 22 * s, ty);
    ctx.moveTo(tl + tw + 12 * s, ty); ctx.lineTo(tl + tw + 60 * s, ty);
  } else {
    ctx.moveTo(tl + tw + 18 * s, ty); ctx.lineTo(tl + tw + 120 * s, ty);
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

// ------------------------------------------------------------------ the game
export default {
  key: 'prism',
  title: 'Prism Breaker',
  tagline: 'Brick breaker',
  accent: ACCENT,
  controls: [
    ['Left stick / D-pad', 'Move the paddle'],
    ['A', 'Launch the ball / fire lasers'],
    ['Capsules', 'Catch them for power-ups'],
    ['Start', 'Pause'],
  ],
  art: {
    cover(ctx, w, h) { paintArt(ctx, w, h, true); },
    hero(ctx, w, h) { paintArt(ctx, w, h, false); },
  },
  create(api) {
    const rnd = (a, b) => a + Math.random() * (b - a);
    const glow = (c, r) => api.glow(c, r);
    const S = {
      level: 1, levelName: '', score: 0, lives: 3,
      grid: new Array(COLS * MAXROWS).fill(null), breakable: 0,
      balls: [], caps: [], bolts: [], parts: [], pops: [], blasts: [], sparks: [],
      paddle: { x: (WL + WR) / 2, v: 0, w: PADDLE_W, flash: 0 },
      timers: { wide: 0, shrink: 0, laser: 0, slow: 0 },
      slowMix: 0, boost: 0, combo: 0, laserCd: 0,
      phase: 'play', phaseT: 0, introT: 0, clock: 0, lost: false,
      banner: null, shake: 0, flash: 0, flashColor: '255,255,255',
      sfxBudget: 0, over: false,
      stats: { levelsCleared: 0, perfectLevels: 0, maxBalls: 1 },
    };
    let ballSeq = 0;

    // ---------------------------------------------------------- sound
    const snd = (voices) => { if (S.sfxBudget > 0) { S.sfxBudget--; api.sfx(voices); } };
    const panOf = (x) => clamp((x - W / 2) / 700, -0.8, 0.8);
    const noteFor = (ckey, combo) => NOTES[NOTE_INDEX[ckey] || 0] * Math.pow(2, Math.min(combo, 12) / 12);
    const sfx = {
      paddle: (t) => snd([{ tone: 300 + Math.abs(t) * 90, to: 200, type: 'triangle', peak: 0.17, attack: 0.003, decay: 0.09 }, { tone: 1400, peak: 0.03, attack: 0.002, decay: 0.05 }]),
      wall: (x) => snd([{ tone: 1750, peak: 0.03, attack: 0.002, decay: 0.04, pan: panOf(x) }]),
      steel: (x) => snd([{ tone: 1245, peak: 0.05, attack: 0.002, decay: 0.16, pan: panOf(x) }, { tone: 1873, peak: 0.05, attack: 0.002, decay: 0.2, pan: panOf(x) }, { tone: 2950, peak: 0.025, attack: 0.002, decay: 0.09, pan: panOf(x) }]),
      hit: (ckey, x) => { const f = noteFor(ckey, S.combo); snd([{ tone: f, type: 'triangle', peak: 0.12, attack: 0.002, decay: 0.12, pan: panOf(x) }, { tone: f * 2, peak: 0.04, attack: 0.002, decay: 0.07, pan: panOf(x) }]); },
      shatter: (ckey, x) => {
        const f = noteFor(ckey, S.combo), p = panOf(x);
        snd([
          { tone: f, peak: 0.12, attack: 0.002, decay: 0.5, pan: p }, { tone: f * 2.01, peak: 0.05, attack: 0.002, decay: 0.32, pan: p }, { tone: f * 3.2, peak: 0.025, attack: 0.002, decay: 0.2, pan: p },
          { noise: true, from: 3200, peakAt: 9000, to: 5200, dur: 0.17, q: 1.3, peak: 0.13, panFrom: p, panTo: p },
        ]);
      },
      boom: (x) => snd([{ noise: true, from: 1100, peakAt: 380, to: 60, dur: 0.6, q: 0.6, peak: 0.5, type: 'lowpass', panFrom: panOf(x), panTo: panOf(x) }, { tone: 120, to: 38, peak: 0.32, attack: 0.004, decay: 0.45 }, { noise: true, from: 4000, peakAt: 8000, to: 3000, dur: 0.3, q: 1, peak: 0.1 }]),
      catchIt: () => snd([{ tone: 660, to: 990, peak: 0.12, attack: 0.004, decay: 0.12 }, { tone: 990, at: 0.07, peak: 0.1, decay: 0.2 }, { tone: 1320, at: 0.14, peak: 0.1, decay: 0.35 }, { tone: 2640, at: 0.14, peak: 0.03, decay: 0.3 }]),
      bad: () => snd([{ tone: 420, to: 150, type: 'sawtooth', peak: 0.07, attack: 0.005, decay: 0.32 }, { tone: 300, to: 110, type: 'square', at: 0.05, peak: 0.03, decay: 0.3 }]),
      life: () => snd([523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ tone: f, at: i * 0.06, peak: 0.1, decay: 0.4 }))),
      laser: () => snd([{ tone: 1700, to: 420, type: 'square', peak: 0.03, attack: 0.002, decay: 0.08 }, { tone: 3400, to: 900, peak: 0.02, attack: 0.002, decay: 0.05 }]),
      launch: () => snd([{ tone: 520, to: 940, type: 'triangle', peak: 0.12, attack: 0.004, decay: 0.12 }, { noise: true, from: 2000, peakAt: 6000, to: 3000, dur: 0.12, q: 1, peak: 0.05 }]),
      lost: () => snd([{ tone: 520, to: 80, type: 'sawtooth', peak: 0.09, attack: 0.01, decay: 0.75 }, { tone: 260, to: 60, peak: 0.15, attack: 0.01, decay: 0.7 }, { noise: true, from: 700, peakAt: 300, to: 70, dur: 0.6, q: 0.7, peak: 0.25, type: 'lowpass' }]),
      clear: () => snd([
        ...[523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98].map((f, i) => ({ tone: f, at: i * 0.07, peak: 0.09, decay: 1.2, pan: (i - 2.5) * 0.2 })),
        ...[1046.5, 1567.98].map((f, i) => ({ tone: f * 2.01, at: 0.3 + i * 0.1, peak: 0.03, decay: 0.9 })),
        { noise: true, at: 0.1, from: 5000, peakAt: 10000, to: 7000, dur: 1.0, q: 3, peak: 0.05 },
      ]),
    };

    // ---------------------------------------------------------- particles & popups
    function part(p) { if (S.parts.length < 900) S.parts.push(p); }
    function shatter(br, vx = 0, vy = 0) {
      const cx = br.x + BW / 2, cy = br.y + BH / 2, col = colorOf(br.c);
      const n = br.k === 'bomb' ? 10 : 13;
      for (let i = 0; i < n; i++) {
        part({ t: 0, x: cx + rnd(-BW / 2, BW / 2), y: cy + rnd(-BH / 2, BH / 2), vx: rnd(-280, 280) + vx * 0.18, vy: rnd(-420, 80) + vy * 0.12, rot: rnd(0, 6.28), vr: rnd(-14, 14), s: rnd(4, 12), c: i % 4 === 0 ? '#ffffff' : col, age: 0, life: rnd(0.55, 1.1), g: 1500 });
      }
      for (let i = 0; i < 5; i++) part({ t: 1, x: cx + rnd(-30, 30), y: cy + rnd(-10, 10), vx: rnd(-200, 200), vy: rnd(-200, 120), s: rnd(10, 22), c: col, age: 0, life: rnd(0.25, 0.5), g: 0 });
      part({ t: 2, x: cx, y: cy, s: 70, c: col, age: 0, life: 0.22, vx: 0, vy: 0, g: 0 });
    }
    function sparkBurst(x, y, col, n = 6, sp = 260) {
      for (let i = 0; i < n; i++) part({ t: 1, x, y, vx: rnd(-sp, sp), vy: rnd(-sp, sp * 0.4), s: rnd(6, 14), c: col, age: 0, life: rnd(0.15, 0.35), g: 600 });
    }
    function popup(x, y, text, color, size = 26) {
      if (S.pops.length > 40) S.pops.shift();
      const half = text.length * size * 0.3 + 10;
      S.pops.push({ x: clamp(x, WL + half, WR - half), y: Math.max(WT + size, y), text, color, size, age: 0, life: 1.0 });
    }

    // ---------------------------------------------------------- level flow
    function speedBase() { return 640 + Math.min(12, S.level - 1) * 18; }
    function speedNow() { return (speedBase() + S.boost) * (1 - 0.36 * S.slowMix); }
    function makeBall(x, y, vx, vy, stuck) { return { id: ++ballSeq, x, y, vx, vy, stuck, off: 0, trail: [], stale: 0, dead: false }; }
    function serve() { S.balls = [makeBall(S.paddle.x, PY - BALL_R, 0, -1, true)]; }
    function clearTimers() { for (const k of Object.keys(S.timers)) S.timers[k] = 0; }

    function loadLevel(n) {
      const lv = n <= LEVELS.length ? parseLevel(LEVELS[n - 1]) : genLevel(n);
      S.grid.fill(null);
      S.breakable = 0;
      for (let r = 0; r < lv.rows; r++) for (let c = 0; c < COLS; c++) {
        const cell = lv.spec[r * COLS + c];
        if (!cell) continue;
        S.grid[r * COLS + c] = {
          k: cell.k, c: cell.c, hp: cell.hp, max: cell.hp, col: c, row: r,
          x: GX + c * CW + (CW - BW) / 2, y: GY + r * CH + (CH - BH) / 2,
          flash: 0, delay: r * 0.045 + Math.abs(c - 6) * 0.025, variant: (c * 7 + r * 3 + n) % 3,
        };
        if (cell.k !== 'steel') S.breakable++;
      }
      S.levelName = lv.name;
      S.boost = 0; S.lost = false; S.combo = 0; S.introT = 0;
      S.caps.length = 0; S.bolts.length = 0; S.blasts.length = 0;
      clearTimers();
      serve();
      S.banner = { title: `LEVEL ${n}`, sub: lv.name.toUpperCase(), t: 0, dur: 2.1 };
    }

    function levelClear() {
      S.phase = 'clear'; S.phaseT = 0;
      S.stats.levelsCleared++;
      const perfect = !S.lost;
      const bonus = 500 + 100 * S.level;
      const pBonus = perfect ? 2000 + 250 * S.level : 0;
      if (perfect) S.stats.perfectLevels++;
      S.score += bonus + pBonus;
      S.banner = { title: 'LEVEL CLEAR', sub: `CLEAR BONUS  +${bonus.toLocaleString()}`, perfect: perfect ? `PERFECT  +${pBonus.toLocaleString()}` : null, t: 0, dur: 2.7 };
      for (const b of S.balls) { sparkBurst(b.x, b.y, '#bff4ff', 14, 380); part({ t: 2, x: b.x, y: b.y, s: 90, c: ACCENT, age: 0, life: 0.35, vx: 0, vy: 0, g: 0 }); }
      S.balls = [];
      S.caps.length = 0; S.bolts.length = 0;
      clearTimers();
      S.sfxBudget = 99;
      sfx.clear();
    }

    function loseLife() {
      S.lives--;
      S.lost = true; S.combo = 0;
      S.shake = 16; S.flash = 0.45; S.flashColor = '255,40,80';
      S.caps.length = 0; S.bolts.length = 0;
      clearTimers();
      S.sfxBudget = 99;
      sfx.lost();
      if (S.lives <= 0) {
        S.lives = 0;
        S.phase = 'dying'; S.phaseT = 0;
        S.banner = { title: 'GAME OVER', sub: `LEVEL ${S.level}  ·  ${S.score.toLocaleString()} POINTS`, t: 0, dur: 99 };
      } else {
        S.phase = 'respawn'; S.phaseT = 0;
        S.boost *= 0.5;
      }
    }

    // ---------------------------------------------------------- bricks
    const cellAt = (c, r) => (c >= 0 && c < COLS && r >= 0 && r < MAXROWS ? S.grid[r * COLS + c] : null);

    function damage(br, source, ball) {
      if (br.k === 'steel') {
        br.flash = 1;
        sparkBurst(ball ? ball.x : br.x + BW / 2, ball ? ball.y : br.y + BH, '#e6f0ff', 4, 200);
        sfx.steel(br.x);
        return;
      }
      if (source !== 'laser') S.combo++;
      br.hp -= 1;
      br.flash = 1;
      if (br.hp <= 0) { breakBrick(br, source, ball); return; }
      S.score += 10;
      sfx.hit(br.c, br.x);
      const col = colorOf(br.c);
      for (let i = 0; i < 4; i++) part({ t: 0, x: br.x + rnd(0, BW), y: br.y + BH, vx: rnd(-120, 120), vy: rnd(-60, 160), rot: rnd(0, 6), vr: rnd(-10, 10), s: rnd(3, 6), c: col, age: 0, life: rnd(0.4, 0.7), g: 1400 });
    }

    function breakBrick(br, source, ball) {
      S.grid[br.row * COLS + br.col] = null;
      S.breakable--;
      const cx = br.x + BW / 2, cy = br.y + BH / 2;
      const pts = br.k === 'bomb' ? 60 : source === 'blast' ? 40 : 30 + 20 * br.max;
      const bonus = source === 'laser' ? 0 : Math.min(1000, 5 * S.combo * (S.combo - 1));
      S.score += pts + bonus;
      const col = colorOf(br.c);
      popup(cx, cy, `+${pts + bonus}`, bonus ? tint(col, 0.35) : col, 24 + Math.min(S.combo, 20) * 1.1);
      if (source !== 'laser' && S.combo >= 5 && S.combo % 5 === 0) popup(cx, cy - 46, `COMBO ×${S.combo}`, '#ffe27a', 38);
      shatter(br, ball ? ball.vx : 0, ball ? ball.vy : 0);
      sfx.shatter(br.c, cx);
      if (br.k === 'bomb') explode(br);
      const chance = source === 'blast' ? 0.04 : 0.13;
      if (S.caps.length < 3 && Math.random() < chance) dropCapsule(cx, cy);
    }

    function explode(br) {
      const cx = br.x + BW / 2, cy = br.y + BH / 2;
      S.shake = Math.max(S.shake, 12); S.flash = Math.max(S.flash, 0.18); S.flashColor = '255,170,90';
      part({ t: 3, x: cx, y: cy, s: 20, grow: 190, c: '#ffb45a', age: 0, life: 0.45, vx: 0, vy: 0, g: 0 });
      part({ t: 2, x: cx, y: cy, s: 200, c: '#ff8a2b', age: 0, life: 0.35, vx: 0, vy: 0, g: 0 });
      sparkBurst(cx, cy, '#ffd27a', 16, 520);
      sfx.boom(cx);
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (dr || dc) S.blasts.push({ col: br.col + dc, row: br.row + dr, t: 0.08 });
    }

    function dropCapsule(x, y) {
      let r = Math.random() * CAP_TOTAL, type = 'multi';
      for (const [k, d] of Object.entries(CAPS)) { r -= d.weight; if (r <= 0) { type = k; break; } }
      S.caps.push({ type, x: clamp(x, WL + 34, WR - 34), y, vy: 250 });
    }

    function applyCapsule(cap) {
      const def = CAPS[cap.type];
      S.score += 50;
      popup(S.paddle.x, PY - 40, def.name.toUpperCase(), def.color, 30);
      part({ t: 2, x: cap.x, y: PY, s: 120, c: def.color, age: 0, life: 0.3, vx: 0, vy: 0, g: 0 });
      sparkBurst(cap.x, PY, def.color, 10, 300);
      if (cap.type === 'shrink') { S.timers.shrink = TIMED.shrink; S.timers.wide = 0; S.score += 250; popup(S.paddle.x, PY - 80, '+300 RISK', '#ff7a8a', 24); sfx.bad(); return; }
      sfx.catchIt();
      if (cap.type === 'wide') { S.timers.wide = TIMED.wide; S.timers.shrink = 0; }
      else if (cap.type === 'laser') S.timers.laser = TIMED.laser;
      else if (cap.type === 'slow') S.timers.slow = TIMED.slow;
      else if (cap.type === 'life') { S.lives = Math.min(9, S.lives + 1); sfx.life(); }
      else if (cap.type === 'multi') multiBall();
    }

    function multiBall() {
      if (S.balls.some((b) => b.stuck)) launch();
      const src = S.balls.find((b) => !b.dead);
      if (!src) return;
      const sp = Math.hypot(src.vx, src.vy) || speedNow();
      const a = Math.atan2(src.vy, src.vx);
      for (const d of [-0.5, 0.5]) {
        if (S.balls.length >= MAX_BALLS) break;
        const b = makeBall(src.x, src.y, Math.cos(a + d) * sp, Math.sin(a + d) * sp, false);
        fixAngle(b);
        S.balls.push(b);
      }
      S.stats.maxBalls = Math.max(S.stats.maxBalls, S.balls.length);
    }

    // ---------------------------------------------------------- balls
    function fixAngle(b) {
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const min = sp * 0.3;
      if (Math.abs(b.vy) < min) {
        const sy = b.vy > 0 ? 1 : -1;
        b.vy = sy * min;
        b.vx = (b.vx < 0 ? -1 : 1) * Math.sqrt(sp * sp - min * min);
      }
    }

    function launch() {
      const P = S.paddle;
      const sp = speedNow();
      for (const b of S.balls) {
        if (!b.stuck) continue;
        b.stuck = false;
        let ang = (b.off / (P.w / 2)) * 0.9 + clamp(P.v / PADDLE_MAX, -1, 1) * 0.35;
        if (Math.abs(ang) < 0.12) ang = (Math.random() < 0.5 ? -1 : 1) * rnd(0.18, 0.32);
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp;
      }
      sfx.launch();
    }

    function collideBricks(b, px, py) {
      const r = BALL_R;
      const c0 = Math.floor((b.x - r - GX) / CW), c1 = Math.floor((b.x + r - GX) / CW);
      const r0 = Math.floor((b.y - r - GY) / CH), r1 = Math.floor((b.y + r - GY) / CH);
      let hits = null;
      for (let row = Math.max(0, r0); row <= Math.min(MAXROWS - 1, r1); row++) {
        for (let col = Math.max(0, c0); col <= Math.min(COLS - 1, c1); col++) {
          const br = S.grid[row * COLS + col];
          if (!br) continue;
          const cx = clamp(b.x, br.x, br.x + BW), cy = clamp(b.y, br.y, br.y + BH);
          const dx = b.x - cx, dy = b.y - cy;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          (hits || (hits = [])).push({ br, dx, dy, d2 });
        }
      }
      if (!hits) return;
      let flipX = 0, flipY = 0, corner = null;
      for (const h of hits) {
        const { br } = h;
        let { dx, dy } = h;
        if (dx === 0 && dy === 0) {
          // centre inside the brick (rare with sub-steps): judge from where the ball came from
          const qx = clamp(px, br.x, br.x + BW), qy = clamp(py, br.y, br.y + BH);
          dx = px - qx; dy = py - qy;
          if (dx === 0 && dy === 0) dy = b.vy > 0 ? -1 : 1;
        }
        if (dx === 0) flipY = flipY || Math.sign(dy);
        else if (dy === 0) flipX = flipX || Math.sign(dx);
        else {
          // a corner: if the neighbour beside it is solid this is really a flat face
          const hn = cellAt(br.col + Math.sign(dx), br.row), vn = cellAt(br.col, br.row + Math.sign(dy));
          if (hn && !vn) flipY = flipY || Math.sign(dy);
          else if (vn && !hn) flipX = flipX || Math.sign(dx);
          else if (hn && vn) { flipX = flipX || Math.sign(dx); flipY = flipY || Math.sign(dy); }
          else if (!corner || h.d2 < corner.d2) corner = { dx, dy, d2: h.d2 };
        }
      }
      if (flipX) b.vx = flipX * Math.abs(b.vx);
      if (flipY) b.vy = flipY * Math.abs(b.vy);
      if (!flipX && !flipY && corner) {
        const d = Math.sqrt(corner.dx * corner.dx + corner.dy * corner.dy) || 1;
        const nx = corner.dx / d, ny = corner.dy / d;
        const dot = b.vx * nx + b.vy * ny;
        if (dot < 0) { b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny; }
      }
      b.x = px; b.y = py;
      fixAngle(b);
      for (const h of hits) {
        if (h.br.k !== 'steel') b.stale = 0;
        if (S.grid[h.br.row * COLS + h.br.col] === h.br) damage(h.br, 'ball', b);
      }
    }

    function stepBall(b, dt) {
      const px = b.x, py = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.x < WL + BALL_R) { b.x = WL + BALL_R; b.vx = Math.abs(b.vx); fixAngle(b); wallHit(WL, b.y); }
      else if (b.x > WR - BALL_R) { b.x = WR - BALL_R; b.vx = -Math.abs(b.vx); fixAngle(b); wallHit(WR, b.y); }
      if (b.y < WT + BALL_R) { b.y = WT + BALL_R; b.vy = Math.abs(b.vy); wallHit(b.x, WT); }
      const P = S.paddle;
      if (b.vy > 0 && b.y + BALL_R >= PY && py + BALL_R <= PY + 8 && b.y - BALL_R < PY + PH && Math.abs(b.x - P.x) <= P.w / 2 + BALL_R * 0.7) {
        const t = clamp((b.x - P.x) / (P.w / 2), -1, 1);
        const ang = clamp(t * 1.05 + clamp(P.v / PADDLE_MAX, -1, 1) * 0.12, -1.1, 1.1);
        const sp = Math.hypot(b.vx, b.vy);
        b.vx = Math.sin(ang) * sp; b.vy = -Math.cos(ang) * sp;
        b.y = PY - BALL_R;
        P.flash = 1; S.combo = 0;
        sparkBurst(b.x, PY, '#bff4ff', 5, 200);
        sfx.paddle(t);
        return;
      }
      if (b.y - BALL_R < GY + MAXROWS * CH && b.y + BALL_R > GY) collideBricks(b, px, py);
      if (b.y > H + 40) b.dead = true;
    }

    function wallHit(x, y) {
      if (S.sparks.length < 24) S.sparks.push({ x, y, age: 0 });
      sfx.wall(x);
    }

    // ---------------------------------------------------------- update
    function updatePaddle(dt) {
      const P = S.paddle;
      const target = api.input.move.x * PADDLE_MAX;
      const k = Math.abs(target) > Math.abs(P.v) && Math.sign(target) === Math.sign(P.v || target) ? 9 : 20;
      P.v += (target - P.v) * Math.min(1, dt * k);
      if (Math.abs(P.v) < 2 && !target) P.v = 0;
      P.x += P.v * dt;
      const tw = PADDLE_W * (S.timers.wide > 0 ? 1.6 : 1) * (S.timers.shrink > 0 ? 0.62 : 1);
      P.w += (tw - P.w) * Math.min(1, dt * 10);
      const lo = WL + P.w / 2, hi = WR - P.w / 2;
      if (P.x < lo) { P.x = lo; if (P.v < 0) P.v = 0; }
      if (P.x > hi) { P.x = hi; if (P.v > 0) P.v = 0; }
      P.flash = Math.max(0, P.flash - dt * 4);
      for (const b of S.balls) if (b.stuck) { b.x = P.x + b.off; b.y = PY - BALL_R; }
    }

    function updateFx(dt) {
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const p = S.parts[i];
        p.age += dt;
        if (p.age >= p.life) { S.parts[i] = S.parts[S.parts.length - 1]; S.parts.pop(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.g) p.vy += p.g * dt;
        if (p.t === 0) { p.rot += p.vr * dt; p.vx *= 1 - dt * 0.8; }
      }
      for (let i = S.pops.length - 1; i >= 0; i--) { const p = S.pops[i]; p.age += dt; p.y -= 70 * dt * (1 - p.age / p.life); if (p.age >= p.life) S.pops.splice(i, 1); }
      for (let i = S.sparks.length - 1; i >= 0; i--) { S.sparks[i].age += dt; if (S.sparks[i].age > 0.3) S.sparks.splice(i, 1); }
      for (const br of S.grid) if (br && br.flash > 0) br.flash = Math.max(0, br.flash - dt * 6);
      S.shake = Math.max(0, S.shake - dt * 40);
      S.flash = Math.max(0, S.flash - dt * 1.4);
      if (S.banner) { S.banner.t += dt; if (S.banner.t > S.banner.dur) S.banner = null; }
    }

    function updatePlay(dt) {
      S.introT += dt;
      updatePaddle(dt);
      for (const k of Object.keys(S.timers)) if (S.timers[k] > 0) S.timers[k] = Math.max(0, S.timers[k] - dt);
      S.slowMix += ((S.timers.slow > 0 ? 1 : 0) - S.slowMix) * Math.min(1, dt * 4);
      S.boost = Math.min(240, S.boost + dt * 3);
      const speed = speedNow();
      const anyStuck = S.balls.some((b) => b.stuck);
      if (anyStuck && S.introT > 0.6 && api.input.pressed('a')) launch();
      else if (!anyStuck && S.timers.laser > 0 && api.input.down('a') && S.laserCd <= 0) {
        const P = S.paddle;
        for (const sx of [-1, 1]) S.bolts.push({ x: P.x + sx * (P.w / 2 - 12), y: PY - 6 });
        S.laserCd = 0.2;
        sfx.laser();
      }
      S.laserCd -= dt;

      for (const b of S.balls) {
        if (b.stuck) continue;
        const m = Math.hypot(b.vx, b.vy) || 1;
        b.vx = (b.vx / m) * speed; b.vy = (b.vy / m) * speed;
        const steps = Math.max(1, Math.ceil((speed * dt) / 5));
        const sdt = dt / steps;
        for (let i = 0; i < steps && !b.dead; i++) stepBall(b, sdt);
        b.trail.push(b.x, b.y);
        if (b.trail.length > 24) b.trail.splice(0, 2);
        b.stale += dt;
        if (b.stale > 15 && b.y < 640) {
          // no glass touched for a while (a loop off steel, or a vertical ping-pong): nudge it, away from the paddle
          const a = Math.atan2(b.vy, b.vx) + (Math.random() < 0.5 ? -1 : 1) * rnd(0.2, 0.4);
          b.vx = Math.cos(a) * speed; b.vy = Math.sin(a) * speed;
          fixAngle(b);
          b.stale = 10;
        }
      }
      if (S.balls.some((b) => b.dead)) S.balls = S.balls.filter((b) => !b.dead);

      // queued blasts from volatile bricks
      for (let i = S.blasts.length - 1; i >= 0; i--) {
        const q = S.blasts[i];
        q.t -= dt;
        if (q.t > 0) continue;
        S.blasts.splice(i, 1);
        const br = cellAt(q.col, q.row);
        if (br && br.k !== 'steel') { br.hp = 0; S.combo++; breakBrick(br, 'blast', null); }
        else if (br) br.flash = 1;
      }

      // laser bolts
      for (let i = S.bolts.length - 1; i >= 0; i--) {
        const bo = S.bolts[i];
        let gone = false;
        const dist = 1800 * dt, steps = Math.max(1, Math.ceil(dist / 14));
        for (let s = 0; s < steps && !gone; s++) {
          bo.y -= dist / steps;
          if (bo.y < WT) { gone = true; sparkBurst(bo.x, WT + 2, '#ff8095', 4, 160); break; }
          const col = Math.floor((bo.x - GX) / CW), row = Math.floor((bo.y - GY) / CH);
          const br = cellAt(col, row);
          if (br && bo.x >= br.x && bo.x <= br.x + BW && bo.y <= br.y + BH && bo.y >= br.y) {
            gone = true;
            sparkBurst(bo.x, br.y + BH, '#ff8095', 5, 180);
            damage(br, 'laser', null);
          }
        }
        if (gone) S.bolts.splice(i, 1);
      }

      // falling capsules
      const P = S.paddle;
      for (let i = S.caps.length - 1; i >= 0; i--) {
        const c = S.caps[i];
        c.y += c.vy * dt;
        if (c.y + 13 >= PY && c.y - 13 <= PY + PH && Math.abs(c.x - P.x) <= P.w / 2 + 30) { S.caps.splice(i, 1); applyCapsule(c); }
        else if (c.y > H + 30) S.caps.splice(i, 1);
      }

      S.stats.maxBalls = Math.max(S.stats.maxBalls, S.balls.length);
      if (S.breakable <= 0 && !S.blasts.length) { levelClear(); return; }
      if (!S.balls.length) loseLife();
    }

    function update(dt) {
      S.clock += dt;
      S.sfxBudget = 6;
      updateFx(dt);
      if (S.phase === 'play') updatePlay(dt);
      else if (S.phase === 'clear') {
        S.phaseT += dt;
        updatePaddle(dt);
        if (S.phaseT > 2.7) { S.level++; loadLevel(S.level); S.phase = 'play'; }
      } else if (S.phase === 'respawn') {
        S.phaseT += dt;
        updatePaddle(dt);
        if (S.phaseT > 1.0) { S.phase = 'play'; S.introT = 1; serve(); }
      } else if (S.phase === 'dying') {
        S.phaseT += dt;
        if (S.phaseT > 1.5 && !S.over) {
          S.over = true;
          api.gameOver({ score: S.score, stats: { ...S.stats } });
        }
      }
    }

    // ---------------------------------------------------------- draw
    function label(ctx, text, x, y) {
      ctx.font = '600 17px "Segoe UI", sans-serif';
      ctx.letterSpacing = '4px';
      ctx.fillStyle = 'rgba(190,220,240,0.55)';
      ctx.fillText(text, x, y);
      ctx.letterSpacing = '0px';
    }

    function drawSide(ctx) {
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const lx = 180, rx = 1740;
      label(ctx, 'LEVEL', lx, 236);
      ctx.font = '200 88px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(String(S.level), lx, 322);
      ctx.font = '600 22px "Segoe UI", sans-serif'; ctx.fillStyle = ACCENT; ctx.letterSpacing = '3px';
      ctx.fillText(S.levelName.toUpperCase(), lx, 360);
      ctx.letterSpacing = '0px';
      const active = Object.keys(TIMED).filter((k) => S.timers[k] > 0);
      if (active.length) {
        label(ctx, 'POWER', lx, 460);
        let y = 506;
        for (const k of active) {
          drawCapsule(ctx, lx - 78, y, k, S.clock, 0.7);
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff';
          ctx.fillText(CAPS[k].name, lx - 44, y + 2);
          ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(lx - 44, y + 12, 140, 4);
          ctx.fillStyle = CAPS[k].color; ctx.fillRect(lx - 44, y + 12, 140 * (S.timers[k] / TIMED[k]), 4);
          ctx.textAlign = 'center';
          y += 62;
        }
      }
      label(ctx, 'COMBO', rx, 236);
      if (S.combo >= 2) {
        ctx.font = '300 80px "Segoe UI", sans-serif';
        ctx.fillStyle = S.combo >= 10 ? '#ffe27a' : '#fff';
        ctx.fillText(`×${S.combo}`, rx, 320);
      } else {
        ctx.font = '200 80px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillText('–', rx, 320);
      }
      label(ctx, 'BRICKS', rx, 430);
      ctx.font = '300 54px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff';
      ctx.fillText(String(Math.max(0, S.breakable)), rx, 492);
      label(ctx, 'BALLS', rx, 590);
      const n = Math.min(S.lives, 7);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const x = rx - (n - 1) * 17 + i * 34;
        ctx.drawImage(glow('#5ad8ff', 24), x - 20, 620 - 20, 40, 40);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#fff';
      for (let i = 0; i < n; i++) { ctx.beginPath(); ctx.arc(rx - (n - 1) * 17 + i * 34, 620, 8, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }

    function chromaText(ctx, text, x, y, size, weight, spacing, face) {
      ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
      ctx.letterSpacing = `${spacing}px`;
      ctx.globalCompositeOperation = 'lighter';
      const d = Math.max(2, size * 0.025);
      ctx.fillStyle = 'rgba(255,40,120,0.6)'; ctx.fillText(text, x - d, y);
      ctx.fillStyle = 'rgba(40,170,255,0.6)'; ctx.fillText(text, x + d, y);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = face; ctx.fillText(text, x, y);
    }

    function drawBanner(ctx, b) {
      const a = Math.min(1, b.t / 0.18) * Math.min(1, (b.dur - b.t) / 0.35);
      if (a <= 0) return;
      const cy = b.title === 'LEVEL CLEAR' || b.title === 'GAME OVER' ? 560 : 820;
      const tall = b.perfect ? 250 : 190;
      ctx.save();
      ctx.globalAlpha = a;
      const g = ctx.createLinearGradient(WL, 0, WR, 0);
      g.addColorStop(0, 'rgba(3,6,18,0)'); g.addColorStop(0.5, 'rgba(3,6,18,0.82)'); g.addColorStop(1, 'rgba(3,6,18,0)');
      ctx.fillStyle = g; ctx.fillRect(WL, cy - 110, WR - WL, tall);
      const lg = ctx.createLinearGradient(WL, 0, WR, 0);
      lg.addColorStop(0, 'rgba(90,216,255,0)'); lg.addColorStop(0.5, 'rgba(160,235,255,0.9)'); lg.addColorStop(1, 'rgba(90,216,255,0)');
      ctx.fillStyle = lg; ctx.fillRect(WL, cy - 110, WR - WL, 2); ctx.fillRect(WL, cy - 110 + tall, WR - WL, 2);
      const e = Math.min(1, b.t / 0.35), sc = 0.82 + 0.18 * (1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2));
      ctx.translate(W / 2, cy);
      ctx.scale(sc, sc);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      chromaText(ctx, b.title, 0, 18, 104, 800, 10, '#ffffff');
      ctx.letterSpacing = '6px';
      ctx.font = '600 28px "Segoe UI", sans-serif'; ctx.fillStyle = ACCENT;
      ctx.fillText(b.sub, 0, 64);
      if (b.perfect) {
        const pg = ctx.createLinearGradient(-260, 0, 260, 0);
        const sh = (S.clock * 0.8) % 1;
        pg.addColorStop(0, '#ffb43a'); pg.addColorStop(clamp(sh - 0.1, 0, 1), '#ffe27a'); pg.addColorStop(clamp(sh, 0, 1), '#ffffff'); pg.addColorStop(clamp(sh + 0.1, 0, 1), '#ffe27a'); pg.addColorStop(1, '#ffb43a');
        chromaText(ctx, b.perfect, 0, 124, 50, 800, 8, pg);
      }
      ctx.restore();
    }

    function draw(ctx) {
      ctx.save();
      ctx.drawImage(background(), 0, 0);
      if (S.shake > 0) ctx.translate(Math.sin(S.clock * 93) * S.shake * 0.6, Math.cos(S.clock * 71) * S.shake * 0.6);

      // wall sparks
      ctx.globalCompositeOperation = 'lighter';
      for (const sp of S.sparks) {
        ctx.globalAlpha = 1 - sp.age / 0.3;
        ctx.drawImage(glow(ACCENT, 40), sp.x - 40, sp.y - 40, 80, 80);
      }
      ctx.globalAlpha = 1;

      // bricks: under-glow, body, hit flash, shine sweep
      const intro = S.phase === 'play' ? S.introT : 9;
      const sweep = ((S.clock % 5) / 5) * 2400 - 300;
      for (const br of S.grid) {
        if (!br) continue;
        const a = clamp((intro - br.delay) / 0.45, 0, 1);
        if (a <= 0) continue;
        const col = colorOf(br.c);
        let ga = br.k === 'steel' ? 0.06 : 0.16;
        if (br.k === 'bomb') ga = 0.25 + 0.2 * Math.sin(S.clock * 7 + br.col);
        ctx.globalAlpha = ga * a;
        ctx.drawImage(glow(col, 40), br.x - 22, br.y - 26, BW + 44, BH + 52);
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const br of S.grid) {
        if (!br) continue;
        const a = clamp((intro - br.delay) / 0.45, 0, 1);
        if (a <= 0) continue;
        const off = (1 - a) * (1 - a) * (1 - a) * -60;
        ctx.globalAlpha = a;
        ctx.drawImage(brickSprite(br.k, br.c, br.hp, br.max, br.variant), br.x - 2, br.y - 2 + off);
      }
      ctx.globalCompositeOperation = 'lighter';
      for (const br of S.grid) {
        if (!br) continue;
        const d = Math.abs(br.x + br.y * 0.7 - sweep);
        const fl = br.flash * 0.85 + (d < 110 ? (1 - d / 110) * 0.32 : 0);
        if (fl <= 0.01) continue;
        ctx.globalAlpha = Math.min(1, fl);
        ctx.drawImage(brickSprite(br.k, br.c, br.hp, br.max, br.variant), br.x - 2, br.y - 2);
      }
      ctx.globalAlpha = 1;

      // capsules
      for (const c of S.caps) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(glow(CAPS[c.type].color, 40), c.x - 60, c.y - 34, 120, 68);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drawCapsule(ctx, c.x, c.y, c.type, S.clock);
      }

      // laser bolts
      ctx.globalCompositeOperation = 'lighter';
      for (const bo of S.bolts) {
        ctx.drawImage(glow('#ff3d5e', 24), bo.x - 14, bo.y - 10, 28, 46);
        ctx.fillStyle = '#ffd0d8'; ctx.fillRect(bo.x - 2, bo.y, 4, 24);
      }

      // paddle
      const P = S.paddle;
      const x0 = P.x - P.w / 2;
      const shrink = S.timers.shrink > 0;
      ctx.globalAlpha = 0.45 + P.flash * 0.4;
      ctx.drawImage(glow(shrink ? '#ff5a78' : ACCENT, 48), x0 - 50, PY - 46, P.w + 100, PH + 92);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      let g = ctx.createLinearGradient(0, PY, 0, PY + PH);
      g.addColorStop(0, '#f2fdff'); g.addColorStop(0.45, shrink ? '#ff8aa0' : ACCENT); g.addColorStop(1, shrink ? '#6a1630' : '#14527c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.roundRect(x0, PY, P.w, PH, PH / 2); ctx.fill();
      const laser = S.timers.laser > 0;
      g = ctx.createLinearGradient(0, PY, 0, PY + PH);
      if (laser) { g.addColorStop(0, '#ffd0d8'); g.addColorStop(0.5, '#ff3d5e'); g.addColorStop(1, '#5a0a18'); }
      else { g.addColorStop(0, '#ffc2f1'); g.addColorStop(0.5, '#ff52d4'); g.addColorStop(1, '#6a1660'); }
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(x0, PY, 24, PH, [PH / 2, 0, 0, PH / 2]); ctx.fill();
      ctx.beginPath(); ctx.roundRect(x0 + P.w - 24, PY, 24, PH, [0, PH / 2, PH / 2, 0]); ctx.fill();
      if (laser) {
        ctx.fillStyle = '#ff9aac';
        for (const sx of [x0 + 8, x0 + P.w - 16]) ctx.fillRect(sx, PY - 8, 8, 9);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x0 + 14, PY + 3, P.w - 28, 3);
      ctx.strokeStyle = 'rgba(230,250,255,0.9)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.roundRect(x0, PY, P.w, PH, PH / 2); ctx.stroke();
      if (P.flash > 0) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = `rgba(200,245,255,${P.flash * 0.5})`;
        ctx.beginPath(); ctx.roundRect(x0, PY, P.w, PH, PH / 2); ctx.fill();
      }

      // balls
      const ballCol = S.slowMix > 0.5 ? '#ffd43b' : '#7fe6ff';
      ctx.globalCompositeOperation = 'lighter';
      for (const b of S.balls) {
        const tr = b.trail, n = tr.length / 2;
        for (let i = 0; i < n; i++) {
          const k = (i + 1) / n, rr = BALL_R * (0.5 + k * 1.3);
          ctx.globalAlpha = k * 0.4;
          ctx.drawImage(glow(ballCol, 32), tr[i * 2] - rr * 2, tr[i * 2 + 1] - rr * 2, rr * 4, rr * 4);
        }
        ctx.globalAlpha = 0.9;
        ctx.drawImage(glow(ballCol, 48), b.x - 46, b.y - 46, 92, 92);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const b of S.balls) {
        ctx.fillStyle = '#ffffff';
        ctx.beginPath(); ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = tint(ballCol, 0.3, 0.9); ctx.lineWidth = 2;
        ctx.stroke();
      }

      // particles
      ctx.globalCompositeOperation = 'lighter';
      for (const p of S.parts) {
        const k = p.age / p.life;
        if (p.t === 0) {
          ctx.globalAlpha = (1 - k) * (0.55 + 0.45 * Math.abs(Math.sin(p.rot * 1.7)));
          ctx.fillStyle = p.c;
          const c = Math.cos(p.rot) * p.s, s = Math.sin(p.rot) * p.s;
          ctx.beginPath();
          ctx.moveTo(p.x + c, p.y + s);
          ctx.lineTo(p.x - s * 0.55 - c * 0.35, p.y + c * 0.55 - s * 0.35);
          ctx.lineTo(p.x + s * 0.4 - c * 0.6, p.y - c * 0.4 - s * 0.6);
          ctx.fill();
        } else if (p.t === 1) {
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(glow(p.c, 24), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
        } else if (p.t === 2) {
          ctx.globalAlpha = (1 - k) * 0.8;
          const z = p.s * (0.6 + k * 0.8);
          ctx.drawImage(glow(p.c, 64), p.x - z, p.y - z, z * 2, z * 2);
        } else {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.c; ctx.lineWidth = 8 * (1 - k);
          ctx.beginPath(); ctx.arc(p.x, p.y, p.s + p.grow * k, 0, Math.PI * 2); ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      // score popups
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of S.pops) {
        const k = p.age / p.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `700 ${Math.round(p.size)}px "Segoe UI", sans-serif`;
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      }
      ctx.globalAlpha = 1;

      // launch hint
      if (S.phase === 'play' && S.introT > 0.6 && (!S.banner || S.banner.t > S.banner.dur - 0.4) && S.balls.some((b) => b.stuck)) {
        ctx.globalAlpha = 0.55 + 0.45 * Math.sin(S.clock * 5);
        ctx.font = '600 24px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px';
        ctx.fillStyle = '#dff8ff';
        ctx.fillText('PRESS  A  TO LAUNCH', W / 2, PY - 70);
        ctx.letterSpacing = '0px';
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      ctx.save();
      drawSide(ctx);
      api.hud(ctx, { score: S.score, left: [`Level ${S.level}`], right: [`Balls ${S.lives}`] });
      if (S.banner) drawBanner(ctx, S.banner);
      if (S.flash > 0) {
        ctx.fillStyle = `rgba(${S.flashColor},${Math.min(0.5, S.flash) * 0.6})`;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.restore();
    }

    loadLevel(1);
    return { update, draw };
  },
};
