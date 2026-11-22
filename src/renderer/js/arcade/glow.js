// Glow Link: an original match-3 puzzle of glowing orbs. Blitz mode, 120 seconds.
//   Swap neighbouring orbs to line up 3+ of a colour. 4 in a line makes a Flare (clears its
//   row or column), an L or T makes a Burst (clears 3x3), 5 in a line makes a Nova (swap it
//   with any orb to clear every orb of that colour). Swapping two specials combines them.
//   Every colour also carries its own symbol, so the board reads without colour.

const COLS = 8;
const ROWS = 8;
const CELL = 94;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const BX = Math.round(960 - BOARD_W / 2);
const BY = 214;
const ORB_R = 39;
const BLITZ = 120;
const ACCENT = '#ffb347';
const FONT = '"Segoe UI", sans-serif';
const TAU = Math.PI * 2;

// Side panels.
const PW = 350;
const LPX = BX - 22 - 40 - PW;
const RPX = BX + BOARD_W + 22 + 40;
const PY = BY - 22;
const PH = BOARD_H + 44;
const LCX = LPX + PW / 2;
const RCX = RPX + PW / 2;
const RING_Y = BY + 178;
const RING_R = 108;

const COLORS = [
  { hex: '#ff4a64', shape: 'diamond' },
  { hex: '#ffa630', shape: 'ring' },
  { hex: '#a8f03c', shape: 'triangle' },
  { hex: '#2ad6ff', shape: 'square' },
  { hex: '#9a78ff', shape: 'star' },
  { hex: '#ff5fd2', shape: 'plus' },
];
const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28];

