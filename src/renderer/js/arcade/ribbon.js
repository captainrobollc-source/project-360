// Ribbon Rivals: an original neon trail racer for the Project 360 arcade.
//
// One to four riders share a dark arena. Each rider is a glowing head that pulls a ribbon of light
// behind it; touching any ribbon (your own included) or the edge ends your round. Every couple of
// seconds a ribbon leaves a short gap that a brave rider can slip through. Hold A to boost, and grab
// pickups to phase through ribbons, wipe the arena clean or boost for free.
//   1 player   Gauntlet: you against CPU rivals with three lives; rounds get busier, faster, smarter.
//   2-4        Party: first to five round wins, empty seats optionally filled by CPU rivals.
// Collisions and the CPU look-ahead both read one coarse occupancy grid instead of lists of segments,
// so a round with a kilometre of ribbon costs the same as one that just started. Ribbons are painted
// once, as they grow, into persistent offscreen canvases and never redrawn.

const W = 1920;
const H = 1080;
const TAU = Math.PI * 2;
const ACCENT = '#ff4fd8';

// the arena and its occupancy grid
const CELL = 8;                    // px per grid cell; a ribbon is about one cell wide
const GW = 224;                    // 224 × 112 cells = 1792 × 896 px
const GH = 112;
const AX = (W - GW * CELL) / 2;    // arena edges
const AY = 140;
const AR = AX + GW * CELL;
const AB = AY + GH * CELL;
const ACX = (AX + AR) / 2;
const ACY = (AY + AB) / 2;
const BLK = 8;                     // cells per side of a crowding block (the CPUs' sense of open space)
const BW = GW / BLK;
const BH = GH / BLK;
const QW = GW / 2;                 // the room-finding grid: 2 × 2 cells each (16 px)
const QH = GH / 2;
const ROOM_CAP = 1000;             // coarse cells (about 500 × 500 px) a CPU flood-fills before it calls a place roomy

// riding
const BASE_SPEED = 270;            // px/s
const BOOST_MUL = 1.7;
const TURN = 3.6;                  // rad/s: the tightest curve anyone can carve (radius = speed / TURN)
const STEP = 3;                    // movement sub-step in px, well under a cell so nothing tunnels
const SELF_GRACE = 26;             // px of your own freshest ribbon that can't hit you
const GAP_LEN = 46;                // px of open ribbon in each gap
const GAP_MIN = 1.7;               // s between gaps
const GAP_MAX = 2.6;
const MAX_GAPS = 160;
const BOOST_DRAIN = 0.55;          // meter/s while boosting: a full meter lasts about 1.8 s
const BOOST_FILL = 0.11;           // meter/s otherwise: about 9 s from empty
const OVERDRIVE_AT = 30;           // s into a round before the pace starts creeping up
const PROBE_STEP = 5;              // px between CPU look-ahead samples (under a cell, so thin ribbons aren't skipped)
const PROBE_SIDE = 6;              // px of clearance the look-ahead keeps on each side
const PROBES = [-1.6, -1.0, -0.55, -0.22, 0, 0.22, 0.55, 1.0, 1.6];
const SUBPROBES = [-1.4, 0, 1.4];

// match flow
const LIVES = 3;
const PARTY_WINS = 5;
const SETTLE_T = 1.15;             // slow motion after a round is decided
const BOARD_T = 2.6;               // scoreboard between rounds
const OVER_T = 2.4;                // final banner before the result screen

const RIDERS = [
  { name: 'Magenta', color: '#ff4fd8' },
  { name: 'Cyan', color: '#38e4ff' },
  { name: 'Lime', color: '#a6ff3d' },
  { name: 'Amber', color: '#ffae2e' },
];
// start spots as fractions of the arena; everyone faces the middle, swung the same way, so nobody starts head-on
const SPOTS = [[-0.34, -0.3], [0.34, 0.3], [0.34, -0.3], [-0.34, 0.3]];
const PICKUPS = {
  phase: { name: 'PHASE', color: '#b38cff', dur: 4, hint: 'RIDE THROUGH RIBBONS' },
  wipe: { name: 'WIPE', color: '#e9f6ff', dur: 0, hint: 'CLEARS EVERY RIBBON' },
  charge: { name: 'CHARGE', color: '#ffe14a', dur: 3.5, hint: 'FREE BOOST' },
};
const PICK_BAG = ['phase', 'charge', 'phase', 'charge', 'wipe'];
const BTN_COL = { A: '#5fd34a', B: '#ff4d4d', X: '#3d8bff', Y: '#ffc533' };
const DASH = [10, 8];

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
function shuffle(arr, r = Math.random) {
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
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };

// Does segment ab cross segment cd? Half-open: a point exactly on a line counts as being on its negative
// side, so a step that ends exactly on a gap's line and the next one that starts there count as exactly
// one crossing between them (a strict test would miss it, a closed one would count it twice).
function segCross(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  if ((d1 > 0) === (d2 > 0)) return false;
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return (d3 > 0) !== (d4 > 0);
}

function fitFont(ctx, text, size, weight, spacing, maxW) {
  ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${spacing}px`;
  const wd = ctx.measureText(text).width;
  if (wd > maxW) { size *= maxW / wd; spacing *= maxW / wd; ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`; ctx.letterSpacing = `${spacing}px`; }
  return size;
}

// ------------------------------------------------------------------ arena backdrop (painted once)
let arenaCanvas = null;
function arenaLayer() {
  if (arenaCanvas) return arenaCanvas;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#06030e'); gr.addColorStop(1, '#030208');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const r = rng32(31);
  for (let i = 0; i < 140; i++) {
    const x = r() * W, y = r() * H;
    if (x > AX - 30 && x < AR + 30 && y > AY - 30 && y < AB + 30) continue;
    g.fillStyle = `rgba(255,220,250,${0.1 + r() * 0.35})`;
    g.fillRect(x, y, r() < 0.15 ? 2 : 1, r() < 0.15 ? 2 : 1);
  }
  // the floor, lit faintly from the middle
  gr = g.createRadialGradient(ACX, ACY, 0, ACX, ACY, 1050);
  gr.addColorStop(0, '#140a2a'); gr.addColorStop(0.55, '#0b0619'); gr.addColorStop(1, '#060410');
  g.fillStyle = gr; g.fillRect(AX, AY, AR - AX, AB - AY);
  // grid: fine lines every 32 px, stronger every 64 (8 cells, so it lines up with the edge)
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(255,79,216,0.028)';
  g.beginPath();
  for (let x = AX + 32; x < AR; x += 64) { g.moveTo(x + 0.5, AY); g.lineTo(x + 0.5, AB); }
  for (let y = AY + 32; y < AB; y += 64) { g.moveTo(AX, y + 0.5); g.lineTo(AR, y + 0.5); }
  g.stroke();
  g.strokeStyle = 'rgba(255,79,216,0.065)';
  g.beginPath();
  for (let x = AX + 64; x < AR; x += 64) { g.moveTo(x + 0.5, AY); g.lineTo(x + 0.5, AB); }
  for (let y = AY + 64; y < AB; y += 64) { g.moveTo(AX, y + 0.5); g.lineTo(AR, y + 0.5); }
  g.stroke();
  g.globalCompositeOperation = 'lighter';
  for (let x = AX + 64; x < AR; x += 64) for (let y = AY + 64; y < AB; y += 64) {
    g.fillStyle = 'rgba(255,120,230,0.10)';
    g.fillRect(x - 1, y - 1, 3, 3);
  }
  g.globalCompositeOperation = 'source-over';
  // the deadly edge (shadowBlur is fine here: this canvas is painted once)
  g.save();
  g.lineJoin = 'round';
  const eg = g.createLinearGradient(AX, AY, AR, AB);
  eg.addColorStop(0, ACCENT); eg.addColorStop(0.5, '#9a6bff'); eg.addColorStop(1, ACCENT);
  g.shadowColor = ACCENT; g.shadowBlur = 26;
  g.strokeStyle = eg; g.lineWidth = 5;
  g.strokeRect(AX - 3, AY - 3, AR - AX + 6, AB - AY + 6);
  g.strokeRect(AX - 3, AY - 3, AR - AX + 6, AB - AY + 6);
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,238,251,0.92)'; g.lineWidth = 1.6;
  g.strokeRect(AX - 3, AY - 3, AR - AX + 6, AB - AY + 6);
  g.strokeStyle = 'rgba(255,79,216,0.16)'; g.lineWidth = 2;
  g.strokeRect(AX - 18, AY - 18, AR - AX + 36, AB - AY + 36);
  g.restore();
  g.globalCompositeOperation = 'lighter';
  for (const [x, y] of [[AX - 3, AY - 3], [AR + 3, AY - 3], [AX - 3, AB + 3], [AR + 3, AB + 3]]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, 48);
    rg.addColorStop(0, 'rgba(255,255,255,0.9)'); rg.addColorStop(0.2, 'rgba(255,140,235,0.55)'); rg.addColorStop(1, 'rgba(255,79,216,0)');
    g.fillStyle = rg; g.fillRect(x - 48, y - 48, 96, 96);
  }
  arenaCanvas = c;
  return c;
}

// ------------------------------------------------------------------ box art
// Four ribbons on the arena floor, in (u across -1..1, v from near 0 to far 1), back to front. Magenta
// has just slipped through a gap in cyan's ribbon; amber didn't make it and burst against magenta's.
const ART_RIBBONS = [
  { ci: 3, pts: [[0.62, 0.99], [0.42, 0.9], [0.18, 0.8], [-0.1, 0.75], [-0.4, 0.7], [-0.75, 0.66]] },
  { ci: 1, pts: [[0.98, 0.86], [0.72, 0.7], [0.4, 0.55], [0.05, 0.47], [-0.3, 0.38], [-0.5, 0.3], [-0.58, 0.19]] },
  { ci: 2, pts: [[0.7, -0.08], [0.72, 0.14], [0.62, 0.3], [0.44, 0.37], [0.3, 0.32], [0.26, 0.23], [0.33, 0.16]] },
  { ci: 0, pts: [[-0.98, 0.97], [-0.8, 0.82], [-0.55, 0.66], [-0.28, 0.56], [-0.06, 0.47], [0.1, 0.36], [0.17, 0.26]] },
];

function artSpline(pts) {
  // Catmull-Rom through the control points
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < 18; k++) {
      const t = k / 18, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1].slice());
  return out;
}

// first proper crossing of polyline A with polyline B: segment index and fraction along A
function polyHit(A, B) {
  for (let i = 0; i < A.length - 1; i++) {
    for (let j = 0; j < B.length - 1; j++) {
      const [ax, ay] = A[i], [bx, by] = A[i + 1], [cx, cy] = B[j], [dx, dy] = B[j + 1];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (!den) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) return { i, t };
    }
  }
  return null;
}

