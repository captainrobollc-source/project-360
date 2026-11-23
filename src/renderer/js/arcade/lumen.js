// Lumen Run: an original neon tunnel runner for the Project 360 arcade.
//
// Fly down the inside of a glowing tube. The left stick slides you around its wall (the world
// turns so you stay at the bottom) while ring segments, spinning bars and pulsing gates rush at
// you. Hold A to phase through anything while the meter lasts; shards refill it and, collected
// without missing one, build a chain multiplier. Skimming an edge is a graze. Every 1000 m the
// tube changes colour and brings in a new pattern. Rendering is plain canvas 2D: a perspective
// tube (screen radius = R·F/z), cached backdrop and glow sprites, and a pooled particle system.

const W = 1920;
const H = 1080;
const TAU = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const ACCENT = '#a77bff';

// tube and camera (metres; the camera rides with the craft and looks down the tube's axis)
const R = 3;                 // tube radius
const HOVER = 2.78;          // the craft flies this far from the axis, just off the wall
const FIN = 1.25;            // ring segments reach this far in from the wall
const ZC = 2.4;              // craft depth ahead of the camera
const CAM_OFF = 0.45;        // the camera sits a little below the axis, so the floor reads as a road
const F0 = 440;              // focal length in px
const VX = W / 2;            // vanishing point
const VY = 452;
const ZNEAR = 0.6;
const ZFAR = 118;
const RING_DZ = 2.5;         // tube grid spacing
const RING_BANDS = [0.6, 3, 8, 20, 45, 118]; // depth bands that share one ring stroke
const LINES = 32;            // lengthwise grid lines
const TH = 0.5;              // obstacle depth
const CL = 0.7;              // craft length (for overlap tests)
const STREAKS = 64;

// craft
const CW = 0.09;             // craft half-width, as an angle on the wall
const OMEGA = 3.7;           // top speed around the tube (rad/s)
const GRAZE = 0.09;          // a pass with less clearance than this (rad) is a graze
const SHARD_HIT = 0.17;      // a shard is collected if it passes within this angle of the craft
const SHARD_R = 2.72;        // shards float at craft height
const BAR_HW = 0.12;         // spinning bar half-width on the wall (rad)

// pacing and scoring
const SECTION = 1000;
const BREATH_IN = 45;        // clear tube before a section boundary...
const BREATH_OUT = 95;       // ...and after it
const GEN_AHEAD = 150;       // how far ahead the course is laid out
const SPD0 = 15;             // m/s at the start
const DRAIN = 0.72;          // phase meter per second of phasing
const PHASE_MIN = 0.12;      // meter needed to start phasing
const SHARD_FILL = 0.03;
const GRAZE_FILL = 0.06;
const LOCK_T = 1.0;          // shutter gates stop switching this long before they reach you
const DIST_PTS = 5;          // per metre, times the speed multiplier
const SHARD_PTS = 10;        // per shard, times the chain multiplier
const GRAZE_PTS = 150;       // per graze, times the speed multiplier

function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgba(hex, a) { const [r, g, b] = rgbOf(hex); return `rgba(${r},${g},${b},${a})`; }
// c: [r,g,b]; k blends toward `to` (255 = tint, 0 = shade)
function css(c, a = 1, k = 0, to = 255) {
  return `rgba(${Math.round(c[0] + (to - c[0]) * k)},${Math.round(c[1] + (to - c[1]) * k)},${Math.round(c[2] + (to - c[2]) * k)},${a})`;
}
const mixRGB = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const WHITE = [255, 255, 255];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const wrapA = (a) => { a %= TAU; return a < 0 ? a + TAU : a; };
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
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

// ------------------------------------------------------------------ sections
// Obstacles always contrast with the tube they sit in; shards always contrast with both.
const THEMES = [
  { name: 'Violet Run', tube: '#a77bff', hot: '#ff3d7f', shard: '#7ff6ff', fog: '#1c0d3c' },
  { name: 'Cyan Drift', tube: '#36e2ff', hot: '#ff7a2e', shard: '#fff06a', fog: '#04223e' },
  { name: 'Ember Coil', tube: '#ff8a3d', hot: '#3dd8ff', shard: '#c4ff6a', fog: '#331206' },
  { name: 'Jade Spiral', tube: '#3dff9a', hot: '#ff3fbf', shard: '#fff06a', fog: '#04291b' },
  { name: 'Rose Static', tube: '#ff4fa3', hot: '#ffd23d', shard: '#7ff6ff', fog: '#300822' },
  { name: 'Gold Reach', tube: '#ffd23d', hot: '#9a6bff', shard: '#7fffd4', fog: '#2a1f04' },
  { name: 'Ice Core', tube: '#9fd8ff', hot: '#ff4058', shard: '#ffe27a', fog: '#091d31' },
  { name: 'Null Horizon', tube: '#e0d4ff', hot: '#ff2a3a', shard: '#7ff6ff', fog: '#120e22' },
].map((t) => ({ ...t, cT: rgbOf(t.tube), cH: rgbOf(t.hot), cS: rgbOf(t.shard), cF: rgbOf(t.fog) }));
const INTROS = [
  'Slip through the gaps',
  'New: spinning bars',
  'New: iris gates  ·  they breathe, so stay centred',
  'New: shutter gates  ·  they lock just before you reach them',
  'New: bars spinning through the gaps',
  'New: corkscrews and counter-spin',
  'New: turning rings',
];
const introOf = (n) => INTROS[n] || 'Everything, faster';

// Course patterns: [name, first section it appears in, weight]. Each section opens with its new one.
const PATTERNS = [
  ['single', 0, 3], ['slalom', 0, 3], ['corridor', 0, 1.5],
  ['bar', 1, 2], ['barRun', 1, 1.4],
  ['iris', 2, 2], ['irisRun', 2, 1.2],
  ['shutter', 3, 1.6], ['twin', 3, 1.4],
  ['ringBar', 4, 1.6], ['cage', 4, 1.2],
  ['corkscrew', 5, 1.3], ['counter', 5, 1.2],
  ['turning', 6, 1.5], ['gauntlet', 6, 1],
];
const INTRO_PATTERN = ['single', 'bar', 'iris', 'shutter', 'ringBar', 'corkscrew', 'turning'];

// Base speed by distance: 15 m/s at the start, 28 m/s by 5000 m, then a slower climb.
function spdBase(s) { return Math.min(40, SPD0 + Math.min(s, 5000) * 0.0026 + Math.max(0, s - 5000) * 0.0012); }
const difficulty = (s) => clamp(s / 6000, 0, 1);
const speedMult = (base) => 1 + (base - SPD0) / 12;

// ------------------------------------------------------------------ obstacle shapes
// Every obstacle reduces to [centre, half-width] pairs on the wall at time t: gaps (rings, irises
// and shutters are solid everywhere else) or arcs (spinning bars are solid only there).
const SH = new Float64Array(64); // 64-bit: rotation terms grow with play time
let shGaps = true;
let clrSide = 0;             // which side the nearest edge was on, from the last clearance()

// Shutter gate: set A's openness (set B is the opposite). A square wave with soft edges, frozen
// once the gate locks, so the last second of approach is a fair read.
function shutterOpen(o, t) {
  if (o.locked) return lerp(o.lockFrom, o.lockTo, clamp((t - o.lockAt) / 0.16, 0, 1));
  const p = (t * o.freq + o.ph) % 1;
  const e = 0.09;
  if (p < e) return p / e;
  if (p < 0.5) return 1;
  if (p < 0.5 + e) return 1 - (p - 0.5) / e;
  return 0;
}

function shape(o, t) {
  let n = 0;
  const rot = o.rot * t;
  if (o.kind === 'ring') {
    shGaps = true;
    for (const g of o.gaps) { SH[n++] = g[0] + rot; SH[n++] = g[1]; }
  } else if (o.kind === 'iris') {
    shGaps = true;
    const hw = o.gmin + (o.gmax - o.gmin) * (0.5 + 0.5 * Math.sin(o.w * t + o.ph));
    for (let i = 0; i < o.k; i++) { SH[n++] = o.a0 + rot + (i * TAU) / o.k; SH[n++] = hw; }
  } else if (o.kind === 'shutter') {
    shGaps = true;
    const oa = shutterOpen(o, t);
    for (let j = 0; j < o.k * 2; j++) {
      const hw = o.ghw * (j % 2 ? 1 - oa : oa);
      if (hw < 0.004) continue;
      SH[n++] = o.a0 + rot + (j * Math.PI) / o.k; SH[n++] = hw;
    }
  } else {
    shGaps = false;
    for (let i = 0; i < o.k; i++) { SH[n++] = o.a0 + rot + (i * TAU) / o.k; SH[n++] = o.bhw; }
  }
  return n >> 1;
}

// Room (rad) between the craft's edge at angle a and the nearest solid edge; negative = a hit.
function clearance(o, a, t) {
  const n = shape(o, t);
  let best, side = 0;
  if (shGaps) {
    best = -9;
    for (let i = 0; i < n; i++) {
      const d = angDiff(a, SH[i * 2]);
      const m = SH[i * 2 + 1] - Math.abs(d);
      if (m > best) { best = m; side = d > 0 ? 1 : -1; }
    }
  } else {
    best = 9;
    for (let i = 0; i < n; i++) {
      const d = angDiff(SH[i * 2], a);
      const m = Math.abs(d) - SH[i * 2 + 1];
      if (m < best) { best = m; side = d > 0 ? 1 : -1; }
    }
  }
  clrSide = side;
  return best - CW;
}

// ------------------------------------------------------------------ shared drawing helpers
// An annular sector from the wall inward, between world angles a0 < a1. World angle grows to the
// right on screen, so screen angles run the other way; `rot` is the camera's angle.
function finPath(ctx, cx, cy, ro, ri, a0, a1, rot) {
  const s0 = HALF_PI - (a1 - rot), s1 = HALF_PI - (a0 - rot);
  ctx.moveTo(cx + Math.cos(s0) * ro, cy + Math.sin(s0) * ro);
  ctx.arc(cx, cy, ro, s0, s1);
  ctx.arc(cx, cy, ri, s1, s0, true);
  ctx.closePath();
}

