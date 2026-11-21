// Pulse Arena: an original neon twin-stick arena shooter for the Project 360 arcade.
//
// Fight inside a ring of light. Left stick flies, right stick aims and fires, LB / RB
// sets off a bomb. Enemies warp in from the ring (always announced by a warning flash)
// in escalating waves; the sparks they leave behind raise a score multiplier (x1..x10)
// that resets when you lose a life. Rendering is plain canvas 2D: additive glow sprites,
// a pooled particle system and a floor grid that ripples away from every explosion.

const ACCENT = '#7cff4f';
const TAU = Math.PI * 2;
const COL = {
  ship: '#ffffff',
  bullet: '#fff2a6',
  drifter: '#b27dff',
  seeker: '#ffa62e',
  splitter: '#ff4fa6',
  shard: '#ff92d0',
  dasher: '#ff4b3e',
  orbiter: '#38e1ff',
};

function rgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// ------------------------------------------------------------------ shapes (shared by the game and the box art)
const SHIP = [1.25, 0, -0.2, -0.4, -0.95, -0.95, -0.55, 0, -0.95, 0.95, -0.2, 0.4];
const SEEKER = [1.25, 0, -0.7, -0.85, -0.7, 0.85];
const SEEKER_IN = [0.42, 0, -0.28, -0.34, -0.28, 0.34];
const DASHER = [1.75, 0, 0.05, -0.52, -1.05, 0, 0.05, 0.52];

function poly(ctx, pts, x, y, s, a) {
  const c = Math.cos(a), n = Math.sin(a);
  for (let i = 0; i < pts.length; i += 2) {
    const lx = pts[i] * s, ly = pts[i + 1] * s;
    const X = x + lx * c - ly * n, Y = y + lx * n + ly * c;
    if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  }
  ctx.closePath();
}
function ngon(ctx, x, y, r, a, sides) {
  for (let i = 0; i < sides; i++) {
    const t = a + (i / sides) * TAU, X = x + Math.cos(t) * r, Y = y + Math.sin(t) * r;
    if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y);
  }
  ctx.closePath();
}
function circ(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }

// Appends one enemy outline to the current path (r size, a heading, rot spin, t clock).
function enemyPath(ctx, kind, x, y, r, a, rot, t) {
  switch (kind) {
    case 'drifter': ngon(ctx, x, y, r, rot, 6); ngon(ctx, x, y, r * 0.42, -rot * 1.6, 6); break;
    case 'seeker': poly(ctx, SEEKER, x, y, r, a); poly(ctx, SEEKER_IN, x, y, r, a); break;
    case 'splitter': {
      const k = r * (0.3 + 0.06 * Math.sin(t * 5)), c = Math.cos(rot) * k, s = Math.sin(rot) * k;
      circ(ctx, x + c, y + s, r * 0.66); circ(ctx, x - c, y - s, r * 0.66);
      break;
    }
    case 'shard': circ(ctx, x, y, r); circ(ctx, x, y, r * 0.38); break;
    case 'dasher': poly(ctx, DASHER, x, y, r, a); break;
    case 'orbiter': {
      circ(ctx, x, y, r * 0.72);
      for (let i = 0; i < 2; i++) { const q = rot + i * Math.PI; circ(ctx, x + Math.cos(q) * r * 1.38, y + Math.sin(q) * r * 1.38, r * 0.24); }
      break;
    }
    default: circ(ctx, x, y, r);
  }
}

const KINDS = {
  drifter: { r: 22, hp: 1, score: 50, sparks: 1, color: COL.drifter },
  seeker: { r: 17, hp: 1, score: 100, sparks: 1, color: COL.seeker },
  splitter: { r: 27, hp: 3, score: 150, sparks: 2, color: COL.splitter },
  shard: { r: 12, hp: 1, score: 40, sparks: 1, color: COL.shard },
  dasher: { r: 20, hp: 2, score: 125, sparks: 2, color: COL.dasher },
  orbiter: { r: 18, hp: 2, score: 150, sparks: 2, color: COL.orbiter },
};
const KIND_LIST = Object.keys(KINDS);
for (const k of KIND_LIST) KINDS[k].fill = rgba(KINDS[k].color, 0.16);

const INTRO = {
  1: 'Move: left stick / WASD   ·   Fire: right stick / arrows   ·   Bomb: LB, RB / Q, E',
  2: 'New threat: Seeker  ·  it hunts you down',
  3: 'New threat: Splitter  ·  divides when destroyed',
  4: 'New threat: Dasher  ·  sidestep the warning line',
  5: 'New threat: Orbiter  ·  circles, then dives',
};

// ------------------------------------------------------------------ waves
function waveGroups(n) {
  const G = (kind, count, pattern = 'cluster') => ({ kind, count, pattern });
  switch (n) {
    case 1: return [G('drifter', 3), G('drifter', 4), G('drifter', 4, 'arc'), G('drifter', 5)];
    case 2: return [G('drifter', 4), G('seeker', 2), G('drifter', 4, 'arc'), G('seeker', 3), G('drifter', 5), G('seeker', 3)];
    case 3: return [G('splitter', 2), G('seeker', 3), G('drifter', 6, 'arc'), G('splitter', 2), G('seeker', 4), G('splitter', 2), G('drifter', 5)];
    case 4: return [G('dasher', 2), G('drifter', 5), G('seeker', 4), G('dasher', 2), G('splitter', 3), G('seeker', 4, 'arc'), G('dasher', 3)];
    case 5: return [G('orbiter', 2), G('seeker', 5), G('dasher', 2), G('drifter', 14, 'ring'), G('orbiter', 3), G('splitter', 3), G('seeker', 5, 'arc'), G('orbiter', 3)];
    default: break;
  }
  const weights = { drifter: 3, seeker: 3 + n * 0.15, splitter: 2, dasher: 1.4 + n * 0.12, orbiter: 1.4 + n * 0.12 };
  const sizes = { drifter: 5 + n * 0.4, seeker: 3 + n * 0.3, splitter: 2 + n * 0.15, dasher: 2 + n * 0.13, orbiter: 2 + n * 0.13 };
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const count = 6 + Math.floor(n * 0.8);
  const groups = [];
  for (let i = 0; i < count; i++) {
    let r = Math.random() * total, kind = 'drifter';
    for (const [k, w] of Object.entries(weights)) { r -= w; if (r <= 0) { kind = k; break; } }
    groups.push(G(kind, Math.max(1, Math.round(sizes[kind] * (0.8 + Math.random() * 0.4))), Math.random() < 0.3 ? 'arc' : 'cluster'));
  }
  if (n % 2 === 0) groups.splice(Math.floor(count / 2), 0, G(Math.random() < 0.5 ? 'drifter' : 'seeker', 10 + n, 'ring'));
  return groups;
}

// ------------------------------------------------------------------ cached backdrop layers (built once)
let statics = null;
function getStatics(W, H, CX, CY, R) {
  if (statics) return statics;
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };

  const [bg, b] = mk(W, H);
  b.fillStyle = '#02040a';
  b.fillRect(0, 0, W, H);
  let g = b.createRadialGradient(CX, CY, 0, CX, CY, 1150);
  g.addColorStop(0, '#0c1a3c'); g.addColorStop(0.42, '#071029'); g.addColorStop(1, '#010208');
  b.fillStyle = g;
  b.fillRect(0, 0, W, H);
  const r = rng(7);
  for (let i = 0; i < 320; i++) {
    const x = r() * W, y = r() * H;
    if (Math.hypot(x - CX, y - CY) < R + 60) continue;
    b.fillStyle = `rgba(160,190,255,${(0.08 + r() * 0.35).toFixed(2)})`;
    const s = r() < 0.88 ? 1.5 : 2.5;
    b.fillRect(x, y, s, s);
  }
  g = b.createRadialGradient(CX, CY, R * 0.1, CX, CY, R);
  g.addColorStop(0, 'rgba(34,70,160,0.26)'); g.addColorStop(0.82, 'rgba(20,40,110,0.14)'); g.addColorStop(1, 'rgba(124,255,79,0.10)');
  b.fillStyle = g;
  b.beginPath(); b.arc(CX, CY, R, 0, TAU); b.fill();
  b.strokeStyle = 'rgba(120,170,255,0.07)';
  b.lineWidth = 1.5;
  for (const k of [0.34, 0.67]) { b.beginPath(); b.arc(CX, CY, R * k, 0, TAU); b.stroke(); }

  const S = Math.ceil((R + 90) * 2), o = S / 2;
  const [ring, q] = mk(S, S);
  q.globalCompositeOperation = 'lighter';
  q.shadowColor = ACCENT;
  const st = (w, c, blur = 0) => { q.lineWidth = w; q.strokeStyle = c; q.shadowBlur = blur; q.beginPath(); q.arc(o, o, R, 0, TAU); q.stroke(); };
  st(52, 'rgba(124,255,79,0.045)'); st(24, 'rgba(124,255,79,0.10)'); st(10, 'rgba(124,255,79,0.30)', 26); st(4, 'rgba(210,255,190,0.95)', 16); st(1.6, '#ffffff');
  q.shadowBlur = 0;
  q.strokeStyle = 'rgba(124,255,79,0.5)';
  q.lineWidth = 2;
  q.beginPath();
  for (let i = 0; i < 96; i++) {
    const t = (i / 96) * TAU, l = i % 8 === 0 ? 24 : 9;
    q.moveTo(o + Math.cos(t) * (R + 14), o + Math.sin(t) * (R + 14));
    q.lineTo(o + Math.cos(t) * (R + 14 + l), o + Math.sin(t) * (R + 14 + l));
  }
  q.stroke();
  q.strokeStyle = 'rgba(124,255,79,0.2)';
  q.lineWidth = 1.5;
  q.beginPath(); q.arc(o, o, R + 50, 0, TAU); q.stroke();

  const [vig, v] = mk(W, H);
  g = v.createRadialGradient(CX, CY, H * 0.4, CX, CY, W * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
  v.fillStyle = g;
  v.fillRect(0, 0, W, H);

  statics = { bg, ring, vig };
  return statics;
}