function paintArt(ctx, w, h, portrait) {
  const s = portrait ? w / 600 : h / 720;
  const R = rng32(portrait ? 5150 : 7373);
  // a floor in perspective: x = cx + F·X/Z, y = hy + K/Z (the horizon sits far above the frame,
  // so we look steeply down onto the arena)
  const cx = portrait ? w * 0.5 : w * 0.655;
  const hy = (portrait ? -500 : -700) * s;
  const yFar = (portrait ? 300 : 165) * s;
  const ZF = 14;
  const K = (yFar - hy) * ZF;
  const ZN = K / (h + 40 * s - hy);
  const F = (portrait ? 540 : 840) * s;
  // the landscape scene is mirrored, so the crash (the busiest corner) lands away from the title
  const flip = portrait ? 1 : -1;
  const P = (u, v) => { const Z = ZN + v * (ZF - ZN); return [cx + (F * flip * u * 7) / Z, hy + K / Z, F / Z]; };
  const L = Math.hypot(w, h);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // night sky
  ctx.fillStyle = '#030209'; ctx.fillRect(0, 0, w, h);
  const [fx, fy] = P(0.05, 0.42);
  let g = ctx.createRadialGradient(fx, fy, 0, fx, fy, L * 0.8);
  g.addColorStop(0, '#2c0d42'); g.addColorStop(0.35, '#13082c'); g.addColorStop(1, '#030209');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 110; i++) {
    const x = R() * w, y = R() * yFar * 1.05;
    ctx.fillStyle = `rgba(255,225,250,${0.15 + R() * 0.5})`;
    const z = (R() < 0.12 ? 2 : 1) * s;
    ctx.fillRect(x, y, z, z);
  }

  // the arena floor and its grid
  const corners = [P(-1, 1), P(1, 1), P(1, -0.3), P(-1, -0.3)];
  ctx.beginPath(); corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  g = ctx.createLinearGradient(0, yFar, 0, h);
  g.addColorStop(0, '#0c061d'); g.addColorStop(1, '#1c0b32');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.lineWidth = Math.max(1, 1.1 * s);
  for (let i = -7; i <= 7; i++) {
    const [x0, y0] = P(i / 7, -0.3), [x1, y1] = P(i / 7, 1);
    ctx.strokeStyle = 'rgba(255,79,216,0.11)';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  for (let z = Math.ceil(ZN * 2) / 2 - 1; z <= ZF; z += 0.5) {
    const v = (z - ZN) / (ZF - ZN);
    const [x0, y0] = P(-1, v), [x1, y1] = P(1, v);
    ctx.strokeStyle = `rgba(255,79,216,${0.05 + 0.08 * clamp(1 - v, 0, 1)})`;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  }
  ctx.globalCompositeOperation = 'lighter';
  g = ctx.createRadialGradient(fx, fy, 0, fx, fy, 420 * s);
  g.addColorStop(0, 'rgba(255,79,216,0.2)'); g.addColorStop(0.5, 'rgba(150,80,255,0.07)'); g.addColorStop(1, 'rgba(150,80,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.restore();
  // the glowing edge (only the far side and the flanks are in frame)
  ctx.save();
  ctx.shadowColor = ACCENT; ctx.shadowBlur = 24 * s;
  ctx.strokeStyle = 'rgba(255,120,232,0.95)'; ctx.lineWidth = 3.5 * s;
  const edge = () => { ctx.beginPath(); [3, 0, 1, 2].forEach((k, i) => (i ? ctx.lineTo(corners[k][0], corners[k][1]) : ctx.moveTo(corners[k][0], corners[k][1]))); };
  edge(); ctx.stroke(); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,240,252,0.9)'; ctx.lineWidth = 1.2 * s;
  edge(); ctx.stroke();
  ctx.restore();

  // ribbons: amber is cut where it hit magenta, and cyan gets a gap exactly where magenta crosses it
  const paths = ART_RIBBONS.map((rb) => artSpline(rb.pts));
  const wl = (p, q) => Math.hypot((q[0] - p[0]) * 7, (q[1] - p[1]) * 6);
  const crash = polyHit(paths[0], paths[3]);
  if (crash) {
    const p = paths[0], a = p[crash.i], b = p[crash.i + 1];
    paths[0] = p.slice(0, crash.i + 1).concat([[lerp(a[0], b[0], crash.t), lerp(a[1], b[1], crash.t)]]);
  }
  const crashPt = paths[0][paths[0].length - 1];
  const cum = paths.map((p) => { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + wl(p[i - 1], p[i])); return c; });
  const slip = polyHit(paths[1], paths[3]);
  let forced = null, slipPt = null;
  if (slip) {
    const a = paths[1][slip.i], b = paths[1][slip.i + 1];
    forced = cum[1][slip.i] + wl(a, b) * slip.t;
    slipPt = [lerp(a[0], b[0], slip.t), lerp(a[1], b[1], slip.t)];
  }
  const pieces = paths.map((p, ri) => {
    const c = cum[ri], len = c[c.length - 1], gaps = [];
    if (ri === 1 && forced != null) gaps.push([forced - 0.3, forced + 0.3]);
    for (let d = 1.2 + ri * 0.45; d < len - 0.9; d += 2.2) {
      if (ri === 1 && forced != null && Math.abs(d + 0.25 - forced) < 1.0) continue;
      gaps.push([d, d + 0.5]);
    }
    const out = [];
    let cur = [];
    for (let i = 0; i < p.length; i++) {
      if (gaps.some(([a, b]) => c[i] > a && c[i] < b)) { if (cur.length > 1) out.push(cur); cur = []; } else cur.push(P(p[i][0], p[i][1]));
    }
    if (cur.length > 1) out.push(cur);
    return out;
  });
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const o = off.getContext('2d');
  o.lineCap = 'round'; o.lineJoin = 'round';
  ART_RIBBONS.forEach((rb, ri) => {
    const col = RIDERS[rb.ci].color;
    o.clearRect(0, 0, w, h);
    o.strokeStyle = col;
    for (const pc of pieces[ri]) {
      for (let i = 1; i < pc.length; i++) {
        o.lineWidth = 0.13 * (pc[i][2] + pc[i - 1][2]) / 2;
        o.beginPath(); o.moveTo(pc[i - 1][0], pc[i - 1][1]); o.lineTo(pc[i][0], pc[i][1]); o.stroke();
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = col; ctx.shadowBlur = 34 * s; ctx.globalAlpha = 0.75;
    ctx.drawImage(off, 0, 0);
    ctx.shadowBlur = 12 * s; ctx.globalAlpha = 0.9;
    ctx.drawImage(off, 0, 0);
    ctx.restore();
    ctx.drawImage(off, 0, 0);
    // hot core, and a bead of light on each side of every gap
    ctx.strokeStyle = tint(col, 0.75);
    for (const pc of pieces[ri]) {
      for (let i = 1; i < pc.length; i++) {
        ctx.lineWidth = 0.045 * (pc[i][2] + pc[i - 1][2]) / 2;
        ctx.beginPath(); ctx.moveTo(pc[i - 1][0], pc[i - 1][1]); ctx.lineTo(pc[i][0], pc[i][1]); ctx.stroke();
      }
    }
    ctx.fillStyle = tint(col, 0.85);
    pieces[ri].forEach((pc, k) => {
      const ends = [];
      if (k > 0) ends.push(pc[0]);
      if (k < pieces[ri].length - 1) ends.push(pc[pc.length - 1]);
      for (const [x, y, sc] of ends) { ctx.beginPath(); ctx.arc(x, y, 0.085 * sc, 0, TAU); ctx.fill(); }
    });
  });

  // vignette (under the lights that follow, which shine through it)
  g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, L * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.7)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // magenta is boosting: sparks streaming off its tail
  const mag = paths[3];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 26; i++) {
    const k = mag.length - 2 - Math.floor(R() * 30);
    const [x, y, sc] = P(mag[k][0] + (R() - 0.5) * 0.05, mag[k][1] + (R() - 0.5) * 0.05);
    const rr = (0.04 + R() * 0.06) * sc;
    g = ctx.createRadialGradient(x, y, 0, x, y, rr * 3);
    g.addColorStop(0, 'rgba(255,240,252,0.9)'); g.addColorStop(0.3, rgba(ACCENT, 0.5)); g.addColorStop(1, rgba(ACCENT, 0));
    ctx.fillStyle = g; ctx.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
  }

  // the slip: a flash of light where magenta threads cyan's gap
  if (slipPt) {
    const [x, y, sc] = P(slipPt[0], slipPt[1]);
    g = ctx.createRadialGradient(x, y, 0, x, y, 1.1 * sc);
    g.addColorStop(0, 'rgba(255,255,255,0.7)'); g.addColorStop(0.25, 'rgba(120,230,255,0.35)'); g.addColorStop(1, 'rgba(56,228,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 1.1 * sc, y - 1.1 * sc, 2.2 * sc, 2.2 * sc);
    ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.42);
    ctx.strokeStyle = 'rgba(200,245,255,0.8)'; ctx.lineWidth = 0.04 * sc;
    ctx.beginPath(); ctx.arc(0, 0, 0.75 * sc, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,140,235,0.5)'; ctx.lineWidth = 0.03 * sc;
    ctx.beginPath(); ctx.arc(0, 0, 1.05 * sc, 0, TAU); ctx.stroke();
    ctx.restore();
    for (const [sx, sy] of [[1, 0.05], [0.05, 1]]) {
      ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.2 * sc);
      g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(-1.2 * sc, -1.2 * sc, 2.4 * sc, 2.4 * sc);
      ctx.restore();
    }
  }

  // amber's crash
  {
    const [x, y, sc] = P(crashPt[0], crashPt[1]);
    g = ctx.createRadialGradient(x, y, 0, x, y, 1.6 * sc);
    g.addColorStop(0, 'rgba(255,250,230,0.95)'); g.addColorStop(0.15, 'rgba(255,190,90,0.75)'); g.addColorStop(0.5, 'rgba(255,120,40,0.22)'); g.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = g; ctx.fillRect(x - 1.6 * sc, y - 1.6 * sc, 3.2 * sc, 3.2 * sc);
    for (let i = 0; i < 30; i++) {
      const a = R() * TAU, d = (0.35 + R() * 1.25) * sc;
      const ex = x + Math.cos(a) * d, ey = y + Math.sin(a) * d * 0.55;
      const sg = ctx.createLinearGradient(x, y, ex, ey);
      sg.addColorStop(0, 'rgba(255,200,110,0)'); sg.addColorStop(0.6, 'rgba(255,190,90,0.55)'); sg.addColorStop(1, 'rgba(255,245,220,0.95)');
      ctx.strokeStyle = sg; ctx.lineWidth = (0.015 + R() * 0.025) * sc;
      ctx.beginPath(); ctx.moveTo(x + (ex - x) * 0.25, y + (ey - y) * 0.25); ctx.lineTo(ex, ey); ctx.stroke();
    }
  }

  // riders' heads
  const head = (u, v, col) => {
    const [x, y, sc] = P(u, v);
    const r = 0.16 * sc;
    ctx.globalCompositeOperation = 'lighter';
    ctx.save(); ctx.translate(x, y + r * 0.8); ctx.scale(1, 0.38);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 10);
    g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(-r * 10, -r * 10, r * 20, r * 20);
    ctx.restore();
    g = ctx.createRadialGradient(x, y, 0, x, y, r * 6.5);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(0.16, rgba(col, 0.8)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r * 6.5, y - r * 6.5, r * 13, r * 13);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = tint(col, 0.35); ctx.lineWidth = r * 0.42;
    ctx.beginPath(); ctx.arc(x, y, r * 1.55, 0, TAU); ctx.stroke();
  };
  for (const ri of [1, 2, 3]) { const p = paths[ri], e = p[p.length - 1]; head(e[0], e[1], RIDERS[ART_RIBBONS[ri].ci].color); }

  // a pickup token waiting in open floor
  {
    const [x, y, sc] = portrait ? P(0.52, 0.77) : P(-0.12, 0.93);
    const r = 0.3 * sc, col = PICKUPS.charge.color;
    ctx.globalCompositeOperation = 'lighter';
    g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
    g.addColorStop(0, rgba(col, 0.55)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + 0.3; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath();
    ctx.fillStyle = 'rgba(30,22,6,0.85)'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth = r * 0.14; ctx.stroke();
    ctx.fillStyle = tint(col, 0.4);
    const b = r * 0.62;
    ctx.beginPath();
    ctx.moveTo(x + b * 0.15, y - b); ctx.lineTo(x - b * 0.45, y + b * 0.12); ctx.lineTo(x - b * 0.02, y + b * 0.12);
    ctx.lineTo(x - b * 0.18, y + b); ctx.lineTo(x + b * 0.45, y - b * 0.15); ctx.lineTo(x + b * 0.02, y - b * 0.15);
    ctx.closePath(); ctx.fill();
  }

  // drifting motes
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 70; i++) {
    const x = R() * w, y = yFar + R() * (h - yFar), rr = (1 + R() * 2.2) * s;
    const col = RIDERS[Math.floor(R() * 4)].color;
    g = ctx.createRadialGradient(x, y, 0, x, y, rr * 3);
    g.addColorStop(0, rgba(col, 0.5)); g.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = g; ctx.fillRect(x - rr * 3, y - rr * 3, rr * 6, rr * 6);
  }
  ctx.globalCompositeOperation = 'source-over';

  // title
  let tx, y1, y2, size1, size2, maxW, align;
  if (portrait) {
    g = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    g.addColorStop(0, 'rgba(3,2,9,0.94)'); g.addColorStop(0.6, 'rgba(3,2,9,0.6)'); g.addColorStop(1, 'rgba(3,2,9,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.42);
    g = ctx.createLinearGradient(0, h * 0.88, 0, h);
    g.addColorStop(0, 'rgba(3,2,9,0)'); g.addColorStop(1, 'rgba(3,2,9,0.92)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.88, w, h * 0.12);
    tx = w / 2; align = 'center'; size1 = 160 * s; y1 = 176 * s; size2 = 66 * s; y2 = 256 * s; maxW = w * 0.88;
  } else {
    g = ctx.createLinearGradient(0, 0, w * 0.6, 0);
    g.addColorStop(0, 'rgba(3,2,9,0.94)'); g.addColorStop(0.5, 'rgba(3,2,9,0.72)'); g.addColorStop(1, 'rgba(3,2,9,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w * 0.6, h);
    tx = 76 * s; align = 'left'; size1 = 176 * s; y1 = h * 0.5 + 6 * s; size2 = 74 * s; y2 = y1 + 90 * s; maxW = w * 0.42;
  }
  const lines = [
    { text: 'RIBBON', size: size1, weight: 900, spacing: size1 * 0.03, y: y1 },
    { text: 'RIVALS', size: size2, weight: 700, spacing: size2 * 0.42, y: y2 },
  ];
  const tc = document.createElement('canvas');
  tc.width = w; tc.height = h;
  const t = tc.getContext('2d');
  t.textAlign = align; t.textBaseline = 'alphabetic';
  for (const ln of lines) {
    ln.size = fitFont(t, ln.text, ln.size, ln.weight, ln.spacing, maxW);
    ln.font = t.font; ln.ls = t.letterSpacing;
    const fg = t.createLinearGradient(0, ln.y - ln.size * 0.74, 0, ln.y);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.48, '#ffe2f7'); fg.addColorStop(0.52, '#ff9be9'); fg.addColorStop(1, '#ff4fd8');
    t.fillStyle = fg;
    t.fillText(ln.text, tx, ln.y);
  }
  // the four riders' colours running through the letters like ribbons
  t.globalCompositeOperation = 'source-atop';
  const bx0 = portrait ? w * 0.1 : tx, bx1 = portrait ? w * 0.9 : tx + maxW;
  const band = t.createLinearGradient(bx0, y1 - size1, bx1, y2);
  band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.34, 'rgba(0,0,0,0)');
  RIDERS.forEach((rd, i) => { band.addColorStop(0.38 + i * 0.05, rgba(rd.color, 0.5)); band.addColorStop(0.405 + i * 0.05, rgba(rd.color, 0.5)); });
  band.addColorStop(0.6, 'rgba(0,0,0,0)'); band.addColorStop(1, 'rgba(0,0,0,0)');
  t.fillStyle = band; t.fillRect(0, 0, w, h);
  t.globalCompositeOperation = 'source-over';
  ctx.save();
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'lighter';
  for (const ln of lines) {
    ctx.font = ln.font; ctx.letterSpacing = ln.ls;
    const dx = ln.size * 0.028;
    ctx.fillStyle = 'rgba(255,40,170,0.6)'; ctx.fillText(ln.text, tx - dx, ln.y + dx * 0.3);
    ctx.fillStyle = 'rgba(40,200,255,0.55)'; ctx.fillText(ln.text, tx + dx, ln.y - dx * 0.3);
  }
  ctx.restore();
  ctx.save();
  ctx.shadowColor = 'rgba(255,79,216,0.85)'; ctx.shadowBlur = 32 * s;
  ctx.drawImage(tc, 0, 0);
  ctx.restore();
  ctx.drawImage(tc, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gx = portrait ? w * 0.77 : tx + size1 * 2.9, gy = y1 - size1 * 0.7;
  for (const [sx, sy] of [[1, 0.06], [0.06, 1]]) {
    ctx.save(); ctx.translate(gx, gy); ctx.scale(sx, sy);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 60 * s);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(-60 * s, -60 * s, 120 * s, 120 * s);
    ctx.restore();
  }
  ctx.restore();

  // genre
  ctx.save();
  ctx.textBaseline = 'middle';
  const tagSize = 22 * s;
  ctx.font = `600 ${tagSize}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${tagSize * 0.42}px`;
  const tag = 'PARTY RACER';
  const tw = ctx.measureText(tag).width;
  const ty = portrait ? h - 46 * s : y2 + 56 * s;
  const tl = portrait ? w / 2 - tw / 2 : tx;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,230,248,0.92)';
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
function create(api) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  const glow = (c, r) => api.glow(c, r);
  const ZERO = { x: 0, y: 0 };

  // ---------------------------------------------------------- persistent ribbon layers
  // Ribbons only ever grow, so each new stretch is painted once: a crisp body on a full-size canvas,
  // plus two halos painted at low resolution and stretched up (the smoothing does the blurring).
  // Every stroke is opaque, so the joints between per-frame strokes never stack up into beads.
  const layer = (w, h, k) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.setTransform(k, 0, 0, k, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    return { c, g };
  };
  const body = layer(W, H, 1);
  const halo = layer(W / 4, H / 4, 1 / 4);
  const haze = layer(W / 12, H / 12, 1 / 12);
  const fade = layer(W, H, 1);       // the previous ribbons, fading out after a wipe or between rounds

  // ---------------------------------------------------------- occupancy grid
  const own = new Uint8Array(GW * GH);      // 0 = open, else the id (1..4) of the rider whose ribbon is there
  const stamp = new Float32Array(GW * GH);  // how far that rider had travelled when it marked the cell
  const dens = new Uint16Array(BW * BH);    // marked cells per block
  const coarse = new Uint8Array(QW * QH);   // 1 where any of the 2 × 2 cells is marked
  const wide = new Uint8Array(QW * QH);     // coarse, grown by one cell: lanes narrower than ~48 px are shut
  const seen = new Uint32Array(QW * QH);    // flood-fill visit marks (a generation counter, never cleared per fill)
  const queue = new Int32Array(QW * QH);
  const qdist = new Uint16Array(QW * QH);   // flood-fill distance from the start, per queue slot
  let gen = 0;
  const cellAt = (x, y) => {
    const cx = Math.floor((x - AX) / CELL), cy = Math.floor((y - AY) / CELL);
    return cx >= 0 && cy >= 0 && cx < GW && cy < GH ? cy * GW + cx : -1;  // (NaN lands outside, too)
  };
  const blocked = (r, i) => {
    const o = own[i];
    return o !== 0 && !(o === r.id && r.dist - stamp[i] < SELF_GRACE);
  };
  function fillCell(r, i) {
    if (own[i]) return;
    own[i] = r.id;
    stamp[i] = r.dist;
    const cx = i % GW, cy = (i / GW) | 0;
    dens[((cy / BLK) | 0) * BW + ((cx / BLK) | 0)]++;
    const qx = cx >> 1, qy = cy >> 1, q = qy * QW + qx;
    if (coarse[q]) return;
    coarse[q] = 1;
    for (let j = Math.max(0, qy - 1); j <= Math.min(QH - 1, qy + 1); j++) {
      for (let k = Math.max(0, qx - 1); k <= Math.min(QW - 1, qx + 1); k++) wide[j * QW + k] = 1;
    }
  }
  // A diagonal step between cells also fills the corner cell, so every ribbon is 4-connected and no head
  // can squeeze through the point where two diagonal cells touch.
  function mark(r, i) {
    if (i === r.lastCell) return;
    const l = r.lastCell;
    if (l >= 0) {
      const lx = l % GW, ly = (l / GW) | 0, cx = i % GW, cy = (i / GW) | 0;
      if (lx !== cx && ly !== cy && Math.abs(lx - cx) === 1 && Math.abs(ly - cy) === 1) fillCell(r, cy * GW + lx);
    }
    fillCell(r, i);
    r.lastCell = i;
  }
  function crowd(x, y) {
    // how full the 3×3 blocks around (x, y) are, 0..1; off the arena counts as full so CPUs shy from walls
    const bx = Math.floor((x - AX) / (CELL * BLK)), by = Math.floor((y - AY) / (CELL * BLK));
    let n = 0;
    for (let j = by - 1; j <= by + 1; j++) {
      for (let i = bx - 1; i <= bx + 1; i++) n += i < 0 || j < 0 || i >= BW || j >= BH ? 64 : dens[j * BW + i];
    }
    return n / (9 * 64);
  }
  // How much open floor can be reached from (x, y), in coarse cells, up to ROOM_CAP: a bounded flood fill,
  // so a CPU can tell a roomy direction from a pocket it would box itself into. Past the first couple of
  // steps it only squeezes through lanes a rider could actually turn around in.
  function roomAt(x, y) {
    const cx = Math.floor((x - AX) / (CELL * 2)), cy = Math.floor((y - AY) / (CELL * 2));
    if (!(cx >= 0 && cy >= 0 && cx < QW && cy < QH)) return 0;
    if (++gen >= 0xfffffff0) { seen.fill(0); gen = 1; }
    let head = 0, tail = 0;
    const s0 = cy * QW + cx;
    queue[tail] = s0; qdist[tail++] = 0; seen[s0] = gen;
    while (head < tail && tail < ROOM_CAP) {
      const c = queue[head], l = qdist[head++] + 1;
      const grid = l > 2 ? wide : coarse;
      const qx = c % QW;
      let n = c - 1;
      if (qx > 0 && seen[n] !== gen && !grid[n]) { seen[n] = gen; queue[tail] = n; qdist[tail++] = l; }
      n = c + 1;
      if (qx < QW - 1 && seen[n] !== gen && !grid[n]) { seen[n] = gen; queue[tail] = n; qdist[tail++] = l; }
      n = c - QW;
      if (n >= 0 && seen[n] !== gen && !grid[n]) { seen[n] = gen; queue[tail] = n; qdist[tail++] = l; }
      n = c + QW;
      if (n < QW * QH && seen[n] !== gen && !grid[n]) { seen[n] = gen; queue[tail] = n; qdist[tail++] = l; }
    }
    return Math.min(tail, ROOM_CAP);
  }
  function areaFree(x, y, rc) {
    const cx = Math.floor((x - AX) / CELL), cy = Math.floor((y - AY) / CELL);
    for (let j = cy - rc; j <= cy + rc; j++) {
      for (let i = cx - rc; i <= cx + rc; i++) if (i < 0 || j < 0 || i >= GW || j >= GH || own[j * GW + i]) return false;
    }
    return true;
  }

  // ---------------------------------------------------------- state
  const S = {
    phase: 'join', phaseT: 0, clock: 0, introT: 0, tick: 0,
    mode: null, demo: true, demoT: 0,
    joins: [], cpuFill: true, joinT: 0, countdown: 0,
    riders: [], gaps: [], picks: [], parts: [], pops: [], banner: null,
    round: 0, maxRound: 0, roundT: 0, speedMul: 1, odMul: 1, overdrive: false, ff: false,
    lives: LIVES, score: 0, roundsWon: 0, maxGaps: 0, humans: 0, matchDone: false, overSent: false,
    statsRider: null, res: null, rb: null, firstRound: true,
    pickT: 0, picksSeen: 0, hintT: 0,
    shake: 0, flash: 0, flashColor: '255,255,255', fadeT: 0, fadeRate: 1.8, sfxBudget: 0,
  };

  // ---------------------------------------------------------- input
  // api.input.pads has one entry per controller plus the keyboard; without it, everything is one device.
  const ALL = { id: 'keys', kind: 'keys', get move() { return api.input.move; }, down: (b) => api.input.down(b), pressed: (b) => api.input.pressed(b) };
  const ALL_LIST = [ALL];
  const NOPAD = { id: 'none', kind: 'pad', move: ZERO, down: () => false, pressed: () => false };
  const pads = () => (api.input.pads && api.input.pads.length ? api.input.pads : ALL_LIST);
  function padOf(r) {
    if (S.mode === 'gauntlet') return api.input; // solo: every device steers
    const list = pads();
    for (let i = 0; i < list.length; i++) if (list[i].id === r.padId) return list[i];
    return NOPAD;
  }
  function humanPressed(b) {
    if (S.mode === 'gauntlet') return api.input.pressed(b);
    for (const r of S.riders) if (r.human && padOf(r).pressed(b)) return true;
    return false;
  }
  const deviceName = (j) => (j.kind === 'keys' ? 'KEYBOARD' : `CONTROLLER ${(parseInt(String(j.padId).replace(/\D/g, ''), 10) || 0) + 1}`);

  // ---------------------------------------------------------- sound
  const panOf = (x) => clamp((x - W / 2) / 800, -0.8, 0.8);
  // UI sounds always play; simulation sounds are muted while the attract demo runs behind the join screen
  const play = (voices, ui) => { if ((ui || !S.demo) && S.sfxBudget > 0) { S.sfxBudget--; api.sfx(voices); } };
  const sfx = {
    join: (ci) => { const f = [523.25, 659.25, 783.99, 987.77][ci] || 660; play([{ tone: f, type: 'triangle', peak: 0.13, attack: 0.004, decay: 0.16 }, { tone: f * 1.5, at: 0.07, peak: 0.11, decay: 0.42 }, { tone: f * 3, at: 0.07, peak: 0.03, decay: 0.3 }], true); },
    leave: () => play([{ tone: 620, to: 260, type: 'triangle', peak: 0.1, attack: 0.004, decay: 0.2 }], true),
    toggle: (on) => play([{ tone: on ? 880 : 660, peak: 0.08, attack: 0.002, decay: 0.08 }, { tone: on ? 1320 : 440, at: 0.06, peak: 0.07, attack: 0.002, decay: 0.12 }], true),
    tick: () => play([{ tone: 880, type: 'triangle', peak: 0.12, attack: 0.002, decay: 0.12 }, { tone: 1760, peak: 0.03, attack: 0.002, decay: 0.06 }], true),
    go: () => play([
      ...[523.25, 783.99, 1046.5].map((f, i) => ({ tone: f, at: i * 0.03, type: 'triangle', peak: 0.1, attack: 0.004, decay: 0.55 })),
      { noise: true, from: 800, peakAt: 6000, to: 3000, dur: 0.4, q: 0.8, peak: 0.12 },
    ], true),
    boost: (x) => { const p = panOf(x); play([{ noise: true, from: 500, peakAt: 3200, to: 1200, dur: 0.38, q: 0.9, peak: 0.16, panFrom: p, panTo: p }, { tone: 160, to: 420, type: 'sawtooth', peak: 0.035, attack: 0.02, decay: 0.28, pan: p }]); },
    slip: (n, x) => {
      const f = 880 * Math.pow(2, Math.min(n - 1, 8) * 2 / 12), p = panOf(x);
      play([
        { tone: f, type: 'triangle', peak: 0.12, attack: 0.002, decay: 0.2, pan: p }, { tone: f * 1.5, at: 0.06, peak: 0.1, decay: 0.45, pan: p },
        { tone: f * 3.01, at: 0.06, peak: 0.03, decay: 0.3, pan: p }, { noise: true, from: 4000, peakAt: 9000, to: 6000, dur: 0.25, q: 2, peak: 0.06, panFrom: p, panTo: p },
      ]);
    },
    slipCpu: (x) => play([{ tone: 1760, peak: 0.03, attack: 0.002, decay: 0.12, pan: panOf(x) }]),
    spawn: (x) => play([{ tone: 1320, to: 1760, peak: 0.045, attack: 0.01, decay: 0.2, pan: panOf(x) }, { tone: 2640, at: 0.08, peak: 0.025, decay: 0.25, pan: panOf(x) }]),
    grab: (kind, x) => {
      const p = panOf(x);
      if (kind === 'phase') play([{ tone: 440, to: 1320, type: 'sine', peak: 0.12, attack: 0.01, decay: 0.35, pan: p }, { tone: 660, to: 1980, at: 0.04, peak: 0.05, decay: 0.35, pan: p }, { noise: true, from: 3000, peakAt: 7000, to: 2000, dur: 0.4, q: 3, peak: 0.05 }]);
      else if (kind === 'charge') play([{ tone: 330, to: 990, type: 'sawtooth', peak: 0.05, attack: 0.01, decay: 0.25, pan: p }, { tone: 990, at: 0.08, peak: 0.1, decay: 0.3, pan: p }, { tone: 1320, at: 0.14, peak: 0.08, decay: 0.4, pan: p }]);
    },
    wipe: () => play([
      { noise: true, from: 9000, peakAt: 2500, to: 200, dur: 0.9, q: 0.7, peak: 0.32 },
      { tone: 1600, to: 120, type: 'triangle', peak: 0.1, attack: 0.005, decay: 0.8 },
      { tone: 2400, to: 180, peak: 0.04, attack: 0.005, decay: 0.6 },
    ]),
    phaseOut: () => play([{ tone: 990, to: 660, type: 'square', peak: 0.03, attack: 0.002, decay: 0.08 }]),
    crash: (x, mine) => {
      const p = panOf(x);
      play([
        { noise: true, from: 1500, peakAt: 500, to: 80, dur: 0.6, q: 0.7, peak: mine ? 0.45 : 0.26, type: 'lowpass', panFrom: p, panTo: p },
        { tone: 320, to: 55, type: 'sawtooth', peak: mine ? 0.1 : 0.05, attack: 0.005, decay: 0.55, pan: p },
        { tone: 1900, to: 380, type: 'square', peak: 0.025, attack: 0.002, decay: 0.15, pan: p },
      ]);
    },
    win: () => play([
      ...[523.25, 659.25, 783.99, 1046.5, 1318.51].map((f, i) => ({ tone: f, at: i * 0.07, peak: 0.09, decay: 0.9, pan: (i - 2) * 0.2 })),
      { noise: true, at: 0.1, from: 5000, peakAt: 10000, to: 7000, dur: 0.8, q: 3, peak: 0.05 },
    ]),
    lose: () => play([{ tone: 440, to: 220, type: 'triangle', peak: 0.1, attack: 0.01, decay: 0.5 }, { tone: 330, to: 147, type: 'triangle', at: 0.18, peak: 0.09, decay: 0.7 }]),
    champion: () => play([
      ...[523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ tone: f, at: i * 0.11, type: 'triangle', peak: 0.1, decay: 0.5 })),
      ...[1046.5, 1318.51, 1567.98].map((f, i) => ({ tone: f, at: 0.5 + i * 0.02, peak: 0.08, decay: 1.4, pan: (i - 1) * 0.3 })),
      { noise: true, at: 0.5, from: 5000, peakAt: 10000, to: 7000, dur: 1.2, q: 3, peak: 0.06 },
    ]),
    overdrive: () => play([{ tone: 220, to: 880, type: 'sawtooth', peak: 0.05, attack: 0.3, decay: 0.4 }, { noise: true, from: 300, peakAt: 4000, to: 2000, dur: 0.8, q: 0.8, peak: 0.12 }]),
  };

  // ---------------------------------------------------------- particles, popups, banners
  function part(t, x, y, vx, vy, s, c, life, grow = 0) {
    if (S.parts.length < 700) S.parts.push({ t, x, y, vx, vy, s, c, life, grow, age: 0 });
  }
  function burst(x, y, col, k = 1) {
    for (let i = 0; i < 30 * k; i++) { const a = rnd(0, TAU), sp = rnd(80, 540); part(0, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(5, 12), i % 4 ? col : '#ffffff', rnd(0.4, 0.9)); }
    for (let i = 0; i < 10 * k; i++) { const a = rnd(0, TAU), sp = rnd(300, 800); part(3, x, y, Math.cos(a) * sp, Math.sin(a) * sp, 2.5, col, rnd(0.2, 0.4)); }
    part(1, x, y, 0, 0, 150 * k, col, 0.35);
    part(2, x, y, 0, 0, 10, col, 0.5, 170 * k);
  }
  function sparkle(x, y, col, n = 8, sp = 260) {
    for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(sp * 0.3, sp); part(0, x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(4, 9), i % 3 ? col : '#ffffff', rnd(0.25, 0.5)); }
  }
  function popup(x, y, text, color, size = 28) {
    if (S.pops.length >= 30) S.pops.shift();
    S.pops.push({ x: clamp(x, AX + 140, AR - 140), y: clamp(y, AY + 40, AB - 24), text, color, size, age: 0, life: 1.15 });
  }
  function banner(title, sub, color = ACCENT, dur = 1.6) { S.banner = { title, sub, color, t: 0, dur }; }

  // ---------------------------------------------------------- riders
  function makeAI(skill, aggr) {
    return {
      skill, aggr,
      look: lerp(130, 400, skill),        // px of look-ahead
      every: lerp(0.24, 0.045, skill),    // s between decisions (slow thinkers react late)
      wanderW: lerp(16, 6, skill),
      smart: clamp((skill - 0.3) / 0.6, 0, 1),   // how much it weighs the room beyond each probe
      t: rnd(0, 0.1), goalA: 0, wander: 0, wanderT: rnd(1, 3), cutD: 1e9,
    };
  }
  function makeRider(slot, ci, human, label, join, ai) {
    const c = RIDERS[ci];
    return {
      id: slot + 1, bit: 1 << slot, ci, name: c.name, color: c.color, core: tint(c.color, 0.72), bead: tint(c.color, 0.88),
      label, human, padId: join ? join.padId : null, kind: join ? join.kind : null, ai: ai || null,
      x: 0, y: 0, a: 0, goal: 0, speed: BASE_SPEED, stepLen: 0, dist: 0,
      alive: true, dx: 0, dy: 0, why: -1,
      laying: true, gapT: 0, gapLeft: 0, gapMid: false, gx: 0, gy: 0, gmx: 0, gmy: 0, gapMask: 0,
      tx: 0, ty: 0, px: 0, py: 0, lastCell: -1,
      meter: 1, boosting: false, boostMix: 0, spent: false, wantBoost: false,
      phase: 0, phaseX: 0, charge: 0, sparkT: 0,
      wins: 0, gapsRound: 0, slipOn: false, slipD: 0, slipX: 0, slipY: 0,
    };
  }
  function resetRider(r, x, y, a) {
    r.x = x; r.y = y; r.a = a; r.goal = a; r.speed = BASE_SPEED; r.dist = 0;
    r.alive = true; r.dx = x; r.dy = y; r.why = -1;
    r.laying = true; r.gapT = rnd(1.2, 2.2); r.gapLeft = 0; r.gapMid = false; r.gapMask = 0;
    r.tx = r.px = x; r.ty = r.py = y; r.lastCell = -1;
    r.meter = 1; r.boosting = false; r.boostMix = 0; r.spent = false; r.wantBoost = false;
    r.phase = 0; r.phaseX = 0; r.charge = 0; r.sparkT = 0;
    r.gapsRound = 0; r.slipOn = false;
    if (r.ai) { r.ai.goalA = a; r.ai.t = rnd(0, 0.1); }
  }
  function placeRiders() {
    const order = shuffle([0, 1, 2, 3].slice(0, S.riders.length));
    S.riders.forEach((r, i) => {
      const [fx, fy] = SPOTS[order[i]];
      const x = ACX + fx * GW * CELL, y = ACY + fy * GH * CELL;
      resetRider(r, x, y, Math.atan2(ACY - y, ACX - x) + 0.5 + rnd(-0.12, 0.12));
    });
  }
  const aliveCount = () => { let n = 0; for (const r of S.riders) if (r.alive) n++; return n; };
  const humansAlive = () => { for (const r of S.riders) if (r.alive && r.human) return true; return false; };

  // ---------------------------------------------------------- ribbons
  function paintTo(r, x, y) {
    const tx = r.tx, ty = r.ty;
    if (Math.abs(x - tx) + Math.abs(y - ty) < 0.05) return;
    let g = haze.g;
    g.strokeStyle = r.color; g.lineWidth = 44;
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
    g = halo.g;
    g.strokeStyle = r.color; g.lineWidth = 15;
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(x, y); g.stroke();
    // the body is redrawn from the previous point, so the new band's end never bites into the old core
    g = body.g;
    g.beginPath(); g.moveTo(r.px, r.py); g.lineTo(tx, ty); g.lineTo(x, y);
    g.lineCap = 'butt'; g.strokeStyle = r.color; g.lineWidth = 7; g.stroke();
    g.lineCap = 'round'; g.strokeStyle = r.core; g.lineWidth = 2.6; g.stroke();
    r.px = tx; r.py = ty; r.tx = x; r.ty = y;
  }
  function bead(r, x, y) {
    // a bright bead on each side of a gap makes the opening easy to read at speed
    const g = body.g;
    g.fillStyle = r.bead;
    g.beginPath(); g.arc(x, y, 4.6, 0, TAU); g.fill();
  }
  function restartRibbon(r) { r.tx = r.px = r.x; r.ty = r.py = r.y; r.lastCell = -1; }
  function clearRibbons() {
    body.g.clearRect(0, 0, W, H); halo.g.clearRect(0, 0, W, H); haze.g.clearRect(0, 0, W, H);
    own.fill(0); dens.fill(0); coarse.fill(0); wide.fill(0);
    S.gaps.length = 0;
  }
  function snapshot(rate) {
    // keep a picture of the current ribbons to fade out, so a wipe or a new round dissolves the old ones
    const g = fade.g;
    g.clearRect(0, 0, W, H);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = 0.32; g.drawImage(haze.c, 0, 0, W, H);
    g.globalAlpha = 0.5; g.drawImage(halo.c, 0, 0, W, H);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.drawImage(body.c, 0, 0);
    S.fadeT = 1; S.fadeRate = rate;
  }
  function startGap(r) {
    paintTo(r, r.x, r.y);
    bead(r, r.x, r.y);
    r.laying = false; r.gapLeft = GAP_LEN; r.gapMid = false; r.gapMask = 0;
    r.gx = r.x; r.gy = r.y;
  }
  function endGap(r) {
    // the span is kept as a short two-segment polyline (start, middle, end) for the slip test
    if (S.gaps.length >= MAX_GAPS) S.gaps.shift();
    const mx = r.gapMid ? r.gmx : (r.gx + r.x) / 2, my = r.gapMid ? r.gmy : (r.gy + r.y) / 2;
    S.gaps.push({ x0: r.gx, y0: r.gy, x1: mx, y1: my, x2: r.x, y2: r.y, crossed: r.gapMask, owner: r.id, d: r.dist });
    r.laying = true; r.gapLeft = 0; r.gapMid = false;
    r.gapT = rnd(GAP_MIN, GAP_MAX);
    restartRibbon(r);
    bead(r, r.x, r.y);
  }
  function wipeAll(by) {
    snapshot(2.2);
    clearRibbons();
    for (const r of S.riders) {
      restartRibbon(r);
      r.slipOn = false;
      if (r.gapLeft > 0) { r.gapLeft = 0; r.gapMid = false; r.gapT = rnd(GAP_MIN, GAP_MAX); if (r.phase <= 0) r.laying = true; }
    }
    part(2, by.x, by.y, 0, 0, 20, '#ffffff', 0.7, 1500);
    part(2, by.x, by.y, 0, 0, 10, ACCENT, 0.9, 1100);
    part(1, by.x, by.y, 0, 0, 260, '#ffffff', 0.4);
    if (!S.demo) { S.flash = 0.35; S.flashColor = '255,255,255'; S.shake = Math.max(S.shake, 5); }
    sfx.wipe();
  }

  // ---------------------------------------------------------- slipping through gaps
  function slipCheck(r, px, py) {
    const gs = S.gaps;
    for (let i = gs.length - 1; i >= 0; i--) {
      const g = gs[i];
      if (g.crossed & r.bit) continue;
      const mx = g.x1 - r.x, my = g.y1 - r.y;
      if (mx * mx + my * my > 1600) continue;  // nowhere near this one (a gap is ~46 px long)
      if (g.owner === r.id && r.dist - g.d < 30) continue;  // riding on out of the gap you just left
      if (segCross(px, py, r.x, r.y, g.x0, g.y0, g.x1, g.y1) || segCross(px, py, r.x, r.y, g.x1, g.y1, g.x2, g.y2)) {
        g.crossed |= r.bit;
        slipped(r, g.x1, g.y1);
      }
    }
    // a gap someone else is laying right now counts too: it spans from where it began to their head
    for (const o of S.riders) {
      if (o === r || !o.alive || o.gapLeft <= 0 || (o.gapMask & r.bit)) continue;
      const mx = o.gx - r.x, my = o.gy - r.y;
      if (mx * mx + my * my > 3600) continue;
      const hit = o.gapMid
        ? segCross(px, py, r.x, r.y, o.gx, o.gy, o.gmx, o.gmy) || segCross(px, py, r.x, r.y, o.gmx, o.gmy, o.x, o.y)
        : segCross(px, py, r.x, r.y, o.gx, o.gy, o.x, o.y);
      if (hit) { o.gapMask |= r.bit; slipped(r, (o.gx + o.x) / 2, (o.gy + o.y) / 2); }
    }
  }
  // A slip only counts once you've ridden a few px past it alive (clipping the gap's edge isn't threading it).
  function slipped(r, x, y) {
    if (r.slipOn) confirmSlip(r);
    r.slipOn = true; r.slipD = r.dist + 10; r.slipX = x; r.slipY = y;
  }
  function confirmSlip(r) {
    r.slipOn = false;
    r.gapsRound++;
    const live = !S.demo && S.phase === 'play';
    if (live && r === S.statsRider) S.maxGaps = Math.max(S.maxGaps, r.gapsRound);
    part(2, r.slipX, r.slipY, 0, 0, 6, r.color, 0.45, 60);
    sparkle(r.slipX, r.slipY, '#ffffff', r.human ? 12 : 5, 280);
    if (!r.human) { sfx.slipCpu(r.slipX); return; }
    if (live && S.mode === 'gauntlet') { S.score += 100; S.rb.gaps += 100; }
    part(1, r.slipX, r.slipY, 0, 0, 90, r.color, 0.3);
    popup(r.x, r.y - 40, r.gapsRound > 1 ? `THREADED ×${r.gapsRound}` : 'THREADED!', tint(r.color, 0.35), 30 + Math.min(r.gapsRound, 6) * 2);
    sfx.slip(r.gapsRound, r.x);
  }

  // ---------------------------------------------------------- moving
  // by: id of the rider whose ribbon was hit (0 for the edge)
  function crash(r, by) {
    r.alive = false;
    r.why = by;
    if (r.laying) paintTo(r, r.x, r.y);
    r.slipOn = false;
    const x = clamp(r.x, AX, AR), y = clamp(r.y, AY, AB);
    r.dx = x; r.dy = y;
    burst(x, y, r.color, r.human ? 1 : 0.75);
    sfx.crash(x, r.human);
    if (S.demo) return;
    if (r.human) { S.shake = Math.max(S.shake, 9); S.flash = Math.max(S.flash, 0.22); S.flashColor = rgbOf(r.color).join(','); }
    if (S.phase !== 'play') return;
    if (S.mode === 'gauntlet' && !r.human && S.riders[0].alive) {
      const pts = 200 + 50 * S.round;
      S.score += pts; S.rb.outlast += pts;
      popup(x, y - 34, `+${pts}  OUTLASTED`, r.color, 26);
    } else if (r.human) {
      // say what got you: it's how you learn to ride
      const o = by ? S.riders[by - 1] : null;
      const why = !o ? 'HIT THE EDGE' : o === r ? 'OWN RIBBON' : `CUT OFF BY ${o.name.toUpperCase()}`;
      popup(x, y - 34, S.mode === 'party' ? `${r.label}  ·  ${why}` : why, r.color, 30);
    }
  }

  function substep(r, st, sdt) {
    const d = angDiff(r.goal, r.a), mt = TURN * sdt;
    r.a += d > mt ? mt : d < -mt ? -mt : d;
    const px = r.x, py = r.y;
    r.x += Math.cos(r.a) * st; r.y += Math.sin(r.a) * st;
    r.dist += st;
    const i = cellAt(r.x, r.y);
    if (i < 0) { crash(r, 0); return; }            // the edge is deadly even while phasing
    if (r.phase > 0) return;
    if (blocked(r, i)) { crash(r, own[i]); return; }
    if (S.gaps.length || S.riders.length > 1) slipCheck(r, px, py);
    if (r.slipOn && r.dist >= r.slipD) confirmSlip(r);
    // gaps open on a timer and close after a fixed distance, so they're the same size at any speed
    if (r.gapLeft > 0) {
      r.gapLeft -= st;
      if (!r.gapMid && r.gapLeft <= GAP_LEN / 2) { r.gapMid = true; r.gmx = r.x; r.gmy = r.y; }
      if (r.gapLeft <= 0) endGap(r);
    } else {
      r.gapT -= sdt;
      if (r.gapT <= 0) startGap(r);
    }
    if (r.laying) mark(r, i);
  }

  function moveAll(dt) {
    // everyone takes the same number of sub-steps, interleaved, so nobody gets to move first in a tie
    let n = 1;
    for (const r of S.riders) if (r.alive) { r.stepLen = r.speed * dt; n = Math.max(n, Math.ceil(r.stepLen / STEP)); }
    const sdt = dt / n;
    for (let k = 0; k < n; k++) for (const r of S.riders) if (r.alive) substep(r, r.stepLen / n, sdt);
    for (const r of S.riders) if (r.alive && r.laying) paintTo(r, r.x, r.y);
  }

  function steerHuman(r) {
    const p = padOf(r);
    const m = p.move || ZERO;
    // the rider turns toward the stick at its own pace; let go and it rides straight on
    r.goal = m.x * m.x + m.y * m.y > 0.1225 ? Math.atan2(m.y, m.x) : r.a;
    r.wantBoost = p.down('a');
  }

  function steerAll(dt) {
    for (const r of S.riders) {
      if (!r.alive) continue;
      if (r.human) steerHuman(r); else think(r, dt);
      const free = r.charge > 0;
      if (r.wantBoost && (free || (!r.spent && r.meter > 0))) {
        if (!r.boosting && r.human) sfx.boost(r.x);
        r.boosting = true;
        if (!free) { r.meter -= BOOST_DRAIN * dt; if (r.meter <= 0) { r.meter = 0; r.spent = true; } }
      } else {
        r.boosting = false;
        r.meter = Math.min(1, r.meter + BOOST_FILL * dt);
        if (r.spent && r.meter >= 0.25) r.spent = false;  // an emptied meter has to refill a little first
      }
      if (r.charge > 0) r.charge = Math.max(0, r.charge - dt);
      if (r.phase > 0) {
        r.phase -= dt;
        if (r.phase <= 0) endPhase(r);
        else if (r.human && r.phase < 1 && r.phase + dt >= 1) sfx.phaseOut();
      }
      r.boostMix += ((r.boosting ? 1 : 0) - r.boostMix) * Math.min(1, dt * 9);
      r.speed = BASE_SPEED * S.speedMul * S.odMul * (1 + (BOOST_MUL - 1) * r.boostMix);
      r.sparkT -= dt;
      if (r.boostMix > 0.3 && r.sparkT <= 0) {
        r.sparkT = 0.022;
        const bx = r.x - Math.cos(r.a) * 10, by = r.y - Math.sin(r.a) * 10;
        part(0, bx, by, -Math.cos(r.a) * rnd(60, 160) + rnd(-50, 50), -Math.sin(r.a) * rnd(60, 160) + rnd(-50, 50), rnd(4, 8), r.charge > 0 ? PICKUPS.charge.color : r.color, rnd(0.25, 0.45));
      }
    }
  }

  function endPhase(r) {
    // never drop a rider out of phase on top of (or a hair in front of) a ribbon: hold it a moment
    // longer until it's clear
    if (r.phaseX < 0.8) {
      const c = Math.cos(r.a), s = Math.sin(r.a);
      for (let d = 0; d <= 16; d += 8) {
        const i = cellAt(r.x + c * d, r.y + s * d);
        if (i >= 0 && own[i]) { r.phase = 0.05; r.phaseX += 0.05; return; }
      }
    }
    r.phase = 0;
    r.laying = true;
    r.gapT = rnd(GAP_MIN, GAP_MAX);
    restartRibbon(r);
  }

  // ---------------------------------------------------------- CPU riders
  // probe scratch (so probing allocates nothing): a point just short of where it stopped (for the room
  // check: right against a ribbon, a coarse cell can straddle it), and the pose ~80 px before (BOK when
  // the probe got that far, for looking one corner further)
  let PX = 0, PY = 0, BX = 0, BY = 0, BA = 0, BOK = false;
  const RING = 16;
  const ring = new Float64Array(RING * 3);
  const OTH = new Float64Array(15);  // rivals' heads for this decision: x, y, cos, sin, speed
  let nOth = 0;
  // From pose (x0, y0, a0), follow the curve the rider would really carve (turning at TURN toward heading
  // a0 + off, then straight on) through the grid, and return how far it gets before a ribbon or the edge.
  // Riders who think ahead also treat a rival's line as solid wherever its head will get there first.
  function probe(r, x0, y0, a0, off, look) {
    let x = x0, y = y0, a = a0, n = 0;
    const target = a0 + off;
    const sp = Math.max(60, r.speed);
    const ta = TURN * PROBE_STEP / sp;
    // while phasing, ribbons only stop being a problem for as far as the phase will last
    const ghost = r.phase > 0 ? (r.phase - 0.2) * r.speed : 0;
    let c = Math.cos(a), s = Math.sin(a), turning = true;
    PX = x; PY = y; BX = x; BY = y; BA = a; BOK = false;
    for (let d = PROBE_STEP; d <= look; d += PROBE_STEP) {
      if (turning) {
        const da = target - a;
        if (da > ta) a += ta; else if (da < -ta) a -= ta; else { a = target; turning = false; }
        c = Math.cos(a); s = Math.sin(a);
      }
      x += c * PROBE_STEP; y += s * PROBE_STEP;
      let hit = false;
      const i = cellAt(x, y);
      if (i < 0 || (d > ghost && blocked(r, i))) hit = true;
      // the probe is a band, not a line: a path that grazes a ribbon's corner between samples, or rides
      // right alongside one, is as good as blocked
      else if (d >= 12) {
        const j = cellAt(x - s * PROBE_SIDE, y + c * PROBE_SIDE), q = cellAt(x + s * PROBE_SIDE, y - c * PROBE_SIDE);
        if (j < 0 || q < 0 || (d > ghost && (blocked(r, j) || blocked(r, q)))) hit = true;
      }
      for (let k = 0; k < nOth && !hit; k += 5) {
        const dx = x - OTH[k], dy = y - OTH[k + 1];
        const along = dx * OTH[k + 2] + dy * OTH[k + 3];
        if (along < -12) continue;
        const perp = dx * OTH[k + 3] - dy * OTH[k + 2];
        if (perp < 16 && perp > -16 && along < (d / sp) * OTH[k + 4] + 28) hit = true;
      }
      if (hit) {
        if (n >= RING) { const o = (n % RING) * 3; BX = ring[o]; BY = ring[o + 1]; BA = ring[o + 2]; BOK = true; }
        if (n >= 4) { const o = ((n - 4) % RING) * 3; PX = ring[o]; PY = ring[o + 1]; }
        return d - PROBE_STEP;
      }
      const o = (n % RING) * 3;
      ring[o] = x; ring[o + 1] = y; ring[o + 2] = a;
      n++;
    }
    PX = x; PY = y;
    return look;
  }
  function gatherRivals(r, on) {
    nOth = 0;
    if (!on) return;
    for (const o of S.riders) {
      if (o === r || !o.alive || o.phase > 0) continue;
      OTH[nOth] = o.x; OTH[nOth + 1] = o.y; OTH[nOth + 2] = Math.cos(o.a); OTH[nOth + 3] = Math.sin(o.a); OTH[nOth + 4] = o.speed;
      nOth += 5;
    }
  }
  function rivalFor(r) {
    // the human (or nearest human) is who CPUs like to cut off; in a CPU-only showdown, anyone will do
    let best = null, bd = 1e12;
    for (const o of S.riders) {
      if (o === r || !o.alive) continue;
      const d = (o.x - r.x) ** 2 + (o.y - r.y) ** 2 - (o.human ? 1e7 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }
  function think(r, dt) {
    const ai = r.ai;
    ai.wanderT -= dt;
    if (ai.wanderT <= 0) { ai.wanderT = rnd(1.2, 3.2); ai.wander = rnd(-0.7, 0.7) * (1 - ai.skill * 0.5); }
    ai.t -= dt;
    if (ai.t > 0) return;
    ai.t = ai.every * rnd(0.75, 1.25);
    const look = ai.look * Math.max(1, r.speed / BASE_SPEED);
    // something to aim for: a point just ahead of a rival (to cut across it), or a nearby pickup
    let aimA = 0, aimW = 0;
    ai.cutD = 1e9;
    if (ai.aggr > 0) {
      const o = rivalFor(r);
      if (o) {
        const lead = 140 + 120 * ai.skill;
        const tx = o.x + Math.cos(o.a) * lead, ty = o.y + Math.sin(o.a) * lead;
        const d = Math.hypot(tx - r.x, ty - r.y);
        if (d < 620 && d > 40) { aimA = Math.atan2(ty - r.y, tx - r.x); aimW = ai.aggr * 60; ai.cutD = d; }
      }
    }
    for (const p of S.picks) {
      const d = Math.hypot(p.x - r.x, p.y - r.y);
      if (d < 360 && p.t > 0.3) { aimA = Math.atan2(p.y - r.y, p.x - r.x); aimW = 30 + 60 * ai.skill; ai.cutD = 1e9; break; }
    }
    gatherRivals(r, ai.smart > 0.3);
    let best = -1e9, bestOff = 0, ahead = look;
    for (let k = 0; k < PROBES.length; k++) {
      const off = PROBES[k];
      const free = probe(r, r.x, r.y, r.a, off, look);
      if (off === 0) ahead = free;
      // (commitment is measured against the heading it chose last time, not the old offset: offsets are
      // relative to a heading that has since turned)
      let sc = free - Math.abs(off) * 18 - Math.abs(angDiff(r.a + off, ai.goalA)) * 10 - Math.abs(off - ai.wander) * ai.wanderW;
      // smarter riders also check the room beyond: a long clear ray into a closing pocket is a trap
      if (ai.smart > 0) sc -= ai.smart * (1 - (free > 20 ? roomAt(PX, PY) : 0) / ROOM_CAP) * 600;
      if (free >= look) sc += 30 - crowd(PX, PY) * 220;   // open floor beyond the look-ahead is worth more
      else if (ai.smart > 0.5 && BOK) {
        // smart riders look one corner further: from shortly before the blockage, is there a way on?
        const bx = BX, by = BY, ba = BA;
        let way = 0;
        for (const o2 of SUBPROBES) way = Math.max(way, probe(r, bx, by, ba, o2, look * 0.7));
        sc += ai.smart * 0.7 * way;
      }
      if (aimW && free > look * 0.55) sc += aimW * Math.cos(angDiff(aimA, r.a + off));
      if (sc > best) { best = sc; bestOff = off; }
    }
    r.goal = r.a + bestOff;
    ai.goalA = r.goal;
    const cutting = aimW && ai.cutD < 420 && Math.abs(angDiff(aimA, r.a)) < 0.4;
    r.wantBoost = ahead > look * 0.7 && (r.charge > 0 || (r.meter > 0.25 && (cutting || (ai.skill > 0.45 && ahead >= look && r.meter > 0.95 && Math.random() < 0.05 * ai.skill))));
  }

  // ---------------------------------------------------------- pickups
  function spawnPick() {
    for (let tries = 0; tries < 40; tries++) {
      const x = rnd(AX + 90, AR - 90), y = rnd(AY + 90, AB - 90);
      if (!areaFree(x, y, 4)) continue;
      let near = false;
      for (const r of S.riders) if (r.alive && (r.x - x) ** 2 + (r.y - y) ** 2 < 170 * 170) near = true;
      if (near) continue;
      const kind = PICK_BAG[Math.floor(Math.random() * PICK_BAG.length)];
      S.picks.push({ kind, x, y, t: 0, life: 12, n: S.demo ? 99 : ++S.picksSeen });
      sfx.spawn(x);
      return;
    }
  }
  function updatePicks(dt) {
    S.pickT -= dt;
    if (S.pickT <= 0) { S.pickT = rnd(7, 11); if (S.picks.length < 2) spawnPick(); }
    for (let i = S.picks.length - 1; i >= 0; i--) {
      const p = S.picks[i];
      p.t += dt;
      if (p.t >= p.life) { S.picks.splice(i, 1); sparkle(p.x, p.y, PICKUPS[p.kind].color, 6, 120); }
    }
  }
  function grabPicks() {
    for (let i = S.picks.length - 1; i >= 0; i--) {
      const p = S.picks[i];
      for (const r of S.riders) {
        if (!r.alive) continue;
        const dx = r.x - p.x, dy = r.y - p.y;
        if (dx * dx + dy * dy < 32 * 32) { S.picks.splice(i, 1); grab(r, p); break; }
      }
    }
  }
  function grab(r, p) {
    const def = PICKUPS[p.kind];
    part(2, p.x, p.y, 0, 0, 14, def.color, 0.45, 90);
    sparkle(p.x, p.y, def.color, 12, 320);
    if (r.human && !S.demo) popup(r.x, r.y - 44, def.name, def.color, 30);
    if (r.human && S.mode === 'gauntlet' && S.phase === 'play') { S.score += 50; S.rb.gaps += 50; }
    if (p.kind === 'phase') {
      if (r.laying) { paintTo(r, r.x, r.y); bead(r, r.x, r.y); }
      r.laying = false; r.gapLeft = 0; r.gapMid = false; r.slipOn = false;
      r.phase = def.dur; r.phaseX = 0;
    } else if (p.kind === 'charge') {
      r.charge = def.dur; r.meter = 1; r.spent = false;
    } else {
      wipeAll(r);
    }
    sfx.grab(p.kind, r.x);
  }

  // ---------------------------------------------------------- match flow
  // Rounds 1-3 add a rival each; after that the rivals get smarter every round and, from round 6, faster,
  // with one of them (two from round 9, all three from 12) riding to cut you off. Tuned against a strong
  // bot so a good player has a fair shot at round 10 in five to eight minutes.
  function gauntletCfg(n) {
    return {
      cpus: Math.min(3, n),
      skill: clamp(0.1 + (n - 1) * 0.045, 0, 1),
      aggr: n >= 6 ? Math.min(0.9, (n - 5) * 0.1) : 0,
      aggressors: n < 6 ? 0 : n < 9 ? 1 : n < 12 ? 2 : 3,
      speed: 1 + Math.min(0.45, Math.max(0, n - 5) * 0.03),
    };
  }
  const skillName = (k) => (k < 0.3 ? 'ROOKIE' : k < 0.55 ? 'RACER' : k < 0.8 ? 'ACE' : 'LEGEND');

  function startDemo() {
    S.riders = [0, 1, 2, 3].map((i) => makeRider(i, i, false, 'CPU', null, makeAI(0.72, 0.25)));
    S.speedMul = 1.1; S.odMul = 1;
    placeRiders();
    snapshot(1.4);
    clearRibbons();
    S.picks.length = 0;
    S.roundT = 0; S.demoT = 0; S.pickT = rnd(3, 5);
  }

  function join(p) {
    let ci = 0;
    while (S.joins.some((j) => j.ci === ci)) ci++;
    S.joins.push({ padId: p.id, kind: p.kind, ci, t: S.clock });
    S.countdown = S.joins.length === 1 ? 8 : Math.max(S.countdown, 6);
    sfx.join(ci);
  }
  function leave(k) {
    S.joins.splice(k, 1);
    sfx.leave();
    if (!S.joins.length) S.countdown = 0;
  }

  function startMatch() {
    const js = S.joins.slice();
    S.humans = js.length;
    S.mode = js.length >= 2 ? 'party' : 'gauntlet';
    S.demo = false;
    S.riders = js.map((j, k) => makeRider(k, j.ci, true, `P${k + 1}`, j, null));
    if (S.mode === 'party' && S.cpuFill) {
      for (let ci = 0; ci < 4 && S.riders.length < 4; ci++) {
        if (js.some((j) => j.ci === ci)) continue;
        S.riders.push(makeRider(S.riders.length, ci, false, 'CPU', null, makeAI(0.58, 0.35)));
      }
    }
    S.statsRider = S.riders[0];
    S.round = S.mode === 'gauntlet' ? 1 : 0;
    S.maxRound = S.round;
    S.lives = LIVES; S.score = 0; S.roundsWon = 0; S.maxGaps = 0; S.matchDone = false;
    S.firstRound = true; S.hintT = 9; S.picksSeen = 0;
    S.parts.length = 0; S.pops.length = 0;
    sfx.go();
    startRound();
  }

  function startRound() {
    let sub;
    if (S.mode === 'gauntlet') {
      const cfg = gauntletCfg(S.round);
      S.speedMul = cfg.speed;
      const hum = S.riders[0];
      S.riders.length = 1;
      const colors = [0, 1, 2, 3].filter((ci) => ci !== hum.ci);
      for (let k = 0; k < cfg.cpus; k++) S.riders.push(makeRider(k + 1, colors[k], false, 'CPU', null, makeAI(cfg.skill, k < cfg.aggressors ? cfg.aggr : 0)));
      sub = `${cfg.cpus} ${skillName(cfg.skill)} RIVAL${cfg.cpus > 1 ? 'S' : ''}${cfg.speed > 1.001 ? `  ·  SPEED +${Math.round((cfg.speed - 1) * 100)}%` : ''}`;
    } else {
      S.round++;
      S.speedMul = 1;
      const lead = S.riders.reduce((m, r) => Math.max(m, r.wins), 0);
      sub = lead === PARTY_WINS - 1 ? 'MATCH POINT' : `FIRST TO ${PARTY_WINS} WINS`;
    }
    S.maxRound = Math.max(S.maxRound, S.round);
    placeRiders();
    snapshot(1.8);
    clearRibbons();
    S.picks.length = 0;
    S.rb = { survive: 0, outlast: 0, gaps: 0, win: 0 };
    S.res = null;
    S.phase = 'intro'; S.phaseT = 0; S.introT = S.firstRound ? 2.6 : 1.5; S.tick = 0;
    S.roundT = 0; S.pickT = rnd(4, 6.5); S.overdrive = false; S.odMul = 1; S.ff = false;
    banner(`ROUND ${S.round}`, sub, ACCENT, S.introT);
  }

  function endRound(winner) {
    S.phase = 'settle'; S.phaseT = 0;
    S.res = { winner, round: S.round, won: false };
    if (S.mode === 'gauntlet') {
      const h = S.riders[0];
      if (winner === h) {
        const bonus = 1000 * S.round;
        S.score += bonus; S.rb.win = bonus; S.roundsWon++;
        S.res.won = true;
        banner('ROUND CLEAR', `+${bonus.toLocaleString()} ROUND BONUS`, h.color, SETTLE_T + 0.2);
        sparkle(h.x, h.y, h.color, 24, 420);
        sfx.win();
      } else {
        S.lives = Math.max(0, S.lives - 1);
        banner(S.lives ? 'CRASHED' : 'OUT OF LIVES', S.lives ? `${S.lives} ${S.lives === 1 ? 'LIFE' : 'LIVES'} LEFT` : `ROUND ${S.round}`, '#ff5a7a', SETTLE_T + 0.2);
        sfx.lose();
      }
    } else if (winner) {
      winner.wins++;
      if (winner === S.statsRider) S.roundsWon++;
      if (winner.wins >= PARTY_WINS) S.matchDone = true;
      banner(`${winner.name.toUpperCase()} TAKES IT`, winner.human ? winner.label : 'CPU RIVAL', winner.color, SETTLE_T + 0.2);
      sparkle(winner.x, winner.y, winner.color, 24, 420);
      sfx.win();
    } else {
      banner('DRAW', 'NOBODY SCORES', '#ffffff', SETTLE_T + 0.2);
      sfx.lose();
    }
  }

  function afterSettle() {
    if (S.mode === 'gauntlet') {
      if (S.lives <= 0) { toOver(); return; }
      if (S.res.won) { S.round++; S.maxRound = Math.max(S.maxRound, S.round); }
    } else if (S.matchDone) { toOver(); return; }
    S.phase = 'board'; S.phaseT = 0;
  }

  const standings = () => S.riders.slice().sort((a, b) => b.wins - a.wins || a.id - b.id);
  function toOver() {
    S.phase = 'over'; S.phaseT = 0;
    if (S.mode === 'party') {
      const w = S.res.winner;
      banner(`${w.name.toUpperCase()} WINS!`, standings().map((r) => `${r.name.toUpperCase()} ${r.wins}`).join('   ·   '), w.color, 99);
      for (let i = 0; i < 4; i++) burst(rnd(AX + 300, AR - 300), rnd(AY + 150, AB - 150), RIDERS[(w.ci + i) % 4].color, 0.8);
      sfx.champion();
    } else {
      banner('GAME OVER', `ROUND ${S.round}  ·  ${Math.round(S.score).toLocaleString()} POINTS`, '#ff5a7a', 99);
    }
  }

  function stats() {
    return { round: S.maxRound, roundsWon: S.roundsWon, party: S.mode === 'party', humans: S.humans, matchDone: S.matchDone, maxGapsInRound: S.maxGaps };
  }
  function result() { return { score: S.mode === 'gauntlet' ? Math.round(S.score) : 0, stats: stats() }; }
  function finalResult() {
    if (S.mode !== 'party') return result();
    const w = S.res.winner;
    return {
      score: 0, stats: stats(),
      title: `${w.name} wins!`,
      message: standings().map((r) => `${r.name}${r.human ? '' : ' (CPU)'} ${r.wins}`).join('  ·  '),
    };
  }

  // ---------------------------------------------------------- update
  function simulate(dt) {
    S.odMul = S.roundT > OVERDRIVE_AT ? 1 + Math.min(0.6, (S.roundT - OVERDRIVE_AT) * 0.02) : 1;
    updatePicks(dt);
    steerAll(dt);
    moveAll(dt);
    grabPicks();
  }

  function updateJoin(dt) {
    S.joinT += dt;
    // the attract demo: four CPUs racing behind the join screen
    if (!S.riders.length) startDemo();
    S.roundT += dt;
    if (aliveCount() > 1) simulate(dt);
    else { S.demoT += dt; if (S.demoT > 1.6) startDemo(); }
    const list = pads();
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      let k = -1;
      for (let j = 0; j < S.joins.length; j++) if (S.joins[j].padId === p.id) k = j;
      if (k < 0) {
        if (S.joinT > 0.3 && S.joins.length < 4 && p.pressed('a')) join(p);
        continue;
      }
      if (p.pressed('x')) { startMatch(); return; }
      if (p.pressed('y')) { S.cpuFill = !S.cpuFill; sfx.toggle(S.cpuFill); }
      if (p.kind === 'pad' && p.pressed('b')) leave(k);
    }
    if (S.joins.length) {
      const before = Math.ceil(S.countdown);
      S.countdown -= dt;
      const now = Math.ceil(S.countdown);
      if (now !== before && now >= 1 && now <= 3) sfx.tick();
      if (S.countdown <= 0) startMatch();
    }
  }

  function updateIntro(dt) {
    S.phaseT += dt;
    // you can line up your heading during the countdown
    for (const r of S.riders) {
      if (!r.human) continue;
      steerHuman(r);
      const d = angDiff(r.goal, r.a), m = TURN * dt;
      r.a += clamp(d, -m, m);
      r.goal = r.a;
    }
    const left = S.introT - S.phaseT;
    const n = Math.ceil(left / 0.5);
    if (n >= 1 && n <= 3 && n !== S.tick) { S.tick = n; sfx.tick(); }
    if (left <= 0) {
      S.phase = 'play'; S.phaseT = 0;
      S.firstRound = false;
      banner('GO!', null, ACCENT, 0.7);
      sfx.go();
    }
  }

  function updatePlay(dt) {
    S.roundT += dt; S.phaseT += dt;
    if (S.hintT > 0) S.hintT -= dt;
    if (!S.overdrive && S.roundT >= OVERDRIVE_AT) { S.overdrive = true; banner('OVERDRIVE', 'THE PACE IS PICKING UP', '#ffae2e', 1.6); sfx.overdrive(); }
    simulate(dt);
    // party: once every human is out, fast-forward the CPU showdown
    S.ff = S.mode === 'party' && !humansAlive() && aliveCount() >= 2;
    if (S.ff) { S.roundT += dt; simulate(dt); }
    if (S.mode === 'gauntlet' && S.riders[0].alive) { const p = dt * (20 + 2 * S.round); S.score += p; S.rb.survive += p; }
    let alive = 0, last = null;
    for (const r of S.riders) if (r.alive) { alive++; last = r; }
    if (S.mode === 'gauntlet') {
      if (!S.riders[0].alive) endRound(null);
      else if (alive === 1) endRound(S.riders[0]);
    } else if (alive <= 1) endRound(last);   // last is null when the final riders went down together
  }

  function updateFx(dt) {
    const ps = S.parts;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.age += dt;
      if (p.age >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t === 0 || p.t === 3) { const k = 1 - Math.min(1, dt * 2.6); p.vx *= k; p.vy *= k; }
    }
    for (let i = S.pops.length - 1; i >= 0; i--) { const p = S.pops[i]; p.age += dt; p.y -= 60 * dt; if (p.age >= p.life) S.pops.splice(i, 1); }
    if (S.banner) { S.banner.t += dt; if (S.banner.t >= S.banner.dur) S.banner = null; }
    S.shake = Math.max(0, S.shake - dt * 30);
    S.flash = Math.max(0, S.flash - dt * 1.6);
    S.fadeT = Math.max(0, S.fadeT - dt * S.fadeRate);
  }

  function update(dt) {
    S.clock += dt;
    S.sfxBudget = 6;
    updateFx(dt);
    switch (S.phase) {
      case 'join': updateJoin(dt); break;
      case 'intro': updateIntro(dt); break;
      case 'play': updatePlay(dt); break;
      case 'settle': {
        S.phaseT += dt;
        steerAll(dt * 0.25); moveAll(dt * 0.25);   // the survivors coast on in slow motion
        if (S.phaseT >= SETTLE_T) afterSettle();
        break;
      }
      case 'board': {
        S.phaseT += dt;
        if (S.phaseT > 0.8 && humanPressed('a')) S.phaseT = BOARD_T;
        if (S.phaseT >= BOARD_T) startRound();
        break;
      }
      case 'over': {
        S.phaseT += dt;
        if (S.phaseT >= OVER_T && !S.overSent) { S.overSent = true; api.gameOver(finalResult()); }
        break;
      }
      default: break;
    }
  }

  // ---------------------------------------------------------- draw helpers
  function chromaText(ctx, text, x, y, size, weight, spacing, face) {
    ctx.font = `${weight} ${size}px "Segoe UI", sans-serif`;
    ctx.letterSpacing = `${spacing}px`;
    ctx.globalCompositeOperation = 'lighter';
    const d = Math.max(2, size * 0.025);
    ctx.fillStyle = 'rgba(255,40,170,0.6)'; ctx.fillText(text, x - d, y);
    ctx.fillStyle = 'rgba(40,200,255,0.55)'; ctx.fillText(text, x + d, y);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = face; ctx.fillText(text, x, y);
    ctx.letterSpacing = '0px';
  }
  function btn(ctx, x, y, letter, r = 17) {
    ctx.fillStyle = BTN_COL[letter];
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${Math.round(r * 1.15)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, x, y + 1);
  }
  // a "(A) LABEL" prompt, centred on x
  function promptRow(ctx, x, y, letter, text, color = '#ffffff') {
    ctx.font = '600 24px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px';
    const tw = ctx.measureText(text).width;
    const x0 = x - (tw + 46) / 2;
    btn(ctx, x0 + 17, y, letter);
    ctx.font = '600 24px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px';
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.fillText(text, x0 + 46, y + 1);
    ctx.letterSpacing = '0px';
  }
  function hexPath(ctx, x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = rot + i * TAU / 6; if (i) ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r); else ctx.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); }
    ctx.closePath();
  }

  function drawPick(ctx, p) {
    const def = PICKUPS[p.kind];
    const k = Math.min(1, p.t / 0.35);
    const fading = p.life - p.t < 2.5;
    const a = fading && Math.sin(S.clock * 22) > 0 ? 0.35 : 1;
    const r = 21 * (0.5 + 0.5 * k) * (1 + 0.06 * Math.sin(S.clock * 5 + p.x));
    ctx.globalAlpha = a;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glow(def.color, 48), p.x - r * 2.6, p.y - r * 2.6, r * 5.2, r * 5.2);
    ctx.globalCompositeOperation = 'source-over';
    hexPath(ctx, p.x, p.y, r, S.clock * 0.8);
    ctx.fillStyle = 'rgba(12,8,24,0.85)'; ctx.fill();
    ctx.strokeStyle = def.color; ctx.lineWidth = 3; ctx.stroke();
    ctx.fillStyle = tint(def.color, 0.35); ctx.strokeStyle = tint(def.color, 0.35);
    const b = r * 0.55, x = p.x, y = p.y;
    if (p.kind === 'charge') {
      ctx.beginPath();
      ctx.moveTo(x + b * 0.15, y - b); ctx.lineTo(x - b * 0.45, y + b * 0.12); ctx.lineTo(x - b * 0.02, y + b * 0.12);
      ctx.lineTo(x - b * 0.18, y + b); ctx.lineTo(x + b * 0.45, y - b * 0.15); ctx.lineTo(x + b * 0.02, y - b * 0.15);
      ctx.closePath(); ctx.fill();
    } else if (p.kind === 'phase') {
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x - b * 0.32, y, b * 0.62, 0, TAU); ctx.stroke();
      ctx.globalAlpha = a * 0.55;
      ctx.beginPath(); ctx.arc(x + b * 0.32, y, b * 0.62, 0, TAU); ctx.stroke();
      ctx.globalAlpha = a;
    } else {
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const an = i * TAU / 8 + S.clock * 2, r0 = b * (i % 2 ? 0.35 : 0.2), r1 = b * (i % 2 ? 0.75 : 1);
        ctx.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); ctx.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1);
      }
      ctx.stroke();
    }
    // name tags while pickups are still new to this run (and briefly on every spawn)
    if (p.n <= 3 || p.t < 1.5) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 17px "Segoe UI", sans-serif'; ctx.letterSpacing = '3px';
      ctx.fillStyle = def.color; ctx.fillText(def.name, x, y + r + 24);
      if (p.n <= 3) { ctx.font = '600 13px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText(def.hint, x, y + r + 42); }
      ctx.letterSpacing = '0px';
    }
    ctx.globalAlpha = 1;
  }

  function drawHeads(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const r of S.riders) {
      if (!r.alive) continue;
      const flick = r.phase > 0 ? (r.phase < 1 ? (Math.sin(S.clock * 30) > 0 ? 0.25 : 0.7) : 0.55) : 1;
      const gs = 72 + r.boostMix * 46 + (r.charge > 0 ? 12 * Math.sin(S.clock * 18) : 0);
      ctx.globalAlpha = 0.85 * flick;
      ctx.drawImage(glow(r.color, 48), r.x - gs / 2, r.y - gs / 2, gs, gs);
      if (r.boostMix > 0.05) {
        const bx = r.x - Math.cos(r.a) * 24, by = r.y - Math.sin(r.a) * 24;
        ctx.globalAlpha = r.boostMix * 0.55 * flick;
        ctx.drawImage(glow('#ffffff', 32), bx - 20, by - 20, 40, 40);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const party = S.mode === 'party';
    for (const r of S.riders) {
      if (!r.alive) {
        // where they went down
        ctx.strokeStyle = rgba(r.color, 0.55); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(r.dx - 7, r.dy - 7); ctx.lineTo(r.dx + 7, r.dy + 7); ctx.moveTo(r.dx + 7, r.dy - 7); ctx.lineTo(r.dx - 7, r.dy + 7); ctx.stroke();
        continue;
      }
      ctx.globalAlpha = r.phase > 0 ? 0.6 : 1;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(r.x, r.y, 5.5, 0, TAU); ctx.fill();
      ctx.strokeStyle = r.color; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(r.x, r.y, 8.5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      if (r.phase > 0) {
        // a dashed halo while phasing
        ctx.strokeStyle = PICKUPS.phase.color; ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (let k = 0; k < 6; k++) { const a0 = S.clock * 3 + k * TAU / 6; ctx.moveTo(r.x + Math.cos(a0) * 15, r.y + Math.sin(a0) * 15); ctx.arc(r.x, r.y, 15, a0, a0 + 0.55); }
        ctx.stroke();
      }
      if (r.human && (r.meter < 0.999 || r.boosting)) {
        ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(r.x, r.y, 20, 0, TAU); ctx.stroke();
        ctx.strokeStyle = r.spent ? '#ff5a7a' : r.charge > 0 ? PICKUPS.charge.color : 'rgba(255,255,255,0.8)';
        ctx.beginPath(); ctx.arc(r.x, r.y, 20, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0.001, r.meter)); ctx.stroke();
      }
      // name tags: always in a party, and early on in the Gauntlet so you can find yourself
      if (r.human && (party || S.phase === 'intro' || S.roundT < 3)) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.font = '700 17px "Segoe UI", sans-serif'; ctx.letterSpacing = '2px';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        const tag = party ? r.label : 'YOU';
        ctx.strokeText(tag, r.x, r.y - 30); ctx.fillStyle = r.color; ctx.fillText(tag, r.x, r.y - 30);
        ctx.letterSpacing = '0px';
      }
      if (S.phase === 'intro') {
        // which way you're facing
        const pulse = 0.55 + 0.45 * Math.sin(S.clock * 8);
        const c = Math.cos(r.a), s = Math.sin(r.a);
        ctx.strokeStyle = rgba(r.color, 0.4 + 0.5 * pulse); ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(r.x + c * 22, r.y + s * 22); ctx.lineTo(r.x + c * 64, r.y + s * 64);
        ctx.moveTo(r.x + c * 64 - c * 12 - s * 9, r.y + s * 64 - s * 12 + c * 9); ctx.lineTo(r.x + c * 64, r.y + s * 64); ctx.lineTo(r.x + c * 64 - c * 12 + s * 9, r.y + s * 64 - s * 12 - c * 9);
        ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.3 + 0.3 * pulse;
        ctx.drawImage(glow(r.color, 48), r.x - 60, r.y - 60, 120, 120);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  function drawParts(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of S.parts) {
      const k = p.age / p.life;
      if (p.t === 0) {
        ctx.globalAlpha = 1 - k;
        ctx.drawImage(glow(p.c, 24), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      } else if (p.t === 1) {
        ctx.globalAlpha = (1 - k) * 0.8;
        const z = p.s * (0.6 + k * 0.8);
        ctx.drawImage(glow(p.c, 64), p.x - z, p.y - z, z * 2, z * 2);
      } else if (p.t === 2) {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.c; ctx.lineWidth = 6 * (1 - k) + 0.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0, p.s + p.grow * k), 0, TAU); ctx.stroke();
      } else {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = p.c; ctx.lineWidth = p.s;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.035, p.y - p.vy * 0.035); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function drawBanner(ctx, b) {
    const a = Math.min(1, b.t / 0.18) * Math.min(1, (b.dur - b.t) / 0.3);
    if (a <= 0) return;
    const big = b.title === 'GO!';
    const cy = S.phase === 'intro' ? ACY - 70 : ACY - 20;
    ctx.save();
    ctx.globalAlpha = a;
    if (!big) {
      const g = ctx.createLinearGradient(AX, 0, AR, 0);
      g.addColorStop(0, 'rgba(4,2,12,0)'); g.addColorStop(0.5, 'rgba(4,2,12,0.8)'); g.addColorStop(1, 'rgba(4,2,12,0)');
      ctx.fillStyle = g; ctx.fillRect(AX, cy - 100, AR - AX, b.sub ? 170 : 130);
      const lg = ctx.createLinearGradient(AX, 0, AR, 0);
      lg.addColorStop(0, rgba(b.color, 0)); lg.addColorStop(0.5, rgba(b.color, 0.9)); lg.addColorStop(1, rgba(b.color, 0));
      ctx.fillStyle = lg; ctx.fillRect(AX, cy - 100, AR - AX, 2); ctx.fillRect(AX, cy - 100 + (b.sub ? 170 : 130), AR - AX, 2);
    }
    const e = Math.min(1, b.t / 0.35), sc = 0.82 + 0.18 * (1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2));
    ctx.translate(W / 2, cy);
    ctx.scale(sc * (big ? 1.5 : 1), sc * (big ? 1.5 : 1));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    chromaText(ctx, b.title, 0, 22, 96, 800, 10, '#ffffff');
    if (b.sub) {
      ctx.font = '600 26px "Segoe UI", sans-serif'; ctx.letterSpacing = '6px';
      ctx.fillStyle = b.color;
      ctx.fillText(b.sub, 0, 62);
      ctx.letterSpacing = '0px';
    }
    ctx.restore();
  }

  function drawCountdown(ctx) {
    const left = S.introT - S.phaseT;
    const n = Math.ceil(left / 0.5);
    if (n < 1 || n > 3) return;
    const k = 1 - (left - (n - 1) * 0.5) / 0.5;   // 0 → 1 through each digit
    const y = ACY + 120;
    ctx.save();
    ctx.globalAlpha = 1 - k * 0.6;
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(W / 2, y, 70 - 20 * k, 0, TAU); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    chromaText(ctx, String(n), W / 2, y + 4, 96 * (1.15 - 0.15 * k), 800, 0, '#ffffff');
    ctx.restore();
  }

  function drawHint(ctx) {
    let a = 0;
    if (S.phase === 'intro' && S.hintT > 0) a = 1;
    else if (S.phase === 'play' && S.hintT > 0) a = Math.min(1, S.hintT / 0.6);
    if (a <= 0) return;
    const keys = S.mode === 'gauntlet' ? S.riders[0].kind === 'keys' : null;
    const l1 = keys === true ? 'WASD  STEER        SPACE  BOOST' : keys === false ? 'LEFT STICK  STEER        HOLD A  BOOST' : 'STICK / WASD  STEER        A / SPACE  BOOST';
    const l2 = 'RIBBONS ARE DEADLY  ·  SLIP THROUGH THEIR GAPS  ·  LAST ONE RIDING WINS';
    ctx.save();
    ctx.globalAlpha = a;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const y = AB - 64;
    ctx.fillStyle = 'rgba(4,2,12,0.72)';
    ctx.beginPath(); ctx.roundRect(W / 2 - 520, y - 34, 1040, 80, 18); ctx.fill();
    ctx.strokeStyle = rgba(ACCENT, 0.5); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '600 24px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = '#ffffff';
    ctx.fillText(l1, W / 2, y - 8);
    ctx.font = '600 15px "Segoe UI", sans-serif'; ctx.letterSpacing = '3px'; ctx.fillStyle = tint(ACCENT, 0.4);
    ctx.fillText(l2, W / 2, y + 24);
    ctx.restore();
  }

  function drawChips(ctx) {
    const rs = S.riders, n = rs.length;
    const cw = 190, gap = 12, total = n * cw + (n - 1) * gap;
    let x = 1010 - total / 2;
    const y = 24, hh = 60;
    ctx.save();
    ctx.textBaseline = 'alphabetic';
    for (const r of rs) {
      ctx.globalAlpha = r.alive || S.phase === 'board' || S.phase === 'intro' ? 1 : 0.42;
      ctx.fillStyle = 'rgba(8,5,20,0.62)';
      ctx.beginPath(); ctx.roundRect(x, y, cw, hh, 10); ctx.fill();
      ctx.fillStyle = r.color; ctx.fillRect(x, y + 10, 4, hh - 20);
      ctx.textAlign = 'left';
      ctx.font = '700 20px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.fillText(r.human ? r.label : 'CPU', x + 16, y + 27);
      const lw = ctx.measureText(r.human ? r.label : 'CPU').width;
      ctx.font = '600 13px "Segoe UI", sans-serif'; ctx.letterSpacing = '2px'; ctx.fillStyle = r.color;
      ctx.fillText(r.name.toUpperCase(), x + 24 + lw, y + 26);
      ctx.letterSpacing = '0px';
      // boost meter (and in a party, round wins beside it)
      const party = S.mode === 'party';
      const bw = cw - 32 - (party ? 70 : 0);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 16, y + 40, bw, 5);
      ctx.fillStyle = r.spent ? '#ff5a7a' : r.charge > 0 ? PICKUPS.charge.color : r.color;
      ctx.fillRect(x + 16, y + 40, bw * r.meter, 5);
      if (party) {
        for (let k = 0; k < PARTY_WINS; k++) {
          const px = x + cw - 16 - (PARTY_WINS - 1 - k) * 12;
          ctx.beginPath(); ctx.arc(px, y + 42, 4, 0, TAU);
          if (k < r.wins) { ctx.fillStyle = r.color; ctx.fill(); } else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1.5; ctx.stroke(); }
        }
      }
      if (!r.alive && S.phase !== 'board' && S.phase !== 'intro') {
        ctx.textAlign = 'right'; ctx.font = '700 13px "Segoe UI", sans-serif'; ctx.fillStyle = '#ff7a95';
        ctx.fillText('OUT', x + cw - 14, y + 26);
      }
      x += cw + gap;
    }
    ctx.restore();
  }

  function drawJoin(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(4,2,12,0.6)'; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const tg = ctx.createLinearGradient(0, 130, 0, 220);
    tg.addColorStop(0, '#ffffff'); tg.addColorStop(0.5, '#ffd9f5'); tg.addColorStop(1, ACCENT);
    chromaText(ctx, 'RIBBON RIVALS', W / 2, 214, 104, 900, 8, tg);
    ctx.font = '600 22px "Segoe UI", sans-serif'; ctx.letterSpacing = '8px'; ctx.fillStyle = 'rgba(255,225,248,0.8)';
    ctx.fillText('PRESS A ON ANY CONTROLLER OR THE KEYBOARD TO JOIN', W / 2, 268);
    ctx.letterSpacing = '0px';
    const n = S.joins.length, party = n >= 2;
    const cw = 330, ch = 290, gap = 34, x0 = W / 2 - (4 * cw + 3 * gap) / 2, y0 = 320;
    for (let i = 0; i < 4; i++) {
      const x = x0 + i * (cw + gap), j = S.joins[i];
      if (j) {
        const col = RIDERS[j.ci].color;
        const pop = Math.min(1, (S.clock - j.t) / 0.25);
        ctx.save();
        ctx.translate(x + cw / 2, y0 + ch / 2); ctx.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop); ctx.translate(-(x + cw / 2), -(y0 + ch / 2));
        ctx.fillStyle = 'rgba(12,7,26,0.9)';
        ctx.beginPath(); ctx.roundRect(x, y0, cw, ch, 16); ctx.fill();
        const bg = ctx.createLinearGradient(0, y0, 0, y0 + 120);
        bg.addColorStop(0, rgba(col, 0.32)); bg.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = bg; ctx.fill();
        ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.textAlign = 'center';
        ctx.font = '200 72px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffffff';
        ctx.fillText(`P${i + 1}`, x + cw / 2, y0 + 92);
        ctx.font = '700 22px "Segoe UI", sans-serif'; ctx.letterSpacing = '6px'; ctx.fillStyle = col;
        ctx.fillText(RIDERS[j.ci].name.toUpperCase(), x + cw / 2, y0 + 130);
        ctx.font = '600 14px "Segoe UI", sans-serif'; ctx.letterSpacing = '3px'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillText(deviceName(j), x + cw / 2, y0 + 156);
        ctx.letterSpacing = '0px';
        // a little ribbon looping across the card (with a gap, naturally)
        const sx0 = x + 34, sx1 = x + cw - 34, sy = y0 + ch - 72, ph = i * 1.3;
        const hk = (S.clock * 0.4 + i * 0.27) % 1, hx = lerp(sx0, sx1, hk);
        const yAt = (xx) => sy + Math.sin(xx * 0.03 + ph + S.clock * 0.8) * 16;
        ctx.beginPath();
        let pen = false;
        for (let k = 0; k <= 40; k++) {
          const xx = lerp(sx0, hx, k / 40);
          if (Math.abs(xx - (sx0 + sx1) / 2) < 14) { pen = false; continue; }
          if (pen) ctx.lineTo(xx, yAt(xx)); else { ctx.moveTo(xx, yAt(xx)); pen = true; }
        }
        ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();
        ctx.strokeStyle = tint(col, 0.72); ctx.lineWidth = 2; ctx.stroke();
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(glow(col, 48), hx - 32, yAt(hx) - 32, 64, 64);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(hx, yAt(hx), 5, 0, TAU); ctx.fill();
        if (j.kind === 'pad') {
          ctx.font = '600 13px "Segoe UI", sans-serif'; ctx.letterSpacing = '2px'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText('B  LEAVE', x + cw / 2, y0 + ch - 18);
          ctx.letterSpacing = '0px';
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.setLineDash(DASH);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.roundRect(x, y0, cw, ch, 16); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(8,5,18,0.5)'; ctx.fill();
        if (party && S.cpuFill) {
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          ctx.font = '200 56px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.45)';
          ctx.fillText('CPU', x + cw / 2, y0 + 130);
          ctx.font = '600 15px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
          ctx.fillText('RIVAL', x + cw / 2, y0 + 160);
          ctx.fillText('A TO TAKE THIS SEAT', x + cw / 2, y0 + ch - 40);
          ctx.letterSpacing = '0px';
        } else {
          const pulse = 0.6 + 0.4 * Math.sin(S.clock * 4 + i);
          ctx.globalAlpha = pulse;
          btn(ctx, x + cw / 2, y0 + 120, 'A', 30);
          ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
          ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = '#ffffff';
          ctx.fillText('PRESS A TO JOIN', x + cw / 2, y0 + 190);
          ctx.letterSpacing = '0px';
        }
        ctx.restore();
      }
    }
    // what happens when we start
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const my = 690;
    if (n === 0) {
      ctx.font = '300 34px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('One player runs the Gauntlet. Two to four play a Party.', W / 2, my + 30);
    } else if (!party) {
      chromaText(ctx, 'GAUNTLET', W / 2, my + 30, 52, 800, 12, '#ffffff');
      ctx.font = '400 24px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText('Solo against CPU rivals  ·  3 lives  ·  every round gets tougher  ·  leaderboard', W / 2, my + 72);
      ctx.font = '400 20px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText('Friends can still press A to join for a Party', W / 2, my + 106);
    } else {
      chromaText(ctx, 'PARTY', W / 2, my + 30, 52, 800, 12, '#ffffff');
      ctx.font = '400 24px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`First to ${PARTY_WINS} round wins  ·  ${n} players${S.cpuFill && n < 4 ? ` + ${4 - n} CPU` : ''}`, W / 2, my + 72);
      promptRow(ctx, W / 2, my + 112, 'Y',`CPU RIVALS: ${S.cpuFill ? 'ON' : 'OFF'}`, S.cpuFill ? '#ffffff' : 'rgba(255,255,255,0.6)');
    }
    if (n > 0) {
      const secs = Math.max(0, Math.ceil(S.countdown));
      promptRow(ctx, W / 2 - 150, 890, 'X', 'START NOW', '#ffffff');
      const cx = W / 2 + 170, cy = 890;
      ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = ACCENT;
      ctx.beginPath(); ctx.arc(cx, cy, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(S.countdown / 8, 0.001, 1)); ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '600 24px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.fillText(String(secs), cx, cy + 1);
      ctx.textAlign = 'left'; ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.fillText('STARTING', cx + 42, cy + 1);
      ctx.letterSpacing = '0px';
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 15px "Segoe UI", sans-serif'; ctx.letterSpacing = '3px'; ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('KEYBOARD   ·   SPACE  JOIN   ·   SHIFT  START   ·   I  CPU RIVALS   ·   WASD  STEER   ·   SPACE  BOOST', W / 2, 990);
    ctx.letterSpacing = '0px';
    ctx.restore();
  }

  function drawBoard(ctx) {
    const a = Math.min(1, S.phaseT / 0.25);
    const party = S.mode === 'party';
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(4,2,12,0.55)'; ctx.fillRect(AX, AY, AR - AX, AB - AY);
    const rows = party ? standings() : null;
    const pw = 780, ph = party ? 200 + rows.length * 62 : 470;
    const px = W / 2 - pw / 2, py = ACY - ph / 2 - 10;
    ctx.fillStyle = 'rgba(10,6,24,0.92)';
    ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18); ctx.fill();
    ctx.strokeStyle = rgba(ACCENT, 0.35); ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = ACCENT; ctx.fillRect(px + 40, py, pw - 80, 3);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const res = S.res || { round: S.round };
    if (!party) {
      chromaText(ctx, res.won ? `ROUND ${res.round} CLEAR` : 'CRASHED', W / 2, py + 76, 54, 800, 6, '#ffffff');
      ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = res.won ? ACCENT : '#ff7a95';
      ctx.fillText(res.won ? `NEXT: ROUND ${S.round}` : `${S.lives} ${S.lives === 1 ? 'LIFE' : 'LIVES'} LEFT  ·  ROUND ${S.round} AGAIN`, W / 2, py + 112);
      ctx.letterSpacing = '0px';
      const k = clamp((S.phaseT - 0.2) / 0.8, 0, 1);
      const lines = [['Survival', S.rb.survive], ['Rivals outlasted', S.rb.outlast], ['Gaps & pickups', S.rb.gaps], ['Round bonus', S.rb.win]];
      lines.forEach(([label, v], i) => {
        const y = py + 170 + i * 46;
        ctx.textAlign = 'left'; ctx.font = '400 24px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillText(label, px + 90, y);
        ctx.textAlign = 'right'; ctx.font = '600 26px "Segoe UI", sans-serif'; ctx.fillStyle = v ? '#ffffff' : 'rgba(255,255,255,0.35)';
        ctx.fillText(`+${Math.round(v * k).toLocaleString()}`, px + pw - 90, y);
      });
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(px + 90, py + 340, pw - 180, 1);
      ctx.textAlign = 'left'; ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('LIVES', px + 90, py + 384);
      ctx.letterSpacing = '0px';
      for (let i = 0; i < LIVES; i++) {
        const lx = px + 200 + i * 34;
        ctx.beginPath(); ctx.arc(lx, py + 377, 9, 0, TAU);
        if (i < S.lives) { ctx.fillStyle = S.riders[0].color; ctx.fill(); } else { ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.textAlign = 'right'; ctx.font = '300 40px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffffff';
      ctx.fillText(Math.round(S.score).toLocaleString(), px + pw - 90, py + 392);
    } else {
      const w = res.winner;
      chromaText(ctx, w ? `${w.name.toUpperCase()} TAKES ROUND ${res.round}` : `ROUND ${res.round}  ·  DRAW`, W / 2, py + 76, 46, 800, 5, '#ffffff');
      ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = ACCENT;
      ctx.fillText(`FIRST TO ${PARTY_WINS} WINS THE MATCH`, W / 2, py + 110);
      ctx.letterSpacing = '0px';
      rows.forEach((r, i) => {
        const y = py + 160 + i * 62;
        ctx.fillStyle = r === w ? rgba(r.color, 0.16) : 'rgba(255,255,255,0.04)';
        ctx.beginPath(); ctx.roundRect(px + 60, y - 22, pw - 120, 50, 10); ctx.fill();
        ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(px + 92, y + 3, 9, 0, TAU); ctx.fill();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.font = '700 24px "Segoe UI", sans-serif'; ctx.fillStyle = '#ffffff';
        ctx.fillText(r.human ? r.label : 'CPU', px + 118, y + 3);
        ctx.font = '600 16px "Segoe UI", sans-serif'; ctx.letterSpacing = '3px'; ctx.fillStyle = r.color;
        ctx.fillText(r.name.toUpperCase(), px + 182, y + 3);
        ctx.letterSpacing = '0px';
        for (let k = 0; k < PARTY_WINS; k++) {
          const cx = px + pw - 110 - (PARTY_WINS - 1 - k) * 34;
          ctx.beginPath(); ctx.arc(cx, y + 3, 10, 0, TAU);
          if (k < r.wins) { ctx.fillStyle = r.color; ctx.fill(); } else { ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 2; ctx.stroke(); }
        }
        ctx.textBaseline = 'alphabetic';
      });
    }
    // next round countdown
    const left = Math.max(1, Math.ceil(BOARD_T - S.phaseT));
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(`NEXT ROUND IN ${left}`, W / 2 - 60, py + ph - 30);
    ctx.letterSpacing = '0px';
    if (S.phaseT > 0.8) { ctx.globalAlpha = a * 0.7; btn(ctx, W / 2 + 140, py + ph - 37, 'A', 13); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.font = '600 16px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('SKIP', W / 2 + 160, py + ph - 31); }
    ctx.restore();
  }

  // ---------------------------------------------------------- draw
  function draw(ctx) {
    ctx.save();
    if (S.shake > 0) {
      ctx.fillStyle = '#030208'; ctx.fillRect(0, 0, W, H);
      ctx.translate(Math.sin(S.clock * 93) * S.shake * 0.6, Math.cos(S.clock * 71) * S.shake * 0.6);
    }
    ctx.drawImage(arenaLayer(), 0, 0);
    if (S.fadeT > 0) { ctx.globalAlpha = S.fadeT * S.fadeT; ctx.drawImage(fade.c, 0, 0); ctx.globalAlpha = 1; }
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.32; ctx.drawImage(haze.c, 0, 0, W, H);
    ctx.globalAlpha = 0.5; ctx.drawImage(halo.c, 0, 0, W, H);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(body.c, 0, 0);
    for (const p of S.picks) drawPick(ctx, p);
    drawHeads(ctx);
    drawParts(ctx);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of S.pops) {
      const k = p.age / p.life;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `800 ${Math.round(p.size)}px "Segoe UI", sans-serif`; ctx.letterSpacing = '2px';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.letterSpacing = '0px';
    ctx.globalAlpha = 1;
    ctx.restore();

    ctx.save();
    if (S.phase === 'join') {
      drawJoin(ctx);
      ctx.restore();
      return;
    }
    if (S.mode === 'gauntlet') api.hud(ctx, { score: S.score, left: [`Round ${S.round}`, `Lives ${S.lives}`], right: [`${S.riders.length - 1} rival${S.riders.length > 2 ? 's' : ''}`] });
    else api.hud(ctx, { score: S.round, left: ['Party', `First to ${PARTY_WINS}`], right: ['Round'], showBest: false }); // a Gauntlet best means nothing here
    drawChips(ctx);
    if (S.phase === 'play' && (S.overdrive || S.ff)) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.font = '700 16px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(S.clock * 6);
      if (S.overdrive) { ctx.fillStyle = '#ffae2e'; ctx.fillText(`OVERDRIVE  +${Math.round((S.odMul - 1) * 100)}%`, AX + 18, AY + 32); }
      if (S.ff) { ctx.fillStyle = '#ffffff'; ctx.fillText('CPU SHOWDOWN  ▸▸', AX + 18, AY + (S.overdrive ? 58 : 32)); }
      ctx.letterSpacing = '0px'; ctx.globalAlpha = 1;
    }
    drawHint(ctx);
    if (S.phase === 'intro') drawCountdown(ctx);
    if (S.phase === 'board') drawBoard(ctx);
    if (S.phase === 'over') { ctx.fillStyle = `rgba(4,2,12,${Math.min(0.55, S.phaseT)})`; ctx.fillRect(AX, AY, AR - AX, AB - AY); }
    if (S.banner && S.phase !== 'board') drawBanner(ctx, S.banner);
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(${S.flashColor},${Math.min(0.5, S.flash) * 0.5})`;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  return { update, draw, result };
}

export default {
  key: 'ribbon',
  title: 'Ribbon Rivals',
  tagline: 'Party racer',
  accent: ACCENT,
  players: 4,
  controls: [
    ['Left stick', 'Steer (your rider curves toward it)'],
    ['A (hold)', 'Boost'],
    ['Ribbon gaps', 'Slip through them'],
    ['Join screen', 'A join · X start · Y CPU rivals'],
    ['Keyboard', 'WASD · Space boost · Shift start'],
    ['Start', 'Pause'],
  ],
  art: {
    cover(ctx, w, h) { paintArt(ctx, w, h, true); },
    hero(ctx, w, h) { paintArt(ctx, w, h, false); },
  },
  create,
};