// ------------------------------------------------------------------ small helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeIn = (t) => t * t * t;
const easeOutBack = (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mixA(a, b, t, al = 1) {
  const x = hexRgb(a), y = hexRgb(b);
  const m = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgba(${m[0]},${m[1]},${m[2]},${al})`;
}
function rgba(hex, al) { return mixA(hex, hex, 0, al); }
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

// Soft glow sprite for the library art (the game itself uses api.glow).
const glowCache = new Map();
function softGlow(color, radius = 32) {
  const key = `${color}|${radius}`;
  if (glowCache.has(key)) return glowCache.get(key);
  const c = makeCanvas(radius * 2, radius * 2);
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(radius, radius, 0, radius, radius, radius);
  grd.addColorStop(0, color);
  grd.addColorStop(0.25, color);
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, radius * 2, radius * 2);
  glowCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------ orb sprites
function symbolPath(g, shape, x, y, s) {
  g.beginPath();
  if (shape === 'diamond') {
    g.moveTo(x, y - s * 1.08); g.lineTo(x + s * 0.74, y); g.lineTo(x, y + s * 1.08); g.lineTo(x - s * 0.74, y); g.closePath();
  } else if (shape === 'triangle') {
    const k = s * 1.1;
    g.moveTo(x, y - k); g.lineTo(x + k * 0.95, y + k * 0.64); g.lineTo(x - k * 0.95, y + k * 0.64); g.closePath();
  } else if (shape === 'square') {
    g.roundRect(x - s * 0.74, y - s * 0.74, s * 1.48, s * 1.48, s * 0.24);
  } else if (shape === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? s * 0.48 : s * 1.12;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  } else if (shape === 'plus') {
    const a = s * 0.32, b = s * 0.98;
    g.moveTo(x - a, y - b); g.lineTo(x + a, y - b); g.lineTo(x + a, y - a); g.lineTo(x + b, y - a);
    g.lineTo(x + b, y + a); g.lineTo(x + a, y + a); g.lineTo(x + a, y + b); g.lineTo(x - a, y + b);
    g.lineTo(x - a, y + a); g.lineTo(x - b, y + a); g.lineTo(x - b, y - a); g.lineTo(x - a, y - a); g.closePath();
  } else if (shape === 'ring') {
    g.arc(x, y, s * 0.9, 0, TAU);
    g.moveTo(x + s * 0.46, y);
    g.arc(x, y, s * 0.46, 0, TAU, true);
  }
}

function drawGloss(g, x, y, R) {
  g.save();
  g.translate(x - R * 0.3, y - R * 0.45);
  g.rotate(-0.55);
  g.scale(1, 0.5);
  const sp = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.52);
  sp.addColorStop(0, 'rgba(255,255,255,0.85)');
  sp.addColorStop(0.55, 'rgba(255,255,255,0.22)');
  sp.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sp;
  g.beginPath(); g.arc(0, 0, R * 0.52, 0, TAU); g.fill();
  g.restore();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.ellipse(x - R * 0.44, y - R * 0.5, R * 0.11, R * 0.065, -0.65, 0, TAU); g.fill();
}

const SPR_SIZES = [24, 48, 96];
const sprites = new Map();
// kind: colour index, 'nova' (rotating body, no gloss) or 'gloss'.
function orbSprite(kind, R) {
  const q = SPR_SIZES.find((s) => s >= R) || 96;
  const key = `${kind}|${q}`;
  let spr = sprites.get(key);
  if (spr) return spr;
  const S = Math.ceil(q * 2 + 6);
  const c = makeCanvas(S, S);
  const g = c.getContext('2d');
  const x = S / 2, y = S / 2;
  if (kind === 'gloss') {
    drawGloss(g, x, y, q);
  } else if (kind === 'nova') {
    let grd = g.createRadialGradient(x, y, 0, x, y, q);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(0.16, '#fff3d8');
    grd.addColorStop(0.42, '#3b2a5e');
    grd.addColorStop(0.8, '#150d26');
    grd.addColorStop(1, '#07040e');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, q, 0, TAU); g.fill();
    const cg = g.createConicGradient(0, x, y);
    COLORS.forEach((col, i) => cg.addColorStop(i / COLORS.length, col.hex));
    cg.addColorStop(1, COLORS[0].hex);
    g.strokeStyle = cg;
    g.lineWidth = q * 0.2;
    g.beginPath(); g.arc(x, y, q * 0.8, 0, TAU); g.stroke();
    g.lineWidth = q * 0.04;
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.beginPath(); g.arc(x, y, q * 0.66, 0, TAU); g.stroke();
    // four-point star core
    g.fillStyle = '#ffffff';
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const rr = i % 2 ? q * 0.11 : q * 0.46;
      g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath(); g.fill();
    // six colour dots on the ring
    COLORS.forEach((col, i) => {
      const a = (i / COLORS.length) * TAU + 0.5;
      g.fillStyle = mixA(col.hex, '#ffffff', 0.5);
      g.beginPath(); g.arc(x + Math.cos(a) * q * 0.8, y + Math.sin(a) * q * 0.8, q * 0.055, 0, TAU); g.fill();
    });
  } else {
    const { hex, shape } = COLORS[kind];
    let grd = g.createRadialGradient(x - q * 0.32, y - q * 0.38, q * 0.04, x, y, q);
    grd.addColorStop(0, mixA(hex, '#ffffff', 0.72));
    grd.addColorStop(0.3, mixA(hex, '#ffffff', 0.14));
    grd.addColorStop(0.74, mixA(hex, '#000000', 0.34));
    grd.addColorStop(1, mixA(hex, '#000000', 0.72));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, q, 0, TAU); g.fill();
    grd = g.createRadialGradient(x, y + q * 0.62, 0, x, y + q * 0.62, q * 0.72);
    grd.addColorStop(0, mixA(hex, '#ffffff', 0.35, 0.6));
    grd.addColorStop(1, mixA(hex, '#ffffff', 0.35, 0));
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, q, 0, TAU); g.fill();
    const s = q * 0.4;
    g.fillStyle = mixA(hex, '#000000', 0.72, 0.6);
    symbolPath(g, shape, x + q * 0.03, y + q * 0.07, s); g.fill('evenodd');
    g.fillStyle = 'rgba(255,255,255,0.94)';
    symbolPath(g, shape, x, y, s); g.fill('evenodd');
    g.lineWidth = Math.max(1, q * 0.05);
    g.strokeStyle = mixA(hex, '#ffffff', 0.6, 0.35);
    g.beginPath(); g.arc(x, y, q - g.lineWidth / 2, 0, TAU); g.stroke();
    drawGloss(g, x, y, q);
  }
  spr = { c, R: q };
  sprites.set(key, spr);
  return spr;
}

// Orb body (source-over). o: { color, special, dir, id }
function drawOrbBody(ctx, o, x, y, R, time, alpha = 1) {
  const nova = o.special === 'nova';
  const spr = orbSprite(nova ? 'nova' : o.color, R);
  const s = spr.c.width * (R / spr.R);
  ctx.globalAlpha = alpha;
  if (nova) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 1.3);
    ctx.drawImage(spr.c, -s / 2, -s / 2, s, s);
    ctx.restore();
    const gl = orbSprite('gloss', R);
    const gs = gl.c.width * (R / gl.R);
    ctx.drawImage(gl.c, x - gs / 2, y - gs / 2, gs, gs);
  } else {
    ctx.drawImage(spr.c, x - s / 2, y - s / 2, s, s);
  }
}

// Additive halo behind an orb.
function drawOrbGlow(ctx, o, x, y, R, glowFn, alpha) {
  const hex = o.special === 'nova' ? '#ffffff' : COLORS[o.color].hex;
  const gs = R * 1.75;
  ctx.globalAlpha = alpha * (o.special ? 0.5 : 0.3);
  ctx.drawImage(glowFn(hex, 64), x - gs, y - gs, gs * 2, gs * 2);
}

// Additive decorations for special orbs.
function drawSpecialFx(ctx, o, x, y, R, time, glowFn, alpha = 1) {
  if (!o.special) return;
  const ph = (o.id || 0) * 1.7;
  const pulse = 0.65 + 0.35 * Math.sin(time * 6 + ph);
  const white = glowFn('#ffffff', 64);
  if (o.special === 'flare') {
    const hex = COLORS[o.color].hex;
    ctx.save();
    ctx.translate(x, y);
    if (o.dir === 'v') ctx.rotate(Math.PI / 2);
    ctx.globalAlpha = alpha * 0.85;
    ctx.drawImage(glowFn(hex, 64), -R * 1.7, -R * 0.55, R * 3.4, R * 1.1);
    ctx.globalAlpha = alpha * (0.55 + 0.45 * pulse);
    ctx.drawImage(white, -R * 1.9, -R * 0.2, R * 3.8, R * 0.4);
    ctx.drawImage(white, -R * 0.9, -R * 0.09, R * 1.8, R * 0.18);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffffff';
    const m = (time * 1.6 + ph) % 1;
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const off = R * (0.95 + 0.28 * k + 0.18 * m);
        ctx.globalAlpha = alpha * (1 - 0.45 * k) * (0.6 + 0.4 * (1 - m));
        ctx.beginPath();
        ctx.moveTo(s * (off + R * 0.2), 0);
        ctx.lineTo(s * off, -R * 0.17);
        ctx.lineTo(s * off, R * 0.17);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.restore();
  } else if (o.special === 'burst') {
    const hex = COLORS[o.color].hex;
    ctx.globalAlpha = alpha * 0.4 * pulse;
    ctx.drawImage(white, x - R * 0.9, y - R * 0.9, R * 1.8, R * 1.8);
    ctx.globalAlpha = alpha * 0.9;
    ctx.strokeStyle = mixA(hex, '#ffffff', 0.45);
    ctx.lineWidth = Math.max(1.5, R * 0.07);
    const rr = R * (1.12 + 0.06 * Math.sin(time * 5 + ph));
    ctx.beginPath(); ctx.arc(x, y, rr, 0, TAU); ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.lineWidth = Math.max(1, R * 0.04);
    ctx.beginPath(); ctx.arc(x, y, rr + R * 0.16, 0, TAU); ctx.stroke();
    const dot = glowFn(mixA(hex, '#ffffff', 0.6), 32);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < 8; i++) {
      const a = time * 2.2 + ph + (i * TAU) / 8;
      const dx = x + Math.cos(a) * rr, dy = y + Math.sin(a) * rr;
      const ds = R * (i % 2 ? 0.16 : 0.24);
      ctx.drawImage(dot, dx - ds, dy - ds, ds * 2, ds * 2);
    }
  } else if (o.special === 'nova') {
    ctx.globalAlpha = alpha * 0.3 * pulse;
    ctx.drawImage(white, x - R * 2.1, y - R * 2.1, R * 4.2, R * 4.2);
    ctx.globalAlpha = alpha;
    for (let i = 0; i < COLORS.length; i++) {
      const a = -time * 1.6 + ph + (i * TAU) / COLORS.length;
      const rr = R * (1.18 + 0.08 * Math.sin(time * 3 + i));
      const ds = R * 0.26;
      ctx.drawImage(glowFn(COLORS[i].hex, 32), x + Math.cos(a) * rr - ds, y + Math.sin(a) * rr - ds, ds * 2, ds * 2);
    }
  }
}

function drawOrbFull(ctx, o, x, y, R, time, glowFn, alpha = 1) {
  ctx.globalCompositeOperation = 'lighter';
  drawOrbGlow(ctx, o, x, y, R, glowFn, alpha);
  ctx.globalCompositeOperation = 'source-over';
  drawOrbBody(ctx, o, x, y, R, time, alpha);
  ctx.globalCompositeOperation = 'lighter';
  drawSpecialFx(ctx, o, x, y, R, time, glowFn, alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function sparkle(ctx, x, y, s, alpha, glowFn, color = '#ffffff') {
  ctx.globalAlpha = alpha;
  ctx.drawImage(glowFn(color, 32), x - s * 1.4, y - s * 1.4, s * 2.8, s * 2.8);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const rr = i % 2 ? s * 0.12 : (i % 4 === 0 ? s * 1.6 : s * 0.9);
    ctx.lineTo(x + Math.cos(a - Math.PI / 2) * rr, y + Math.sin(a - Math.PI / 2) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

// ------------------------------------------------------------------ static backdrop (cached)
let bgCache = null;
function backdrop() {
  if (bgCache) return bgCache;
  const c = makeCanvas(1920, 1080);
  const g = c.getContext('2d');
  let grd = g.createLinearGradient(0, 0, 0, 1080);
  grd.addColorStop(0, '#0d0816');
  grd.addColorStop(0.55, '#140b1c');
  grd.addColorStop(1, '#06040a');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1920, 1080);
  grd = g.createRadialGradient(960, 600, 0, 960, 600, 900);
  grd.addColorStop(0, 'rgba(255,150,60,0.16)');
  grd.addColorStop(0.5, 'rgba(160,70,140,0.07)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1920, 1080);
  // faint hexagon lattice
  g.strokeStyle = 'rgba(255,200,140,0.035)';
  g.lineWidth = 1;
  const hs = 46;
  for (let row = 0; row < 30; row++) {
    for (let col = 0; col < 26; col++) {
      const x = col * hs * 1.5;
      const y = row * hs * 0.866 * 2 + (col % 2 ? hs * 0.866 : 0);
      g.beginPath();
      for (let i = 0; i < 6; i++) g.lineTo(x + Math.cos((i * TAU) / 6) * hs * 0.5, y + Math.sin((i * TAU) / 6) * hs * 0.5);
      g.closePath();
      g.stroke();
    }
  }
  grd = g.createRadialGradient(960, 560, 380, 960, 560, 1150);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(0,0,0,0.7)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 1920, 1080);
  bgCache = c;
  return c;
}

function glassPanel(g, x, y, w, h, r, strong) {
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.55)';
  g.shadowBlur = 40;
  g.shadowOffsetY = 12;
  const grd = g.createLinearGradient(0, y, 0, y + h);
  grd.addColorStop(0, strong ? 'rgba(26,18,38,0.86)' : 'rgba(30,22,42,0.62)');
  grd.addColorStop(1, strong ? 'rgba(10,7,16,0.9)' : 'rgba(12,9,18,0.62)');
  g.fillStyle = grd;
  g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
  g.restore();
  g.save();
  g.beginPath(); g.roundRect(x, y, w, h, r); g.clip();
  const sh = g.createLinearGradient(0, y, 0, y + h * 0.35);
  sh.addColorStop(0, 'rgba(255,255,255,0.07)');
  sh.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sh;
  g.fillRect(x, y, w, h * 0.35);
  g.restore();
  g.lineWidth = 1.5;
  g.strokeStyle = 'rgba(255,255,255,0.11)';
  g.beginPath(); g.roundRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, r); g.stroke();
  g.strokeStyle = 'rgba(255,190,120,0.22)';
  g.beginPath(); g.moveTo(x + r, y + 0.75); g.lineTo(x + w - r, y + 0.75); g.stroke();
}

function label(g, text, x, y, align = 'center') {
  g.font = `600 15px ${FONT}`;
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.textAlign = align;
  g.textBaseline = 'middle';
  spaced(g, 4);
  g.fillText(text, x + (align === 'center' ? 2 : 0), y);
  spaced(g, 0);
}

let panelCache = null;
function panels() {
  if (panelCache) return panelCache;
  const c = makeCanvas(1920, 1080);
  const g = c.getContext('2d');
  glassPanel(g, BX - 22, BY - 22, BOARD_W + 44, BOARD_H + 44, 28, true);
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      const x = BX + col * CELL, y = BY + r * CELL;
      g.fillStyle = (r + col) % 2 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.05)';
      g.beginPath(); g.roundRect(x + 4, y + 4, CELL - 8, CELL - 8, 16); g.fill();
      const grd = g.createRadialGradient(x + CELL / 2, y + CELL / 2 + 5, 4, x + CELL / 2, y + CELL / 2, ORB_R + 6);
      grd.addColorStop(0, 'rgba(0,0,0,0.4)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.beginPath(); g.arc(x + CELL / 2, y + CELL / 2, ORB_R + 6, 0, TAU); g.fill();
    }
  }
  glassPanel(g, LPX, PY, PW, PH, 24);
  glassPanel(g, RPX, PY, PW, PH, 24);

  // right panel labels
  label(g, 'TIME LEFT', RCX, BY + 26);
  label(g, 'SCORE', RCX, BY + 360);
  label(g, 'CASCADE', RCX, BY + 530);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.lineWidth = 1;
  for (const yy of [BY + 330, BY + 500]) { g.beginPath(); g.moveTo(RPX + 40, yy); g.lineTo(RPX + PW - 40, yy); g.stroke(); }

  // left panel: specials legend + controls
  label(g, 'SPECIALS', LCX, BY + 26);
  const legend = [
    ['FLARE', 'Match 4 in a line.', 'Clears its row or column.'],
    ['BURST', 'Match an L or T shape.', 'Clears a 3×3 area.'],
    ['NOVA', 'Match 5 in a line. Swap', 'it to clear a whole colour.'],
  ];
  legend.forEach(([name, a, b], i) => {
    const y = BY + 104 + i * 128;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = `600 24px ${FONT}`;
    g.fillStyle = '#ffffff';
    spaced(g, 2);
    g.fillText(name, LPX + 108, y - 26);
    spaced(g, 0);
    g.font = `16px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.62)';
    g.fillText(a, LPX + 108, y + 4);
    g.fillText(b, LPX + 108, y + 26);
  });
  g.font = `italic 16px ${FONT}`;
  g.fillStyle = 'rgba(255,200,140,0.75)';
  g.textAlign = 'center';
  g.fillText('Swap two specials together', LCX, BY + 470);
  g.fillText('for a bigger blast.', LCX, BY + 492);
  g.strokeStyle = 'rgba(255,255,255,0.08)';
  g.beginPath(); g.moveTo(LPX + 40, BY + 530); g.lineTo(LPX + PW - 40, BY + 530); g.stroke();
  label(g, 'CONTROLS', LCX, BY + 562);
  const ctl = [['A', '#5bd45b', 'Pick up, then push to swap'], ['B', '#f05050', 'Put down'], ['X', '#4aa3ff', 'Show a hint']];
  ctl.forEach(([b, col, text], i) => {
    const y = BY + 612 + i * 44;
    g.fillStyle = col;
    g.beginPath(); g.arc(LPX + 62, y, 15, 0, TAU); g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 16px ${FONT}`;
    g.textAlign = 'center';
    g.fillText(b, LPX + 62, y + 1);
    g.textAlign = 'left';
    g.font = `17px ${FONT}`;
    g.fillStyle = 'rgba(255,255,255,0.75)';
    g.fillText(text, LPX + 92, y + 1);
  });
  panelCache = c;
  return c;
}

// ------------------------------------------------------------------ the game
function createGame(api) {
  const W = api.w;
  const H = api.h;
  const glow = api.glow;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const ri = (n) => Math.floor(Math.random() * n);
  const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  let grid = [];
  let nextId = 1;
  const at = (i) => grid[(i / COLS) | 0][i % COLS];
  const put = (i, o) => { grid[(i / COLS) | 0][i % COLS] = o; };
  const rcOf = (i) => [(i / COLS) | 0, i % COLS];
  const idx = (r, c) => r * COLS + c;
  const px = (c) => BX + (c + 0.5) * CELL;
  const py = (r) => BY + (r + 0.5) * CELL;
  const inside = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
  const newOrb = (color, r, c) => ({ id: nextId++, color, special: null, dir: 'h', x: c, y: r, vy: 0, wait: 0, anim: null, dying: false, die: 0, delay: 0, popped: false, merge: null, born: 0, squash: 0 });

  let t = 0;
  let phase = 'fall';
  let phaseT = 0;
  let phaseDur = 0;
  let pending = null;
  let swapInfo = null;
  let started = false;
  let timeLeft = BLITZ;
  let timeUp = false;
  let endT = 0;
  let overCalled = false;
  let score = 0;
  let shown = 0;
  let chain = 0;
  let chainPop = 0;
  let lastChain = 0;
  let chainHold = 0;
  const shownChain = () => (chain > 0 ? chain : chainHold > 0 ? lastChain : 1);
  const stats = { maxCascade: 0, novas: 0 };
  let cursor = { r: 4, c: 3 };
  const cursorPos = { x: 3, y: 4 };
  const bump = { x: 0, y: 0 };
  let selected = null;
  let heldDir = null;
  let repeatT = 0;
  let dirLock = false;
  let idleT = 0;
  let hint = null;
  let hintT = 0;
  const parts = [];
  const texts = [];
  const beams = [];
  const rings = [];
  const arcs = [];
  let flash = 0;
  let flashColor = '#ffd08a';
  let shake = 0;
  let readyT = 0;
  const bokeh = Array.from({ length: 16 }, (_, i) => ({
    x: rnd(0, W), y: rnd(140, H), r: rnd(90, 230), sp: rnd(0.05, 0.16), ph: rnd(0, TAU), amp: rnd(30, 90),
    col: COLORS[i % COLORS.length].hex, a: rnd(0.035, 0.075),
  }));

  // ---------------------------------------------------------------- sounds
  const S = {
    move: () => api.sfx({ tone: 1500, peak: 0.022, attack: 0.002, decay: 0.03 }),
    bump: () => api.sfx({ tone: 180, to: 140, type: 'triangle', peak: 0.05, decay: 0.06 }),
    pick: () => api.sfx([{ tone: 620, to: 930, peak: 0.08, decay: 0.12 }, { tone: 1240, peak: 0.03, decay: 0.12, at: 0.03 }]),
    drop: () => api.sfx({ tone: 720, to: 480, peak: 0.06, decay: 0.1 }),
    swap: () => api.sfx([
      { noise: true, from: 500, peakAt: 2800, to: 900, dur: 0.2, q: 1.1, peak: 0.13 },
      { tone: 320, to: 560, type: 'triangle', peak: 0.04, decay: 0.14 },
    ]),
    nope: () => api.sfx([
      { tone: 340, to: 310, type: 'triangle', peak: 0.08, decay: 0.11 },
      { tone: 262, to: 232, type: 'triangle', peak: 0.08, decay: 0.16, at: 0.11 },
    ]),
    pop: (step, n) => {
      const f = 523.25 * Math.pow(2, PENTA[Math.min(step - 1, PENTA.length - 1)] / 12);
      const v = [
        { tone: f, to: f * 1.5, peak: 0.11, decay: 0.16 },
        { tone: f * 2, peak: 0.035, decay: 0.12, at: 0.025 },
        { noise: true, from: 3000, peakAt: 6500, to: 4000, dur: 0.07, q: 2, peak: 0.05 },
      ];
      if (n > 3) v.push({ tone: f * 1.26, to: f * 1.89, peak: 0.06, decay: 0.2, at: 0.06 });
      if (n > 5) v.push({ tone: f * 1.5, to: f * 2.25, peak: 0.05, decay: 0.24, at: 0.11 });
      api.sfx(v);
    },
    create: () => api.sfx([880, 1108.7, 1318.5, 1760].map((f, i) => ({ tone: f, peak: 0.065, decay: 0.4, at: i * 0.055 }))),
    flare: () => api.sfx([
      { noise: true, from: 900, peakAt: 7000, to: 2200, dur: 0.45, q: 0.7, peak: 0.2 },
      { tone: 200, to: 90, type: 'triangle', peak: 0.12, decay: 0.35 },
    ]),
    burst: () => api.sfx([
      { tone: 150, to: 45, peak: 0.24, decay: 0.42 },
      { noise: true, from: 300, peakAt: 1600, to: 220, dur: 0.5, q: 0.5, peak: 0.26 },
    ]),
    nova: () => api.sfx([
      { noise: true, from: 200, peakAt: 9000, to: 4000, dur: 0.9, q: 0.6, peak: 0.22 },
      { tone: 110, to: 55, peak: 0.18, decay: 0.8 },
      ...[523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ tone: f, peak: 0.06, decay: 0.7, at: 0.08 + i * 0.05 })),
    ]),
    tick: (n) => api.sfx({ tone: n <= 3 ? 1320 : 990, type: 'triangle', peak: n <= 3 ? 0.09 : 0.06, decay: 0.07 }),
    timeUp: () => api.sfx([
      { tone: 880, to: 440, type: 'triangle', peak: 0.12, decay: 0.5 },
      { tone: 659, to: 330, type: 'triangle', peak: 0.1, decay: 0.6, at: 0.14 },
      { tone: 440, to: 220, type: 'triangle', peak: 0.1, decay: 0.9, at: 0.28 },
      { noise: true, from: 4000, peakAt: 1200, to: 300, dur: 0.9, q: 0.6, peak: 0.12 },
    ]),
    go: () => api.sfx([{ tone: 659.25, peak: 0.08, decay: 0.3 }, { tone: 987.77, peak: 0.08, decay: 0.45, at: 0.09 }]),
    shuffle: () => api.sfx([
      { noise: true, from: 300, peakAt: 4000, to: 600, dur: 0.85, q: 0.9, peak: 0.16, panFrom: -0.7, panTo: 0.7 },
      { tone: 330, to: 660, type: 'triangle', peak: 0.05, decay: 0.7 },
    ]),
    hint: () => api.sfx([{ tone: 1568, peak: 0.04, decay: 0.3 }, { tone: 2093, peak: 0.03, decay: 0.35, at: 0.08 }]),
  };

  // ---------------------------------------------------------------- board logic
  function setPhase(p, dur = 0) { phase = p; phaseT = 0; phaseDur = dur; }

  function findRuns() {
    const runs = [];
    const ok = (o, color) => o && !o.dying && o.color === color;
    for (let r = 0; r < ROWS; r++) {
      let c = 0;
      while (c < COLS) {
        const o = grid[r][c];
        if (!o || o.dying || o.color < 0) { c++; continue; }
        let e = c + 1;
        while (e < COLS && ok(grid[r][e], o.color)) e++;
        if (e - c >= 3) { const cells = []; for (let k = c; k < e; k++) cells.push(idx(r, k)); runs.push({ dir: 'h', cells, color: o.color }); }
        c = e;
      }
    }
    for (let c = 0; c < COLS; c++) {
      let r = 0;
      while (r < ROWS) {
        const o = grid[r][c];
        if (!o || o.dying || o.color < 0) { r++; continue; }
        let e = r + 1;
        while (e < ROWS && ok(grid[e][c], o.color)) e++;
        if (e - r >= 3) { const cells = []; for (let k = r; k < e; k++) cells.push(idx(k, c)); runs.push({ dir: 'v', cells, color: o.color }); }
        r = e;
      }
    }
    return runs;
  }

  function groupRuns(runs) {
    const groups = [];
    const owner = new Map();
    for (const run of runs) {
      let g = null;
      for (const i of run.cells) {
        const og = owner.get(i);
        if (!og || og === g) continue;
        if (!g) { g = og; continue; }
        for (const r2 of og.runs) g.runs.push(r2);
        for (const i2 of og.cells) { g.cells.add(i2); owner.set(i2, g); }
        groups.splice(groups.indexOf(og), 1);
      }
      if (!g) { g = { runs: [], cells: new Set(), color: run.color }; groups.push(g); }
      g.runs.push(run);
      for (const i of run.cells) { g.cells.add(i); owner.set(i, g); }
    }
    return groups;
  }

  function specialFor(g) {
    let maxLen = 0, longest = null, hasH = false, hasV = false;
    for (const run of g.runs) {
      if (run.cells.length > maxLen) { maxLen = run.cells.length; longest = run; }
      if (run.dir === 'h') hasH = true; else hasV = true;
    }
    if (maxLen >= 5) return { type: 'nova', run: longest };
    if (hasH && hasV) return { type: 'burst' };
    if (maxLen === 4) return { type: 'flare', dir: longest.dir, run: longest };
    return null;
  }

  function choosePivot(g, sp, prefer) {
    const ok = (i) => { const o = at(i); return o && !o.special; };
    for (const p of prefer) if (g.cells.has(p) && ok(p)) return p;
    if (sp.type === 'burst') {
      const hs = new Set();
      for (const run of g.runs) if (run.dir === 'h') run.cells.forEach((i) => hs.add(i));
      for (const run of g.runs) if (run.dir === 'v') for (const i of run.cells) if (hs.has(i) && ok(i)) return i;
    }
    const cells = sp.run ? sp.run.cells : [...g.cells];
    const mid = Math.floor((cells.length - 1) / 2);
    for (let d = 0; d < cells.length; d++) {
      for (const k of [mid + d, mid - d]) if (k >= 0 && k < cells.length && ok(cells[k])) return cells[k];
    }
    for (const i of g.cells) if (ok(i)) return i;
    return -1;
  }

  function lineLen(r, c, dr, dc, color) {
    let n = 0;
    r += dr; c += dc;
    while (inside(r, c) && grid[r][c] && grid[r][c].color === color) { n++; r += dr; c += dc; }
    return n;
  }
  function matchAt(i) {
    const [r, c] = rcOf(i);
    const o = grid[r][c];
    if (!o || o.color < 0) return 0;
    const hl = 1 + lineLen(r, c, 0, -1, o.color) + lineLen(r, c, 0, 1, o.color);
    const vl = 1 + lineLen(r, c, -1, 0, o.color) + lineLen(r, c, 1, 0, o.color);
    return (hl >= 3 ? hl : 0) + (vl >= 3 ? vl : 0);
  }
  function swapCells(a, b) { const o = at(a); put(a, at(b)); put(b, o); }

  function findMoves() {
    const moves = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        for (const [dr, dc] of [[0, 1], [1, 0]]) {
          const r2 = r + dr, c2 = c + dc;
          if (!inside(r2, c2)) continue;
          const a = idx(r, c), b = idx(r2, c2);
          const A = at(a), B = at(b);
          if (!A || !B) continue;
          if (A.special === 'nova' || B.special === 'nova') { moves.push({ a, b, value: 9 }); continue; }
          if (A.special && B.special) { moves.push({ a, b, value: 8 }); continue; }
          if (A.color === B.color) continue;
          swapCells(a, b);
          const n = matchAt(a) + matchAt(b);
          swapCells(a, b);
          if (n) moves.push({ a, b, value: n + (A.special || B.special ? 2 : 0) });
        }
      }
    }
    return moves;
  }

  function bestMove() {
    const moves = findMoves();
    if (!moves.length) return null;
    const top = Math.max(...moves.map((m) => m.value));
    const best = moves.filter((m) => m.value === top);
    return best[ri(best.length)];
  }

  function fillBoard() {
    for (let tries = 0; tries < 200; tries++) {
      grid = [];
      for (let r = 0; r < ROWS; r++) {
        const row = [];
        for (let c = 0; c < COLS; c++) {
          let col;
          do { col = ri(COLORS.length); } while (
            (c >= 2 && row[c - 1].color === col && row[c - 2].color === col)
            || (r >= 2 && grid[r - 1][c].color === col && grid[r - 2][c].color === col));
          row.push(newOrb(col, r, c));
        }
        grid.push(row);
      }
      if (findMoves().length >= 4) break;
    }
  }

  // ---------------------------------------------------------------- effects
  function spawnPop(o, x, y) {
    const hex = o.color >= 0 ? COLORS[o.color].hex : '#ffffff';
    const n = parts.length > 700 ? 4 : 9;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), sp = rnd(120, 430);
      const life = rnd(0.35, 0.8);
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60, life, max: life, size: rnd(9, 20), color: hex });
    }
    rings.push({ x, y, r0: ORB_R * 0.6, r1: ORB_R * 1.75, life: 0.32, max: 0.32, color: hex, w: 5 });
  }

  function addText(text, x, y, o = {}) {
    texts.push({ text, x, y, vy: o.vy ?? -60, life: o.life || 1, max: o.life || 1, size: o.size || 38, color: o.color || '#ffffff', glow: o.glow || ACCENT, weight: o.weight || 600 });
  }

  function addArc(from, to, color) {
    const [r0, c0] = rcOf(from), [r1, c1] = rcOf(to);
    arcs.push({ x0: px(c0), y0: py(r0), x1: px(c1), y1: py(r1), life: 0.55, max: 0.55, seed: rnd(0, 1000), color });
  }

  function mostCommonColor(exclude) {
    const n = COLORS.map(() => 0);
    for (let i = 0; i < ROWS * COLS; i++) {
      const o = at(i);
      if (o && o.color >= 0 && !o.dying && !exclude.has(i)) n[o.color]++;
    }
    let best = 0;
    for (let k = 1; k < n.length; k++) if (n[k] > n[best]) best = k;
    return n[best] ? best : -1;
  }

  // Grow a clear set through every special it touches (chain reactions).
  function expand(clear, detonated, protect, delays, kinds) {
    const queue = [...clear];
    while (queue.length) {
      const i = queue.shift();
      const o = at(i);
      if (!o || !o.special || detonated.has(i) || protect.has(i)) continue;
      detonated.add(i);
      kinds.add(o.special);
      const [r, c] = rcOf(i);
      const d0 = delays.get(i) || 0;
      const hex = o.color >= 0 ? COLORS[o.color].hex : '#ffffff';
      const targets = [];
      if (o.special === 'flare') {
        if (o.dir === 'h') for (let k = 0; k < COLS; k++) targets.push(idx(r, k));
        else for (let k = 0; k < ROWS; k++) targets.push(idx(k, c));
        beams.push({ dir: o.dir, i: o.dir === 'h' ? r : c, life: 0.5, max: 0.5, color: hex, w: 46, delay: d0 });
      } else if (o.special === 'burst') {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (inside(r + dr, c + dc)) targets.push(idx(r + dr, c + dc));
        rings.push({ x: px(c), y: py(r), r0: CELL * 0.4, r1: CELL * 2.1, life: 0.5, max: 0.5, color: hex, w: 16, delay: d0 });
        shake = Math.max(shake, 8);
      } else if (o.special === 'nova') {
        const col = mostCommonColor(clear);
        if (col >= 0) {
          for (let k = 0; k < ROWS * COLS; k++) { const q = at(k); if (q && q.color === col && !q.dying) { targets.push(k); addArc(i, k, COLORS[col].hex); } }
        }
        flash = Math.min(1, flash + 0.4);
      }
      for (const k of targets) {
        if (protect.has(k)) continue;
        const [kr, kc] = rcOf(k);
        const d = d0 + Math.hypot(kr - r, kc - c) * 0.028;
        if (!clear.has(k)) { clear.add(k); queue.push(k); delays.set(k, d); }
        else if ((delays.get(k) ?? 0) > d) delays.set(k, d);
      }
    }
  }

  // One clearing step: pop the set (plus chain reactions), create specials, score it.
  function applyClear(clear, { created = [], detonated = new Set(), delays = new Map(), bonus = 0, kinds = new Set() } = {}) {
    const protect = new Set(created.map((s) => s.idx));
    for (const p of protect) clear.delete(p);
    const preset = detonated.size;
    expand(clear, detonated, protect, delays, kinds);

    chain++;
    chainPop = 1;
    stats.maxCascade = Math.max(stats.maxCascade, chain);
    const blasts = detonated.size - preset;
    const pts = (clear.size * 10 + bonus + blasts * 40) * chain;
    score += pts;

    let sx = 0, sy = 0, maxDelay = 0, firstHex = null;
    for (const i of clear) {
      const o = at(i);
      if (!o) continue;
      const [r, c] = rcOf(i);
      sx += px(c); sy += py(r);
      o.dying = true;
      o.die = 0;
      o.popped = false;
      o.delay = delays.get(i) || 0;
      maxDelay = Math.max(maxDelay, o.delay);
      if (!firstHex && o.color >= 0) firstHex = COLORS[o.color].hex;
    }
    for (const s of created) {
      const [pr, pc] = rcOf(s.idx);
      for (const i of s.cells) { const o = at(i); if (o && o.dying && !detonated.has(i)) o.merge = { x: pc, y: pr }; }
      const o = at(s.idx);
      o.special = s.type;
      o.dir = s.dir;
      if (s.type === 'nova') { o.color = -1; stats.novas++; }
      o.born = 1;
      rings.push({ x: px(pc), y: py(pr), r0: 10, r1: CELL * 1.2, life: 0.45, max: 0.45, color: '#ffffff', w: 6, delay: 0.12 });
    }
    const n = Math.max(1, clear.size);
    addText(`+${pts.toLocaleString()}`, sx / n, sy / n - 10, { size: chain > 1 ? 44 : 38, life: 1.1, glow: firstHex || ACCENT });
    if (chain >= 2) {
      addText(`CASCADE x${chain}`, BX + BOARD_W / 2, BY + BOARD_H * 0.42, { size: 74 + Math.min(chain, 6) * 6, life: 1.25, vy: -40, weight: 700, color: '#fff3dc', glow: ACCENT });
    }
    flashColor = firstHex || '#ffd08a';
    flash = Math.min(1, flash + 0.05 + clear.size * 0.012);

    S.pop(chain, clear.size);
    if (created.length) S.create();
    if (kinds.has('nova')) S.nova();
    else if (kinds.has('burst')) S.burst();
    else if (kinds.has('flare')) S.flare();
    if (kinds.size) shake = Math.max(shake, 6);

    setPhase('pop', 0.26 + maxDelay + (kinds.size ? 0.12 : 0));
  }

  function resolve(prefer) {
    const runs = findRuns();
    if (!runs.length) { endCascade(); return; }
    const groups = groupRuns(runs);
    const clear = new Set();
    const created = [];
    let bonus = 0;
    for (const g of groups) {
      for (const i of g.cells) clear.add(i);
      const sp = specialFor(g);
      if (!sp) continue;
      const p = choosePivot(g, sp, prefer);
      if (p < 0) continue;
      created.push({ idx: p, type: sp.type, dir: sp.dir || 'h', cells: [...g.cells] });
      bonus += sp.type === 'nova' ? 150 : sp.type === 'burst' ? 80 : 50;
    }
    applyClear(clear, { created, bonus });
  }

  function endCascade() {
    if (chain >= 2) { lastChain = chain; chainHold = 1.3; }
    if (chain >= 4) addText(chain >= 6 ? 'DAZZLING!' : 'BRILLIANT!', BX + BOARD_W / 2, BY + BOARD_H * 0.58, { size: 56, life: 1.3, vy: -30, weight: 700, color: '#ffe2a8' });
    chain = 0;
    hint = null;
    setPhase('idle');
    if (!started) {
      started = true;
      addText('GO!', BX + BOARD_W / 2, BY + BOARD_H / 2, { size: 120, life: 0.9, vy: -20, weight: 700, color: '#fff3dc' });
      S.go();
    }
    if (timeUp) return;
    if (!findMoves().length) startShuffle();
  }

  function removeDying() {
    for (let i = 0; i < ROWS * COLS; i++) { const o = at(i); if (o && o.dying) put(i, null); }
  }

  function collapse() {
    for (let c = 0; c < COLS; c++) {
      let write = ROWS - 1;
      for (let r = ROWS - 1; r >= 0; r--) {
        const o = grid[r][c];
        if (!o) continue;
        if (r !== write) { grid[write][c] = o; grid[r][c] = null; }
        write--;
      }
      const count = write + 1;
      for (let r = 0; r < count; r++) {
        const o = newOrb(ri(COLORS.length), r, c);
        o.y = r - count - 0.4;
        grid[r][c] = o;
      }
      for (let r = 0; r < ROWS; r++) { const o = grid[r][c]; if (o.y < r) { o.wait = c * 0.012; o.vy = 0; } }
    }
  }

  function updateFall(dt) {
    let moving = false;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c];
        if (!o || o.y >= r) continue;
        moving = true;
        if (o.wait > 0) { o.wait -= dt; continue; }
        o.vy = Math.min(o.vy + 75 * dt, 26);
        o.y += o.vy * dt;
        if (o.y >= r) { o.y = r; if (o.vy > 3) o.squash = Math.min(1, o.vy / 12); o.vy = 0; }
      }
    }
    if (!moving) resolve([]);
  }

  function startSwap(a, b) {
    const A = at(a), B = at(b);
    if (!A || !B) return;
    put(a, B); put(b, A);
    const [ar, ac] = rcOf(a), [br, bc] = rcOf(b);
    A.anim = { fx: ac, fy: ar, tx: bc, ty: br, t: 0, dur: 0.17, arc: -1 };
    B.anim = { fx: bc, fy: br, tx: ac, ty: ar, t: 0, dur: 0.17, arc: -1 };
    swapInfo = { a, b, A, B };
    chainHold = 0;
    selected = null;
    hint = null;
    hintT = 0;
    idleT = 0;
    cursor = { r: br, c: bc };
    setPhase('swap', 0.17);
    S.swap();
  }

  function finishSwap() {
    const { a, b, A, B } = swapInfo; // A now sits at b, B at a
    if (A.special === 'nova' || B.special === 'nova') { novaSwap(A, B, a, b); return; }
    if (A.special && B.special) { comboSwap(A, B, a, b); return; }
    if (findRuns().length) { chain = 0; resolve([b, a]); return; }
    put(a, A); put(b, B);
    const [ar, ac] = rcOf(a), [br, bc] = rcOf(b);
    A.anim = { fx: bc, fy: br, tx: ac, ty: ar, t: 0, dur: 0.2, arc: -1 };
    B.anim = { fx: ac, fy: ar, tx: bc, ty: br, t: 0, dur: 0.2, arc: -1 };
    cursor = { r: ar, c: ac };
    setPhase('unswap', 0.2);
    S.nope();
  }

  function distDelays(from, cells, k = 0.03) {
    const [r0, c0] = rcOf(from);
    const m = new Map();
    for (const i of cells) { const [r, c] = rcOf(i); m.set(i, Math.hypot(r - r0, c - c0) * k); }
    return m;
  }

  function novaSwap(A, B, a, b) {
    chain = 0;
    const novaIsA = A.special === 'nova';
    const nova = novaIsA ? A : B;
    const other = novaIsA ? B : A;
    const novaIdx = novaIsA ? b : a;
    const otherIdx = novaIsA ? a : b;
    if (other.special === 'nova') {
      const all = new Set();
      for (let i = 0; i < ROWS * COLS; i++) all.add(i);
      for (const i of all) if (i % 3 === 0) addArc(novaIdx, i, COLORS[i % COLORS.length].hex);
      flash = 1;
      flashColor = '#ffffff';
      shake = 18;
      addText('SUPERNOVA', BX + BOARD_W / 2, BY + BOARD_H * 0.3, { size: 96, life: 1.6, vy: -20, weight: 700, color: '#ffffff', glow: '#b9a2ff' });
      applyClear(all, { detonated: new Set([novaIdx, otherIdx]), delays: distDelays(novaIdx, all, 0.045), bonus: 1500, kinds: new Set(['nova']) });
      return;
    }
    const color = other.color;
    const targets = [];
    for (let i = 0; i < ROWS * COLS; i++) { const o = at(i); if (o && o.color === color) targets.push(i); }
    const hex = COLORS[color].hex;
    for (const i of targets) addArc(novaIdx, i, hex);
    nova.born = 1;
    if (other.special === 'flare' || other.special === 'burst') {
      for (const i of targets) {
        const o = at(i);
        if (!o.special) { o.special = other.special; o.dir = Math.random() < 0.5 ? 'h' : 'v'; o.born = 1; }
      }
      addText(other.special === 'flare' ? 'FLARE STORM' : 'BURST STORM', BX + BOARD_W / 2, BY + BOARD_H * 0.3, { size: 80, life: 1.4, vy: -20, weight: 700, color: '#ffffff', glow: hex });
      S.create();
      flash = Math.min(1, flash + 0.3);
      flashColor = hex;
      pending = () => {
        const clear = new Set([novaIdx, ...targets]);
        applyClear(clear, { detonated: new Set([novaIdx]), delays: distDelays(novaIdx, clear, 0.04), bonus: 400, kinds: new Set(['nova']) });
      };
      setPhase('wait', 0.6);
      return;
    }
    const clear = new Set([novaIdx, ...targets]);
    flashColor = hex;
    applyClear(clear, { detonated: new Set([novaIdx]), delays: distDelays(novaIdx, clear, 0.035), bonus: 120, kinds: new Set(['nova']) });
  }

  function comboSwap(A, B, a, b) {
    chain = 0;
    const [r, c] = rcOf(b);
    const kinds = [A.special, B.special].sort().join('+');
    const clear = new Set([a, b]);
    const hexA = COLORS[A.color].hex, hexB = COLORS[B.color].hex;
    const addRow = (rr, hex, w = 50) => { if (rr < 0 || rr >= ROWS) return; for (let k = 0; k < COLS; k++) clear.add(idx(rr, k)); beams.push({ dir: 'h', i: rr, life: 0.6, max: 0.6, color: hex, w, delay: 0 }); };
    const addCol = (cc, hex, w = 50) => { if (cc < 0 || cc >= COLS) return; for (let k = 0; k < ROWS; k++) clear.add(idx(k, cc)); beams.push({ dir: 'v', i: cc, life: 0.6, max: 0.6, color: hex, w, delay: 0 }); };
    let name;
    if (kinds === 'flare+flare') {
      addRow(r, hexA, 60); addCol(c, hexB, 60);
      name = 'CROSSFIRE';
    } else if (kinds === 'burst+flare') {
      for (let d = -1; d <= 1; d++) { addRow(r + d, hexA); addCol(c + d, hexB); }
      name = 'WIDE FLARE';
    } else {
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) if (inside(r + dr, c + dc)) clear.add(idx(r + dr, c + dc));
      rings.push({ x: px(c), y: py(r), r0: CELL * 0.5, r1: CELL * 3.6, life: 0.6, max: 0.6, color: hexA, w: 26, delay: 0 });
      rings.push({ x: px(c), y: py(r), r0: CELL * 0.3, r1: CELL * 2.6, life: 0.5, max: 0.5, color: '#ffffff', w: 10, delay: 0.06 });
      name = 'MEGA BURST';
    }
    addText(name, BX + BOARD_W / 2, BY + BOARD_H * 0.3, { size: 80, life: 1.4, vy: -20, weight: 700, color: '#ffffff', glow: hexA });
    flash = Math.min(1, flash + 0.5);
    flashColor = hexA;
    shake = 14;
    applyClear(clear, { detonated: new Set([a, b]), delays: distDelays(b, clear, 0.03), bonus: 300, kinds: new Set([A.special, B.special]) });
  }

  function startShuffle() {
    const list = [];
    for (let i = 0; i < ROWS * COLS; i++) list.push(at(i));
    const place = () => { for (let i = 0; i < list.length; i++) put(i, list[i]); };
    let ok = false;
    for (let tries = 0; tries < 300 && !ok; tries++) {
      for (let i = list.length - 1; i > 0; i--) { const j = ri(i + 1); [list[i], list[j]] = [list[j], list[i]]; }
      place();
      ok = !findRuns().length && findMoves().length > 0;
    }
    for (let tries = 0; tries < 500 && !ok; tries++) {
      for (const o of list) if (!o.special) o.color = ri(COLORS.length);
      ok = !findRuns().length && findMoves().length > 0;
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c];
        o.anim = { fx: o.x, fy: o.y, tx: c, ty: r, t: 0, dur: 0.95, swirl: true };
      }
    }
    selected = null;
    hint = null;
    addText('NO MOVES · RESHUFFLE', BX + BOARD_W / 2, BY + BOARD_H / 2, { size: 54, life: 1.4, vy: -10, weight: 700, color: '#fff3dc' });
    S.shuffle();
    setPhase('shuffle', 1.0);
  }

  // ---------------------------------------------------------------- input
  function readDir() {
    const inp = api.input;
    let d = null;
    let fresh = false;
    for (const k of Object.keys(DIRS)) if (inp.pressed(k)) { d = k; fresh = true; }
    if (!d) {
      const m = inp.move;
      if (Math.max(Math.abs(m.x), Math.abs(m.y)) > 0.5) d = Math.abs(m.x) > Math.abs(m.y) ? (m.x > 0 ? 'right' : 'left') : (m.y > 0 ? 'down' : 'up');
    }
    return { d, fresh };
  }

  function onDir(d) {
    idleT = 0;
    const [dr, dc] = DIRS[d];
    if (selected) {
      const r2 = selected.r + dr, c2 = selected.c + dc;
      if (phase === 'idle' && inside(r2, c2)) startSwap(idx(selected.r, selected.c), idx(r2, c2));
      else { bump.x = dc * 0.12; bump.y = dr * 0.12; S.bump(); }
      dirLock = true; // one swap per push
      return;
    }
    const r2 = cursor.r + dr, c2 = cursor.c + dc;
    if (!inside(r2, c2)) { bump.x = dc * 0.12; bump.y = dr * 0.12; return; }
    cursor = { r: r2, c: c2 };
    S.move();
  }

  function handleInput(dt) {
    const inp = api.input;
    if (timeUp) return;
    const { d, fresh } = readDir();
    if (!d) { heldDir = null; dirLock = false; }
    else if (fresh || d !== heldDir) { heldDir = d; dirLock = false; repeatT = 0.22; onDir(d); }
    else if (!dirLock) { repeatT -= dt; if (repeatT <= 0) { repeatT += 0.09; onDir(d); } }

    if (inp.pressed('a')) {
      idleT = 0;
      if (phase === 'idle') {
        const here = idx(cursor.r, cursor.c);
        if (!selected) { if (at(here)) { selected = { ...cursor }; dirLock = true; S.pick(); } }
        else if (selected.r === cursor.r && selected.c === cursor.c) { selected = null; S.drop(); }
        else if (Math.abs(selected.r - cursor.r) + Math.abs(selected.c - cursor.c) === 1) startSwap(idx(selected.r, selected.c), here);
        else { selected = { ...cursor }; dirLock = true; S.pick(); }
      }
    }
    if (inp.pressed('b')) { idleT = 0; if (selected) { selected = null; S.drop(); } }
    if (inp.pressed('x')) {
      idleT = 0;
      if (phase === 'idle') { hint = bestMove(); hintT = 2.6; if (hint) S.hint(); }
    }
  }

  // ---------------------------------------------------------------- update
  function updateOrbs(dt) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c];
        if (!o) continue;
        if (o.anim) {
          const A = o.anim;
          A.t += dt;
          const p = Math.min(1, A.t / A.dur);
          const e = easeInOut(p);
          let x = A.fx + (A.tx - A.fx) * e;
          let y = A.fy + (A.ty - A.fy) * e;
          if (A.arc) {
            const k = Math.sin(p * Math.PI) * 0.16 * A.arc;
            x += -(A.ty - A.fy) * k;
            y += (A.tx - A.fx) * k;
          }
          if (A.swirl) {
            const k = Math.sin(p * Math.PI);
            const ang = k * 1.8;
            const dx = (x - 3.5) * (1 - 0.6 * k), dy = (y - 3.5) * (1 - 0.6 * k);
            x = 3.5 + dx * Math.cos(ang) - dy * Math.sin(ang);
            y = 3.5 + dx * Math.sin(ang) + dy * Math.cos(ang);
          }
          o.x = x; o.y = y;
          if (p >= 1) { o.x = A.tx; o.y = A.ty; o.anim = null; }
        }
        if (o.born > 0) o.born = Math.max(0, o.born - dt * 1.8);
        if (o.squash > 0) o.squash = Math.max(0, o.squash - dt * 5);
        if (o.dying) {
          o.die += dt;
          if (!o.popped && o.die >= o.delay) { o.popped = true; spawnPop(o, px(c), py(r)); }
        }
      }
    }
  }

  function updateFx(dt) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts[i] = parts[parts.length - 1]; parts.pop(); continue; }
      const drag = Math.exp(-3 * dt);
      p.vx *= drag; p.vy = p.vy * drag + 340 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    for (const list of [texts, beams, rings, arcs]) {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e.delay > 0) { e.delay -= dt; continue; }
        e.life -= dt;
        if (e.y !== undefined && e.vy) e.y += e.vy * dt;
        if (e.life <= 0) list.splice(i, 1);
      }
    }
    flash = Math.max(0, flash - dt * 2.6);
    shake = Math.max(0, shake - dt * 40);
    chainPop = Math.max(0, chainPop - dt * 3);
    chainHold = Math.max(0, chainHold - dt);
    bump.x *= Math.exp(-dt * 18); bump.y *= Math.exp(-dt * 18);
    const k = 1 - Math.exp(-dt * 26);
    cursorPos.x += (cursor.c - cursorPos.x) * k;
    cursorPos.y += (cursor.r - cursorPos.y) * k;
  }

  function updateTimer(dt) {
    if (!started) { readyT += dt; return; }
    if (!timeUp) {
      const before = Math.ceil(timeLeft);
      timeLeft = Math.max(0, timeLeft - dt);
      const after = Math.ceil(timeLeft);
      if (after < before && after <= 10 && after > 0) S.tick(after);
      if (timeLeft <= 0) {
        timeUp = true;
        selected = null;
        hint = null;
        S.timeUp();
      }
    }
    if (timeUp && phase === 'idle' && !overCalled) {
      endT += dt;
      if (endT >= 1.5) {
        overCalled = true;
        api.gameOver({ score, stats: { maxCascade: stats.maxCascade, novas: stats.novas } });
      }
    }
  }

  function update(dt) {
    t += dt;
    updateTimer(dt);
    handleInput(dt);
    phaseT += dt;
    if (phase === 'idle') {
      if (!timeUp) idleT += dt;
      if (hintT > 0) hintT -= dt;
      if (!hint && !timeUp && (idleT > 6 || hintT > 0)) hint = bestMove();
    }
    if (phase === 'swap' && phaseT >= phaseDur) finishSwap();
    else if (phase === 'unswap' && phaseT >= phaseDur) setPhase('idle');
    else if (phase === 'pop' && phaseT >= phaseDur) { removeDying(); collapse(); setPhase('fall'); }
    else if (phase === 'fall') updateFall(dt);
    else if (phase === 'wait' && phaseT >= phaseDur) { const f = pending; pending = null; if (f) f(); else setPhase('idle'); }
    else if (phase === 'shuffle' && phaseT >= phaseDur) setPhase('idle');
    updateOrbs(dt);
    updateFx(dt);
    const diff = score - shown;
    shown = Math.abs(diff) < 1 ? score : shown + diff * Math.min(1, dt * 7);
  }

  // ---------------------------------------------------------------- draw
  function drawBokeh(ctx) {
    ctx.globalCompositeOperation = 'lighter';
    for (const b of bokeh) {
      const x = b.x + Math.sin(t * b.sp + b.ph) * b.amp;
      const y = b.y + Math.cos(t * b.sp * 0.8 + b.ph) * b.amp * 0.6;
      ctx.globalAlpha = b.a;
      ctx.drawImage(glow(b.col, 64), x - b.r, y - b.r, b.r * 2, b.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function hintCells() {
    if (!hint || phase !== 'idle' || timeUp) return null;
    if (hintT <= 0 && idleT <= 6) return null;
    return hint;
  }

  function orbPlacement(o, r, c, liftId) {
    let x = px(o.x), y = py(o.y);
    let s = 1, a = 1;
    if (o.dying) {
      const local = clamp((o.die - o.delay) / 0.24, 0, 1);
      if (o.merge && local > 0) {
        const e = easeIn(local);
        x += (px(o.merge.x) - x) * e;
        y += (py(o.merge.y) - y) * e;
        s = 1 - 0.4 * local;
      } else s = 1 + 0.35 * local;
      a = 1 - local;
    }
    if (o.id === liftId) {
      if (selected) { s *= 1.12 + 0.03 * Math.sin(t * 8); y -= 5; }
      else if (swapInfo && o.anim && (phase === 'swap' || phase === 'unswap')) s *= 1.1;
    }
    return { x, y, s, a };
  }

  function drawOrbs(ctx) {
    const sel = selected ? grid[selected.r][selected.c] : null;
    const liftId = sel ? sel.id : (swapInfo && (phase === 'swap' || phase === 'unswap') ? swapInfo.A.id : -1);
    const h = hintCells();
    const hintIds = new Map();
    if (h) {
      const [ar, ac] = rcOf(h.a), [br, bc] = rcOf(h.b);
      const strong = hintT > 0;
      const w = Math.sin(t * (strong ? 16 : 9)) * (strong ? 0.07 : 0.035) * (strong ? 1 : Math.max(0, Math.sin(t * 2.4)));
      const A = grid[ar][ac], B = grid[br][bc];
      if (A) hintIds.set(A.id, { dx: (bc - ac) * w, dy: (br - ar) * w });
      if (B) hintIds.set(B.id, { dx: (ac - bc) * w, dy: (ar - br) * w });
    }
    const list = [];
    let top = null;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const o = grid[r][c];
        if (!o) continue;
        const p = orbPlacement(o, r, c, liftId);
        const hw = hintIds.get(o.id);
        if (hw) { p.x += hw.dx * CELL; p.y += hw.dy * CELL; }
        if (o.y < -1.2) continue;
        const item = { o, p };
        if (o.id === liftId) top = item; else list.push(item);
      }
    }
    if (top) list.push(top);

    // pass 1: halos
    ctx.globalCompositeOperation = 'lighter';
    for (const { o, p } of list) drawOrbGlow(ctx, o, p.x, p.y, ORB_R * p.s, glow, p.a);
    // pass 2: bodies (with landing squash)
    ctx.globalCompositeOperation = 'source-over';
    for (const { o, p } of list) {
      if (o.squash > 0) {
        const q = Math.sin(o.squash * Math.PI) * 0.13 * o.squash;
        ctx.save();
        ctx.translate(p.x, p.y + ORB_R * q);
        ctx.scale(1 + q, 1 - q);
        drawOrbBody(ctx, o, 0, 0, ORB_R * p.s, t, p.a);
        ctx.restore();
      } else drawOrbBody(ctx, o, p.x, p.y, ORB_R * p.s, t, p.a);
    }
    // pass 3: special fx, pop flashes, creation flashes
    ctx.globalCompositeOperation = 'lighter';
    const white = glow('#ffffff', 64);
    for (const { o, p } of list) {
      drawSpecialFx(ctx, o, p.x, p.y, ORB_R * p.s, t, glow, p.a);
      if (o.dying && o.die >= o.delay) {
        const local = clamp((o.die - o.delay) / 0.24, 0, 1);
        const hex = o.color >= 0 ? COLORS[o.color].hex : '#ffffff';
        ctx.globalAlpha = (1 - local) * 0.75;
        const gs = ORB_R * (1.3 + local * 1.3);
        ctx.drawImage(glow(hex, 64), p.x - gs, p.y - gs, gs * 2, gs * 2);
        ctx.globalAlpha = (1 - local) * 0.4;
        const ws = ORB_R * (0.6 + local * 0.6);
        ctx.drawImage(white, p.x - ws, p.y - ws, ws * 2, ws * 2);
      } else if (o.dying) {
        ctx.globalAlpha = 0.15 + 0.12 * Math.sin(t * 40);
        ctx.drawImage(white, p.x - ORB_R * 0.8, p.y - ORB_R * 0.8, ORB_R * 1.6, ORB_R * 1.6);
      }
      if (o.born > 0) {
        ctx.globalAlpha = o.born * 0.6;
        const gs = ORB_R * (1.2 + (1 - o.born) * 1.4);
        ctx.drawImage(white, p.x - gs, p.y - gs, gs * 2, gs * 2);
      }
      if (hintIds.has(o.id)) {
        ctx.globalAlpha = (hintT > 0 ? 0.35 : 0.18) * (0.6 + 0.4 * Math.sin(t * 6));
        const gs = ORB_R * 1.5;
        ctx.drawImage(glow(ACCENT, 64), p.x - gs, p.y - gs, gs * 2, gs * 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function hintRect(h) {
    const [ar, ac] = rcOf(h.a), [br, bc] = rcOf(h.b);
    return {
      x: BX + Math.min(ac, bc) * CELL + 3, y: BY + Math.min(ar, br) * CELL + 3,
      w: (Math.abs(bc - ac) + 1) * CELL - 6, h: (Math.abs(br - ar) + 1) * CELL - 6,
    };
  }

  // Under the orbs: a soft plate and a marching outline around the suggested pair.
  function drawHintShimmer(ctx) {
    const h = hintCells();
    if (!h) return;
    const strong = hintT > 0;
    const R = hintRect(h);
    const pulse = strong ? 0.6 + 0.4 * Math.sin(t * 7) : 0.5 + 0.5 * Math.sin(t * 2.4);
    ctx.save();
    ctx.globalAlpha = strong ? 0.12 + 0.12 * pulse : 0.06 + 0.06 * pulse;
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 18); ctx.fill();
    ctx.globalAlpha = strong ? 0.45 + 0.4 * pulse : 0.3 + 0.25 * pulse;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 30;
    ctx.stroke();
    ctx.restore();
  }

  // Over the orbs: a band of light sweeping across the pair every couple of seconds.
  function drawHintSweep(ctx) {
    const h = hintCells();
    if (!h) return;
    const strong = hintT > 0;
    const cyc = (t * (strong ? 0.9 : 0.55)) % 1;
    if (cyc > 0.55) return;
    const f = easeInOut(cyc / 0.55);
    const R = hintRect(h);
    const sx = R.x - 70 + (R.w + 140) * f;
    ctx.save();
    ctx.beginPath(); ctx.roundRect(R.x, R.y, R.w, R.h, 18); ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const grd = ctx.createLinearGradient(sx - 45, R.y + R.h, sx + 45, R.y);
    grd.addColorStop(0, 'rgba(255,230,190,0)');
    grd.addColorStop(0.5, strong ? 'rgba(255,236,200,0.55)' : 'rgba(255,236,200,0.38)');
    grd.addColorStop(1, 'rgba(255,230,190,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(R.x, R.y, R.w, R.h);
    ctx.restore();
  }

  function drawCursor(ctx) {
    if (timeUp) return;
    const x = BX + (cursorPos.x + bump.x) * CELL, y = BY + (cursorPos.y + bump.y) * CELL;
    const busy = phase !== 'idle';
    const col = selected ? '#ffffff' : ACCENT;
    const pulse = 0.5 + 0.5 * Math.sin(t * (selected ? 9 : 4));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (busy ? 0.12 : 0.22) + 0.1 * pulse;
    ctx.drawImage(glow(col, 64), x - 18, y - 18, CELL + 36, CELL + 36);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = busy ? 0.45 : 1;
    ctx.strokeStyle = col;
    ctx.lineWidth = selected ? 4 : 3;
    ctx.beginPath(); ctx.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 18); ctx.stroke();
    // corner brackets
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    const o = -2 - pulse * 3, L = 18;
    const corners = [[x + o, y + o, 1, 1], [x + CELL - o, y + o, -1, 1], [x + o, y + CELL - o, 1, -1], [x + CELL - o, y + CELL - o, -1, -1]];
    for (const [cx, cy, sx, sy] of corners) {
      ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke();
    }
    if (selected && !busy) {
      ctx.fillStyle = '#ffffff';
      const mx = x + CELL / 2, my = y + CELL / 2;
      for (const [dr, dc] of Object.values(DIRS)) {
        if (!inside(selected.r + dr, selected.c + dc)) continue;
        const off = CELL / 2 + 10 + pulse * 4;
        ctx.save();
        ctx.translate(mx + dc * off, my + dr * off);
        ctx.rotate(Math.atan2(dr, dc));
        ctx.globalAlpha = 0.9;
        ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-5, -9); ctx.lineTo(-5, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawFx(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const white = glow('#ffffff', 64);
    for (const b of beams) {
      if (b.delay > 0) continue;
      const k = b.life / b.max;
      const grow = 1 - Math.pow(k, 4);
      const w = b.w * (0.5 + 0.5 * k);
      ctx.globalAlpha = k;
      if (b.dir === 'h') {
        const y = py(b.i), cx0 = BX + BOARD_W / 2, half = (BOARD_W / 2 + 60) * grow;
        ctx.drawImage(glow(b.color, 64), cx0 - half, y - w, half * 2, w * 2);
        ctx.drawImage(white, cx0 - half, y - w * 0.25, half * 2, w * 0.5);
      } else {
        const x = px(b.i), cy0 = BY + BOARD_H / 2, half = (BOARD_H / 2 + 60) * grow;
        ctx.drawImage(glow(b.color, 64), x - w, cy0 - half, w * 2, half * 2);
        ctx.drawImage(white, x - w * 0.25, cy0 - half, w * 0.5, half * 2);
      }
    }
    for (const r of rings) {
      if (r.delay > 0) continue;
      const k = r.life / r.max;
      const rr = r.r0 + (r.r1 - r.r0) * (1 - k * k);
      ctx.globalAlpha = k * 0.9;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.w * k + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, rr, 0, TAU); ctx.stroke();
    }
    const step = Math.floor(t * 30);
    for (const a of arcs) {
      const k = a.life / a.max;
      const segs = 7;
      const dx = a.x1 - a.x0, dy = a.y1 - a.y0;
      const len = Math.hypot(dx, dy) || 1;
      const nx = -dy / len, ny = dx / len;
      ctx.beginPath();
      ctx.moveTo(a.x0, a.y0);
      for (let s = 1; s < segs; s++) {
        const f = s / segs;
        const j = (hash(a.seed + s * 13.7 + step * 3.1) - 0.5) * Math.min(60, len * 0.25);
        ctx.lineTo(a.x0 + dx * f + nx * j, a.y0 + dy * f + ny * j);
      }
      ctx.lineTo(a.x1, a.y1);
      ctx.globalAlpha = k * 0.55;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 7;
      ctx.stroke();
      ctx.globalAlpha = k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    for (const p of parts) {
      const k = p.life / p.max;
      const s = p.size * (0.35 + 0.65 * k);
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.drawImage(glow(p.color, 32), p.x - s, p.y - s, s * 2, s * 2);
      const w = s * 0.32;
      ctx.drawImage(glow('#ffffff', 32), p.x - w, p.y - w, w * 2, w * 2);
    }
    ctx.restore();
  }

  function drawSidePanels(ctx) {
    ctx.save();
    // ---- right: time ring, score, cascade
    const frac = timeLeft / BLITZ;
    const low = started && timeLeft <= 10 && !timeUp;
    const col = low || timeUp ? '#ff5a4a' : ACCENT;
    const sub = timeLeft - Math.floor(timeLeft);
    ctx.lineCap = 'round';
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.beginPath(); ctx.arc(RCX, RING_Y, RING_R, 0, TAU); ctx.stroke();
    // ticks around the ring
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU;
      ctx.beginPath();
      ctx.moveTo(RCX + Math.cos(a) * (RING_R + 18), RING_Y + Math.sin(a) * (RING_R + 18));
      ctx.lineTo(RCX + Math.cos(a) * (RING_R + (i % 6 ? 23 : 28)), RING_Y + Math.sin(a) * (RING_R + (i % 6 ? 23 : 28)));
      ctx.stroke();
    }
    if (frac > 0) {
      const a0 = -Math.PI / 2, a1 = a0 + frac * TAU;
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgba(col, low ? 0.16 + 0.2 * sub : 0.16);
      ctx.lineWidth = 34;
      ctx.beginPath(); ctx.arc(RCX, RING_Y, RING_R, a0, a1); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      const grd = ctx.createLinearGradient(RCX, RING_Y - RING_R, RCX, RING_Y + RING_R);
      grd.addColorStop(0, mixA(col, '#ffffff', 0.35));
      grd.addColorStop(1, col);
      ctx.strokeStyle = grd;
      ctx.lineWidth = 14;
      ctx.beginPath(); ctx.arc(RCX, RING_Y, RING_R, a0, a1); ctx.stroke();
      const hx = RCX + Math.cos(a1) * RING_R, hy = RING_Y + Math.sin(a1) * RING_R;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(glow(col, 64), hx - 34, hy - 34, 68, 68);
      ctx.drawImage(glow('#ffffff', 32), hx - 10, hy - 10, 20, 20);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    const secs = Math.ceil(timeLeft);
    ctx.save();
    ctx.translate(RCX, RING_Y - 8);
    if (low) { const s = 1 + 0.12 * Math.pow(sub, 3); ctx.scale(s, s); }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `300 100px ${FONT}`;
    ctx.fillStyle = low || timeUp ? '#ff7a6a' : '#ffffff';
    ctx.fillText(String(secs), 0, 0);
    ctx.restore();
    label(ctx, timeUp ? 'TIME UP' : started ? 'SECONDS' : 'READY', RCX, RING_Y + 52);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `300 64px ${FONT}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(Math.round(shown).toLocaleString(), RCX, BY + 412);
    ctx.font = `17px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    const best = api.best || 0;
    ctx.fillText(best ? `Best ${Math.round(best).toLocaleString()}` : 'No best yet', RCX, BY + 462);

    const m = shownChain();
    const hot = m >= 2;
    const sc = 1 + 0.25 * easeIn(chainPop) * (hot ? 1 : 0);
    if (hot) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 8);
      ctx.drawImage(glow(ACCENT, 64), RCX - 120, BY + 610 - 90, 240, 180);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.save();
    ctx.translate(RCX, BY + 612);
    ctx.scale(sc, sc);
    ctx.font = `${hot ? 700 : 300} 92px ${FONT}`;
    ctx.fillStyle = hot ? '#ffe2b0' : 'rgba(255,255,255,0.35)';
    ctx.fillText(`x${m}`, 0, 0);
    ctx.restore();
    ctx.font = `17px ${FONT}`;
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(`Longest chain x${Math.max(1, stats.maxCascade)}   ·   Novas ${stats.novas}`, RCX, BY + 700);

    // ---- left: animated legend icons
    const icons = [{ color: 3, special: 'flare', dir: 'h', id: 11 }, { color: 1, special: 'burst', dir: 'h', id: 23 }, { color: -1, special: 'nova', dir: 'h', id: 37 }];
    icons.forEach((o, i) => drawOrbFull(ctx, o, LPX + 58, BY + 92 + i * 128, 30, t, glow, 1));
    ctx.restore();
  }

  function drawTexts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const tx of texts) {
      if (tx.delay > 0) continue;
      const k = tx.life / tx.max;
      const age = tx.max - tx.life;
      const sc = age < 0.2 ? Math.max(0.01, easeOutBack(age / 0.2)) : 1;
      ctx.globalAlpha = Math.min(1, k * 2.5);
      ctx.save();
      ctx.translate(tx.x, tx.y);
      ctx.scale(sc, sc);
      ctx.font = `${tx.weight} ${tx.size}px ${FONT}`;
      ctx.shadowColor = tx.glow;
      ctx.shadowBlur = tx.size * 0.45;
      ctx.lineWidth = Math.max(2, tx.size * 0.06);
      ctx.strokeStyle = 'rgba(20,10,4,0.55)';
      ctx.strokeText(tx.text, 0, 0);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawBanner(ctx) {
    const cxm = BX + BOARD_W / 2, cym = BY + BOARD_H / 2;
    let text = null, alpha = 1, col = '#fff3dc', glowCol = ACCENT;
    if (!started) { text = 'READY'; alpha = clamp(readyT * 3, 0, 1) * (0.7 + 0.3 * Math.sin(t * 6)); }
    else if (timeUp) { text = 'TIME UP'; alpha = clamp(endT * 3 + 0.4, 0, 1); col = '#ffffff'; glowCol = '#ff6a4a'; }
    if (!text) return;
    ctx.save();
    if (timeUp) {
      ctx.globalAlpha = alpha * 0.55;
      ctx.fillStyle = '#05030a';
      ctx.beginPath(); ctx.roundRect(BX - 22, BY - 22, BOARD_W + 44, BOARD_H + 44, 28); ctx.fill();
    }
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${timeUp ? 130 : 96}px ${FONT}`;
    spaced(ctx, timeUp ? 10 : 16);
    ctx.shadowColor = glowCol;
    ctx.shadowBlur = 50;
    ctx.fillStyle = col;
    ctx.fillText(text, cxm + (timeUp ? 5 : 8), cym);
    spaced(ctx, 0);
    if (timeUp) {
      ctx.shadowBlur = 0;
      ctx.font = `300 34px ${FONT}`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(`${score.toLocaleString()} points`, cxm, cym + 96);
    }
    ctx.restore();
  }

  function drawFlash(ctx) {
    if (flash <= 0.01) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flash * 0.45;
    const cxm = BX + BOARD_W / 2, cym = BY + BOARD_H / 2;
    ctx.drawImage(glow(flashColor, 64), cxm - 760, cym - 600, 1520, 1200);
    ctx.restore();
  }

  function draw(ctx) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(backdrop(), 0, 0);
    drawBokeh(ctx);
    ctx.drawImage(panels(), 0, 0);
    ctx.save();
    if (shake > 0.3) ctx.translate(Math.sin(t * 91.7) * shake * 0.6, Math.cos(t * 73.3) * shake * 0.6);
    drawHintShimmer(ctx);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(BX - 22, BY - 22, BOARD_W + 44, BOARD_H + 44, 28);
    ctx.clip();
    drawOrbs(ctx);
    drawHintSweep(ctx);
    ctx.restore();
    drawFx(ctx);
    drawCursor(ctx);
    ctx.restore();
    drawSidePanels(ctx);
    drawTexts(ctx);
    drawFlash(ctx);
    drawBanner(ctx);
    ctx.restore();
    api.hud(ctx, { score: Math.round(shown), left: [`Cascade x${shownChain()}`], right: [`${Math.ceil(timeLeft)}s`] });
  }

  // ---------------------------------------------------------------- start: orbs pour in
  fillBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const o = grid[r][c];
      o.y = r - ROWS - 0.6;
      o.wait = 0.25 + (ROWS - 1 - r) * 0.06 + c * 0.015;
    }
  }
  setPhase('fall');

  return { update, draw };
}