// ------------------------------------------------------------------ the game
function create(api) {
  const W = api.w, H = api.h;
  const CX = W / 2, CY = H / 2 + 28, R = 468;
  const rand = (a, b) => a + Math.random() * (b - a);
  const { bg, ring, vig } = getStatics(W, H, CX, CY, R);

  // palette + glow sprites (index = colour id used by particles)
  const PAL = [COL.ship, ACCENT, COL.bullet, COL.drifter, COL.seeker, COL.splitter, COL.shard, COL.dasher, COL.orbiter, '#8fc4ff'];
  const CI = { white: 0, accent: 1, bullet: 2, drifter: 3, seeker: 4, splitter: 5, shard: 6, dasher: 7, orbiter: 8, blue: 9 };
  for (const k of KIND_LIST) KINDS[k].ci = CI[k];
  const GL = PAL.map((c) => api.glow(c, 32));
  const POOL = api.glow(ACCENT, 128);

  // ---- particles: fixed pool in typed arrays (kind 0 = streak, 1 = glow dot)
  const PMAX = 1600;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX), pvx = new Float32Array(PMAX), pvy = new Float32Array(PMAX);
  const pl = new Float32Array(PMAX), pm = new Float32Array(PMAX), ps = new Float32Array(PMAX);
  const pc = new Uint8Array(PMAX), pk = new Uint8Array(PMAX);
  let pn = 0;
  function part(x, y, vx, vy, life, size, c, k) {
    const i = pn < PMAX ? pn++ : (Math.random() * PMAX) | 0;
    px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy; pl[i] = pm[i] = life; ps[i] = size; pc[i] = c; pk[i] = k;
  }
  function burst(x, y, n, c, sMin, sMax, lMin, lMax, size, k) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = rand(sMin, sMax);
      part(x, y, Math.cos(a) * s, Math.sin(a) * s, rand(lMin, lMax), size, c, k);
    }
  }

  // ---- state
  let T = 0;
  let score = 0, kills = 0, mult = 1, prog = 0, maxMult = 1;
  let lives = 3, bombs = 3, bombUsed = false;
  let waveN = 0, highestWave = 0, noBombWave = 0;
  let phase = 'banner', bannerT = 0, groups = [], gi = 0, groupT = 0, interval = 2.5, spd = 1, waveT = 0, doneAt = -1, clearT = -1;
  let shake = 0, shx = 0, shy = 0, flash = 0, ringFlash = 0;
  let respawnT = 0, overT = -1, overSent = false;
  let popT = 0, popText = '', popX = 0, popY = 0;
  const player = { x: CX, y: CY, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2, cd: 0, aiming: false };
  let enemies = [], bullets = [], sparks = [], pending = [], ripples = [], blasts = [];
  const fresh = [];
  const sfxAt = {};

  const need = (m) => 2 + m * 3; // sparks needed to go from x m to x m+1
  const dashAim = () => Math.max(0.6, 0.92 - waveN * 0.02);

  // ---- sound
  function play(name, gap, voices) {
    if (T - (sfxAt[name] ?? -9) < gap) return;
    sfxAt[name] = T;
    api.sfx(voices);
  }
  const panOf = (x) => Math.max(-0.8, Math.min(0.8, (x - CX) / (W * 0.45)));

  // ---- grid: a sparse lattice displaced by active ripples
  const GN = 23, GS = (2 * R) / (GN - 1);
  const gx = new Float32Array(GN * GN), gy = new Float32Array(GN * GN);
  function ripple(x, y, amp, v = 650, life = 1) {
    if (ripples.length >= 14) ripples.shift();
    ripples.push({ x, y, r: 0, v, amp, life: 1, decay: 1 / life });
  }

  // ---- helpers
  function addScore(n) { score += n; }
  function rayToRing(x, y, dx, dy) {
    const fx = x - CX, fy = y - CY, b = fx * dx + fy * dy, c = fx * fx + fy * fy - R * R;
    return -b + Math.sqrt(Math.max(0, b * b - c));
  }
  function segDist2(cx, cy, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay, l2 = vx * vx + vy * vy;
    let t = l2 ? ((cx - ax) * vx + (cy - ay) * vy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = ax + vx * t - cx, dy = ay + vy * t - cy;
    return dx * dx + dy * dy;
  }
  function steer(e, dvx, dvy, k, dt) { const f = Math.min(1, k * dt); e.vx += (dvx - e.vx) * f; e.vy += (dvy - e.vy) * f; }

  function makeEnemy(kind, x, y) {
    const K = KINDS[kind];
    return {
      kind, K, x, y, vx: 0, vy: 0, r: K.r, hp: K.hp, a: Math.atan2(player.y - y, player.x - x), rot: Math.random() * TAU,
      st: 0, t: rand(0.8, 1.6), flash: 0, seed: Math.random() * 100, dead: false, oa: 0, dir: 1, age: 0,
    };
  }

  // ---- waves & spawning
  function nextWave() {
    waveN++;
    highestWave = Math.max(highestWave, waveN);
    if (!bombUsed) noBombWave = waveN;
    groups = waveGroups(waveN);
    gi = 0; groupT = 0.2; waveT = 0; doneAt = -1; clearT = -1;
    interval = waveN <= 5 ? 2.6 - waveN * 0.1 : Math.max(1.0, 2.25 - (waveN - 5) * 0.13);
    spd = Math.min(1.8, 1 + (waveN - 1) * 0.063);
    phase = 'banner'; bannerT = waveN === 1 ? 3 : 2.3;
    ringFlash = 0.9;
    ripple(CX, CY, 22, 700, 1.6);
    play('wave', 0.5, [
      { tone: 392, type: 'triangle', peak: 0.07, decay: 0.18 },
      { tone: 523.25, type: 'triangle', peak: 0.07, decay: 0.18, at: 0.08 },
      { tone: 659.25, type: 'triangle', peak: 0.07, decay: 0.2, at: 0.16 },
      { tone: 1046.5, type: 'sine', peak: 0.08, decay: 0.6, at: 0.24 },
      { noise: true, from: 3000, peakAt: 8000, to: 5000, dur: 0.7, q: 2, peak: 0.04, at: 0.2 },
    ]);
  }

  function pickAngle() {
    let best = 0, bestD = -1;
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * TAU;
      const d = Math.hypot(CX + Math.cos(a) * (R - 60) - player.x, CY + Math.sin(a) * (R - 60) - player.y);
      if (d > 430) return a;
      if (d > bestD) { bestD = d; best = a; }
    }
    return best;
  }
  function queue(kind, ang, rr, delay) {
    pending.push({ kind, ang, x: CX + Math.cos(ang) * rr, y: CY + Math.sin(ang) * rr, t: 1 + delay, warn: 1 + delay, hold: 0, dead: false });
  }
  function spawnGroup(g) {
    const n = g.count;
    let base = 0;
    if (g.pattern === 'ring') {
      base = Math.random() * TAU;
      for (let i = 0; i < n; i++) {
        const a = base + (i / n) * TAU;
        const x = CX + Math.cos(a) * (R - 50), y = CY + Math.sin(a) * (R - 50);
        if (Math.hypot(x - player.x, y - player.y) < 300) continue; // never on top of the player
        queue(g.kind, a, R - 50, 0.2 + (i % 2) * 0.1);
      }
    } else if (g.pattern === 'arc') {
      base = pickAngle();
      const spread = Math.min(1.4, 0.18 * n);
      for (let i = 0; i < n; i++) queue(g.kind, base + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0), R - 50, i * 0.05);
    } else {
      base = pickAngle();
      for (let i = 0; i < n; i++) queue(g.kind, base + rand(-0.13, 0.13), R - rand(48, 110), i * 0.06);
    }
    play('warn', 0.2, [{ tone: 330, to: 700, type: 'sine', peak: 0.035, attack: 0.04, decay: 0.16, pan: panOf(CX + Math.cos(base) * R) }]);
  }

  // ---- combat
  function explode(x, y, ci, r) {
    const big = r > 20;
    burst(x, y, big ? 26 : 18, ci, 120, big ? 620 : 480, 0.3, 0.75, 1, 0);
    burst(x, y, big ? 9 : 6, CI.white, 150, 500, 0.2, 0.45, 1, 0);
    burst(x, y, big ? 7 : 4, ci, 20, 160, 0.3, 0.7, rand(8, 16), 1);
    part(x, y, 0, 0, 0.22, r * 3.2, ci, 1);
    part(x, y, 0, 0, 0.12, r * 1.6, CI.white, 1);
  }
  function kill(e, how, b) {
    if (e.dead) return;
    e.dead = true;
    const K = e.K;
    explode(e.x, e.y, K.ci, e.r);
    ripple(e.x, e.y, 10 + e.r * 0.5, 620, 0.9);
    if (how !== 'clear') { kills++; addScore(K.score * mult); }
    if (how === 'shot') {
      for (let i = 0; i < K.sparks; i++) spark(e.x, e.y);
      if (e.kind === 'splitter') {
        const dir = b ? Math.atan2(b.vy, b.vx) : Math.random() * TAU;
        for (const s of [-1, 1]) {
          const a = dir + s * (Math.PI / 2) + rand(-0.3, 0.3);
          const sh = makeEnemy('shard', e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12);
          sh.vx = Math.cos(a) * 330; sh.vy = Math.sin(a) * 330; sh.age = 0.12;
          fresh.push(sh);
        }
      }
    }
    shake = Math.min(40, shake + (e.r > 20 ? 4 : 2.5));
    const p = panOf(e.x);
    if (e.r > 20) {
      play('boom', 0.05, [
        { noise: true, from: 2600, peakAt: 1100, to: 140, dur: 0.38, q: 0.7, peak: 0.26, type: 'lowpass', panFrom: p, panTo: p },
        { tone: 150, to: 40, type: 'sine', peak: 0.2, attack: 0.003, decay: 0.3, pan: p },
      ]);
    } else {
      play('pop', 0.04, [
        { noise: true, from: 3600, peakAt: 1600, to: 300, dur: 0.22, q: 0.8, peak: 0.18, type: 'lowpass', panFrom: p, panTo: p },
        { tone: 240, to: 70, type: 'sine', peak: 0.12, attack: 0.002, decay: 0.16, pan: p },
      ]);
    }
  }
  function hit(e, b) {
    e.hp--;
    if (e.hp <= 0) { kill(e, 'shot', b); return; }
    e.flash = 0.08;
    e.x += b.vx * 0.006; e.y += b.vy * 0.006;
    const back = Math.atan2(-b.vy, -b.vx);
    for (let i = 0; i < 4; i++) { const a = back + rand(-0.8, 0.8), s = rand(150, 420); part(b.x, b.y, Math.cos(a) * s, Math.sin(a) * s, rand(0.15, 0.3), 1, e.K.ci, 0); }
    play('hit', 0.05, [{ tone: 620, to: 420, type: 'square', peak: 0.018, attack: 0.001, decay: 0.04, pan: panOf(e.x) }]);
  }
  function spark(x, y) {
    if (sparks.length > 260) sparks.shift();
    const a = Math.random() * TAU, s = rand(60, 210);
    sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 8, rot: Math.random() * TAU, dead: false });
  }
  function collect(s) {
    s.dead = true;
    addScore(10 * mult);
    part(s.x, s.y, 0, 0, 0.18, 22, CI.accent, 1);
    if (mult < 10 && ++prog >= need(mult)) {
      prog = 0;
      mult++;
      maxMult = Math.max(maxMult, mult);
      popT = 1.1; popText = `x${mult}`; popX = player.x; popY = player.y - 40;
      ringFlash = Math.max(ringFlash, 0.45);
      burst(player.x, player.y, 26, CI.accent, 200, 520, 0.3, 0.6, 1, 0);
      play('mult', 0.1, [
        { tone: 880, type: 'triangle', peak: 0.07, decay: 0.12 },
        { tone: 1318.5, type: 'triangle', peak: 0.07, decay: 0.25, at: 0.06 },
        { tone: 1760, type: 'sine', peak: 0.05, decay: 0.4, at: 0.12 },
      ]);
    } else {
      const f = 900 + mult * 70 + (prog / need(mult)) * 300;
      play('pick', 0.035, [{ tone: f, to: f * 1.5, type: 'sine', peak: 0.05, attack: 0.002, decay: 0.07 }]);
    }
  }
  function shoot(a) {
    const streams = mult >= 8 ? 3 : mult >= 4 ? 2 : 1;
    const c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
    const pattern = streams === 1 ? [[0, 0]] : streams === 2 ? [[-7, 0], [7, 0]] : [[0, 0], [-6, -0.075], [6, 0.075]];
    for (const [off, da] of pattern) {
      const ang = a + da + rand(-0.018, 0.018);
      bullets.push({ x: player.x + c * 18 + nx * off, y: player.y + s * 18 + ny * off, vx: Math.cos(ang) * 1550, vy: Math.sin(ang) * 1550, dead: false });
    }
    part(player.x + c * 20, player.y + s * 20, player.vx * 0.5, player.vy * 0.5, 0.06, 16, CI.bullet, 1);
    play('shot', 0.11, [{ tone: 1500, to: 620, type: 'triangle', peak: 0.03, attack: 0.001, decay: 0.05, pan: panOf(player.x) * 0.6 }]);
  }
  function bomb() {
    bombs--;
    bombUsed = true;
    blasts.push({ x: player.x, y: player.y, r: 0, v: 1900, max: 2 * R + 80 });
    ripple(player.x, player.y, 70, 1500, 1.3);
    shake = 36; flash = 0.55; ringFlash = 1;
    player.inv = Math.max(player.inv, 0.6);
    burst(player.x, player.y, 90, CI.accent, 300, 1400, 0.4, 0.9, 1.4, 0);
    burst(player.x, player.y, 40, CI.white, 200, 1000, 0.3, 0.7, 1, 0);
    part(player.x, player.y, 0, 0, 0.35, 180, CI.accent, 1);
    play('bomb', 0.2, [
      { noise: true, from: 180, peakAt: 3200, to: 110, dur: 1.3, q: 0.5, peak: 0.6, type: 'lowpass' },
      { tone: 95, to: 28, type: 'sine', peak: 0.45, attack: 0.01, decay: 1.1 },
      { tone: 220, to: 55, type: 'sawtooth', peak: 0.05, attack: 0.01, decay: 0.7 },
    ]);
  }
  function clearAround(x, y, r) {
    for (const e of enemies) if (!e.dead && Math.hypot(e.x - x, e.y - y) < r) kill(e, 'clear');
  }
  function die() {
    player.alive = false;
    lives--;
    mult = 1; prog = 0;
    const { x, y } = player;
    burst(x, y, 140, CI.white, 200, 1000, 0.5, 1.3, 1.5, 0);
    burst(x, y, 110, CI.accent, 150, 800, 0.5, 1.4, 1.3, 0);
    burst(x, y, 40, CI.accent, 40, 300, 0.6, 1.4, rand(12, 26), 1);
    part(x, y, 0, 0, 0.5, 240, CI.white, 1);
    ripple(x, y, 80, 1000, 1.5);
    shake = 40; flash = 0.7; ringFlash = 1;
    clearAround(x, y, 340);
    bullets = [];
    play('death', 0.3, [
      { noise: true, from: 4200, peakAt: 900, to: 70, dur: 1.5, q: 0.6, peak: 0.6, type: 'lowpass' },
      { tone: 320, to: 40, type: 'sawtooth', peak: 0.1, attack: 0.005, decay: 1.1 },
      { tone: 72, to: 28, type: 'sine', peak: 0.4, attack: 0.005, decay: 1.3 },
    ]);
    if (lives <= 0) overT = 2.2; else respawnT = 1.6;
  }
  function respawn() {
    Object.assign(player, { x: CX, y: CY, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, inv: 2, cd: 0 });
    bombs = 3;
    clearAround(CX, CY, 300);
    ripple(CX, CY, 40, 900, 1.2);
    for (let i = 0; i < 40; i++) { const a = (i / 40) * TAU; part(CX + Math.cos(a) * 120, CY + Math.sin(a) * 120, -Math.cos(a) * 500, -Math.sin(a) * 500, 0.24, 1, CI.accent, 0); }
    play('respawn', 0.3, [{ tone: 220, to: 880, type: 'triangle', peak: 0.08, attack: 0.25, decay: 0.3 }, { tone: 1760, type: 'sine', peak: 0.05, decay: 0.5, at: 0.3 }]);
  }

  // ------------------------------------------------------------------ update
  function updateEnemy(e, dt) {
    e.age += dt;
    if (e.flash > 0) e.flash -= dt;
    const dx = player.x - e.x, dy = player.y - e.y, d = Math.hypot(dx, dy) || 1, toP = Math.atan2(dy, dx);
    switch (e.kind) {
      case 'drifter': {
        e.a += (Math.random() - 0.5) * dt * 4 + angDiff(toP, e.a) * dt * 0.35;
        const s = 80 * spd;
        e.vx = Math.cos(e.a) * s; e.vy = Math.sin(e.a) * s;
        e.rot += dt * 0.9;
        break;
      }
      case 'seeker': {
        const s = 165 * spd;
        steer(e, (dx / d) * s, (dy / d) * s, 2.2, dt);
        e.a = Math.atan2(e.vy, e.vx);
        break;
      }
      case 'splitter': {
        const aim = toP + Math.sin(T * 1.7 + e.seed) * 0.9, s = 75 * spd;
        steer(e, Math.cos(aim) * s, Math.sin(aim) * s, 1.5, dt);
        e.rot += dt * 0.7;
        break;
      }
      case 'shard': {
        const s = 255 * spd;
        steer(e, (dx / d) * s, (dy / d) * s, 1.5, dt);
        e.rot += dt * 6;
        break;
      }
      case 'dasher': {
        e.t -= dt;
        if (e.st === 0) { // roam
          const aim = toP + Math.sin(T * 1.3 + e.seed) * 0.6, s = 60 * spd;
          steer(e, Math.cos(aim) * s, Math.sin(aim) * s, 2, dt);
          e.a += angDiff(toP, e.a) * Math.min(1, dt * 4);
          if (e.t <= 0 && e.age > 0.6) { e.st = 1; e.t = dashAim(); }
        } else if (e.st === 1) { // telegraph: tracks the player, then locks for the last 0.3 s
          steer(e, 0, 0, 6, dt);
          if (e.t > 0.3) e.a += angDiff(toP, e.a) * Math.min(1, dt * 10);
          if (e.t <= 0) {
            e.st = 2; e.t = 0.8;
            const s = 820 * Math.sqrt(spd);
            e.vx = Math.cos(e.a) * s; e.vy = Math.sin(e.a) * s;
            play('dash', 0.15, [{ noise: true, from: 500, peakAt: 2600, to: 900, dur: 0.35, q: 1.2, peak: 0.12, panFrom: panOf(e.x), panTo: panOf(e.x + e.vx * 0.4) }]);
          }
        } else if (e.st === 2) { // dash
          if (Math.random() < 0.9) part(e.x, e.y, -e.vx * 0.15 + rand(-40, 40), -e.vy * 0.15 + rand(-40, 40), 0.3, 1, CI.dasher, 0);
          if (e.t <= 0) { e.st = 3; e.t = 0.55; }
        } else { // recover
          steer(e, 0, 0, 5, dt);
          if (e.t <= 0) { e.st = 0; e.t = rand(1.0, 1.9); }
        }
        break;
      }
      case 'orbiter': {
        e.rot += dt * 5;
        const ORB = 230;
        if (e.st === 0) { // approach
          const s = 200 * spd;
          steer(e, (dx / d) * s, (dy / d) * s, 2.5, dt);
          if (d < ORB + 30 && e.age > 0.5) { e.st = 1; e.oa = Math.atan2(-dy, -dx); e.t = rand(2.2, 3.4); e.dir = Math.random() < 0.5 ? -1 : 1; }
        } else if (e.st === 1) { // orbit the player
          e.oa += e.dir * 1.6 * spd * dt;
          let ox = player.x + Math.cos(e.oa) * ORB, oy = player.y + Math.sin(e.oa) * ORB;
          const cx = ox - CX, cy = oy - CY, cd = Math.hypot(cx, cy), lim = R - e.r - 8;
          if (cd > lim) { ox = CX + (cx / cd) * lim; oy = CY + (cy / cd) * lim; }
          steer(e, (ox - e.x) * 6, (oy - e.y) * 6, 8, dt);
          e.t -= dt;
          if (e.t <= 0) { e.st = 2; e.t = 0.5; e.a = toP; }
        } else if (e.st === 2) { // wind-up (tracks, then locks for the last 0.2 s)
          steer(e, 0, 0, 8, dt);
          if (e.t > 0.2) e.a = toP;
          e.t -= dt;
          if (e.t <= 0) {
            e.st = 3; e.t = 0.75;
            const s = 640 * Math.sqrt(spd);
            e.vx = Math.cos(e.a) * s; e.vy = Math.sin(e.a) * s;
            play('dive', 0.15, [{ tone: 900, to: 300, type: 'triangle', peak: 0.05, attack: 0.01, decay: 0.3, pan: panOf(e.x) }]);
          }
        } else if (e.st === 3) { // dive
          if (Math.random() < 0.8) part(e.x, e.y, -e.vx * 0.15, -e.vy * 0.15, 0.3, 1, CI.orbiter, 0);
          e.t -= dt;
          if (e.t <= 0) { e.st = 4; e.t = 0.4; }
        } else {
          steer(e, 0, 0, 4, dt);
          e.t -= dt;
          if (e.t <= 0) e.st = 0;
        }
        break;
      }
      default: break;
    }
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    // the ring of light keeps everything inside
    const ox = e.x - CX, oy = e.y - CY, od = Math.hypot(ox, oy), lim = R - e.r - 4;
    if (od > lim) {
      const nx = ox / od, ny = oy / od;
      e.x = CX + nx * lim; e.y = CY + ny * lim;
      if ((e.kind === 'dasher' && e.st === 2) || (e.kind === 'orbiter' && e.st === 3)) {
        e.st = e.kind === 'dasher' ? 3 : 4; e.t = 0.5;
        e.vx *= 0.1; e.vy *= 0.1;
        burst(CX + nx * R, CY + ny * R, 10, e.K.ci, 100, 380, 0.2, 0.45, 1, 0);
      } else {
        const vn = e.vx * nx + e.vy * ny;
        if (vn > 0) { e.vx -= 2 * vn * nx; e.vy -= 2 * vn * ny; }
        if (e.kind === 'drifter') e.a = Math.atan2(e.vy, e.vx);
      }
    }
  }

  function update(dt) {
    T += dt;
    const input = api.input;

    // camera + flashes
    shake *= Math.exp(-dt * 7);
    shx = (Math.random() * 2 - 1) * shake;
    shy = (Math.random() * 2 - 1) * shake;
    flash = Math.max(0, flash - dt * 2.2);
    ringFlash = Math.max(0, ringFlash - dt * 1.4);
    if (popT > 0) { popT -= dt; popY -= dt * 40; }

    if (waveN === 0) nextWave();

    // ---- player
    if (player.alive) {
      const m = input.move;
      player.vx += m.x * 3400 * dt;
      player.vy += m.y * 3400 * dt;
      const drag = Math.exp(-dt * 7.5);
      player.vx *= drag; player.vy *= drag;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      const ox = player.x - CX, oy = player.y - CY, od = Math.hypot(ox, oy), lim = R - 16;
      if (od > lim) {
        const nx = ox / od, ny = oy / od;
        player.x = CX + nx * lim; player.y = CY + ny * lim;
        const vn = player.vx * nx + player.vy * ny;
        if (vn > 0) { player.vx -= vn * nx; player.vy -= vn * ny; }
      }
      const mm = Math.hypot(m.x, m.y);
      if (mm > 0.2) {
        const back = Math.atan2(-m.y, -m.x);
        if (Math.random() < 0.8) part(player.x + Math.cos(back) * 12, player.y + Math.sin(back) * 12, Math.cos(back + rand(-0.3, 0.3)) * 260, Math.sin(back + rand(-0.3, 0.3)) * 260, rand(0.12, 0.25), 1, CI.accent, 0);
      }
      const aim = input.aim, am = Math.hypot(aim.x, aim.y);
      player.aiming = am > 0.3;
      if (player.aiming) player.a = Math.atan2(aim.y, aim.x);
      else if (mm > 0.2) player.a += angDiff(Math.atan2(m.y, m.x), player.a) * Math.min(1, dt * 10);
      if (player.aiming) {
        player.cd -= dt;
        if (player.cd <= 0) { shoot(player.a); player.cd = Math.max(0, player.cd + 0.085); }
      } else player.cd = Math.max(0, player.cd - dt);
      if (player.inv > 0) player.inv -= dt;
      if ((input.pressed('lb') || input.pressed('rb')) && bombs > 0) bomb();
    } else if (overT < 0) {
      respawnT -= dt;
      if (respawnT <= 0) respawn();
    }

    // ---- wave director
    if (overT < 0) {
      if (phase === 'banner') {
        bannerT -= dt;
        if (bannerT <= 0) phase = 'fight';
      } else if (player.alive) {
        waveT += dt;
        if (gi < groups.length) {
          groupT -= dt;
          if (enemies.length + pending.length < 4 && groupT > 0.6) groupT = 0.6; // arena nearly empty: keep the pace up
          if (groupT <= 0 && enemies.length + pending.length < 170) {
            spawnGroup(groups[gi++]);
            // from wave 7 the arena sometimes opens two warp points at once
            if (waveN >= 7 && gi < groups.length && Math.random() < Math.min(0.45, (waveN - 6) * 0.09)) spawnGroup(groups[gi++]);
            groupT = interval;
          }
        } else {
          if (doneAt < 0) doneAt = waveT;
          if (enemies.length === 0 && pending.length === 0) {
            if (clearT < 0) clearT = 0.9;
            clearT -= dt;
            if (clearT <= 0) nextWave();
          } else if (waveT - doneAt > 20) nextWave();
        }
      }
    }
    if (bannerT > 0 && phase === 'fight') bannerT = 0;

    // ---- warp-ins
    for (const s of pending) {
      s.t -= dt;
      if (s.t > 0) continue;
      if (player.alive && s.hold < 1.5 && Math.hypot(player.x - s.x, player.y - s.y) < 170) { s.hold += dt; s.t = 0; continue; }
      s.dead = true;
      fresh.push(makeEnemy(s.kind, s.x, s.y));
      const ci = KINDS[s.kind].ci;
      burst(s.x, s.y, 12, ci, 80, 320, 0.2, 0.45, 1, 0);
      part(s.x, s.y, 0, 0, 0.25, 50, ci, 1);
    }

    // ---- enemies
    for (const e of enemies) updateEnemy(e, dt);
    const n = enemies.length;
    for (let i = 0; i < n; i++) {
      const a = enemies[i];
      for (let j = i + 1; j < n; j++) {
        const b = enemies[j], rr = (a.r + b.r) * 0.85;
        const dx = b.x - a.x;
        if (dx > rr || dx < -rr) continue;
        const dy = b.y - a.y;
        if (dy > rr || dy < -rr) continue;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr || d2 < 1e-4) continue;
        const d = Math.sqrt(d2), push = ((rr - d) * 0.25) / d;
        a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push;
      }
    }

    // ---- bullets
    for (const b of bullets) {
      const ox = b.x, oy = b.y;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const rx = b.x - CX, ry = b.y - CY;
      if (rx * rx + ry * ry > R * R) {
        b.dead = true;
        const d = Math.hypot(rx, ry), hx = CX + (rx / d) * R, hy = CY + (ry / d) * R;
        part(hx, hy, 0, 0, 0.14, 14, CI.accent, 1);
        const back = Math.atan2(-ry, -rx);
        for (let i = 0; i < 2; i++) { const a = back + rand(-1, 1), s = rand(120, 320); part(hx, hy, Math.cos(a) * s, Math.sin(a) * s, 0.2, 1, CI.accent, 0); }
        continue;
      }
      const minX = Math.min(ox, b.x), maxX = Math.max(ox, b.x), minY = Math.min(oy, b.y), maxY = Math.max(oy, b.y);
      for (const e of enemies) {
        if (e.dead) continue;
        const rr = e.r + 7;
        if (e.x < minX - rr || e.x > maxX + rr || e.y < minY - rr || e.y > maxY + rr) continue;
        if (segDist2(e.x, e.y, ox, oy, b.x, b.y) < rr * rr) { b.dead = true; hit(e, b); break; }
      }
    }

    // ---- bomb shockwaves
    for (const bl of blasts) {
      bl.r += bl.v * dt;
      for (const e of enemies) if (!e.dead && Math.hypot(e.x - bl.x, e.y - bl.y) < bl.r) kill(e, 'bomb');
      if (bl.r > bl.max) bl.dead = true;
    }

    // ---- player collisions
    if (player.alive && player.inv <= 0) {
      for (const e of enemies) {
        if (e.dead || e.age < 0.3) continue;
        const rr = e.r * 0.75 + 9;
        const dx = e.x - player.x, dy = e.y - player.y;
        if (dx * dx + dy * dy < rr * rr) { die(); break; }
      }
    }

    // ---- sparks
    const sdrag = Math.exp(-dt * 2.5);
    for (const s of sparks) {
      s.life -= dt;
      if (s.life <= 0) { s.dead = true; continue; }
      s.vx *= sdrag; s.vy *= sdrag;
      s.rot += dt * 3;
      if (player.alive) {
        const dx = player.x - s.x, dy = player.y - s.y, d = Math.hypot(dx, dy) || 1;
        if (d < 30) { collect(s); continue; }
        if (d < 210) {
          const k = 1 - d / 210, acc = 300 + 3000 * k;
          s.vx += (dx / d) * acc * dt; s.vy += (dy / d) * acc * dt;
          s.life = Math.max(s.life, 1.5);
        }
      }
      s.x += s.vx * dt; s.y += s.vy * dt;
      const ox = s.x - CX, oy = s.y - CY, od = Math.hypot(ox, oy);
      if (od > R - 10) { s.x = CX + (ox / od) * (R - 10); s.y = CY + (oy / od) * (R - 10); s.vx *= -0.5; s.vy *= -0.5; }
    }

    // ---- particles
    const drag = Math.exp(-dt * 2.8);
    for (let i = 0; i < pn;) {
      pl[i] -= dt;
      if (pl[i] <= 0) {
        pn--;
        px[i] = px[pn]; py[i] = py[pn]; pvx[i] = pvx[pn]; pvy[i] = pvy[pn]; pl[i] = pl[pn]; pm[i] = pm[pn]; ps[i] = ps[pn]; pc[i] = pc[pn]; pk[i] = pk[pn];
        continue;
      }
      px[i] += pvx[i] * dt; py[i] += pvy[i] * dt;
      pvx[i] *= drag; pvy[i] *= drag;
      i++;
    }

    // ---- ripples
    for (const r of ripples) { r.r += r.v * dt; r.life -= r.decay * dt; }

    // ---- tidy up
    if (enemies.some((e) => e.dead)) enemies = enemies.filter((e) => !e.dead);
    if (fresh.length) { for (const e of fresh) enemies.push(e); fresh.length = 0; }
    bullets = bullets.filter((b) => !b.dead);
    sparks = sparks.filter((s) => !s.dead);
    pending = pending.filter((s) => !s.dead);
    ripples = ripples.filter((r) => r.life > 0);
    blasts = blasts.filter((b) => !b.dead);

    // ---- game over (once)
    if (overT >= 0 && !overSent) {
      overT -= dt;
      if (overT <= 0) {
        overSent = true;
        api.gameOver({ score: Math.round(score), stats: { wave: highestWave, noBombWave, kills, maxMultiplier: maxMult } });
      }
    }
  }

  // ------------------------------------------------------------------ draw
  function drawGrid(ctx) {
    const x0 = CX - R, y0 = CY - R;
    const pAlive = player.alive;
    for (let j = 0; j < GN; j++) {
      for (let i = 0; i < GN; i++) {
        let x = x0 + i * GS, y = y0 + j * GS;
        let ox = 0, oy = 0;
        for (const r of ripples) {
          const dx = x - r.x, dy = y - r.y, d = Math.sqrt(dx * dx + dy * dy) || 1, diff = d - r.r;
          if (diff > 110 || diff < -110) continue;
          const f = (1 - Math.abs(diff) / 110), k = r.amp * r.life * f * f / d;
          ox += dx * k; oy += dy * k;
        }
        if (pAlive) { // the ship sits in a slight dimple
          const dx = x - player.x, dy = y - player.y, d2 = dx * dx + dy * dy;
          if (d2 < 22500) { const d = Math.sqrt(d2) || 1, f = 1 - d / 150, k = (-14 * f * f) / d; ox += dx * k; oy += dy * k; }
        }
        gx[j * GN + i] = x + ox; gy[j * GN + i] = y + oy;
      }
    }
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R - 3, 0, TAU);
    ctx.clip();
    ctx.beginPath();
    for (let j = 0; j < GN; j++) {
      ctx.moveTo(gx[j * GN], gy[j * GN]);
      for (let i = 1; i < GN; i++) ctx.lineTo(gx[j * GN + i], gy[j * GN + i]);
    }
    for (let i = 0; i < GN; i++) {
      ctx.moveTo(gx[i], gy[i]);
      for (let j = 1; j < GN; j++) ctx.lineTo(gx[j * GN + i], gy[j * GN + i]);
    }
    ctx.strokeStyle = 'rgba(70,120,240,0.17)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.beginPath();
    for (let k = 0; k < GN * GN; k++) ctx.rect(gx[k] - 1.5, gy[k] - 1.5, 3, 3);
    ctx.fillStyle = 'rgba(130,180,255,0.32)';
    ctx.fill();
    ctx.restore();
  }

  function drawWarnings(ctx) {
    for (const s of pending) {
      const k = Math.max(0, Math.min(1, 1 - s.t / s.warn));
      const pulse = 0.5 + 0.5 * Math.sin(T * 24 + s.ang * 3);
      const K = KINDS[s.kind];
      ctx.globalAlpha = 0.35 + 0.5 * pulse;
      ctx.drawImage(GL[K.ci], s.x - 26, s.y - 26, 52, 52);
      ctx.strokeStyle = K.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      circ(ctx, s.x, s.y, K.r + 46 * (1 - k));
      ctx.stroke();
      ctx.globalAlpha = 0.35 + 0.6 * pulse;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(CX, CY, R + 22, s.ang - 0.07, s.ang + 0.07);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawTelegraphs(ctx) {
    ctx.setLineDash([16, 12]);
    for (const e of enemies) {
      if (e.kind === 'dasher' && e.st === 1) {
        const locked = e.t <= 0.3, dx = Math.cos(e.a), dy = Math.sin(e.a), len = rayToRing(e.x, e.y, dx, dy);
        ctx.globalAlpha = locked ? 0.9 : 0.2 + 0.35 * (1 - e.t / dashAim());
        ctx.strokeStyle = COL.dasher;
        ctx.lineWidth = locked ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x + dx * e.r * 1.8, e.y + dy * e.r * 1.8);
        ctx.lineTo(e.x + dx * len, e.y + dy * len);
        ctx.stroke();
      } else if (e.kind === 'orbiter' && e.st === 2) {
        const dx = Math.cos(e.a), dy = Math.sin(e.a), len = Math.min(rayToRing(e.x, e.y, dx, dy), 520);
        ctx.globalAlpha = e.t <= 0.2 ? 0.85 : 0.4;
        ctx.strokeStyle = COL.orbiter;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(e.x + dx * 30, e.y + dy * 30);
        ctx.lineTo(e.x + dx * len, e.y + dy * len);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawSparks(ctx) {
    if (!sparks.length) return;
    for (const s of sparks) {
      const a = s.life < 1.5 ? (Math.floor(s.life * 10) % 2 ? 0.3 : 0.9) : 0.8;
      ctx.globalAlpha = a * 0.7;
      ctx.drawImage(GL[CI.accent], s.x - 14, s.y - 14, 28, 28);
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (const s of sparks) ngon(ctx, s.x, s.y, 6, s.rot, 4);
    ctx.strokeStyle = '#d8ffc4';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawEnemies(ctx) {
    for (const e of enemies) {
      const born = Math.min(1, e.age / 0.25);
      let s = e.r * 2.5 * born, a = 0.45;
      if (e.kind === 'dasher' && e.st === 1) a = 0.45 + 0.5 * Math.abs(Math.sin(T * 28));
      if (e.kind === 'orbiter' && e.st === 2) { s *= 1.5; a = 0.85; }
      ctx.globalAlpha = a;
      ctx.drawImage(GL[e.K.ci], e.x - s, e.y - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    for (const kind of KIND_LIST) {
      let any = false;
      ctx.beginPath();
      for (const e of enemies) {
        if (e.kind !== kind || e.flash > 0) continue;
        const born = Math.max(0.05, Math.min(1, e.age / 0.25));
        let x = e.x, y = e.y;
        if (kind === 'dasher' && e.st === 1) { x += rand(-2, 2); y += rand(-2, 2); }
        enemyPath(ctx, kind, x, y, e.r * born, e.a, e.rot, T + e.seed);
        any = true;
      }
      if (any) { ctx.fillStyle = KINDS[kind].fill; ctx.fill(); ctx.strokeStyle = KINDS[kind].color; ctx.stroke(); }
    }
    let any = false;
    ctx.beginPath();
    for (const e of enemies) if (e.flash > 0) { enemyPath(ctx, e.kind, e.x, e.y, e.r * 1.1, e.a, e.rot, T + e.seed); any = true; }
    if (any) { ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fill(); ctx.strokeStyle = '#ffffff'; ctx.stroke(); }
  }

  function drawBullets(ctx) {
    if (!bullets.length) return;
    ctx.globalAlpha = 0.45;
    for (const b of bullets) ctx.drawImage(GL[CI.bullet], b.x - 12, b.y - 12, 24, 24);
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const b of bullets) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016); }
    ctx.strokeStyle = COL.bullet;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawParticles(ctx) {
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    for (let c = 0; c < PAL.length; c++) {
      let any = false;
      ctx.beginPath();
      for (let i = 0; i < pn; i++) {
        if (pk[i] !== 0 || pc[i] !== c) continue;
        const L = 0.05 * ps[i] * (pl[i] / pm[i]);
        ctx.moveTo(px[i], py[i]);
        ctx.lineTo(px[i] - pvx[i] * L, py[i] - pvy[i] * L);
        any = true;
      }
      if (any) { ctx.strokeStyle = PAL[c]; ctx.stroke(); }
    }
    for (let i = 0; i < pn; i++) {
      if (pk[i] !== 1) continue;
      const f = pl[i] / pm[i], s = ps[i] * (0.4 + 0.6 * f);
      ctx.globalAlpha = f;
      ctx.drawImage(GL[pc[i]], px[i] - s, py[i] - s, s * 2, s * 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlayer(ctx) {
    if (!player.alive) return;
    const { x, y, a } = player;
    const blink = player.inv > 0 && Math.floor(T * 14) % 2 === 0;
    ctx.globalAlpha = 0.09;
    ctx.drawImage(POOL, x - 230, y - 230, 460, 460);
    ctx.globalAlpha = blink ? 0.3 : 0.85;
    ctx.drawImage(GL[CI.accent], x - 44, y - 44, 88, 88);
    if (player.aiming) {
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 64, a - 0.18, a + 0.18);
      ctx.stroke();
    }
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.beginPath();
    poly(ctx, SHIP, x, y, 18, a);
    ctx.fillStyle = 'rgba(124,255,79,0.35)';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
    if (player.inv > 0) {
      ctx.globalAlpha = Math.min(1, player.inv) * 0.5;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2;
      ctx.beginPath();
      circ(ctx, x, y, 28 + Math.sin(T * 10) * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawShockwaves(ctx) {
    if (!blasts.length && !ripples.some((r) => r.amp >= 30)) return;
    ctx.save();
    ctx.beginPath();
    ctx.arc(CX, CY, R + 6, 0, TAU);
    ctx.clip();
    for (const r of ripples) {
      if (r.amp < 30 || r.r > 1400) continue;
      ctx.globalAlpha = Math.max(0, r.life) * 0.5;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 4;
      ctx.beginPath();
      circ(ctx, r.x, r.y, r.r);
      ctx.stroke();
    }
    for (const b of blasts) {
      const f = 1 - b.r / b.max;
      ctx.globalAlpha = Math.max(0, f);
      ctx.strokeStyle = '#eaffdf';
      ctx.lineWidth = 10 * f + 2;
      ctx.beginPath();
      circ(ctx, b.x, b.y, b.r);
      ctx.stroke();
      ctx.globalAlpha = Math.max(0, f) * 0.3;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 40;
      ctx.stroke();
    }
    ctx.restore();
  }

  function spaced(ctx, text, x, y, gap) {
    // draws centred text with extra tracking (canvas letterSpacing is not everywhere)
    let wsum = 0;
    const ws = [...text].map((ch) => { const w = ctx.measureText(ch).width; wsum += w; return w; });
    let cx = x - (wsum + gap * (ws.length - 1)) / 2;
    ctx.textAlign = 'left';
    [...text].forEach((ch, i) => { ctx.fillText(ch, cx, y); cx += ws[i] + gap; });
  }

  function drawBanner(ctx) {
    if (bannerT <= 0) return;
    const total = waveN === 1 ? 3 : 2.3, el = total - bannerT;
    const a = Math.max(0, Math.min(1, el / 0.3, bannerT / 0.45));
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.globalAlpha = a;
    ctx.font = '200 132px "Segoe UI", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 30;
    spaced(ctx, `WAVE ${waveN}`, CX, CY - 200 - (1 - a) * 20, 18);
    ctx.shadowBlur = 0;
    const sub = INTRO[waveN] || (waveN === 10 ? 'Milestone wave  ·  hold the ring' : waveN > 5 ? `Arena speed +${Math.round((spd - 1) * 100)}%` : '');
    if (sub) {
      ctx.font = '400 26px "Segoe UI", sans-serif';
      ctx.fillStyle = ACCENT;
      ctx.textAlign = 'center';
      ctx.fillText(sub, CX, CY - 112);
    }
    ctx.restore();
  }

  function drawPop(ctx) {
    if (popT <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, popT / 0.4);
    ctx.font = '600 44px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = ACCENT;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 18;
    ctx.fillText(popText, popX + shx, popY + shy);
    ctx.restore();
  }

  function drawMultBar(ctx) {
    const x = 48, y = 74, w = 250, h = 5;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(x, y, w, h);
    const f = mult >= 10 ? 1 : prog / need(mult);
    ctx.fillStyle = ACCENT;
    ctx.globalAlpha = mult >= 10 ? 0.6 + 0.4 * Math.sin(T * 8) : 1;
    ctx.fillRect(x, y, w * f, h);
    ctx.globalAlpha = 0.55;
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(mult >= 10 ? 'MAX MULTIPLIER' : `NEXT x${mult + 1}`, x, y + 11);
    ctx.restore();
  }

  function draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0);
    ctx.translate(shx, shy);
    drawGrid(ctx);
    ctx.globalCompositeOperation = 'lighter';
    const rx = CX - ring.width / 2, ry = CY - ring.height / 2;
    ctx.globalAlpha = 0.78 + 0.14 * Math.sin(T * 2.2);
    ctx.drawImage(ring, rx, ry);
    if (ringFlash > 0) { ctx.globalAlpha = Math.min(1, ringFlash); ctx.drawImage(ring, rx, ry); }
    ctx.globalAlpha = 1;
    drawWarnings(ctx);
    drawTelegraphs(ctx);
    drawSparks(ctx);
    drawEnemies(ctx);
    drawBullets(ctx);
    drawParticles(ctx);
    drawPlayer(ctx);
    drawShockwaves(ctx);
    ctx.restore();

    ctx.save();
    if (flash > 0) { ctx.fillStyle = `rgba(235,255,225,${(flash * 0.35).toFixed(3)})`; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(vig, 0, 0);
    ctx.restore();
    drawPop(ctx);
    drawBanner(ctx);
    api.hud(ctx, { score, left: [`Wave ${Math.max(1, waveN)}`, `x${mult}`], right: [`Lives ${Math.max(0, lives)}`, `Bombs ${bombs}`] });
    drawMultBar(ctx);
  }

  // Dev/test hook only: a harness can define window.__pulseDev(fn) to inspect a running game.
  if (typeof window !== 'undefined' && typeof window.__pulseDev === 'function') {
    window.__pulseDev({
      info: () => ({ T, score, kills, mult, maxMult, lives, bombs, waveN, enemies: enemies.length, particles: pn, sparks: sparks.length, pending: pending.length }),
      jump: (w) => { for (const e of enemies) e.dead = true; pending = []; waveN = w - 1; nextWave(); },
      god: (on) => { player.inv = on ? 1e9 : 0; },
      stress: (n = 150) => {
        for (let i = 0; i < n; i++) { const a = Math.random() * TAU, d = 120 + Math.random() * (R - 160); fresh.push(makeEnemy(KIND_LIST[i % 6], CX + Math.cos(a) * d, CY + Math.sin(a) * d)); }
        for (let i = 0; i < 1100; i++) part(rand(CX - R, CX + R), rand(CY - R, CY + R), rand(-200, 200), rand(-200, 200), rand(2.5, 3.5), i % 3 ? 1 : 12, i % PAL.length, i % 3 ? 0 : 1);
      },
    });
  }

  return { update, draw };
}

// ------------------------------------------------------------------ box art
function artScene(ctx, w, h, o) {
  const r = rng(o.seed);
  const s = o.s;
  // sky
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#02030a'); g.addColorStop(0.55, '#081536'); g.addColorStop(1, '#010309');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const blob = (x, y, rad, c) => {
    const q = ctx.createRadialGradient(x, y, 0, x, y, rad);
    q.addColorStop(0, c); q.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = q;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  ctx.globalCompositeOperation = 'lighter';
  blob(o.cx, o.cy - o.ry * 0.3, o.rx * 1.5, 'rgba(40,140,90,0.22)');
  blob(o.cx - o.rx * 0.9, o.cy - o.ry * 2.2, o.rx * 0.9, 'rgba(120,70,255,0.14)');
  blob(o.cx + o.rx * 0.9, o.cy - o.ry * 1.4, o.rx * 0.8, 'rgba(255,60,150,0.10)');
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = `rgba(170,200,255,${(0.1 + r() * 0.5).toFixed(2)})`;
    const z = r() < 0.9 ? 1 : 2;
    ctx.fillRect(r() * w, r() * h, z * s * 1.4, z * s * 1.4);
  }

  // floor in perspective: unit disk -> screen
  const map = (u, v) => [o.cx + u * o.rx * (0.8 + 0.2 * (v + 1) / 2), o.cy + v * o.ry];
  const ringPath = (k) => {
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const t = (i / 120) * TAU, [X, Y] = map(Math.cos(t) * k, Math.sin(t) * k); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
  };
  ctx.save();
  ringPath(1);
  g = ctx.createRadialGradient(o.cx, o.cy, 0, o.cx, o.cy, o.rx);
  g.addColorStop(0, 'rgba(40,90,190,0.5)'); g.addColorStop(0.75, 'rgba(14,30,80,0.55)'); g.addColorStop(1, 'rgba(124,255,79,0.25)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.clip();
  ctx.beginPath();
  for (let k = -10; k <= 10; k++) {
    const u = k / 10;
    for (let i = 0; i <= 20; i++) { const [X, Y] = map(u, -1 + i / 10); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
    for (let i = 0; i <= 20; i++) { const [X, Y] = map(-1 + i / 10, u); if (i) ctx.lineTo(X, Y); else ctx.moveTo(X, Y); }
  }
  ctx.strokeStyle = 'rgba(90,150,255,0.28)';
  ctx.lineWidth = Math.max(1, 1.1 * s);
  ctx.stroke();
  ctx.restore();

  // pulse rings around the ship + the ring of light
  ctx.globalCompositeOperation = 'lighter';
  for (const [k, a] of [[0.32, 0.35], [0.55, 0.18], [0.78, 0.08]]) {
    ringPath(k);
    ctx.strokeStyle = `rgba(124,255,79,${a})`;
    ctx.lineWidth = 3 * s;
    ctx.stroke();
  }
  ctx.shadowColor = ACCENT;
  for (const [lw, c, blur] of [[50, 'rgba(124,255,79,0.06)', 0], [22, 'rgba(124,255,79,0.14)', 0], [9, 'rgba(124,255,79,0.45)', 40], [4, 'rgba(220,255,200,1)', 20], [1.6, '#ffffff', 0]]) {
    ringPath(1);
    ctx.lineWidth = lw * s;
    ctx.strokeStyle = c;
    ctx.shadowBlur = blur * s;
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ringPath(1.08);
  ctx.strokeStyle = 'rgba(124,255,79,0.22)';
  ctx.lineWidth = 1.5 * s;
  ctx.stroke();
  // light column rising from the arena
  g = ctx.createLinearGradient(o.cx - o.rx * 0.25, 0, o.cx + o.rx * 0.25, 0);
  g.addColorStop(0, 'rgba(124,255,79,0)'); g.addColorStop(0.5, 'rgba(124,255,79,0.07)'); g.addColorStop(1, 'rgba(124,255,79,0)');
  ctx.fillStyle = g;
  ctx.fillRect(o.cx - o.rx * 0.25, 0, o.rx * 0.5, o.cy);

  const glowAt = (x, y, rad, c, a = 1) => {
    const q = ctx.createRadialGradient(x, y, 0, x, y, rad);
    q.addColorStop(0, rgba(c, a)); q.addColorStop(0.3, rgba(c, a * 0.45)); q.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = q;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  };
  const enemy = (kind, u, v, size, a, rot, lift = 0) => {
    const [X, Y0] = map(u, v);
    const depth = 0.75 + 0.25 * (v + 1) / 2, rr = size * s * depth, Y = Y0 - lift * s;
    const c = KINDS[kind].color;
    glowAt(X, Y, rr * 3, c, 0.55);
    ctx.beginPath();
    enemyPath(ctx, kind, X, Y, rr, a, rot, 0.7);
    ctx.fillStyle = rgba(c, 0.22);
    ctx.fill();
    ctx.shadowColor = c;
    ctx.shadowBlur = 14 * s;
    ctx.strokeStyle = c;
    ctx.lineWidth = 3.2 * s * depth;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.shadowBlur = 0;
    return [X, Y];
  };

  const [sx, sy0] = map(0, 0.05);
  const sy = sy0 - 10 * s;
  const shipA = o.shipA;
  const [tx, ty] = map(o.target[0], o.target[1]);
  const tY = ty - 30 * s;

  // bullet streams from the ship to the target
  const dirA = Math.atan2(tY - sy, tx - sx), dist = Math.hypot(tx - sx, tY - sy);
  for (const off of [-9, 0, 9]) {
    const nx = -Math.sin(dirA) * off * s, ny = Math.cos(dirA) * off * s;
    for (let d = 40 * s; d < dist - 30 * s; d += 46 * s) {
      const X = sx + Math.cos(dirA) * d + nx, Y = sy + Math.sin(dirA) * d + ny;
      glowAt(X, Y, 12 * s, COL.bullet, 0.5);
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X - Math.cos(dirA) * 22 * s, Y - Math.sin(dirA) * 22 * s);
      ctx.strokeStyle = '#fffbe0';
      ctx.lineWidth = 3.5 * s;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }

  // enemies
  for (const e of o.enemies) {
    const [X, Y] = map(e[1], e[2]);
    const a = e[5] === undefined ? Math.atan2(sy - Y, sx - X) : e[5];
    if (e[0] === 'dasher') {
      ctx.setLineDash([14 * s, 10 * s]);
      ctx.strokeStyle = rgba(COL.dasher, 0.7);
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(X, Y - (e[4] || 0) * s);
      ctx.lineTo(X + (sx - X) * 0.8, Y - (e[4] || 0) * s + (sy - Y) * 0.8);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    enemy(e[0], e[1], e[2], e[3], a, r() * TAU, e[4] || 0);
  }
  // orbit path around the ship
  ctx.setLineDash([4 * s, 9 * s]);
  ctx.strokeStyle = rgba(COL.orbiter, 0.45);
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.ellipse(sx, sy, o.rx * 0.36, o.ry * 0.36, 0, 0, TAU);
  ctx.stroke();
  ctx.setLineDash([]);
  enemy('orbiter', -0.3, -0.12, 20, 0, 0.6, 10);
  enemy('orbiter', 0.26, 0.24, 20, 0, 2.1, 10);

  // explosion at the target
  glowAt(tx, tY, 150 * s, '#ffffff', 0.35);
  glowAt(tx, tY, 90 * s, COL.seeker, 0.7);
  glowAt(tx, tY, 40 * s, '#ffffff', 1);
  ctx.lineCap = 'round';
  const burstCols = [COL.seeker, '#ffffff', ACCENT, COL.bullet, COL.splitter];
  for (let i = 0; i < 70; i++) {
    const a = r() * TAU, d0 = (20 + r() * 40) * s, d1 = d0 + (30 + r() * 140) * s;
    ctx.strokeStyle = burstCols[i % burstCols.length];
    ctx.globalAlpha = 0.5 + r() * 0.5;
    ctx.lineWidth = (1.5 + r() * 2.5) * s;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(a) * d0, tY + Math.sin(a) * d0 * 0.8);
    ctx.lineTo(tx + Math.cos(a) * d1, tY + Math.sin(a) * d1 * 0.8);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,240,200,0.6)';
  ctx.lineWidth = 3 * s;
  ctx.beginPath();
  ctx.ellipse(tx, tY, 120 * s, 90 * s, 0, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 40; i++) {
    const a = r() * TAU, d = (40 + r() * 220) * s;
    glowAt(tx + Math.cos(a) * d, tY + Math.sin(a) * d * 0.8, (4 + r() * 10) * s, burstCols[i % burstCols.length], 0.9);
  }

  // sparks drifting toward the ship
  for (let i = 0; i < 18; i++) {
    const k = r(), X = tx + (sx - tx) * k * 0.8 + (r() - 0.5) * 120 * s, Y = tY + (sy - tY) * k * 0.8 + (r() - 0.5) * 90 * s;
    glowAt(X, Y, 14 * s, ACCENT, 0.7);
    ctx.beginPath();
    ngon(ctx, X, Y, 6 * s, r() * TAU, 4);
    ctx.strokeStyle = '#d8ffc4';
    ctx.lineWidth = 2 * s;
    ctx.stroke();
  }

  // the ship
  glowAt(sx, sy + 26 * s, 130 * s, ACCENT, 0.35);
  glowAt(sx, sy, 60 * s, ACCENT, 0.9);
  ctx.beginPath();
  poly(ctx, SHIP, sx, sy, 34 * s, shipA);
  ctx.fillStyle = 'rgba(124,255,79,0.45)';
  ctx.fill();
  ctx.shadowColor = ACCENT;
  ctx.shadowBlur = 24 * s;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 4 * s;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.shadowBlur = 0;
  // engine trail
  for (let i = 1; i < 9; i++) {
    const X = sx - Math.cos(shipA) * (30 + i * 16) * s, Y = sy - Math.sin(shipA) * (30 + i * 16) * s;
    glowAt(X, Y, (16 - i) * s, ACCENT, 0.6 - i * 0.06);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function artTitle(ctx, x, y, size, align, s) {
  // "PULSE" heavy over "ARENA" thin, tracked to the same width; returns the block width
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${size}px "Segoe UI", sans-serif`;
  const word = 'PULSE', gap1 = size * 0.03;
  const w1 = [...word].reduce((a, ch) => a + ctx.measureText(ch).width, 0) + gap1 * (word.length - 1);
  const left = align === 'center' ? x - w1 / 2 : x;
  const draw = (text, font, gap, yy, fill, blur) => {
    ctx.font = font;
    let cx = left;
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = blur;
    ctx.fillStyle = fill;
    for (const ch of text) { ctx.fillText(ch, cx, yy); cx += ctx.measureText(ch).width + gap; }
  };
  const g = ctx.createLinearGradient(0, y - size * 0.75, 0, y);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#e9ffe0'); g.addColorStop(1, ACCENT);
  draw(word, `900 ${size}px "Segoe UI", sans-serif`, gap1, y, g, 34 * s);
  draw(word, `900 ${size}px "Segoe UI", sans-serif`, gap1, y, g, 0);
  // "ARENA": thin, spread to the width of "PULSE"
  const size2 = size * 0.4;
  ctx.font = `200 ${size2}px "Segoe UI", sans-serif`;
  const w2 = [...'ARENA'].reduce((a, ch) => a + ctx.measureText(ch).width, 0);
  const gap2 = (w1 - w2) / 4;
  const y2 = y + size2 * 1.25;
  draw('ARENA', `200 ${size2}px "Segoe UI", sans-serif`, gap2, y2, '#ffffff', 18 * s);
  // accent rule between the words
  ctx.shadowBlur = 12 * s;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(left, y + size * 0.11, w1, Math.max(2, 3 * s));
  ctx.restore();
  return { left, width: w1, bottom: y2 };
}

function artTag(ctx, text, x, y, size, width, align) {
  ctx.save();
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.textBaseline = 'alphabetic';
  const chars = [...text];
  const raw = chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0);
  const gap = Math.max(size * 0.15, (width - raw) / (chars.length - 1));
  const total = raw + gap * (chars.length - 1);
  let cx = align === 'center' ? x - total / 2 : x;
  for (const ch of chars) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + gap; }
  ctx.restore();
}

function cover(ctx, w, h) {
  const rx = w * 0.62, s = rx / 435;
  artScene(ctx, w, h, {
    cx: w * 0.5, cy: h * 0.64, rx, ry: rx * 0.55, s, seed: 360, shipA: -1.15, target: [0.42, -0.72],
    enemies: [
      ['drifter', -0.62, -0.55, 22, 30, 0], ['drifter', -0.1, -0.86, 18, 20, 0], ['drifter', 0.78, 0.1, 22, 20, 0],
      ['seeker', -0.5, 0.42, 20, 12], ['seeker', -0.72, 0.15, 18, 12], ['seeker', 0.05, 0.72, 20, 12],
      ['splitter', 0.62, -0.32, 28, 18, 0.4], ['shard', 0.8, -0.5, 12, 16], ['shard', 0.7, -0.08, 12, 16],
      ['dasher', -0.82, -0.18, 22, 14],
    ],
  });
  // title band
  let g = ctx.createLinearGradient(0, 0, 0, h * 0.42);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h * 0.42);
  g = ctx.createLinearGradient(0, h * 0.82, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = g;
  ctx.fillRect(0, h * 0.82, w, h * 0.18);
  const t = artTitle(ctx, w / 2, h * 0.205, w * 0.25, 'center', s);
  artTag(ctx, 'TWIN-STICK SHOOTER', w / 2, h * 0.945, w * 0.03, t.width * 0.92, 'center');
  ctx.fillStyle = ACCENT;
  ctx.fillRect(w / 2 - w * 0.05, h * 0.905, w * 0.1, Math.max(2, 2.5 * s));
}

function hero(ctx, w, h) {
  const rx = Math.min(w * 0.3, h * 0.66), s = rx / 435;
  artScene(ctx, w, h, {
    cx: w * 0.685, cy: h * 0.6, rx, ry: rx * 0.42, s, seed: 720, shipA: -0.75, target: [0.55, -0.62],
    enemies: [
      ['drifter', -0.55, -0.6, 22, 30, 0], ['drifter', 0.05, -0.88, 18, 20, 0], ['drifter', 0.85, 0.2, 22, 20, 0],
      ['seeker', -0.45, 0.5, 20, 12], ['seeker', -0.75, 0.2, 18, 12], ['seeker', 0.1, 0.75, 20, 12],
      ['splitter', 0.7, -0.2, 28, 18, 0.4], ['shard', 0.86, -0.42, 12, 16], ['shard', 0.6, 0.05, 12, 16],
      ['dasher', -0.85, -0.25, 22, 14],
    ],
  });
  const g = ctx.createLinearGradient(0, 0, w * 0.55, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.75)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w * 0.55, h);
  const size = Math.min(h * 0.18, w * 0.095);
  const t = artTitle(ctx, w * 0.055, h * 0.47, size, 'left', size / 144);
  artTag(ctx, 'TWIN-STICK SHOOTER', t.left, t.bottom + size * 0.5, size * 0.15, t.width, 'left');
}

export default {
  key: 'pulse',
  title: 'Pulse Arena',
  tagline: 'Twin-stick shooter',
  accent: ACCENT,
  controls: [
    ['Left stick', 'Fly'],
    ['Right stick', 'Aim and fire'],
    ['LB / RB', 'Bomb (3 per life)'],
    ['Sparks', 'Collect to raise the multiplier'],
    ['Keyboard', 'WASD · arrows · Q / E'],
    ['Start', 'Pause'],
  ],
  art: { cover, hero },
  create,
};