// Seen from behind: the nose points into the tube, twin engines at the back.
const CRAFT = [0, -50, 15, -14, 54, 6, 22, 9, 9, 18, -9, 18, -22, 9, -54, 6, -15, -14];
const CANOPY = [0, -36, 8, -12, 0, -4, -8, -12];
function polyPath(ctx, pts, s = 1, ox = 0, oy = 0) {
  for (let i = 0; i < pts.length; i += 2) {
    const x = ox + pts[i] * s, y = oy + pts[i + 1] * s;
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

// ------------------------------------------------------------------ cached backdrops
// The tube's far end glows in the section's fog colour; painted once per theme at half size.
const bgCache = new Map();
function backdrop(th) {
  let c = bgCache.get(th.name);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = W / 2; c.height = H / 2;
  const g = c.getContext('2d');
  g.fillStyle = '#020108';
  g.fillRect(0, 0, c.width, c.height);
  const cx = VX / 2, cy = VY / 2;
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, 640);
  gr.addColorStop(0, css(th.cT, 1, 0.55));
  gr.addColorStop(0.03, css(th.cT, 0.7, 0.1));
  gr.addColorStop(0.1, css(th.cF, 1, 0.2));
  gr.addColorStop(0.3, css(th.cF, 1));
  gr.addColorStop(0.62, css(th.cF, 0.55, 0.6, 0));
  gr.addColorStop(1, 'rgba(2,1,8,1)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  bgCache.set(th.name, c);
  return c;
}

let vignette = null;
function vignetteCanvas() {
  if (vignette) return vignette;
  const c = document.createElement('canvas');
  c.width = W / 2; c.height = H / 2;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(VX / 2, VY / 2, H * 0.22, W / 4, H / 4, W * 0.36);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  vignette = c;
  return c;
}

// ------------------------------------------------------------------ the game
function create(api) {
  const rand = (a, b) => a + Math.random() * (b - a);
  const irand = (a, b) => Math.floor(rand(a, b + 1));
  const sign = () => (Math.random() < 0.5 ? -1 : 1);

  // palette: particles and glow sprites refer to colours by index (no strings per particle)
  const PAL = ['#ffffff', ACCENT, '#ffd27a', '#bfe9ff'];
  const PI_WHITE = 0, PI_GOLD = 2, PI_ICE = 3;
  for (const th of THEMES) PAL.push(th.tube, th.hot, th.shard);
  const tubeIx = (i) => 4 + i * 3;
  const hotIx = (i) => 5 + i * 3;
  const shardIx = (i) => 6 + i * 3;
  const GL = PAL.map((c) => api.glow(c, 32));
  const GLB = PAL.map(() => null);
  const bigGlow = (i) => GLB[i] || (GLB[i] = api.glow(PAL[i], 128));

  // ---- particles: fixed pool in typed arrays (0 streak, 1 glow dot, 2 ring, 3 debris)
  const PMAX = 900;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX), pvx = new Float32Array(PMAX), pvy = new Float32Array(PMAX);
  const pl = new Float32Array(PMAX), pm = new Float32Array(PMAX), ps = new Float32Array(PMAX);
  const pr = new Float32Array(PMAX), pvr = new Float32Array(PMAX);
  const pc = new Uint8Array(PMAX), pk = new Uint8Array(PMAX);
  let pn = 0;
  function part(x, y, vx, vy, life, size, c, k, rot = 0, vr = 0) {
    const i = pn < PMAX ? pn++ : (Math.random() * PMAX) | 0;
    px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy; pl[i] = pm[i] = life; ps[i] = size; pc[i] = c; pk[i] = k; pr[i] = rot; pvr[i] = vr;
  }
  function burst(x, y, n, c, sMin, sMax, lMin, lMax, size, k) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(sMin, sMax);
      part(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(lMin, lMax), size, c, k);
    }
  }

  // ---- motion streaks along the wall (world space, recycled as they pass)
  const stA = new Float32Array(STREAKS), stS = new Float32Array(STREAKS);
  for (let i = 0; i < STREAKS; i++) { stA[i] = rand(0, TAU); stS[i] = rand(0, ZFAR); }
  // lengthwise grid line directions, refreshed each frame from the camera angle
  const LC = new Float32Array(LINES), LS = new Float32Array(LINES);

  // ---- state
  let T = 0;
  let dist = 0, prevDist = 0, spd = SPD0, score = 0, crashDist = 0;
  let craftA = 0, prevA = 0, angV = 0, camA = 0, bank = 0, F = F0;
  let meter = 1, phasing = false, armed = false, tail = 0, boost = 0;
  let shield = false, shieldInv = 0;
  let chain = 0, maxChain = 0, got = 0, grazes = 0;
  let mode = 'run', crashT = 0, overSent = false;
  let sec = 0, themeI = 0, themeFromI = 0, themeT = 1;
  let shake = 0, shx = 0, shy = 0, flash = 0, flashRGB = '255,255,255';
  let banner = { title: 'SECTION 1', sub: THEMES[0].name.toUpperCase(), note: introOf(0), t: 0, dur: 2.8 };
  let emitAcc = 0, god = false, lowWarned = false;
  const obs = [], shards = [], portals = [], pickups = [], pops = [];
  const sfxAt = {};
  const CP = { x: VX, y: 880, a: HALF_PI };   // craft screen position, refreshed each frame
  const col = { tc: [0, 0, 0], tcHi: [0, 0, 0], tube: '', tubeHi: '', hot: '', hotDark: '', hotEdge: '', shard: '', shardHi: '' };

  const chainMult = () => Math.min(5, 1 + Math.floor(chain / 10));
  const intangible = () => phasing || tail > 0 || shieldInv > 0 || god;
  const distNow = () => (mode === 'run' ? dist : crashDist);

  // ---- sound
  function play(name, gap, voices) {
    if (T - (sfxAt[name] ?? -9) < gap) return;
    sfxAt[name] = T;
    api.sfx(voices);
  }
  const panOf = (x) => clamp((x - VX) / 900, -0.8, 0.8);
  const NOTES = [783.99, 880, 987.77, 1174.66, 1318.51, 1567.98, 1760, 1975.53, 2349.32, 2637.02];
  const sfx = {
    shard: (pan, gold) => {
      const f = NOTES[chain % NOTES.length] * (gold ? 0.5 : 1);
      play('shard', 0.025, [{ tone: f, type: 'triangle', peak: 0.1, attack: 0.002, decay: 0.12, pan }, { tone: f * 2, peak: 0.035, attack: 0.002, decay: 0.08, pan }]);
    },
    chainUp: () => play('chainUp', 0.1, [
      ...[1, 1.25, 1.5, 2].map((m, i) => ({ tone: 659.25 * m, at: i * 0.05, peak: 0.075, decay: 0.4, pan: (i - 1.5) * 0.25 })),
      { noise: true, at: 0.05, from: 5000, peakAt: 9000, to: 7000, dur: 0.4, q: 3, peak: 0.04 },
    ]),
    miss: () => play('miss', 0.25, [{ tone: 440, to: 220, type: 'triangle', peak: 0.08, attack: 0.004, decay: 0.22 }, { tone: 330, to: 160, peak: 0.05, at: 0.06, decay: 0.2 }]),
    graze: (pan) => play('graze', 0.05, [
      { noise: true, from: 3000, peakAt: 9000, to: 5000, dur: 0.16, q: 1.5, peak: 0.22, panFrom: pan, panTo: pan },
      { tone: 2400, to: 1500, type: 'square', peak: 0.025, attack: 0.002, decay: 0.08, pan },
      { tone: 1800, peak: 0.05, attack: 0.002, decay: 0.18, pan },
    ]),
    whoosh: (pan) => play('whoosh', 0.1, [{ noise: true, from: 500, peakAt: 1900, to: 350, dur: 0.24, q: 0.8, peak: 0.06, panFrom: pan * 0.5, panTo: pan }]),
    phaseOn: () => play('phaseOn', 0.08, [{ tone: 220, to: 660, type: 'triangle', peak: 0.09, attack: 0.02, decay: 0.25 }, { noise: true, from: 600, peakAt: 4000, to: 2500, dur: 0.35, q: 0.8, peak: 0.12 }]),
    phaseOff: () => play('phaseOff', 0.08, [{ tone: 520, to: 180, type: 'triangle', peak: 0.06, attack: 0.01, decay: 0.2 }]),
    empty: () => play('empty', 0.4, [{ tone: 180, type: 'square', peak: 0.035, attack: 0.003, decay: 0.08 }, { tone: 150, type: 'square', at: 0.09, peak: 0.035, attack: 0.003, decay: 0.1 }]),
    phased: () => play('phased', 0.1, [{ noise: true, from: 1500, peakAt: 6000, to: 800, dur: 0.3, q: 0.7, peak: 0.12 }, { tone: 900, to: 1400, peak: 0.04, attack: 0.01, decay: 0.15 }]),
    lock: (pan) => play('lock', 0.1, [{ tone: 1250, type: 'square', peak: 0.03, attack: 0.002, decay: 0.05, pan }, { tone: 2500, peak: 0.04, attack: 0.002, decay: 0.12, pan }]),
    section: () => play('section', 0.5, [
      ...[523.25, 659.25, 783.99, 1046.5, 1318.51].map((f, i) => ({ tone: f, at: i * 0.06, peak: 0.075, decay: 0.9, pan: (i - 2) * 0.2 })),
      { noise: true, from: 300, peakAt: 6000, to: 3000, dur: 0.9, q: 0.6, peak: 0.15 },
      { tone: 110, to: 220, peak: 0.12, attack: 0.1, decay: 0.6 },
    ]),
    shield: () => play('shield', 0.2, [{ tone: 660, to: 990, peak: 0.1, attack: 0.004, decay: 0.12 }, { tone: 990, at: 0.07, peak: 0.09, decay: 0.25 }, { tone: 1480, at: 0.14, peak: 0.08, decay: 0.45 }]),
    shieldBreak: () => play('shieldBreak', 0.2, [
      { noise: true, from: 3200, peakAt: 9000, to: 5200, dur: 0.3, q: 1.2, peak: 0.2 },
      { tone: 1245, peak: 0.06, attack: 0.002, decay: 0.3 }, { tone: 1873, peak: 0.05, attack: 0.002, decay: 0.35 },
      { tone: 300, to: 90, type: 'triangle', peak: 0.14, attack: 0.003, decay: 0.3 },
    ]),
    crash: (pan) => api.sfx([
      { noise: true, from: 1400, peakAt: 420, to: 50, dur: 1.1, q: 0.6, peak: 0.55, type: 'lowpass', panFrom: pan, panTo: pan },
      { tone: 130, to: 32, peak: 0.34, attack: 0.004, decay: 0.8 },
      { noise: true, from: 4000, peakAt: 9000, to: 3000, dur: 0.45, q: 1, peak: 0.14 },
      { tone: 880, to: 110, type: 'sawtooth', peak: 0.05, attack: 0.004, decay: 0.6 },
    ]),
  };

  // ---- popups (score text near the craft)
  function popup(text, color, size = 30, dy = 0) {
    if (pops.length > 10) pops.shift();
    let y = CP.y - 110 - dy;
    // stack on top of anything that just appeared, so two events in a row stay readable
    for (const p of pops) if (p.t < 0.45 && Math.abs(p.y - y) < (p.size + size) * 0.6) y = p.y - (p.size + size) * 0.62;
    pops.push({ text, color, size, x: CP.x, y, t: 0, life: 0.95 });
  }

  // ---------------------------------------------------------- course generator
  // Obstacles are laid out ahead in chunks (a slalom, a corkscrew, a bar run...). Spacing is set
  // in seconds at the speed you'll have there, and every gap sits within the turn you can make in
  // that time, so the course is always passable without phasing.
  const G = { s: 60, ang: 0, free: false, limit: 0, intro: 0, last: '' };
  let shardsDirty = false;

  function ob(kind, s, props) {
    const o = { kind, s, rot: 0, done: false, minClear: 9, side: 0, ghost: false, phased: false, flash: 0, ...props };
    obs.push(o);
    return o;
  }
  function addShard(s, a, gold = false) {
    if (shards.length >= 420) return;
    shards.push({ s, a: wrapA(a), gold, done: false, got: false, spin: rand(0, TAU) });
    shardsDirty = true;
  }
  const ringGaps = (list) => list.map(([c, hw]) => [wrapA(c), hw]).sort((p, q) => p[0] - q[0]);
  const arrival = (s) => T + Math.max(0, s - dist) / spdBase((s + dist) / 2);

  function gapAhead(k = 1) {
    let ds = lerp(1.5, 0.84, difficulty(G.s)) * k * rand(0.94, 1.08) * spdBase(G.s);
    if (G.free) ds = Math.max(ds, 1.3 * spdBase(G.s)); // you could be anywhere: allow a half-turn
    return G.s + ds > G.limit ? -1 : G.s + ds;
  }
  // how far round the tube we ask you to move over a stretch of ds metres
  const reach = (ds, k = 1) => lerp(1.2, 2.5, difficulty(G.s)) * (ds / spdBase(G.s)) * k;
  function aim(s, k = 1, min = 0.25) {
    if (G.free) return rand(0, TAU);
    return G.ang + sign() * rand(min, 1) * reach(s - G.s, k);
  }
  const gapHW = () => lerp(0.62, 0.34, difficulty(G.s)) * rand(0.92, 1.12);

  function trail(s0, s1, a0, a1, density = 1) {
    if (s1 - s0 < 2) return;
    const n = Math.max(1, Math.round(((s1 - s0) / 2.4) * density));
    const d = angDiff(a1, a0);
    for (let i = 0; i <= n; i++) { const t = i / n; addShard(s0 + (s1 - s0) * t, a0 + d * t); }
  }

  // Shards from the last gap to this one, then straight through it. Now and then the last few
  // hug the gap's edge (collecting them means grazing) or a gold trio sits inside the wall
  // beside it (only a phase reaches those; missing gold never breaks the chain).
  function shardsTo(s0, s1, a0, a1, hw) {
    if (Math.random() < 0.18) return;
    const span = s1 - s0;
    const lead = Math.min(Math.max(span - 4, 2.4), 7.2);
    const rate = Math.abs(angDiff(a1, a0)) / (span / spdBase(s0));
    if (rate < 2.3 && span - lead > 6) trail(s0 + 3, s1 - lead, a0, a1);
    const lure = G.s > 600 && hw > 0.3 && Math.random() < 0.2;
    const side = sign();
    for (let x = s1 - lead + 2.4, i = 0; x <= s1 + 0.6; x += 2.4, i++) {
      const edge = lure ? clamp((x - (s1 - 6)) / 5, 0, 1) * (hw - 0.03) : 0;
      addShard(x, a1 + side * edge);
    }
    if (s1 >= 3 * SECTION && hw > 0.25 && Math.random() < 0.12) {
      const ga = a1 - side * (hw + 0.32);
      for (const dx of [-1.2, 0, 1.2]) addShard(s1 + dx, ga, true);
    }
  }

  function ringStep(s, a, hw) {
    const s0 = G.s, a0 = G.free ? a : G.ang;
    ob('ring', s, { gaps: [[wrapA(a), hw]] });
    shardsTo(s0, s, a0, a, hw);
    G.s = s; G.ang = wrapA(a); G.free = false;
  }

  function spiralTo(s1, turn) {
    // a coil of shards leading into an obstacle you can pass anywhere (bars, shutters)
    if (G.free || s1 - G.s < 9) return;
    trail(G.s + 3, s1 - 2, G.ang, G.ang + turn);
  }

  function barStep(k = 1, dir = sign(), spokes = 0) {
    const s = gapAhead(k);
    if (s < 0) return false;
    const n = spokes || (G.s > 3000 && Math.random() < 0.4 ? 3 : 2);
    const rot = dir * lerp(1.0, 2.2, difficulty(s)) * rand(0.85, 1.15) * (n === 3 ? 0.8 : 1);
    spiralTo(s, -dir * Math.min(1.2, reach(s - G.s) * 0.8));
    ob('bar', s, { k: n, a0: rand(0, TAU), rot, bhw: BAR_HW });
    G.s = s; G.free = true;
    return true;
  }

  function irisStep(k = 1) {
    const s = gapAhead(k);
    if (s < 0) return false;
    const n = Math.random() < 0.5 ? 2 : 3;
    const gmin = CW + lerp(0.12, 0.06, difficulty(s));
    const target = aim(s, 1, 0);
    const rot = rand(-1, 1) * (G.s > 3000 ? 0.5 : 0.25);
    const a0 = target - rot * arrival(s); // a gap sits on target when you get there
    if (!G.free) trail(G.s + 3, s - 1, G.ang, target, 0.9);
    ob('iris', s, { k: n, a0, rot, gmin, gmax: gmin + rand(0.28, 0.45), w: rand(2.4, 3.4), ph: rand(0, TAU) });
    G.s = s; G.ang = target; G.free = true;
    return true;
  }

  const P = {
    single() { const s = gapAhead(); if (s >= 0) ringStep(s, aim(s), gapHW()); },
    slalom() {
      let dir = sign();
      for (let i = irand(3, 5); i > 0; i--) {
        const s = gapAhead(0.85);
        if (s < 0) return;
        ringStep(s, G.free ? rand(0, TAU) : G.ang + dir * rand(0.55, 1) * reach(s - G.s), gapHW());
        dir = -dir;
      }
    },
    corridor() {
      // tight rings whose gaps drift: a graze alley
      const hw = gapHW() * 0.85;
      let s = gapAhead();
      if (s < 0) return;
      ringStep(s, aim(s), hw);
      let dir = sign();
      for (let i = irand(3, 5); i > 0; i--) {
        s = gapAhead(0.42);
        if (s < 0) return;
        ringStep(s, G.ang + dir * rand(0.3, 0.8) * reach(s - G.s), hw);
        if (Math.random() < 0.3) dir = -dir;
      }
    },
    bar() { barStep(1); },
    barRun() { let dir = sign(); for (let i = irand(2, 3); i > 0; i--) { if (!barStep(0.9, dir)) return; dir = -dir; } },
    iris() { irisStep(1); },
    irisRun() { if (irisStep(1)) irisStep(1); },
    shutter() {
      const s = gapAhead(1.1);
      if (s < 0) return;
      const k = G.s > 4500 && Math.random() < 0.5 ? 3 : 2;
      spiralTo(s - 6, 0);
      ob('shutter', s, {
        k, a0: G.free ? rand(0, TAU) : G.ang + rand(-0.4, 0.4), ghw: Math.min(0.44, (Math.PI / (2 * k)) * 0.85),
        freq: 1 / rand(1.5, 2.0), ph: Math.random(), locked: false, lockFrom: 0, lockTo: 0, lockAt: 0,
      });
      G.s = s; G.free = true;
    },
    twin() {
      // two gaps: the easy one nearly in line, the narrow one baited with shards
      const s = gapAhead();
      if (s < 0) return;
      const a1 = G.free ? rand(0, TAU) : G.ang + rand(-0.3, 0.3) * reach(s - G.s);
      const a2 = a1 + sign() * rand(1.6, 2.6);
      const hw1 = gapHW(), hw2 = Math.max(CW + 0.07, hw1 * 0.6);
      const s0 = G.s, a0 = G.free ? a1 : G.ang;
      ob('ring', s, { gaps: ringGaps([[a1, hw1], [a2, hw2]]) });
      if (Math.abs(angDiff(a2, a0)) / ((s - s0) / spdBase(s0)) < 2.3) trail(s0 + 3, s + 0.5, a0, a2);
      G.s = s; G.ang = a1; G.free = true;
    },
    ringBar() {
      // a wide gap with a bar sweeping through it just behind: pick the side it isn't on
      const s = gapAhead(1.1);
      if (s < 0) return;
      const a = aim(s);
      ringStep(s, a, Math.max(gapHW() * 1.3, 0.44));
      if (s + 3.5 > G.limit) return;
      ob('bar', s + 3.5, { k: 2, a0: rand(0, TAU), rot: sign() * lerp(0.7, 1.3, difficulty(s)), bhw: BAR_HW });
      G.s = s + 3.5;
    },
    cage() {
      // a ring, then an iris breathing in line with its gap
      const s = gapAhead(1.05);
      if (s < 0) return;
      const a = aim(s);
      ringStep(s, a, gapHW() * 1.1);
      if (s + 5 > G.limit) return;
      const gmin = CW + 0.08;
      ob('iris', s + 5, { k: 2, a0: a, rot: 0, gmin, gmax: gmin + 0.32, w: rand(2.6, 3.4), ph: rand(0, TAU) });
      G.s = s + 5;
    },
    corkscrew() {
      const dir = sign(), hw = gapHW() * 0.95;
      let s = gapAhead();
      if (s < 0) return;
      ringStep(s, aim(s), hw);
      for (let i = irand(5, 7); i > 0; i--) {
        s = gapAhead(0.5);
        if (s < 0) return;
        ringStep(s, G.ang + dir * 0.85 * reach(s - G.s), hw);
      }
    },
    counter() {
      const s = gapAhead(1.1);
      if (s < 0) return;
      const sp = lerp(0.9, 1.7, difficulty(s));
      spiralTo(s, sign() * Math.min(1, reach(s - G.s) * 0.7));
      ob('bar', s, { k: 2, a0: rand(0, TAU), rot: sp, bhw: BAR_HW });
      if (s + 4 <= G.limit) ob('bar', s + 4, { k: 2, a0: rand(0, TAU), rot: -sp, bhw: BAR_HW });
      G.s = s + 4; G.free = true;
    },
    turning() {
      // rings with two opposite gaps, turning: from either gap the next one is in reach
      const rot = sign() * lerp(0.5, 1.0, difficulty(G.s));
      for (let i = irand(2, 3); i > 0; i--) {
        const s = gapAhead(1.05);
        if (s < 0) break;
        const a = aim(s, 0.8, 0), hw = gapHW() * 1.05, ta = arrival(s);
        const s0 = G.s, a0 = G.free ? a : G.ang;
        ob('ring', s, { gaps: ringGaps([[a - rot * ta, hw], [a + Math.PI - rot * ta, hw]]), rot });
        if (!G.free) trail(s0 + 3, s - 2, a0, a, 0.8);
        G.s = s; G.ang = a; G.free = false;
      }
      G.free = true;
    },
    gauntlet() { P.single(); if (barStep(0.85)) irisStep(1); },
  };

  function pickPattern(n) {
    let total = 0;
    for (const [name, first, w] of PATTERNS) if (first <= n && name !== G.last) total += w * (first === n ? 2 : 1);
    let r = Math.random() * total;
    for (const [name, first, w] of PATTERNS) {
      if (first > n || name === G.last) continue;
      r -= w * (first === n ? 2 : 1);
      if (r <= 0) return name;
    }
    return 'single';
  }

  function breather(n) {
    // clear tube either side of the section gate, a lazy line of shards, sometimes a shield
    const B = n * SECTION;
    portals.push({ s: B, sec: n, done: false });
    const a0 = G.free ? rand(0, TAU) : G.ang, a1 = a0 + rand(-0.8, 0.8);
    const s0 = Math.max(G.s + 4, B - BREATH_IN + 6), s1 = B + BREATH_OUT - 14;
    trail(s0, s1, a0, a1, 0.7);
    if (n >= 1 && !shield && !pickups.some((p) => !p.done) && Math.random() < 0.5) {
      pickups.push({ s: B + 45, a: wrapA(a0 + angDiff(a1, a0) * ((B + 45 - s0) / (s1 - s0))), done: false, spin: 0 });
    }
    G.s = B + BREATH_OUT; G.ang = a1; G.free = true; G.intro = n;
  }

  function generate() {
    let guard = 0;
    while (G.s < dist + GEN_AHEAD && guard++ < 40) {
      const n = Math.floor(G.s / SECTION);
      const limit = (n + 1) * SECTION - BREATH_IN;
      if (G.s >= limit - 8) { breather(n + 1); continue; }
      G.limit = limit;
      const before = G.s;
      const name = G.intro >= 0 && G.intro < INTRO_PATTERN.length ? INTRO_PATTERN[G.intro] : pickPattern(n);
      G.intro = -1;
      G.last = name;
      P[name]();
      if (G.s === before) G.s = limit; // no room for this chunk: straight on to the breather
    }
    if (shardsDirty) { shards.sort((a, b) => a.s - b.s); shardsDirty = false; }
  }

  // ---------------------------------------------------------- run events
  function craftPos() {
    const k = F / ZC, sa = HALF_PI - angDiff(craftA, camA);
    CP.a = sa;
    CP.x = VX + Math.cos(sa) * HOVER * k;
    CP.y = VY - CAM_OFF * k + Math.sin(sa) * HOVER * k;
  }

  function startPhase() {
    phasing = true;
    sfx.phaseOn();
    burst(CP.x, CP.y, 14, shardIx(themeI), 200, 520, 0.2, 0.45, 1, 0);
  }
  function endPhase() {
    phasing = false;
    tail = 0.16; // a short fade-out, so letting go inside a wall isn't instant death
    // ran dry: let go and press again to phase (no stutter as shards trickle back in)
    if (meter <= 0) { meter = 0; armed = false; sfx.empty(); } else sfx.phaseOff();
  }

  function gotShard(sh) {
    sh.got = true;
    chain++;
    got++;
    if (chain > maxChain) maxChain = chain;
    const pts = SHARD_PTS * chainMult() * (sh.gold ? 3 : 1);
    score += pts;
    meter = Math.min(1, meter + SHARD_FILL * (sh.gold ? 2 : 1));
    if (meter >= PHASE_MIN) lowWarned = false;
    sfx.shard(panOf(CP.x), sh.gold);
    const c = sh.gold ? PI_GOLD : shardIx(themeI);
    part(CP.x, CP.y - 30, 0, 0, 0.2, 46, c, 1);
    burst(CP.x, CP.y - 30, 5, c, 120, 360, 0.15, 0.35, 1, 0);
    if (chain % 10 === 0) {
      popup(chain >= 40 ? `CHAIN ${chain}  ·  ×5` : `CHAIN ${chain}  ·  ×${chainMult()}`, PAL[shardIx(themeI)], 34);
      sfx.chainUp();
    } else if (sh.gold) popup(`+${pts}`, '#ffd27a', 26);
  }
  function missShard(sh) {
    if (sh.gold) return; // gold is bait: optional
    if (chain >= 5) { popup('CHAIN LOST', 'rgba(255,140,160,0.95)', 24, 40); sfx.miss(); }
    chain = 0;
  }

  function graze(o) {
    grazes++;
    const pts = Math.round(GRAZE_PTS * speedMult(spdBase(dist)));
    score += pts;
    meter = Math.min(1, meter + GRAZE_FILL);
    const side = o.side || 1;
    const ux = Math.cos(CP.a - HALF_PI), uy = Math.sin(CP.a - HALF_PI);
    const wx = CP.x + ux * side * 56 * (F / F0), wy = CP.y + uy * side * 56 * (F / F0);
    for (let i = 0; i < 16; i++) {
      const a = CP.a + rand(-0.9, 0.9) + side * 0.5, s = rand(300, 900);
      part(wx, wy, Math.cos(a) * s + ux * side * 200, Math.sin(a) * s + uy * side * 200, rand(0.15, 0.35), rand(1.5, 3), i % 3 ? PI_GOLD : PI_WHITE, 0);
    }
    part(wx, wy, 0, 0, 0.18, 60, PI_GOLD, 1);
    popup(`GRAZE  +${pts}`, '#ffe08a', 28);
    sfx.graze(clamp(panOf(wx) + side * 0.3, -0.9, 0.9));
  }

  function judge(o) {
    o.done = true;
    if (o.phased) {
      if (phasing || tail > 0) { popup('PHASED', PAL[shardIx(themeI)], 24, 30); sfx.phased(); }
      return;
    }
    if (!o.ghost && o.minClear >= 0 && o.minClear < GRAZE) graze(o);
    else if (o.minClear < 0.45) sfx.whoosh(clamp(o.side * 0.6, -0.8, 0.8));
  }

  function breakShield(o) {
    shield = false;
    shieldInv = 1.0;
    o.phased = true;
    o.flash = 1;
    shake = Math.max(shake, 10);
    flash = 0.35; flashRGB = '160,220,255';
    burst(CP.x, CP.y, 26, PI_ICE, 200, 700, 0.3, 0.7, 2, 0);
    for (let i = 0; i < 10; i++) { const a = rand(0, TAU), s = rand(200, 520); part(CP.x, CP.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.5, 0.9), rand(8, 14), PI_ICE, 3, rand(0, TAU), rand(-12, 12)); }
    part(CP.x, CP.y, 520, 0, 0.45, 40, PI_ICE, 2);
    popup('SHIELD BROKEN', '#bfe9ff', 30);
    sfx.shieldBreak();
  }

  function crash(o) {
    mode = 'crash';
    crashT = 0;
    crashDist = dist;
    o.flash = 1;
    if (phasing) phasing = false;
    shake = 26;
    flash = 0.85; flashRGB = THEMES[themeI].cH.join(',');
    const hi = hotIx(themeI);
    burst(CP.x, CP.y, 44, hi, 300, 1300, 0.35, 0.9, 3, 0);
    burst(CP.x, CP.y, 26, PI_WHITE, 200, 900, 0.25, 0.6, 2, 0);
    burst(CP.x, CP.y, 18, tubeIx(themeI), 60, 420, 0.4, 1.0, 24, 1);
    for (let i = 0; i < 18; i++) {
      const a = rand(0, TAU), s = rand(150, 700);
      part(CP.x, CP.y, Math.cos(a) * s, Math.sin(a) * s - 120, rand(0.8, 1.5), rand(8, 20), i % 3 ? hi : PI_WHITE, 3, rand(0, TAU), rand(-14, 14));
    }
    part(CP.x, CP.y, 0, 0, 0.5, 260, PI_WHITE, 1);
    part(CP.x, CP.y, 0, 0, 0.7, 380, hi, 1);
    part(CP.x, CP.y, 900, 0, 0.6, 30, PI_WHITE, 2);
    part(CP.x, CP.y, 560, 0, 0.9, 20, hi, 2);
    sfx.crash(panOf(CP.x));
  }

  function enterSection(n) {
    sec = n;
    themeFromI = themeI;
    themeI = n % THEMES.length;
    themeT = 0;
    const th = THEMES[themeI];
    banner = { title: `SECTION ${n + 1}`, sub: `${th.name.toUpperCase()}  ·  ${(n * SECTION).toLocaleString()} M`, note: introOf(n), t: 0, dur: 3.4 };
    flash = Math.max(flash, 0.3); flashRGB = th.cT.join(',');
    const k = F / ZC;
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU;
      const x = VX + Math.cos(a) * R * k * 0.9, y = VY - CAM_OFF * k + Math.sin(a) * R * k * 0.9;
      part(x, y, Math.cos(a) * 500, Math.sin(a) * 500, rand(0.3, 0.6), 2, tubeIx(themeI), 0);
    }
    sfx.section();
  }

  // ---------------------------------------------------------- update
  function run(dt) {
    // steering: quick to respond, quicker still to stop, so you can tuck into a gap
    const target = clamp(api.input.move.x, -1, 1) * OMEGA;
    const k = Math.abs(target) > Math.abs(angV) && Math.sign(target) === Math.sign(angV || target) ? 13 : 20;
    angV += (target - angV) * Math.min(1, dt * k);
    prevA = craftA;
    craftA = wrapA(craftA + angV * dt);
    // the camera follows with a little lag, so the craft visibly swings into its turns
    camA = wrapA(camA + angDiff(craftA, camA) * Math.min(1, dt * 9));
    bank += ((angV / OMEGA) * 0.32 - bank) * Math.min(1, dt * 10);

    // phase: needs a fresh press (an A still held from the menu doesn't count)
    const held = api.input.down('a');
    if (!held) armed = true;
    if (held && armed && !phasing) {
      if (meter >= PHASE_MIN) startPhase();
      else if (api.input.pressed('a')) sfx.empty();
    }
    if (phasing) {
      meter -= DRAIN * dt;
      if (!held || meter <= 0) endPhase();
    }
    tail = Math.max(0, tail - dt);
    shieldInv = Math.max(0, shieldInv - dt);
    boost += ((phasing ? 1 : 0) - boost) * Math.min(1, dt * (phasing ? 7 : 3));

    // speed and distance (phasing surges you forward)
    const base = spdBase(dist);
    spd = base * (1 + 0.24 * boost);
    prevDist = dist;
    dist += spd * dt;
    score += (dist - prevDist) * DIST_PTS * speedMult(base);
    // FOV kick: the focal length shrinks with speed and with the phase surge
    F += (F0 * (1 - 0.13 * boost - 0.06 * clamp((base - SPD0) / 20, 0, 1)) - F) * Math.min(1, dt * 5);
    craftPos();

    generate();

    // obstacles overlapping the craft this frame (sorted by s, so stop at the first one ahead)
    const ghost = intangible();
    for (let i = 0; i < obs.length; i++) {
      const o = obs[i];
      if (o.done) continue;
      if (o.s - TH / 2 - CL / 2 > dist) break;
      const hi = o.s + TH / 2 + CL / 2;
      if (hi >= prevDist) {
        const c = clearance(o, craftA, T);
        if (c < o.minClear) { o.minClear = c; o.side = clrSide; }
        if (ghost || shieldInv > 0) o.ghost = true;
        if (c < 0) {
          if (ghost) o.phased = true;
          else if (shield) breakShield(o);
          else { crash(o); return; }
        }
      }
      if (hi <= dist) judge(o);
    }

    // shards and pickups crossing the craft's depth: judged where the craft was at that instant
    const span = dist - prevDist || 1;
    const turn = angDiff(craftA, prevA);
    for (let i = 0; i < shards.length; i++) {
      const sh = shards[i];
      if (sh.s > dist) break;
      if (sh.done) continue;
      sh.done = true;
      const a = prevA + turn * clamp((sh.s - prevDist) / span, 0, 1);
      if (Math.abs(angDiff(a, sh.a)) < SHARD_HIT) gotShard(sh); else missShard(sh);
    }
    for (const p of pickups) {
      if (p.done || p.s > dist) continue;
      p.done = true;
      if (Math.abs(angDiff(craftA, p.a)) < SHARD_HIT + 0.05) {
        shield = true;
        popup('SHIELD', '#bfe9ff', 34);
        sfx.shield();
        part(CP.x, CP.y, 0, 0, 0.35, 120, PI_ICE, 1);
        burst(CP.x, CP.y, 16, PI_ICE, 150, 450, 0.2, 0.5, 1, 0);
      }
    }
    for (const p of portals) if (!p.done && p.s <= dist) { p.done = true; enterSection(p.sec); }

    // shutter gates lock (and say so) a second before they arrive
    for (const o of obs) {
      if (o.kind !== 'shutter' || o.locked || o.s < dist) continue;
      if ((o.s - dist) / spd > LOCK_T) continue;
      const v = shutterOpen(o, T);
      o.locked = true; o.lockFrom = v; o.lockTo = v >= 0.5 ? 1 : 0; o.lockAt = T; o.flash = 1;
      sfx.lock(0);
    }

    if (meter < PHASE_MIN && !lowWarned && T > 3) { lowWarned = true; popup('SHARDS REFILL PHASE', PAL[shardIx(themeI)], 22, 60); }

    // engine exhaust: sparks spill back toward the camera
    emitAcc += dt * (40 + boost * 110);
    const ux = Math.cos(CP.a), uy = Math.sin(CP.a);
    while (emitAcc >= 1) {
      emitAcc--;
      const side = Math.random() < 0.5 ? -1 : 1, kf = F / F0;
      const ex = CP.x + Math.cos(CP.a - HALF_PI) * side * 12 * kf + ux * 14 * kf, ey = CP.y + Math.sin(CP.a - HALF_PI) * side * 12 * kf + uy * 14 * kf;
      const s = rand(260, 520) * (1 + boost);
      part(ex, ey, ux * s + rand(-60, 60), uy * s + rand(-60, 60), rand(0.12, 0.26), rand(1.2, 2.2), phasing ? shardIx(themeI) : tubeIx(themeI), 0);
    }

    // drop what's behind the camera
    const behind = dist - ZC - TH;
    trim(obs, behind);
    trim(shards, behind);
    trim(portals, behind);
    trim(pickups, behind);
  }

  function trim(arr, behind) {
    let k = 0;
    while (k < arr.length && arr[k].done && arr[k].s < behind) k++;
    if (k) arr.splice(0, k);
  }

  function crashStep(dt) {
    crashT += dt;
    spd *= Math.exp(-dt * 3.2); // the world coasts to a stop
    prevDist = dist;
    dist += spd * dt;
    F += (F0 * 1.05 - F) * Math.min(1, dt * 2);
    boost += (0 - boost) * Math.min(1, dt * 3);
    trim(obs, dist - ZC - TH);
    if (crashT > 1.9 && !overSent) {
      overSent = true;
      const r = result();
      api.gameOver({
        score: r.score, stats: r.stats,
        title: `Run over · ${r.stats.distance.toLocaleString()} m`,
        message: `Section ${sec + 1}  ·  ${grazes} graze${grazes === 1 ? '' : 's'}  ·  best chain ${maxChain}`,
      });
    }
  }

  function fx(dt) {
    // particles
    const drag = Math.exp(-dt * 2.6);
    for (let i = 0; i < pn;) {
      pl[i] -= dt;
      if (pl[i] <= 0) {
        pn--;
        px[i] = px[pn]; py[i] = py[pn]; pvx[i] = pvx[pn]; pvy[i] = pvy[pn]; pl[i] = pl[pn]; pm[i] = pm[pn];
        ps[i] = ps[pn]; pc[i] = pc[pn]; pk[i] = pk[pn]; pr[i] = pr[pn]; pvr[i] = pvr[pn];
        continue;
      }
      if (pk[i] !== 2) {
        px[i] += pvx[i] * dt; py[i] += pvy[i] * dt;
        pvx[i] *= drag; pvy[i] *= drag;
        if (pk[i] === 3) { pr[i] += pvr[i] * dt; pvy[i] += 500 * dt; }
      }
      i++;
    }
    for (let i = pops.length - 1; i >= 0; i--) { const p = pops[i]; p.t += dt; p.y -= 60 * dt; if (p.t > p.life) pops.splice(i, 1); }
    if (banner) { banner.t += dt; if (banner.t > banner.dur) banner = null; }
    for (const o of obs) if (o.flash > 0) o.flash = Math.max(0, o.flash - dt * 3);
    themeT = Math.min(1, themeT + dt / 1.6);
    shake = Math.max(0, shake - dt * 34);
    shx = shake ? Math.sin(T * 91) * shake * 0.6 : 0;
    shy = shake ? Math.cos(T * 73) * shake * 0.6 : 0;
    flash = Math.max(0, flash - dt * 1.6);
    // recycle streaks that went behind the camera
    for (let i = 0; i < STREAKS; i++) if (stS[i] - dist + ZC < ZNEAR) { stS[i] = dist + rand(14, ZFAR * 0.7); stA[i] = rand(0, TAU); }
  }

  function update(dt) {
    T += dt;
    if (mode === 'run') run(dt);
    else crashStep(dt);
    fx(dt);
  }

  // ---------------------------------------------------------- draw
  const fogAt = (z) => Math.pow(clamp(1 - z / ZFAR, 0, 1), 1.4);

  function blendColors() {
    const a = THEMES[themeFromI], b = THEMES[themeI], t = themeT;
    const tc = mixRGB(a.cT, b.cT, t), hc = mixRGB(a.cH, b.cH, t), sc = mixRGB(a.cS, b.cS, t);
    col.tc = tc; col.tcHi = mixRGB(tc, WHITE, 0.5);
    col.tube = css(tc); col.tubeHi = css(tc, 1, 0.5);
    col.hot = css(hc); col.hotDark = css(hc, 1, 0.62, 0); col.hotEdge = css(hc, 1, 0.65);
    col.shard = css(sc); col.shardHi = css(sc, 1, 0.6);
  }

  function drawTube(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let j = 0; j < LINES; j++) { const a = HALF_PI - ((j * TAU) / LINES - camA); LC[j] = Math.cos(a); LS[j] = Math.sin(a); }
    const beat = 0.85 + 0.15 * Math.sin(T * 7.5);
    // wall panels: every other strip between lengthwise lines is faintly lit. Each strip is a
    // wedge from the vanishing point, so all of them together are one cheap fill.
    const kn = F / ZNEAR, kf = F / 80;
    ctx.fillStyle = col.tube;
    ctx.globalAlpha = 0.05 * beat;
    ctx.beginPath();
    for (let j = 0; j < LINES; j += 2) {
      const j2 = j + 1;
      ctx.moveTo(VX + LC[j] * R * kf, VY + (LS[j] * R - CAM_OFF) * kf);
      ctx.lineTo(VX + LC[j] * R * kn, VY + (LS[j] * R - CAM_OFF) * kn);
      ctx.lineTo(VX + LC[j2] * R * kn, VY + (LS[j2] * R - CAM_OFF) * kn);
      ctx.lineTo(VX + LC[j2] * R * kf, VY + (LS[j2] * R - CAM_OFF) * kf);
      ctx.closePath();
    }
    ctx.fill();
    // lengthwise lines: straight spokes through the vanishing point. Distance from it stands in
    // for depth, so a radial gradient fades them into the fog and each set is a single stroke.
    for (let pass = 0; pass < 2; pass++) {
      const c = pass ? col.tcHi : col.tc;
      const gr = ctx.createRadialGradient(VX, VY, 0, VX, VY, 1150);
      gr.addColorStop(0, css(c, 0)); gr.addColorStop(0.03, css(c, 0.15)); gr.addColorStop(0.08, css(c, 0.4));
      gr.addColorStop(0.23, css(c, 0.75)); gr.addColorStop(0.5, css(c, 1));
      ctx.strokeStyle = gr;
      ctx.globalAlpha = (pass ? 0.75 : 0.36) * beat;
      ctx.lineWidth = pass ? 3 : 1.5;
      ctx.beginPath();
      for (let j = pass ? 0 : 1; j < LINES; j += pass ? 4 : 1) {
        if (!pass && j % 4 === 0) continue;
        ctx.moveTo(VX + LC[j] * R * kn, VY + (LS[j] * R - CAM_OFF) * kn);
        ctx.lineTo(VX + LC[j] * R * kf, VY + (LS[j] * R - CAM_OFF) * kf);
      }
      ctx.stroke();
    }
    // rings: a beat, a pulse racing away down the tube, and a bright rib every 40 m
    const first = Math.ceil((dist - ZC + ZNEAR) / RING_DZ);
    const last = Math.floor((dist - ZC + ZFAR) / RING_DZ);
    const waveAt = (z) => Math.pow(Math.max(0, Math.cos(z * 0.13 - T * 4.2)), 12);
    ctx.strokeStyle = col.tube;
    ctx.fillStyle = col.tube;
    for (let k = last; k >= first; k--) {
      const z = k * RING_DZ - dist + ZC;
      const fog = fogAt(z);
      if (fog < 0.01) continue;
      const wave = waveAt(z);
      const kz = F / z, cy = VY - CAM_OFF * kz, rr = R * kz;
      if (wave > 0.08 && z - RING_DZ > 1.6) {
        // the pulse lights the whole band up to the next ring out (not the nearest bands:
        // they're bigger than the screen and their rings already carry the pulse)
        const k2 = F / (z - RING_DZ);
        ctx.globalAlpha = fog * wave * 0.09;
        ctx.beginPath();
        ctx.arc(VX, VY - CAM_OFF * k2, R * k2, 0, TAU);
        ctx.arc(VX, cy, rr, TAU, 0, true);
        ctx.fill();
      }
      if (((k % 16) + 16) % 16 === 0) {
        ctx.beginPath(); ctx.arc(VX, cy, rr, 0, TAU);
        ctx.globalAlpha = fog * 0.16;
        ctx.lineWidth = clamp(0.32 * kz, 2, 60);
        ctx.stroke();
        ctx.strokeStyle = col.tubeHi;
        ctx.globalAlpha = fog * 0.7;
        ctx.lineWidth = clamp(0.03 * kz, 1, 5);
        ctx.stroke();
        ctx.strokeStyle = col.tube;
      }
    }
    // The rings themselves, batched: additive blending doesn't care about order, so rings in
    // the same depth band share one stroke (ten strokes instead of fifty).
    for (let b = 0; b < RING_BANDS.length - 1; b++) {
      const z0 = RING_BANDS[b], z1 = RING_BANDS[b + 1], zm = (z0 + z1) / 2, km = F / zm;
      const k0 = Math.ceil((dist - ZC + z0) / RING_DZ);
      for (let major = 0; major < 2; major++) {
        let n = 0;
        ctx.beginPath();
        for (let k = k0; ; k++) {
          const z = k * RING_DZ - dist + ZC;
          if (z >= z1) break;
          if ((((k % 4) + 4) % 4 === 0) !== (major === 1)) continue;
          const kz = F / z, cy = VY - CAM_OFF * kz;
          ctx.moveTo(VX + R * kz, cy);
          ctx.arc(VX, cy, R * kz, 0, TAU);
          n++;
        }
        if (!n) continue;
        ctx.globalAlpha = fogAt(zm) * (major ? 0.55 : 0.22) * beat;
        ctx.lineWidth = clamp((major ? 0.05 : 0.025) * km, 0.6, 10);
        ctx.stroke();
      }
    }
    // the pulse brightens the rings it passes
    ctx.beginPath();
    for (let k = last; k >= first; k--) {
      const z = k * RING_DZ - dist + ZC;
      if (waveAt(z) < 0.3) continue;
      const kz = F / z, cy = VY - CAM_OFF * kz;
      ctx.moveTo(VX + R * kz, cy);
      ctx.arc(VX, cy, R * kz, 0, TAU);
    }
    ctx.globalAlpha = 0.35 * beat;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // a soft core glow where the tube vanishes
    ctx.globalAlpha = 0.32 + 0.1 * Math.sin(T * 2.2);
    const cg = bigGlow(tubeIx(themeI)), cs = 170;
    ctx.drawImage(cg, VX - cs, VY - cs, cs * 2, cs * 2);
    // motion streaks along the wall
    const len = 0.5 + spd * 0.07 + boost * 3.5;
    ctx.strokeStyle = boost > 0.3 ? col.shardHi : '#ffffff';
    ctx.globalAlpha = 0.26 + boost * 0.4;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    for (let i = 0; i < STREAKS; i++) {
      const z = stS[i] - dist + ZC;
      if (z < ZNEAR) continue;
      const a = HALF_PI - (stA[i] - camA), c = Math.cos(a), s = Math.sin(a), rr = R * 0.97;
      const k1 = F / z, k2 = F / (z + len);
      ctx.moveTo(VX + c * rr * k1, VY + (s * rr - CAM_OFF) * k1);
      ctx.lineTo(VX + c * rr * k2, VY + (s * rr - CAM_OFF) * k2);
    }
    ctx.stroke();
    ctx.restore();
  }

  function finsAt(ctx, n, cy, k) {
    // the solid parts of a gap-type obstacle: everything between consecutive gaps
    const ro = R * k, ri = (R - FIN) * k;
    if (n === 0) { finPath(ctx, VX, cy, ro, ri, 0, TAU, camA); return; }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const from = SH[i * 2] + SH[i * 2 + 1];
      const to = SH[j * 2] + (j === 0 ? TAU : 0) - SH[j * 2 + 1];
      if (to - from > 0.002) finPath(ctx, VX, cy, ro, ri, from, to, camA);
    }
  }
  function spokesAt(ctx, n, cy, k) {
    const ew = BAR_HW * R * k, hw = ew * 0.55;
    for (let i = 0; i < n; i++) {
      const sa = HALF_PI - (SH[i * 2] - camA), ux = Math.cos(sa), uy = Math.sin(sa);
      const ex = VX + ux * R * k, ey = cy + uy * R * k;
      ctx.moveTo(VX - uy * hw, cy + ux * hw);
      ctx.lineTo(ex - uy * ew, ey + ux * ew);
      ctx.lineTo(ex + uy * ew, ey - ux * ew);
      ctx.lineTo(VX + uy * hw, cy - ux * hw);
      ctx.closePath();
    }
  }

  function drawObstacle(ctx, o, z) {
    const a = fogAt(z) * (z < ZC ? 0.55 * clamp((z - ZNEAR) / (ZC - ZNEAR), 0, 1) : 1);
    if (a < 0.01) return;
    const n = shape(o, T);
    const bar = !shGaps;
    const k1 = F / z, k2 = F / (z + TH);
    const c1 = VY - CAM_OFF * k1, c2 = VY - CAM_OFF * k2;
    const far = z > 40; // a few pixels across: the front face and its edge are enough
    ctx.globalCompositeOperation = 'source-over';
    if (!far) {
      // back face (its sliver above the front face reads as the fin's top)
      ctx.globalAlpha = a;
      ctx.fillStyle = col.hotDark;
      ctx.beginPath();
      if (bar) spokesAt(ctx, n, c2, k2); else finsAt(ctx, n, c2, k2);
      ctx.fill();
    }
    // front face
    ctx.beginPath();
    if (bar) spokesAt(ctx, n, c1, k1); else finsAt(ctx, n, c1, k1);
    ctx.fillStyle = col.hot;
    ctx.globalAlpha = a * 0.9;
    ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    if (!far) {
      ctx.globalAlpha = a * 0.28;
      ctx.strokeStyle = col.hot;
      ctx.lineWidth = clamp(0.2 * k1, 2, 34);
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.strokeStyle = col.hotEdge;
    ctx.lineWidth = clamp(0.03 * k1, 1, 4);
    ctx.stroke();
    if (o.flash > 0) { ctx.globalAlpha = a * o.flash * 0.8; ctx.fillStyle = '#ffffff'; ctx.fill(); }
    if (bar) {
      // the hub
      ctx.globalAlpha = a;
      ctx.drawImage(GL[hotIx(themeI)], VX - 0.9 * k1, c1 - 0.9 * k1, 1.8 * k1, 1.8 * k1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = col.hotEdge;
      ctx.beginPath(); ctx.arc(VX, c1, 0.3 * k1, 0, TAU); ctx.fill();
    } else if (o.kind === 'iris') {
      // glowing teeth at the gap edges breathe with the gate
      const sz = 0.45 * k1, ri = (R - FIN * 0.5) * k1;
      ctx.globalAlpha = a * 0.9;
      for (let i = 0; i < n; i++) {
        for (let e = -1; e <= 1; e += 2) {
          const sa = HALF_PI - (SH[i * 2] + e * SH[i * 2 + 1] - camA);
          ctx.drawImage(GL[PI_WHITE], VX + Math.cos(sa) * ri - sz, c1 + Math.sin(sa) * ri - sz, sz * 2, sz * 2);
        }
      }
    } else if (o.kind === 'shutter') {
      // door frames: thin lines over every doorway, bright on the set that's open
      const oa = shutterOpen(o, T), rr = (R - FIN - 0.08) * k1;
      ctx.lineWidth = clamp(0.06 * k1, 1, 8);
      for (let j = 0; j < o.k * 2; j++) {
        const open = j % 2 ? 1 - oa : oa;
        const c = o.a0 + o.rot * T + (j * Math.PI) / o.k, hw = o.ghw;
        const s0 = HALF_PI - (c + hw - camA);
        ctx.globalAlpha = a * (0.25 + 0.75 * open) * (o.locked ? 1 : 0.7);
        ctx.strokeStyle = open > 0.5 ? (o.locked ? '#ffffff' : col.tubeHi) : col.hot;
        ctx.beginPath(); ctx.arc(VX, c1, rr, s0, s0 + hw * 2); ctx.stroke();
      }
    }
    // left additive: shards, pickups and portals (drawn between obstacles) all want it
  }

  function drawShard(ctx, sh, z) {
    if (sh.got) return;
    const a = fogAt(z) * (z < ZC ? clamp((z - ZNEAR) / (ZC - ZNEAR), 0, 1) * 0.6 : 1) * (sh.done ? 0.4 : 1);
    if (a < 0.02) return;
    const k = F / z, sa = HALF_PI - (sh.a - camA);
    const x = VX + Math.cos(sa) * SHARD_R * k, y = VY + (Math.sin(sa) * SHARD_R - CAM_OFF) * k;
    const sz = Math.max(1, 0.17 * k);
    // all additive (a halo and a bright spinning crystal), so runs of shards need no mode switches
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * 0.75;
    ctx.drawImage(GL[sh.gold ? PI_GOLD : shardIx(themeI)], x - sz * 3, y - sz * 3, sz * 6, sz * 6);
    ctx.globalAlpha = a;
    const wf = 0.3 + 0.7 * Math.abs(Math.cos(sh.spin + T * 4));
    ctx.beginPath();
    ctx.moveTo(x, y - sz); ctx.lineTo(x + sz * 0.62 * wf, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz * 0.62 * wf, y);
    ctx.closePath();
    ctx.fillStyle = sh.gold ? '#ffe9a8' : col.shardHi;
    ctx.fill();
  }

  function drawPickup(ctx, p, z) {
    if (p.done) return;
    const a = fogAt(z);
    const k = F / z, sa = HALF_PI - (p.a - camA);
    const x = VX + Math.cos(sa) * SHARD_R * k, y = VY + (Math.sin(sa) * SHARD_R - CAM_OFF) * k;
    const sz = Math.max(1.5, 0.3 * k);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * (0.7 + 0.3 * Math.sin(T * 6));
    ctx.drawImage(GL[PI_ICE], x - sz * 3.5, y - sz * 3.5, sz * 7, sz * 7);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const t = T * 1.5 + (i * TAU) / 6; const X = x + Math.cos(t) * sz, Y = y + Math.sin(t) * sz; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(190,233,255,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#e6f7ff';
    ctx.lineWidth = Math.max(1, sz * 0.14);
    ctx.stroke();
  }

  function drawPortal(ctx, p, z) {
    const a = fogAt(z) * (z < ZC ? clamp((z - ZNEAR) / (ZC - ZNEAR), 0, 1) : 1);
    if (a < 0.01) return;
    const k = F / z, cy = VY - CAM_OFF * k, rr = (R - 0.08) * k;
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = THEMES[p.sec % THEMES.length].tube;
    ctx.globalAlpha = a * 0.35;
    ctx.lineWidth = clamp(0.8 * k, 3, 90);
    ctx.beginPath(); ctx.arc(VX, cy, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = a * 0.9;
    ctx.lineWidth = clamp(0.1 * k, 1.5, 12);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }

  // Everything in the tube, far to near, so nearer things cover farther ones. The far pass stops
  // at the craft's depth; the near pass draws what's between the craft and the camera.
  function drawWorld(ctx, near) {
    const zLo = near ? ZNEAR : ZC, zHi = near ? ZC : ZFAR;
    let io = obs.length - 1, is = shards.length - 1, ip = pickups.length - 1, iq = portals.length - 1;
    for (;;) {
      const so = io >= 0 ? obs[io].s : -1e9, ss = is >= 0 ? shards[is].s : -1e9;
      const sp = ip >= 0 ? pickups[ip].s : -1e9, sq = iq >= 0 ? portals[iq].s : -1e9;
      const s = Math.max(so, ss, sp, sq);
      if (s === -1e9) break;
      const z = s - dist + ZC;
      if (z < zLo) break;
      const draw = z < zHi;
      if (s === so) { if (draw) drawObstacle(ctx, obs[io], z); io--; }
      else if (s === ss) { if (draw) drawShard(ctx, shards[is], z); is--; }
      else if (s === sp) { if (draw) drawPickup(ctx, pickups[ip], z); ip--; }
      else { if (draw) drawPortal(ctx, portals[iq], z); iq--; }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawCraft(ctx) {
    if (mode !== 'run') return;
    const kf = F / F0;
    const ghost = phasing || tail > 0;
    ctx.save();
    // light pooled on the wall under the craft
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    const g = bigGlow(tubeIx(themeI)), gs = 110 * kf;
    ctx.drawImage(g, CP.x - gs, CP.y - gs * 0.5 + 18 * kf, gs * 2, gs);
    ctx.translate(CP.x, CP.y);
    ctx.rotate(CP.a - HALF_PI + bank);
    ctx.scale(kf, kf);
    // engines
    const flick = 0.8 + 0.2 * Math.sin(T * 47);
    ctx.globalAlpha = 0.9 * flick;
    for (const ex of [-12, 12]) ctx.drawImage(GL[ghost ? shardIx(themeI) : tubeIx(themeI)], ex - 22, 0, 44, 44);
    ctx.globalAlpha = 1;
    ctx.drawImage(GL[PI_WHITE], -26, 2, 20, 20);
    ctx.drawImage(GL[PI_WHITE], 6, 2, 20, 20);
    if (ghost) {
      // phased: a translucent body with a chromatic double
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = 'rgba(255,60,170,0.6)';
      ctx.beginPath(); polyPath(ctx, CRAFT, 1, -5, 0); ctx.fill();
      ctx.fillStyle = 'rgba(60,200,255,0.6)';
      ctx.beginPath(); polyPath(ctx, CRAFT, 1, 5, 0); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.5;
    } else ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath(); polyPath(ctx, CRAFT);
    ctx.fillStyle = '#140a26';
    ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ghost ? col.shardHi : col.tubeHi;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.globalAlpha = ghost ? 0.6 : 1;
    ctx.beginPath(); polyPath(ctx, CANOPY);
    ctx.fillStyle = ghost ? col.shardHi : '#f2ecff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-50, 5); ctx.lineTo(-20, 8); ctx.moveTo(50, 5); ctx.lineTo(20, 8); ctx.stroke();
    if (shield || shieldInv > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = shield ? 0.55 + 0.25 * Math.sin(T * 5) : (Math.sin(T * 40) > 0 ? 0.5 : 0.15);
      ctx.strokeStyle = '#bfe9ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const t = (i * TAU) / 6 + T * 0.8; const X = Math.cos(t) * 74, Y = -8 + Math.sin(t) * 50; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawParticles(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < pn; i++) {
      const f = pl[i] / pm[i];
      const k = pk[i];
      if (k === 0) {
        ctx.globalAlpha = f;
        ctx.strokeStyle = PAL[pc[i]];
        ctx.lineWidth = ps[i];
        ctx.beginPath();
        ctx.moveTo(px[i], py[i]);
        ctx.lineTo(px[i] - pvx[i] * 0.035, py[i] - pvy[i] * 0.035);
        ctx.stroke();
      } else if (k === 1) {
        ctx.globalAlpha = f;
        const s = ps[i] * (0.6 + 0.4 * f);
        ctx.drawImage(GL[pc[i]], px[i] - s, py[i] - s, s * 2, s * 2);
      } else if (k === 2) {
        // expanding ring: radius only ever grows from its (non-negative) start
        ctx.globalAlpha = f;
        ctx.strokeStyle = PAL[pc[i]];
        ctx.lineWidth = 2 + 10 * f;
        ctx.beginPath();
        ctx.arc(px[i], py[i], ps[i] + (pm[i] - pl[i]) * pvx[i], 0, TAU);
        ctx.stroke();
      } else {
        ctx.globalAlpha = Math.min(1, f * 1.5);
        ctx.fillStyle = PAL[pc[i]];
        const s = ps[i], c = Math.cos(pr[i]) * s, n = Math.sin(pr[i]) * s;
        ctx.beginPath();
        ctx.moveTo(px[i] + c, py[i] + n);
        ctx.lineTo(px[i] - n * 0.5 - c * 0.4, py[i] + c * 0.5 - n * 0.4);
        ctx.lineTo(px[i] + n * 0.4 - c * 0.6, py[i] - c * 0.4 - n * 0.6);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawSpeedLines(ctx) {
    // radial streaks at the screen edges while phasing (and faintly at high speed)
    const amt = boost + clamp((spd - 24) / 16, 0, 1) * 0.35;
    if (amt < 0.05) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = boost > 0.3 ? col.shardHi : '#ffffff';
    ctx.lineWidth = 2;
    ctx.globalAlpha = Math.min(0.45, amt * 0.4);
    ctx.beginPath();
    for (let i = 0; i < 44; i++) {
      const a = Math.random() * TAU, r0 = rand(560, 900), l = rand(90, 320) * amt;
      const c = Math.cos(a), s = Math.sin(a);
      ctx.moveTo(VX + c * r0, VY + s * r0 * 0.75);
      ctx.lineTo(VX + c * (r0 + l), VY + s * (r0 + l) * 0.75);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawPops(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pops) {
      const f = p.t / p.life;
      ctx.globalAlpha = f < 0.7 ? 1 : 1 - (f - 0.7) / 0.3;
      const sc = f < 0.12 ? 0.7 + (f / 0.12) * 0.3 : 1;
      ctx.font = `700 ${Math.round(p.size * sc)}px "Segoe UI", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function drawBanner(ctx) {
    if (!banner) return;
    const b = banner, a = Math.min(1, b.t / 0.25, (b.dur - b.t) / 0.5);
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const y = 250 - (1 - Math.min(1, b.t / 0.35)) * 16;
    const g = ctx.createLinearGradient(VX - 620, 0, VX + 620, 0);
    g.addColorStop(0, 'rgba(4,2,12,0)'); g.addColorStop(0.5, 'rgba(4,2,12,0.6)'); g.addColorStop(1, 'rgba(4,2,12,0)');
    ctx.fillStyle = g;
    ctx.fillRect(VX - 620, y - 100, 1240, 210);
    ctx.font = '200 84px "Segoe UI", sans-serif';
    ctx.letterSpacing = '18px';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.title, VX + 9, y);
    ctx.font = '600 26px "Segoe UI", sans-serif';
    ctx.letterSpacing = '7px';
    ctx.fillStyle = col.tubeHi;
    ctx.fillText(b.sub, VX + 3.5, y + 48);
    ctx.letterSpacing = '0px';
    if (b.note) {
      ctx.font = '400 26px "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(b.note, VX, y + 92);
    }
    ctx.restore();
  }

  // first-run hints, timed so you can play without a tutorial
  const HINTS = [
    [2.6, 7.6, 'STEER AROUND THE TUBE', 'Left stick  ·  D-pad  ·  A / D keys'],
    [7.4, 12.6, 'HOLD  A  TO PHASE THROUGH WALLS', 'Space on a keyboard  ·  the meter drains while you phase, shards refill it'],
    [12.4, 17.8, 'DON’T MISS A SHARD', 'An unbroken chain multiplies shard points  ·  skim past edges to graze'],
  ];
  function drawHints(ctx) {
    if (mode !== 'run' || T > 18) return;
    for (const [t0, t1, title, sub] of HINTS) {
      if (T < t0 || T > t1) continue;
      const a = Math.min(1, (T - t0) / 0.4, (t1 - T) / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const g = ctx.createLinearGradient(VX - 560, 0, VX + 560, 0);
      g.addColorStop(0, 'rgba(4,2,12,0)'); g.addColorStop(0.5, 'rgba(4,2,12,0.55)'); g.addColorStop(1, 'rgba(4,2,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(VX - 560, 190, 1120, 112);
      ctx.font = '600 34px "Segoe UI", sans-serif';
      ctx.letterSpacing = '6px';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(title, VX + 3, 238);
      ctx.letterSpacing = '0px';
      ctx.font = '400 22px "Segoe UI", sans-serif';
      ctx.fillStyle = col.tubeHi;
      ctx.fillText(sub, VX, 276);
      ctx.restore();
    }
  }

  function label(ctx, text, x, y, align) {
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.letterSpacing = '4px';
    ctx.textAlign = align;
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }

  function drawPanel(ctx) {
    ctx.save();
    ctx.textBaseline = 'middle';
    // progress to the next section, under the title
    const d = distNow(), into = (d % SECTION) / SECTION;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(48, 74, 250, 4);
    ctx.fillStyle = col.tube;
    ctx.fillRect(48, 74, 250 * into, 4);
    label(ctx, `NEXT  ${THEMES[(sec + 1) % THEMES.length].name.toUpperCase()}  ·  ${Math.ceil(SECTION - (d % SECTION))} M`, 48, 92, 'left');

    // phase meter, bottom centre
    const mw = 420, mh = 10, mx = VX - mw / 2, my = H - 50;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath(); ctx.roundRect(mx, my, mw, mh, mh / 2); ctx.fill();
    const low = meter < PHASE_MIN;
    if (meter > 0.004) {
      ctx.globalAlpha = phasing ? 0.75 + 0.25 * Math.sin(T * 30) : low ? 0.6 + 0.4 * Math.sin(T * 8) : 1;
      ctx.fillStyle = phasing ? '#ffffff' : low ? '#ff5a78' : col.shard;
      ctx.beginPath(); ctx.roundRect(mx, my, Math.max(mh, mw * meter), mh, mh / 2); ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(mx + mw * PHASE_MIN - 1, my - 4, 2, mh + 8);
    label(ctx, 'PHASE', mx - 20, my + mh / 2, 'right');
    if (T < 40 || low || phasing) label(ctx, phasing ? 'PHASING' : low ? 'SHARDS REFILL' : 'HOLD A', mx + mw + 20, my + mh / 2, 'left');
    if (shield) {
      const sx = mx + mw + 200, sy = my + mh / 2;
      ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const t = (i * TAU) / 6; const X = sx + Math.cos(t) * 13, Y = sy + Math.sin(t) * 13; if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
      ctx.closePath(); ctx.stroke();
      label(ctx, 'SHIELD', sx + 24, sy, 'left');
    }

    // chain, bottom right: count, multiplier and pips toward the next step
    const cx = W - 56, cy = H - 46, m = chainMult();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'right';
    ctx.font = '200 66px "Segoe UI", sans-serif';
    ctx.fillStyle = chain ? '#ffffff' : 'rgba(255,255,255,0.3)';
    const cs = String(chain);
    ctx.fillText(cs, cx, cy + 16);
    const nw = ctx.measureText(cs).width;
    ctx.font = '700 28px "Segoe UI", sans-serif';
    ctx.fillStyle = col.shard;
    ctx.fillText(`×${m}`, cx - nw - 16, cy + 14);
    label(ctx, 'CHAIN', cx - nw - 16, cy - 22, 'right');
    const pips = m >= 5 ? 10 : chain % 10;
    for (let lit = 0; lit < 2; lit++) {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) if ((i < pips) === (lit === 1)) ctx.rect(cx - 10 - (9 - i) * 14, cy - 60, 10, 4);
      ctx.fillStyle = lit ? col.shard : 'rgba(255,255,255,0.15)';
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(ctx) {
    blendColors();
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(backdrop(THEMES[themeI]), 0, 0, W, H);
    if (themeT < 1 && themeFromI !== themeI) {
      ctx.globalAlpha = 1 - themeT;
      ctx.drawImage(backdrop(THEMES[themeFromI]), 0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    ctx.translate(shx, shy);
    drawTube(ctx);
    drawWorld(ctx, false);
    drawCraft(ctx);
    drawWorld(ctx, true);
    drawParticles(ctx);
    ctx.restore();

    drawSpeedLines(ctx);
    ctx.drawImage(vignetteCanvas(), 0, 0, W, H);
    if (flash > 0) {
      ctx.fillStyle = `rgba(${flashRGB},${(Math.min(0.6, flash) * 0.55).toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }
    drawPops(ctx);
    drawBanner(ctx);
    drawHints(ctx);
    const base = spdBase(distNow());
    api.hud(ctx, {
      score,
      left: [`${Math.floor(distNow()).toLocaleString()} m`, THEMES[themeI].name],
      right: [`Speed ×${speedMult(base).toFixed(1)}`, `Grazes ${grazes}`],
    });
    drawPanel(ctx);
  }

  // The run so far: used for the game-over screen and when you quit from the pause menu.
  function result() {
    return { score: Math.round(score), stats: { distance: Math.floor(distNow()), grazes, maxChain, shards: got } };
  }

  // first shards: a straight line, so the first thing you do is collect
  for (let s = 24; s <= 54; s += 2.4) addShard(s, 0);
  generate();
  craftPos();

  // Dev/test hook only: a harness can define window.__lumenDev(fn) to inspect a running game.
  if (typeof window !== 'undefined' && typeof window.__lumenDev === 'function') {
    window.__lumenDev({
      info: () => ({ T, dist, spd, score, chain, maxChain, grazes, got, meter, mode, sec, shield, F, obs: obs.length, shards: shards.length, portals: portals.length, pickups: pickups.length, parts: pn, pops: pops.length }),
      god: (on) => { god = !!on; },
      state: () => ({ T, dist, spd, craftA, angV, meter, phasing, obs, shards }),
      clearance: (o, a, t) => clearance(o, a, t),
      shutterOpen: (o, t) => shutterOpen(o, t),
      LOCK_T,
    });
  }

  return { update, draw, result };
}

// ------------------------------------------------------------------ box art
// The same tube, painted once at full quality (shadow blur is fine here).
function paintArt(ctx, w, h, portrait) {
  const s = portrait ? w / 600 : Math.min(w / 1280, h / 720);
  const r = rng32(portrait ? 5151 : 7373);
  const vx = portrait ? w * 0.5 : w * 0.685;
  const vy = portrait ? h * 0.56 : h * 0.44;
  const f = (portrait ? 172 : 214) * s;
  const off = 0.45;
  const rot = portrait ? 0.32 : -0.42;          // the tube is turned a little: mid-carve
  const th = THEMES[0];
  const L = Math.hypot(w, h);
  const P = (ang, rad, z) => { const a = HALF_PI - (ang - rot), k = f / z; return [vx + Math.cos(a) * rad * k, vy + (Math.sin(a) * rad - off) * k]; };
  const cyAt = (z) => vy - off * f / z;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // backdrop: the far end of the tube glowing through the fog
  ctx.fillStyle = '#030109'; ctx.fillRect(0, 0, w, h);
  let g = ctx.createRadialGradient(vx, vy, 0, vx, vy, L * 0.6);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.02, '#e2d2ff'); g.addColorStop(0.07, '#5a34b8');
  g.addColorStop(0.2, '#24104e'); g.addColorStop(0.5, '#0c0520'); g.addColorStop(1, '#030109');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // keep streaks and speed lines off the title
  const clearOfTitle = (x, y) => (portrait ? y > 300 * s : x > w * 0.5);

  // tube grid: lit wall panels, rings (closer together near the camera) and lengthwise lines
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = th.tube;
  ctx.globalAlpha = 0.06;
  ctx.beginPath();
  for (let j = 0; j < LINES; j += 2) {
    const a0 = (j * TAU) / LINES, a1 = ((j + 1) * TAU) / LINES;
    ctx.moveTo(...P(a0, R, 60)); ctx.lineTo(...P(a0, R, 0.5)); ctx.lineTo(...P(a1, R, 0.5)); ctx.lineTo(...P(a1, R, 60));
    ctx.closePath();
  }
  ctx.fill();
  ctx.strokeStyle = th.tube;
  for (let i = 0, z = 0.8; z < 75; i++, z += 0.9 + z * 0.06) {
    const fog = Math.pow(clamp(1 - z / 75, 0, 1), 1.3);
    const k = f / z, major = i % 4 === 0;
    ctx.globalAlpha = fog * (major ? 0.6 : 0.24);
    ctx.lineWidth = clamp((major ? 0.06 : 0.03) * k, 0.6, 8);
    ctx.shadowColor = th.tube; ctx.shadowBlur = major ? 14 * s : 0;
    ctx.beginPath(); ctx.arc(vx, cyAt(z), R * k, 0, TAU); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  for (let j = 0; j < LINES; j++) {
    const ang = (j * TAU) / LINES;
    const major = j % 4 === 0;
    ctx.globalAlpha = major ? 0.6 : 0.26;
    ctx.lineWidth = (major ? 2.6 : 1.2) * s;
    const g2 = ctx.createLinearGradient(...P(ang, R, 0.7), ...P(ang, R, 60));
    g2.addColorStop(0, rgba(th.tube, 1)); g2.addColorStop(1, rgba(th.tube, 0));
    ctx.strokeStyle = g2;
    ctx.beginPath(); ctx.moveTo(...P(ang, R, 0.7)); ctx.lineTo(...P(ang, R, 60)); ctx.stroke();
  }
  // bright ribs
  for (const z of [3.1, 16, 40]) {
    const k = f / z, fog = Math.pow(1 - z / 75, 1.3);
    ctx.globalAlpha = fog * 0.22; ctx.strokeStyle = th.tube; ctx.lineWidth = 0.35 * k;
    ctx.beginPath(); ctx.arc(vx, cyAt(z), R * k, 0, TAU); ctx.stroke();
    ctx.globalAlpha = fog * 0.85; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, 0.03 * k);
    ctx.stroke();
  }
  // motion streaks along the wall
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 70; i++) {
    const ang = r() * TAU, z = 1.8 + Math.pow(r(), 1.4) * 26, len = 1 + r() * 1.6;
    const p0 = P(ang, R * 0.97, z), p1 = P(ang, R * 0.97, z + len);
    if (!clearOfTitle(p0[0], p0[1])) continue;
    ctx.globalAlpha = 0.18 + r() * 0.3;
    ctx.lineWidth = (z < 4 ? 2.2 : 1.2) * s;
    ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // obstacles, far to near: ring segments with gaps, a spinning bar
  const fin = (z, gaps, fog) => {
    const k1 = f / z, k2 = f / (z + TH), c1 = cyAt(z), c2 = cyAt(z + TH);
    const sorted = gaps.map(([c, hw]) => [wrapA(c), hw]).sort((p, q) => p[0] - q[0]);
    const path = (cy, k) => {
      ctx.beginPath();
      sorted.forEach(([c, hw], i) => {
        const nx = sorted[(i + 1) % sorted.length];
        const to = nx[0] + (i === sorted.length - 1 ? TAU : 0) - nx[1];
        finPath(ctx, vx, cy, R * k, (R - FIN) * k, c + hw, to, rot);
      });
    };
    ctx.globalAlpha = fog;
    path(c2, k2); ctx.fillStyle = css(th.cH, 1, 0.62, 0); ctx.fill();
    path(c1, k1);
    const gr = ctx.createRadialGradient(vx, c1, (R - FIN) * k1, vx, c1, R * k1);
    gr.addColorStop(0, css(th.cH, 1, 0.35)); gr.addColorStop(1, th.hot);
    ctx.fillStyle = gr; ctx.fill();
    ctx.shadowColor = th.hot; ctx.shadowBlur = 26 * s;
    ctx.strokeStyle = css(th.cH, 1, 0.7); ctx.lineWidth = Math.max(1.2, 0.035 * k1);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  };
  const bar = (z, ang, fog) => {
    const k = f / z, cy = cyAt(z), ew = BAR_HW * R * k, hw = ew * 0.55;
    ctx.beginPath();
    for (const a of [ang, ang + Math.PI]) {
      const sa = HALF_PI - (a - rot), ux = Math.cos(sa), uy = Math.sin(sa), ex = vx + ux * R * k, ey = cy + uy * R * k;
      ctx.moveTo(vx - uy * hw, cy + ux * hw); ctx.lineTo(ex - uy * ew, ey + ux * ew); ctx.lineTo(ex + uy * ew, ey - ux * ew); ctx.lineTo(vx + uy * hw, cy - ux * hw); ctx.closePath();
    }
    ctx.globalAlpha = fog;
    ctx.fillStyle = th.hot; ctx.fill();
    ctx.shadowColor = th.hot; ctx.shadowBlur = 24 * s;
    ctx.strokeStyle = css(th.cH, 1, 0.7); ctx.lineWidth = Math.max(1, 0.03 * k); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd6e6'; ctx.beginPath(); ctx.arc(vx, cy, 0.3 * k, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  };
  fin(32, [[rot + 2.6, 0.5]], 0.4);
  fin(20, [[rot + 1.8, 0.5]], 0.6);
  fin(12, [[rot + 0.95, 0.45], [rot - 2.0, 0.5]], 0.8);
  bar(7.6, rot + 1.75, 0.92);
  fin(4.2, [[rot + 0.1, 0.62]], 1);

  // a coil of shards threading the gaps
  const shardPts = [];
  for (let z = 26; z >= 3.3; z -= 1.7) {
    const t = clamp((z - 4.6) / (20 - 4.6), 0, 1);
    const ang = rot + 0.1 + t * 1.7;
    shardPts.push([P(ang, SHARD_R, z), 0.17 * f / z, Math.pow(1 - z / 75, 1.2)]);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const [[x, y], sz, fog] of shardPts) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, sz * 3.2);
    rg.addColorStop(0, rgba(th.shard, 0.8 * fog)); rg.addColorStop(1, rgba(th.shard, 0));
    ctx.fillStyle = rg; ctx.fillRect(x - sz * 3.2, y - sz * 3.2, sz * 6.4, sz * 6.4);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const [[x, y], sz, fog] of shardPts) {
    ctx.globalAlpha = fog;
    ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x + sz * 0.6, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz * 0.6, y); ctx.closePath();
    ctx.fillStyle = css(th.cS, 1, 0.6); ctx.fill();
    ctx.strokeStyle = th.shard; ctx.lineWidth = Math.max(1, sz * 0.18); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // the craft, swinging into its turn, with a light trail spilling back toward us
  const ca = rot + 0.06, [cx, cy] = P(ca, HOVER, ZC);
  const sa = HALF_PI - (ca - rot);
  const cs = (portrait ? 0.95 : 1.0) * s; // bigger than true scale: the craft is the cover's hero
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const t = i / 26, d = 18 * cs + t * 260 * s;
    const x = cx + Math.cos(sa) * d, y = cy + Math.sin(sa) * d, rr = (14 + 30 * t) * s;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, rgba(th.tube, 0.32 * (1 - t))); rg.addColorStop(1, rgba(th.tube, 0));
    ctx.fillStyle = rg; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  g = ctx.createRadialGradient(cx, cy + 18 * cs, 0, cx, cy + 18 * cs, 120 * cs);
  g.addColorStop(0, rgba(th.tube, 0.55)); g.addColorStop(1, rgba(th.tube, 0));
  ctx.save(); ctx.translate(cx, cy + 18 * cs); ctx.scale(1, 0.45); ctx.translate(-cx, -(cy + 18 * cs));
  ctx.fillStyle = g; ctx.fillRect(cx - 120 * cs, cy + 18 * cs - 120 * cs, 240 * cs, 240 * cs);
  ctx.restore();
  ctx.save();
  ctx.translate(cx, cy); ctx.rotate(sa - HALF_PI + 0.14); ctx.scale(cs, cs);
  for (const ex of [-12, 12]) {
    const rg = ctx.createRadialGradient(ex, 14, 0, ex, 14, 26);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.3, rgba(th.tube, 0.9)); rg.addColorStop(1, rgba(th.tube, 0));
    ctx.fillStyle = rg; ctx.fillRect(ex - 26, -12, 52, 52);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.beginPath(); polyPath(ctx, CRAFT);
  ctx.fillStyle = '#140a26'; ctx.fill();
  ctx.shadowColor = th.tube; ctx.shadowBlur = 16;
  ctx.strokeStyle = css(th.cT, 1, 0.5); ctx.lineWidth = 3; ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.beginPath(); polyPath(ctx, CANOPY); ctx.fillStyle = '#f2ecff'; ctx.fill();
  ctx.restore();
  // speed lines at the frame's edges
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = '#ffffff';
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU, r0 = (0.42 + r() * 0.3) * L, l = (30 + r() * 140) * s;
    const x0 = vx + Math.cos(a) * r0, y0 = vy + Math.sin(a) * r0;
    if (!clearOfTitle(x0, y0)) continue;
    ctx.globalAlpha = 0.08 + r() * 0.2;
    ctx.lineWidth = (1 + r() * 1.5) * s;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(vx + Math.cos(a) * (r0 + l), vy + Math.sin(a) * (r0 + l)); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // vignette
  g = ctx.createRadialGradient(vx, vy, Math.min(w, h) * 0.3, w / 2, h / 2, L * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // title
  if (portrait) {
    g = ctx.createLinearGradient(0, 0, 0, h * 0.4);
    g.addColorStop(0, 'rgba(3,1,9,0.92)'); g.addColorStop(0.6, 'rgba(3,1,9,0.5)'); g.addColorStop(1, 'rgba(3,1,9,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.4);
    g = ctx.createLinearGradient(0, h * 0.84, 0, h);
    g.addColorStop(0, 'rgba(3,1,9,0)'); g.addColorStop(1, 'rgba(3,1,9,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.84, w, h * 0.16);
    artTitle(ctx, w / 2, 182 * s, 150 * s, 'center', s, w * 0.86);
    artTag(ctx, w / 2, h - 46 * s, 21 * s, 'center', s);
  } else {
    g = ctx.createLinearGradient(0, 0, w * 0.6, 0);
    g.addColorStop(0, 'rgba(3,1,9,0.94)'); g.addColorStop(0.5, 'rgba(3,1,9,0.7)'); g.addColorStop(1, 'rgba(3,1,9,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w * 0.6, h);
    const t = artTitle(ctx, 76 * s, h * 0.5 + 10 * s, 168 * s, 'left', s, w * 0.44);
    artTag(ctx, t.left, t.bottom + 54 * s, 21 * s, 'left', s);
  }
  ctx.restore();
}

// "LUMEN" heavy over "RUN" thin, tracked to the same width. Returns the block's metrics.
function artTitle(ctx, x, y, size, align, s, maxW) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `900 ${size}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${size * 0.02}px`;
  let tw = ctx.measureText('LUMEN').width - size * 0.02;
  if (tw > maxW) {
    size *= maxW / tw;
    ctx.font = `900 ${size}px "Segoe UI", sans-serif`;
    ctx.letterSpacing = `${size * 0.02}px`;
    tw = ctx.measureText('LUMEN').width - size * 0.02;
  }
  const left = align === 'center' ? x - tw / 2 : x;
  // chromatic fringe behind the letters
  ctx.globalCompositeOperation = 'lighter';
  const d = size * 0.026;
  ctx.fillStyle = 'rgba(255,60,170,0.55)'; ctx.fillText('LUMEN', left - d, y + d * 0.3);
  ctx.fillStyle = 'rgba(70,200,255,0.55)'; ctx.fillText('LUMEN', left + d, y - d * 0.3);
  ctx.globalCompositeOperation = 'source-over';
  const g = ctx.createLinearGradient(0, y - size * 0.74, 0, y);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.48, '#f1eaff'); g.addColorStop(0.52, '#cfb2ff'); g.addColorStop(1, ACCENT);
  ctx.fillStyle = g;
  ctx.shadowColor = 'rgba(167,123,255,0.9)'; ctx.shadowBlur = size * 0.22;
  ctx.fillText('LUMEN', left, y);
  ctx.shadowBlur = 0;
  ctx.fillText('LUMEN', left, y);
  // a lens glint on the U
  ctx.globalCompositeOperation = 'lighter';
  const gx = left + size * 0.98, gy = y - size * 0.7;
  for (const [sx, sy] of [[1, 0.06], [0.06, 1]]) {
    ctx.save(); ctx.translate(gx, gy); ctx.scale(sx, sy);
    const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, 60 * s);
    rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = rg; ctx.fillRect(-60 * s, -60 * s, 120 * s, 120 * s);
    ctx.restore();
  }
  ctx.globalCompositeOperation = 'source-over';
  // RUN: thin, spread to LUMEN's width
  const s2 = size * 0.42;
  ctx.font = `300 ${s2}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = '0px';
  const raw = ctx.measureText('RUN').width;
  ctx.letterSpacing = `${Math.max(0, (tw - raw) / 2)}px`;
  const y2 = y + s2 * 1.16;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(167,123,255,0.85)'; ctx.shadowBlur = size * 0.1;
  ctx.fillText('RUN', left, y2);
  ctx.shadowBlur = 0;
  ctx.letterSpacing = '0px';
  ctx.restore();
  return { left, width: tw, bottom: y2 };
}

function artTag(ctx, x, y, size, align, s) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${size * 0.42}px`;
  const text = 'TUNNEL RUNNER';
  const tw = ctx.measureText(text).width - size * 0.42;
  const left = align === 'center' ? x - tw / 2 : x;
  ctx.fillStyle = 'rgba(236,226,255,0.92)';
  ctx.fillText(text, left, y);
  ctx.letterSpacing = '0px';
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  if (align === 'center') {
    ctx.moveTo(left - 70 * s, y); ctx.lineTo(left - 22 * s, y);
    ctx.moveTo(left + tw + 22 * s, y); ctx.lineTo(left + tw + 70 * s, y);
  } else {
    ctx.moveTo(left + tw + 22 * s, y); ctx.lineTo(left + tw + 124 * s, y);
  }
  ctx.stroke();
  ctx.restore();
}

export default {
  key: 'lumen',
  title: 'Lumen Run',
  tagline: 'Tunnel runner',
  accent: ACCENT,
  controls: [
    ['Left stick / D-pad', 'Move around the tube'],
    ['A (hold)', 'Phase through walls while the meter lasts'],
    ['Shards', 'Refill phase; an unbroken chain multiplies them'],
    ['Near misses', 'Skim an edge to graze for a bonus'],
    ['Keyboard', 'A / D or arrows · Space to phase'],
    ['Start', 'Pause'],
  ],
  art: {
    cover(ctx, w, h) { paintArt(ctx, w, h, true); },
    hero(ctx, w, h) { paintArt(ctx, w, h, false); },
  },
  create,
};