// ------------------------------------------------------------------ library art
function artBackground(ctx, w, h, hx, hy) {
  let grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, '#08050f');
  grd.addColorStop(0.5, '#190b21');
  grd.addColorStop(1, '#050308');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  const m = Math.max(w, h);
  grd = ctx.createRadialGradient(hx, hy, 0, hx, hy, m * 0.75);
  grd.addColorStop(0, 'rgba(255,150,60,0.36)');
  grd.addColorStop(0.3, 'rgba(210,70,120,0.13)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
  grd = ctx.createRadialGradient(w * 0.88, h * 0.06, 0, w * 0.88, h * 0.06, m * 0.6);
  grd.addColorStop(0, 'rgba(110,80,255,0.22)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);
}

// Soft light rays fanning out from the focal point.
function artRays(ctx, x, y, len, u, seed) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.filter = `blur(${Math.max(2, 7 * u)}px)`;
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI / 2 + (hash(seed + i) - 0.5) * 2.6;
    const wdt = (0.03 + hash(seed + i * 2.3) * 0.06);
    const g = ctx.createRadialGradient(x, y, 0, x, y, len);
    g.addColorStop(0, 'rgba(255,190,110,0.16)');
    g.addColorStop(1, 'rgba(255,150,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, len, a - wdt, a + wdt);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// A receding field of orbs below a horizon, with depth of field. u = size unit.
function artField(ctx, w, h, horizon, u, seed, skip) {
  const rows = 11;
  const far = makeCanvas(w, h);
  const near = makeCanvas(w, h);
  const fc = far.getContext('2d');
  const nc = near.getContext('2d');
  const layerOf = (d) => (d < 0.5 ? fc : d > 0.86 ? nc : ctx);
  const drawRow = (k) => {
    const d = (k + 1) / rows;
    const g = layerOf(d);
    const y = horizon + (h * 1.08 - horizon) * Math.pow(d, 1.7);
    const s = 0.16 + 1.0 * Math.pow(d, 1.5);
    const R = 40 * u * s;
    const gap = R * 2.35;
    const n = Math.ceil(w / gap) + 2;
    const off = (k % 2) * gap * 0.5 - gap;
    for (let i = 0; i < n; i++) {
      const x = off + i * gap;
      if (skip && skip(x, y, R)) continue;
      const kind = Math.floor(hash(seed + k * 31.3 + i * 7.7) * COLORS.length) % COLORS.length;
      const o = { color: kind, special: null, id: i + k * 40 };
      const alpha = 0.25 + 0.75 * Math.pow(d, 1.1);
      g.globalCompositeOperation = 'lighter';
      drawOrbGlow(g, o, x, y, R, softGlow, alpha);
      g.globalCompositeOperation = 'source-over';
      drawOrbBody(g, o, x, y, R, 0, alpha);
    }
    g.globalAlpha = 1;
  };
  for (let k = 0; k < rows; k++) if ((k + 1) / rows < 0.5) drawRow(k);
  ctx.save();
  ctx.filter = `blur(${Math.max(1, 2.2 * u)}px)`;
  ctx.drawImage(far, 0, 0);
  ctx.restore();
  // haze over the far rows
  const grd = ctx.createLinearGradient(0, horizon - 30 * u, 0, horizon + (h - horizon) * 0.3);
  grd.addColorStop(0, 'rgba(26,12,34,1)');
  grd.addColorStop(0.3, 'rgba(26,12,34,0.5)');
  grd.addColorStop(1, 'rgba(26,12,34,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, horizon - 30 * u, w, (h - horizon) * 0.3 + 30 * u);
  const hz = ctx.createLinearGradient(0, horizon - 70 * u, 0, horizon + 40 * u);
  hz.addColorStop(0, 'rgba(255,170,90,0)');
  hz.addColorStop(0.62, 'rgba(255,170,90,0.2)');
  hz.addColorStop(1, 'rgba(255,170,90,0)');
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = hz;
  ctx.fillRect(0, horizon - 70 * u, w, 110 * u);
  ctx.globalCompositeOperation = 'source-over';
  for (let k = 0; k < rows; k++) { const d = (k + 1) / rows; if (d >= 0.5 && d <= 0.86) drawRow(k); }
  for (let k = 0; k < rows; k++) if ((k + 1) / rows > 0.86) drawRow(k);
  ctx.save();
  ctx.filter = `blur(${Math.max(1.5, 4.5 * u)}px)`;
  ctx.drawImage(near, 0, 0);
  ctx.restore();
}

// Three orbs joined by a chain of light.
function artChain(ctx, pts, R, u, kind) {
  const hex = COLORS[kind].hex;
  const ctrl = (i) => { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; return [(x0 + x1) / 2, (y0 + y1) / 2 - 30 * u]; };
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) { const [mx, my] = ctrl(i); ctx.quadraticCurveTo(mx, my, pts[i][0], pts[i][1]); }
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'lighter';
  // bloom behind the whole chain
  const [cx, cy] = pts[1];
  ctx.globalAlpha = 0.55;
  ctx.drawImage(softGlow(hex, 64), cx - R * 5.5, cy - R * 4, R * 11, R * 8);
  ctx.globalAlpha = 1;
  for (const [lw, col] of [[96, rgba(hex, 0.07)], [52, rgba(hex, 0.16)], [24, mixA(hex, '#ffffff', 0.35, 0.5)], [9, 'rgba(255,240,215,0.95)'], [3, 'rgba(255,255,255,1)']]) {
    ctx.lineWidth = lw * u;
    ctx.strokeStyle = col;
    path();
    ctx.stroke();
  }
  // energy beads along the links
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const [mx, my] = ctrl(i);
    for (let k = 1; k < 8; k++) {
      const f = k / 8;
      const x = (1 - f) * (1 - f) * x0 + 2 * (1 - f) * f * mx + f * f * x1;
      const y = (1 - f) * (1 - f) * y0 + 2 * (1 - f) * f * my + f * f * y1;
      const s = (k % 3 === 0 ? 20 : 10) * u;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(softGlow('#ffffff', 32), x - s, y - s, s * 2, s * 2);
    }
  }
  for (const [x, y] of pts) {
    ctx.globalAlpha = 0.8;
    ctx.drawImage(softGlow(hex, 64), x - R * 2.7, y - R * 2.7, R * 5.4, R * 5.4);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = mixA(hex, '#ffffff', 0.45);
    ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.arc(x, y, R * 1.3, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 0.25;
    ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.arc(x, y, R * 1.58, 0, TAU); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  for (const [x, y] of pts) drawOrbBody(ctx, { color: kind, special: null }, x, y, R, 0, 1);
  // light them from inside
  ctx.globalCompositeOperation = 'lighter';
  for (const [x, y] of pts) {
    ctx.globalAlpha = 0.5;
    ctx.drawImage(softGlow(hex, 64), x - R * 1.05, y - R * 1.05, R * 2.1, R * 2.1);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(softGlow('#ffffff', 64), x - R * 0.75, y - R * 0.75, R * 1.5, R * 1.5);
    sparkle(ctx, x + R * 0.62, y - R * 0.68, 9 * u, 0.95, softGlow, '#ffe2b0');
  }
  ctx.restore();
}

function artSparkles(ctx, w, h, u, n, seed, avoid) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < n; i++) {
    const x = hash(seed + i * 3.1) * w;
    const y = hash(seed + i * 5.7 + 1) * h;
    if (avoid && avoid(x, y)) continue;
    const s = (2 + Math.pow(hash(seed + i * 9.3 + 2), 3) * 14) * u;
    const col = COLORS[i % COLORS.length].hex;
    sparkle(ctx, x, y, s, 0.55 + 0.45 * hash(seed + i), softGlow, mixA(col, '#ffffff', 0.5));
  }
  ctx.restore();
}

// "GLOW" over "LINK". Returns the block's metrics.
function artTitle(ctx, x, y, size, align) {
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `700 ${size}px ${FONT}`;
  spaced(ctx, size * 0.03);
  const gw = ctx.measureText('GLOW').width - size * 0.03;
  const left = align === 'center' ? x - gw / 2 : x;
  // warm bloom behind the word
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 0.4;
  ctx.drawImage(softGlow('#ff9a40', 64), left - gw * 0.2, y - size * 1.05, gw * 1.4, size * 1.5);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const grd = ctx.createLinearGradient(0, y - size * 0.74, 0, y);
  grd.addColorStop(0, '#fffbf2');
  grd.addColorStop(0.42, '#ffd38f');
  grd.addColorStop(1, '#ff8638');
  ctx.shadowColor = 'rgba(255,130,40,0.9)';
  ctx.shadowBlur = size * 0.3;
  ctx.fillStyle = grd;
  ctx.fillText('GLOW', left, y);
  ctx.shadowBlur = size * 0.08;
  ctx.shadowColor = 'rgba(255,230,180,0.9)';
  ctx.fillText('GLOW', left, y);
  ctx.shadowBlur = 0;
  // LINK: lighter weight, spread to GLOW's width
  const ls = size * 0.5;
  ctx.font = `400 ${ls}px ${FONT}`;
  spaced(ctx, 0);
  const raw = ctx.measureText('LINK').width;
  const spacing = Math.max(0, (gw - raw) / 3);
  spaced(ctx, spacing);
  const ly = y + ls * 1.12;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,190,120,0.85)';
  ctx.shadowBlur = size * 0.14;
  ctx.fillText('LINK', left, ly);
  ctx.shadowBlur = 0;
  spaced(ctx, 0);
  ctx.restore();
  return { bottom: ly + ls * 0.2, left, width: gw };
}

function artTagline(ctx, x, y, size, align) {
  ctx.save();
  ctx.font = `600 ${size}px ${FONT}`;
  spaced(ctx, size * 0.45);
  const text = 'PUZZLE';
  const tw = ctx.measureText(text).width - size * 0.45;
  const padX = size * 1.2, bh = size * 2.1;
  const bw = tw + padX * 2;
  const bx = align === 'center' ? x - bw / 2 : x;
  ctx.fillStyle = 'rgba(255,179,71,0.14)';
  ctx.strokeStyle = 'rgba(255,190,110,0.85)';
  ctx.lineWidth = Math.max(1, size * 0.09);
  ctx.beginPath(); ctx.roundRect(bx, y - bh / 2, bw, bh, bh / 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffe2b8';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, bx + padX, y + size * 0.04);
  ctx.restore();
  return bw;
}

function artVignette(ctx, w, h, k) {
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, `rgba(0,0,0,${k})`);
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

function drawCover(ctx, w, h) {
  const u = Math.min(w / 600, h / 900);
  ctx.save();
  artBackground(ctx, w, h, w * 0.5, h * 0.58);
  const horizon = h * 0.5;
  const chain = [[w * 0.2, h * 0.645], [w * 0.5, h * 0.545], [w * 0.8, h * 0.655]];
  const R = 64 * u;
  artRays(ctx, w * 0.5, h * 0.56, h * 0.75, u, 2.4);
  artField(ctx, w, h, horizon, u * 1.05, 4.2, (x, y, r) => chain.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < R * 1.15 + r));
  const top = ctx.createLinearGradient(0, 0, 0, h * 0.48);
  top.addColorStop(0, 'rgba(6,3,10,0.8)');
  top.addColorStop(1, 'rgba(6,3,10,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, w, h * 0.48);
  artSparkles(ctx, w, h * 0.95, u, 50, 9.1, (x, y) => y < h * 0.4 && Math.abs(x - w / 2) < w * 0.36);
  artChain(ctx, chain, R, u, 1);
  ctx.globalCompositeOperation = 'lighter';
  drawSpecialFx(ctx, { special: 'nova', color: -1, id: 2 }, w * 0.85, h * 0.87, 46 * u, 0.6, softGlow, 1);
  ctx.globalCompositeOperation = 'source-over';
  drawOrbBody(ctx, { special: 'nova', color: -1 }, w * 0.85, h * 0.87, 46 * u, 0.6, 1);
  artVignette(ctx, w, h, 0.5);
  const t = artTitle(ctx, w / 2, h * 0.19, 150 * u, 'center');
  artTagline(ctx, w / 2, t.bottom + 42 * u, 19 * u, 'center');
  ctx.restore();
}

function drawHero(ctx, w, h) {
  const u = Math.min(h / 720, w / 1100);
  ctx.save();
  artBackground(ctx, w, h, w * 0.7, h * 0.5);
  const horizon = h * 0.45;
  const chain = [[w * 0.56, h * 0.6], [w * 0.72, h * 0.41], [w * 0.88, h * 0.58]];
  const R = 74 * u;
  artRays(ctx, w * 0.72, h * 0.45, Math.max(w, h) * 0.6, u, 6.1);
  artField(ctx, w, h, horizon, u * 1.1, 7.7, (x, y, r) => chain.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < R * 1.15 + r));
  const side = ctx.createLinearGradient(0, 0, w * 0.66, 0);
  side.addColorStop(0, 'rgba(6,3,10,0.94)');
  side.addColorStop(0.5, 'rgba(6,3,10,0.72)');
  side.addColorStop(1, 'rgba(6,3,10,0)');
  ctx.fillStyle = side;
  ctx.fillRect(0, 0, w * 0.66, h);
  artSparkles(ctx, w, h, u, 64, 3.3, (x, y) => x < w * 0.45 && y > h * 0.18 && y < h * 0.82);
  artChain(ctx, chain, R, u, 1);
  ctx.globalCompositeOperation = 'lighter';
  drawSpecialFx(ctx, { special: 'flare', color: 3, dir: 'h', id: 5 }, w * 0.95, h * 0.87, 44 * u, 0.2, softGlow, 1);
  ctx.globalCompositeOperation = 'source-over';
  drawOrbBody(ctx, { special: 'flare', color: 3 }, w * 0.95, h * 0.87, 44 * u, 0.2, 1);
  artVignette(ctx, w, h, 0.45);
  const size = Math.min(160 * u, w * 0.15);
  const t = artTitle(ctx, w * 0.075, h * 0.48, size, 'left');
  artTagline(ctx, t.left, t.bottom + 40 * u, 18 * u, 'left');
  ctx.restore();
}

export default {
  key: 'glow',
  title: 'Glow Link',
  tagline: 'Puzzle',
  accent: ACCENT,
  controls: [
    ['D-pad / Left stick', 'Move the cursor'],
    ['A', 'Pick up an orb, then push a direction to swap'],
    ['B', 'Put the orb down'],
    ['X', 'Show a hint'],
    ['Start', 'Pause'],
  ],
  art: { cover: drawCover, hero: drawHero },
  create: createGame,
};
