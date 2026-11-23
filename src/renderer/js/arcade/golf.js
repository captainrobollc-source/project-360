// Orbit Golf: an original neon mini golf course for the Project 360 arcade.
//
// Nine holes laid out across the decks of a space station, one screen each. Bank off neon rails,
// ride cargo belts, skate over cryo ice, thread bridges across hull breaches, time the blast doors,
// dive through a wormhole and slingshot around a tiny planet. Fewer strokes score more, and a putt
// that banks off the rails on its way in pays a bonus.

const W = 1920;
const H = 1080;
const TAU = Math.PI * 2;
const ACCENT = '#ff5470';

// ------------------------------------------------------------------ physics tuning
const BALL_R = 11;
const CUP_R = 21;
const WALL_R = 6;            // half the thickness of a rail
const BAR_R = 9;             // half the thickness of a moving bar
const VMAX = 2300;           // px/s off the putter at full power
const FRICTION = 860;        // rolling resistance on deck turf (px/s²)
const DRAG = 0.3;            // extra speed-proportional loss (1/s): long putts settle a little sooner
const SUBSTEP = 4;           // most the ball moves (relative to anything moving) in one physics step
const WALL_E = 0.74;
const BUMPER_E = 0.92;
const BUMPER_KICK = 170;     // px/s a bumper adds on top of the rebound
const KICK_GAP = 0.25;       // bumpers kick at most this often, so a ball can't pump energy in a crevice
const PLANET_E = 0.8;
const BAR_E = 0.8;
const KEEP = 0.97;           // tangential speed kept through a rail contact
const SOFT_HIT = 40;         // slower contacts than this don't bounce (no buzzing against a rail)
const COUNT_HIT = 80;        // slower contacts don't count as a bank
const BELT_GRIP = 2400;      // how hard a conveyor drags the ball up to its own speed (px/s²)
const CUP_PULL_LIP = 1150;   // the rim slopes in: a ball hanging over the edge drops (beats friction)
const CUP_PULL_IN = 2000;
const CUP_DRAG = 1300;
const CAP_EDGE = 280;        // fastest a ball can roll and still drop, at the rim ...
const CAP_CENTER = 700;      // ... and dead centre; faster than that it lips out or skims over
const TELE_R = 30;
const TELE_TRIGGER = 18;
const REST_V = 5;
const REST_T = 0.12;
const SURF = { ice: { fr: 0.2, drag: 0.25 }, dust: { fr: 3.4, drag: 2.5 } };

// ------------------------------------------------------------------ rules & feel
const MAX_STROKES = 7;       // then the ball is picked up
const PICKED_STROKES = 8;    // what a picked-up hole counts as against par
const CHARGE_T = 2.6;        // one full 0 → 100 → 0 swing of the power meter (s); see meter()
const MIN_POWER = 0.025;     // a tap of A isn't a stroke
const PREVIEW_LEN = 520;
const INTRO_LOCK = 0.9;
const POINTS = { ace: 5000, eagle: 3000, birdie: 2000, par: 1200, bogey: 600, double: 250, worse: 100, picked: 0 };
const BANK_PTS = 250;
const BANK_CAP = 1000;
const RESULT = {
  ace: { text: 'HOLE IN ONE!', short: 'Hole in one', color: '#ffd84a' },
  eagle: { text: 'EAGLE!', short: 'Eagle', color: '#4ad8ff' },
  birdie: { text: 'BIRDIE!', short: 'Birdie', color: '#5dff9a' },
  par: { text: 'PAR', short: 'Par', color: '#ffffff' },
  bogey: { text: 'BOGEY', short: 'Bogey', color: '#ffb36b' },
  double: { text: 'DOUBLE BOGEY', short: 'Double bogey', color: '#ff8f6b' },
  worse: { text: 'HOLED', short: 'Holed', color: '#ff7a8a' },
  picked: { text: 'PICKED UP', short: 'Picked up', color: '#9aa3b8' },
};
const COL = {
  bumper: '#3ee8ff', belt: '#4dffb0', ice: '#9fe6ff', dust: '#d29a62', hazard: '#ffb02e',
  bar: '#ffd04d', tele: '#c27bff', well: '#7ea6ff', cup: '#bff6ff',
};
const BTN_COL = { A: '#5dc21e', B: '#e0352b', X: '#2a6fdb', Y: '#f5c400' };

// ------------------------------------------------------------------ the course
// A chamfered rectangle (corners cut by c), as a wall loop.
function box(x0, y0, x1, y1, c = 0) {
  if (!c) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  return [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];
}

// walls[0] is the course boundary; other closed loops are solid blocks, open ones are rails.
// Zones are { rect: [x0, y0, x1, y1] }, { circle: [x, y, r] } or { poly: [[x, y], ...] }.
// Movers: { spin: [x, y], len (half), rate (rad/s), a0 } or
//         { slide: [x, y], half: [hx, hy], axis: [ux, uy], amp, period (s), phase }.
// Black holes: { x, y, core (void radius), ref (full-strength radius), reach, g }.
// aim: the starting aim in degrees (a natural line down the hole, not a free line to the cup);
// without one the aim starts at the cup. label: where the hole number is stencilled on the deck.
const HOLES = [
  {
    // the cup sits off the tee's line, so an overhit putt glances off the far rail instead of
    // bouncing straight back in
    name: 'Docking Bay', par: 2, label: [930, 640], aim: 0,
    tee: [400, 690], cup: [1450, 450],
    walls: [{ pts: box(240, 330, 1680, 800, 80), closed: true }],
  },
  {
    name: 'Bumper Alley', par: 3, label: [700, 880], aim: 0,
    tee: [340, 830], cup: [1370, 380],
    walls: [{ pts: [[220, 700], [1160, 700], [1160, 320], [1220, 260], [1520, 260], [1580, 320], [1580, 900], [1520, 960], [280, 960], [220, 900]], closed: true }],
    bumpers: [[1440, 840, 52], [1250, 540, 28], [1490, 540, 28]],
    tip: 'Bumpers kick the ball back harder than it hits them',
  },
  {
    name: 'Cargo Belt', par: 3, label: [860, 830], aim: -45,
    tee: [460, 860], cup: [1420, 330],
    walls: [{ pts: box(300, 220, 1620, 960, 70), closed: true }, { pts: box(1230, 370, 1330, 460), closed: true }],
    belts: [{ rect: [440, 500, 1620, 640], dir: 180, speed: 560 }],
    bumpers: [[1540, 320, 24]], // breaks up easy rebounds off the corner
    tip: 'Conveyors drag the ball the way the arrows run',
  },
  {
    // a long slide across the ice into a dust bunker; the far rails are angled so nothing comes
    // straight back
    name: 'Cryo Deck', par: 3, label: [360, 520], aim: 0,
    tee: [360, 760], cup: [1560, 450],
    walls: [
      { pts: [[300, 240], [1480, 240], [1720, 420], [1720, 720], [1480, 940], [300, 940], [220, 860], [220, 320]], closed: true },
      { pts: [[980, 510], [1090, 620], [980, 730], [870, 620]], closed: true },
      { pts: box(1180, 300, 1260, 380), closed: true },
    ],
    ice: [{ rect: [500, 240, 1360, 940] }],
    dust: [{ rect: [1360, 240, 1720, 940] }],
    tip: 'Ice keeps the ball sliding · dust stops it dead',
  },
  {
    // the aim starts at the cup, straight over the breach: the narrow bridge is the brave way across
    name: 'Hull Breach', par: 3, label: [380, 800],
    tee: [360, 570], cup: [1580, 440],
    walls: [{ pts: box(200, 240, 1720, 940, 60), closed: true }],
    voids: [{ rect: [560, 240, 1360, 540] }, { rect: [560, 600, 1360, 820] }],
    tip: 'Fall into the void and it costs a stroke',
  },
  {
    name: 'Blast Doors', par: 3, label: [480, 740], aim: 0,
    tee: [340, 590], cup: [1580, 590],
    walls: [{ pts: box(200, 330, 1720, 850, 60), closed: true }, { pts: [[760, 330], [760, 520]] }, { pts: [[760, 660], [760, 850]] }],
    movers: [
      { slide: [760, 590], half: [0, 75], axis: [0, 1], amp: 150, period: 3.2, phase: 0 },
      { spin: [1260, 590], len: 185, rate: 1.25, a0: 0 },
    ],
    tip: 'Time your putt through the moving doors',
  },
  {
    name: 'Wormhole', par: 3, label: [600, 720], aim: -40,
    tee: [420, 800], cup: [1530, 390],
    walls: [{ pts: box(220, 240, 1700, 940, 70), closed: true }, { pts: [[960, 240], [960, 940]] }],
    tele: [[700, 440], [1220, 790]],
    voids: [{ rect: [1615, 240, 1700, 540] }],
    tip: 'Roll into a wormhole to come out of its twin',
  },
  {
    name: 'Slingshot', par: 3, label: [590, 860], aim: 0,
    tee: [380, 590], cup: [1540, 590],
    walls: [{ pts: box(220, 240, 1700, 940, 70), closed: true }, { pts: [[960, 240], [960, 420]] }, { pts: [[960, 760], [960, 940]] }],
    planets: [{ x: 960, y: 590, r: 70, reach: 380, g: 1600 }],
    tip: 'Gravity bends your putt around the planet',
  },
  {
    // three chambers in a zigzag: bumpers and a belt, then a black hole, then a turbine at the cup
    name: 'Event Horizon', par: 4, label: [960, 300], aim: 60,
    tee: [300, 320], cup: [1600, 830],
    walls: [
      { pts: box(170, 190, 1750, 1000, 80), closed: true },
      { pts: [[640, 190], [640, 700]] },
      { pts: [[1260, 1000], [1260, 480]] },
    ],
    bumpers: [[470, 590, 32], [1340, 920, 28]],
    belts: [{ rect: [176, 870, 900, 994], dir: 0, speed: 520 }],
    blackHoles: [{ x: 950, y: 590, core: 44, ref: 80, reach: 290, g: 1150 }],
    dust: [{ rect: [1266, 196, 1744, 320] }],
    movers: [{ spin: [1480, 650], len: 120, rate: 1.5, a0: 0 }],
    tip: 'Everything you have learned, all at once',
  },
];
const COURSE_PAR = HOLES.reduce((s, h) => s + h.par, 0);

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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
function rgbOf(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function mix(hex, to, t, a = 1) {
  const c = rgbOf(hex), e = rgbOf(to);
  return `rgba(${Math.round(c[0] + (e[0] - c[0]) * t)},${Math.round(c[1] + (e[1] - c[1]) * t)},${Math.round(c[2] + (e[2] - c[2]) * t)},${a})`;
}
const tint = (hex, t, a = 1) => mix(hex, '#ffffff', t, a);
const shade = (hex, t, a = 1) => mix(hex, '#000000', t, a);
const rgba = (hex, a) => mix(hex, hex, 0, a);
const toParText = (n) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `−${-n}`);

// The power meter after holding A for t seconds: up to 100 and back down, part linear and part
// eased. A purely eased swing lingers at the top, which would make a full-power putt free to
// time; this way it slows near the ends but never stops, so a hard putt is harder to judge.
function meter(t) {
  const u = (t / CHARGE_T) % 1, tri = u < 0.5 ? u * 2 : 2 - u * 2;
  return 0.6 * tri + 0.4 * (0.5 - 0.5 * Math.cos(Math.PI * tri));
}

function inPoly(pts, x, y) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inZone(z, x, y) {
  if (z.rect) { const r = z.rect; return x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3]; }
  if (z.circle) { const c = z.circle, dx = x - c[0], dy = y - c[1]; return dx * dx + dy * dy <= c[2] * c[2]; }
  return inPoly(z.poly, x, y);
}
function zonePath(g, z) {
  g.beginPath();
  if (z.rect) { const r = z.rect; g.rect(r[0], r[1], r[2] - r[0], r[3] - r[1]); }
  else if (z.circle) g.arc(z.circle[0], z.circle[1], z.circle[2], 0, TAU);
  else polyPath(g, z.poly, true);
}
function polyPath(g, pts, closed) {
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (closed) g.closePath();
}
function zoneCenter(z) {
  if (z.rect) return [(z.rect[0] + z.rect[2]) / 2, (z.rect[1] + z.rect[3]) / 2];
  if (z.circle) return [z.circle[0], z.circle[1]];
  return [z.poly.reduce((s, p) => s + p[0], 0) / z.poly.length, z.poly.reduce((s, p) => s + p[1], 0) / z.poly.length];
}

// ------------------------------------------------------------------ the world: one hole's physics
// Everything here is plain data and pure functions, so the putt preview (and a test harness) can
// run exactly the same simulation the game does.
function buildHole(def, index = 0) {
  const world = {
    def, index, t: 0,
    segs: [], circles: [], movers: [], belts: [], surfaces: [], voids: [], pads: [], wells: [],
    cup: { x: def.cup[0], y: def.cup[1] }, tee: { x: def.tee[0], y: def.tee[1] },
    outer: def.walls[0].pts,
    solids: def.walls.slice(1).filter((w) => w.closed).map((w) => w.pts),
    moverSpeed: 0,
  };
  const reach = BALL_R + WALL_R + 2;
  def.walls.forEach((wl, wi) => {
    const p = wl.pts, n = p.length;
    for (let i = 0; i < (wl.closed ? n : n - 1); i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % n];
      world.segs.push({
        kind: 'wall', key: wi, ax, ay, bx, by, r: WALL_R, e: WALL_E, keep: KEEP,
        x0: Math.min(ax, bx) - reach, x1: Math.max(ax, bx) + reach, y0: Math.min(ay, by) - reach, y1: Math.max(ay, by) + reach,
      });
    }
  });
  (def.bumpers || []).forEach(([x, y, r], i) => world.circles.push({ kind: 'bumper', key: 100 + i, x, y, r, e: BUMPER_E, keep: 1, kick: BUMPER_KICK, flash: 0 }));
  (def.planets || []).forEach((p, i) => {
    world.circles.push({ kind: 'planet', key: 200 + i, x: p.x, y: p.y, r: p.r, e: PLANET_E, keep: KEEP, kick: 0, flash: 0 });
    world.wells.push({ x: p.x, y: p.y, r: p.r, reach: p.reach, g: p.g });
  });
  (def.movers || []).forEach((m, i) => {
    const mv = { kind: 'bar', key: 300 + i, r: BAR_R, e: BAR_E, keep: KEEP, flash: 0, ...m, a0: m.a0 || 0, phase: m.phase || 0 };
    world.movers.push(mv);
    world.moverSpeed = Math.max(world.moverSpeed, m.spin ? Math.abs(m.rate) * (m.len + BAR_R) : (m.amp * TAU) / m.period);
    pose(mv, 0);
  });
  for (const b of def.belts || []) {
    const a = (b.dir * Math.PI) / 180;
    world.belts.push({ ...b, dx: Math.round(Math.cos(a) * 1e6) / 1e6, dy: Math.round(Math.sin(a) * 1e6) / 1e6 });
  }
  for (const z of def.ice || []) world.surfaces.push({ ...z, kind: 'ice', ...SURF.ice });
  for (const z of def.dust || []) world.surfaces.push({ ...z, kind: 'dust', ...SURF.dust });
  for (const z of def.voids || []) world.voids.push({ ...z });
  // a black hole is a gravity well around a void: pass too close and it swallows the ball
  for (const h of def.blackHoles || []) {
    world.wells.push({ x: h.x, y: h.y, r: h.ref, reach: h.reach, g: h.g, hole: true, core: h.core });
    world.voids.push({ circle: [h.x, h.y, h.core], well: true });
  }
  if (def.tele) world.pads = def.tele.map(([x, y]) => ({ x, y }));
  return world;
}

function pose(m, t) {
  if (m.spin) {
    const a = m.a0 + m.rate * t, c = Math.cos(a) * m.len, s = Math.sin(a) * m.len;
    m.cx = m.spin[0]; m.cy = m.spin[1]; m.ang = a;
    m.ax = m.cx - c; m.ay = m.cy - s; m.bx = m.cx + c; m.by = m.cy + s;
  } else {
    const w = TAU / m.period, ph = w * t + m.phase;
    const off = m.amp * Math.sin(ph), v = m.amp * w * Math.cos(ph);
    m.cx = m.slide[0] + m.axis[0] * off; m.cy = m.slide[1] + m.axis[1] * off;
    m.ax = m.cx - m.half[0]; m.ay = m.cy - m.half[1]; m.bx = m.cx + m.half[0]; m.by = m.cy + m.half[1];
    m.vx = m.axis[0] * v; m.vy = m.axis[1] * v;
  }
}
function setTime(world, t) { world.t = t; for (const m of world.movers) pose(m, t); }

function newBall(x, y) { return { x, y, vx: 0, vy: 0, lock: -1, still: 0, rollT: 0, over: false, kickAt: -9 }; }
function newEvents(withHits) { return { hits: withHits ? [] : null, bounces: 0, lastKey: -1, lastT: -9, t: 0, cup: false, void: null, tele: -1, lip: 0, rest: false }; }
function clearEvents(ev) { if (ev.hits) ev.hits.length = 0; ev.bounces = 0; ev.cup = false; ev.void = null; ev.tele = -1; ev.lip = 0; ev.rest = false; }

const Q = { x: 0, y: 0 }; // scratch: closest point on a segment
function closest(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  Q.x = ax + dx * t; Q.y = ay + dy * t;
  return Q;
}

// Push the ball out along n and bounce it off something moving at (vcx, vcy).
function impact(b, nx, ny, pen, vcx, vcy, obj, ev) {
  b.x += nx * pen; b.y += ny * pen;
  const rvx = b.vx - vcx, rvy = b.vy - vcy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;
  const hit = -vn;
  let out = hit < SOFT_HIT ? 0 : hit * obj.e;
  if (obj.kick && hit > 60 && ev.t - b.kickAt > KICK_GAP) { out = Math.min(out + obj.kick, hit * 1.8); b.kickAt = ev.t; }
  const tx = rvx - vn * nx, ty = rvy - vn * ny;
  b.vx = vcx + tx * obj.keep + nx * out;
  b.vy = vcy + ty * obj.keep + ny * out;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > VMAX * 1.15) { b.vx *= (VMAX * 1.15) / sp; b.vy *= (VMAX * 1.15) / sp; }
  if (hit > COUNT_HIT) {
    // one bank per surface: a ball grinding into a corner of the same wall loop counts once
    if (obj.key !== ev.lastKey || ev.t - ev.lastT > 0.15) ev.bounces++;
    ev.lastKey = obj.key; ev.lastT = ev.t;
    if (ev.hits) ev.hits.push({ obj, hit, x: b.x - nx * BALL_R, y: b.y - ny * BALL_R, nx, ny });
  }
}

function hitSeg(b, ax, ay, bx, by, obj, ev) {
  const q = closest(b.x, b.y, ax, ay, bx, by);
  let dx = b.x - q.x, dy = b.y - q.y;
  const min = BALL_R + obj.r, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  let d = Math.sqrt(d2);
  if (d < 1e-6) {
    // centre exactly on the line: push out to the side the ball is coming from
    dx = -(by - ay); dy = bx - ax;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l; d = 0;
    if (dx * b.vx + dy * b.vy > 0) { dx = -dx; dy = -dy; }
  } else { dx /= d; dy /= d; }
  let vcx = 0, vcy = 0;
  if (obj.kind === 'bar') {
    if (obj.spin) { vcx = -obj.rate * (q.y - obj.cy); vcy = obj.rate * (q.x - obj.cx); } else { vcx = obj.vx; vcy = obj.vy; }
  }
  impact(b, dx, dy, min - d, vcx, vcy, obj, ev);
  return true;
}

function hitCircle(b, c, ev) {
  let dx = b.x - c.x, dy = b.y - c.y;
  const min = BALL_R + c.r, d2 = dx * dx + dy * dy;
  if (d2 >= min * min) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-6) { dx = 0; dy = -1; } else { dx /= d; dy /= d; }
  impact(b, dx, dy, min - d, 0, 0, c, ev);
  return true;
}

// Moving bars push first and rails go last, so the rails always win: the ball can be squeezed but
// never shoved through a wall.
function collide(world, b, ev) {
  for (let it = 0; it < 4; it++) {
    let any = false;
    for (const m of world.movers) if (hitSeg(b, m.ax, m.ay, m.bx, m.by, m, ev)) any = true;
    for (const c of world.circles) if (hitCircle(b, c, ev)) any = true;
    for (const s of world.segs) {
      if (b.x < s.x0 || b.x > s.x1 || b.y < s.y0 || b.y > s.y1) continue;
      if (hitSeg(b, s.ax, s.ay, s.bx, s.by, s, ev)) any = true;
    }
    if (!any) return;
  }
}

// One frame of ball physics, in sub-steps short enough that nothing can tunnel. Reports through ev:
// hits (impacts), bounces (banks counted), cup / void / tele / lip, and rest.
function stepBall(world, b, dt, ev) {
  const n = Math.min(90, Math.max(1, Math.ceil(((Math.hypot(b.vx, b.vy) + world.moverSpeed) * dt) / SUBSTEP)));
  const h = dt / n;
  const cup = world.cup;
  for (let i = 0; i < n; i++) {
    world.t += h;
    ev.t = world.t;
    for (const m of world.movers) pose(m, world.t);
    let fr = FRICTION, drag = DRAG, ux = 0, uy = 0;
    const cx = cup.x - b.x, cy = cup.y - b.y, cd = Math.hypot(cx, cy);
    if (cd > CUP_R + BALL_R) {
      for (const z of world.surfaces) if (inZone(z, b.x, b.y)) { fr *= z.fr; drag *= z.drag; break; }
      for (const z of world.belts) {
        if (!inZone(z, b.x, b.y)) continue;
        const dv = clamp(z.speed - (b.vx * z.dx + b.vy * z.dy), -BELT_GRIP * h, BELT_GRIP * h);
        b.vx += z.dx * dv; b.vy += z.dy * dv;
        ux = z.dx * z.speed; uy = z.dy * z.speed; // it rolls against the moving belt, not the deck
        break;
      }
    } else if (cd > 1e-3) {
      const pull = cd < CUP_R ? CUP_PULL_IN : cd < CUP_R + BALL_R * 0.5 ? CUP_PULL_LIP : 0;
      b.vx += (cx / cd) * pull * h; b.vy += (cy / cd) * pull * h;
      if (cd < CUP_R) fr += CUP_DRAG;
    }
    for (const g of world.wells) {
      const gx = g.x - b.x, gy = g.y - b.y, d2 = gx * gx + gy * gy;
      if (d2 >= g.reach * g.reach || d2 < 1) continue;
      const d = Math.sqrt(d2), dd = Math.max(d, g.r);
      let a = (g.g * g.r * g.r) / (dd * dd);
      if (d > g.reach * 0.7) a *= (g.reach - d) / (g.reach * 0.3);
      b.vx += (gx / d) * a * h; b.vy += (gy / d) * a * h;
    }
    if (b.rollT > 20) fr *= 1 + (b.rollT - 20) * 2; // a safety net: nothing rolls forever
    const rx = b.vx - ux, ry = b.vy - uy, rs = Math.hypot(rx, ry);
    if (rs > 0) { const k = Math.max(0, rs - (fr + drag * rs) * h) / rs; b.vx = ux + rx * k; b.vy = uy + ry * k; }
    b.x += b.vx * h; b.y += b.vy * h;
    collide(world, b, ev);

    // the cup: slow enough drops, faster rattles over the rim
    const ex = b.x - cup.x, ey = b.y - cup.y, ed = Math.hypot(ex, ey);
    if (ed < CUP_R - 2) {
      if (Math.hypot(b.vx, b.vy) < CAP_EDGE + (CAP_CENTER - CAP_EDGE) * (1 - ed / CUP_R)) { ev.cup = true; return; }
      b.over = true;
    } else if (b.over && ed > CUP_R + 2) { b.over = false; ev.lip = Math.hypot(b.vx, b.vy); }
    for (const z of world.voids) if (inZone(z, b.x, b.y)) { ev.void = z; return; }
    const P = world.pads;
    if (P.length) {
      if (b.lock >= 0) {
        const p = P[b.lock];
        if (Math.hypot(b.x - p.x, b.y - p.y) > TELE_R + 10) b.lock = -1;
      } else {
        for (let k = 0; k < P.length; k++) {
          const dx = b.x - P[k].x, dy = b.y - P[k].y;
          if (dx * dx + dy * dy >= TELE_TRIGGER * TELE_TRIGGER) continue;
          const o = P[1 - k];
          b.x = o.x + dx; b.y = o.y + dy; b.lock = 1 - k; ev.tele = k;
          break;
        }
      }
    }
  }
  b.rollT += dt;
  if (Math.hypot(b.vx, b.vy) < REST_V) {
    b.still += dt;
    if (b.still >= REST_T) { b.vx = 0; b.vy = 0; ev.rest = true; }
  } else b.still = 0;
}

function onCourse(world, x, y) {
  if (!inPoly(world.outer, x, y)) return false;
  for (const s of world.solids) if (inPoly(s, x, y)) return false;
  return true;
}

// Would a ball centred here overlap anything solid?
function blocked(world, x, y) {
  for (const s of world.segs) {
    if (x < s.x0 || x > s.x1 || y < s.y0 || y > s.y1) continue;
    const q = closest(x, y, s.ax, s.ay, s.bx, s.by);
    if ((x - q.x) ** 2 + (y - q.y) ** 2 < (BALL_R + s.r) ** 2) return true;
  }
  for (const c of world.circles) if ((x - c.x) ** 2 + (y - c.y) ** 2 < (BALL_R + c.r) ** 2) return true;
  for (const m of world.movers) {
    const q = closest(x, y, m.ax, m.ay, m.bx, m.by);
    if ((x - q.x) ** 2 + (y - q.y) ** 2 < (BALL_R + m.r) ** 2) return true;
  }
  return false;
}

// The putt preview: how far a ball travels in a straight line before its first contact.
function rayCast(world, x, y, dx, dy, maxLen) {
  let prev = 0;
  for (let s = 4; s <= maxLen; s += 4) {
    if (!blocked(world, x + dx * s, y + dy * s)) { prev = s; continue; }
    let lo = prev, hi = s;
    for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (blocked(world, x + dx * mid, y + dy * mid)) hi = mid; else lo = mid; }
    return { len: lo, hit: true };
  }
  return { len: maxLen, hit: false };
}

// ------------------------------------------------------------------ painting: the backdrop
let spaceCanvas = null;
function spaceBackdrop() {
  if (spaceCanvas) return spaceCanvas;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  let gr = g.createLinearGradient(0, 0, W, H);
  gr.addColorStop(0, '#05030f'); gr.addColorStop(0.5, '#070a1c'); gr.addColorStop(1, '#030309');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'lighter';
  for (const [x, y, r, col, a] of [[260, 180, 620, '#ff3d7a', 0.10], [1700, 900, 700, '#5a3dff', 0.12], [1500, 120, 420, '#2fb8ff', 0.07], [380, 1000, 480, '#a63dff', 0.08]]) {
    const rg = g.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, rgba(col, a)); rg.addColorStop(1, rgba(col, 0));
    g.fillStyle = rg; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const R = rng32(4711);
  for (let i = 0; i < 420; i++) {
    const x = R() * W, y = R() * H, big = R() < 0.08;
    g.fillStyle = `rgba(${200 + R() * 55 | 0},${210 + R() * 45 | 0},255,${0.2 + R() * 0.6})`;
    g.fillRect(x, y, big ? 2 : 1, big ? 2 : 1);
  }
  g.globalCompositeOperation = 'source-over';
  spaceCanvas = c;
  return c;
}

function hazardPattern(g) {
  const c = document.createElement('canvas');
  c.width = c.height = 24;
  const p = c.getContext('2d');
  p.fillStyle = '#1a1206'; p.fillRect(0, 0, 24, 24);
  p.fillStyle = COL.hazard;
  for (let k = -24; k < 48; k += 24) { p.beginPath(); p.moveTo(k, 24); p.lineTo(k + 12, 24); p.lineTo(k + 36, 0); p.lineTo(k + 24, 0); p.closePath(); p.fill(); }
  return g.createPattern(c, 'repeat');
}

// ------------------------------------------------------------------ painting: a hole's static layer (once per hole)
const layerCache = new Map();
function paintHole(world) {
  if (layerCache.has(world.index)) return layerCache.get(world.index);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const def = world.def;
  const R = rng32(1000 + world.index * 97);
  g.drawImage(spaceBackdrop(), 0, 0);
  g.lineJoin = 'round'; g.lineCap = 'round';

  // the hull the deck is bolted into
  g.save();
  g.beginPath(); polyPath(g, world.outer, true);
  g.strokeStyle = '#0d1226'; g.lineWidth = 64; g.stroke();
  g.strokeStyle = '#1a2140'; g.lineWidth = 50; g.stroke();
  g.strokeStyle = 'rgba(255,84,112,0.10)'; g.lineWidth = 70; g.globalCompositeOperation = 'lighter'; g.stroke();
  g.restore();

  // deck plating
  g.save();
  g.beginPath(); polyPath(g, world.outer, true);
  let gr = g.createLinearGradient(0, 200, 0, 1000);
  gr.addColorStop(0, '#101a3a'); gr.addColorStop(1, '#0a1128');
  g.fillStyle = gr; g.fill();
  g.clip();
  g.strokeStyle = 'rgba(130,170,255,0.06)'; g.lineWidth = 1;
  g.beginPath();
  for (let x = 0; x <= W; x += 80) { g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); }
  for (let y = 0; y <= H; y += 80) { g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); }
  g.stroke();
  // heavier seams every third plate
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 3;
  g.beginPath();
  for (let x = 0; x <= W; x += 240) { g.moveTo(x, 0); g.lineTo(x, H); }
  for (let y = 0; y <= H; y += 240) { g.moveTo(0, y); g.lineTo(W, y); }
  g.stroke();
  g.fillStyle = 'rgba(160,190,255,0.10)';
  for (let x = 40; x < W; x += 80) for (let y = 40; y < H; y += 80) if (R() < 0.18) g.fillRect(x - 1, y - 1, 2, 2);
  // the deck's stencilled hole number
  if (def.label) {
    const [lx, ly] = def.label;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '900 150px "Segoe UI", sans-serif'; g.letterSpacing = '12px';
    g.fillStyle = 'rgba(190,205,255,0.06)';
    g.fillText(String(world.index + 1).padStart(2, '0'), lx, ly);
    g.font = '700 24px "Segoe UI", sans-serif'; g.letterSpacing = '9px';
    g.fillStyle = 'rgba(190,205,255,0.10)';
    g.fillText(def.name.toUpperCase(), lx, ly + 40);
    g.letterSpacing = '0px';
  }
  // a soft light pooled round the cup, so the eye finds it first
  g.globalCompositeOperation = 'lighter';
  const rg = g.createRadialGradient(world.cup.x, world.cup.y, 0, world.cup.x, world.cup.y, 900);
  rg.addColorStop(0, 'rgba(120,150,255,0.10)'); rg.addColorStop(1, 'rgba(120,150,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
  g.globalCompositeOperation = 'source-over';

  // ice and dust
  for (const z of world.surfaces) {
    g.save(); zonePath(g, z); g.clip();
    if (z.kind === 'ice') {
      const [zx, zy] = zoneCenter(z);
      const ig = g.createLinearGradient(zx - 400, zy - 400, zx + 400, zy + 400);
      ig.addColorStop(0, 'rgba(150,225,255,0.24)'); ig.addColorStop(0.5, 'rgba(110,190,255,0.14)'); ig.addColorStop(1, 'rgba(170,235,255,0.24)');
      g.fillStyle = ig; zonePath(g, z); g.fill();
      g.fillStyle = 'rgba(220,250,255,0.07)';
      for (let k = 0; k < 7; k++) { const x = zx - 700 + R() * 1400, wdt = 30 + R() * 90; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + wdt, 0); g.lineTo(x + wdt - 500, H); g.lineTo(x - 500, H); g.closePath(); g.fill(); }
      g.strokeStyle = 'rgba(230,250,255,0.16)'; g.lineWidth = 1.2;
      for (let k = 0; k < 14; k++) {
        let x = zx + (R() - 0.5) * 900, y = zy + (R() - 0.5) * 700, a = R() * TAU;
        g.beginPath(); g.moveTo(x, y);
        for (let j = 0; j < 4; j++) { a += (R() - 0.5) * 1.4; x += Math.cos(a) * 26; y += Math.sin(a) * 26; g.lineTo(x, y); }
        g.stroke();
      }
    } else {
      g.fillStyle = 'rgba(120,78,46,0.55)'; zonePath(g, z); g.fill();
      const r = z.rect || [0, 0, W, H];
      for (let k = 0; k < 900; k++) {
        const x = r[0] + R() * (r[2] - r[0]), y = r[1] + R() * (r[3] - r[1]);
        g.fillStyle = R() < 0.5 ? 'rgba(230,170,110,0.28)' : 'rgba(40,20,10,0.35)';
        g.fillRect(x, y, 1 + R() * 2.5, 1 + R() * 2.5);
      }
    }
    g.restore();
    g.save(); zonePath(g, z);
    g.strokeStyle = z.kind === 'ice' ? 'rgba(200,245,255,0.55)' : 'rgba(230,170,110,0.55)';
    g.lineWidth = 2; if (z.kind === 'dust') g.setLineDash([10, 8]);
    g.stroke(); g.restore();
  }

  // conveyor beds (the arrows are animated on top)
  for (const z of world.belts) {
    const [x0, y0, x1, y1] = z.rect;
    g.fillStyle = '#071618'; g.fillRect(x0, y0, x1 - x0, y1 - y0);
    g.strokeStyle = rgba(COL.belt, 0.18); g.lineWidth = 1;
    const along = Math.abs(z.dx) > 0.5;
    g.beginPath();
    if (along) for (let x = x0; x <= x1; x += 24) { g.moveTo(x + 0.5, y0); g.lineTo(x + 0.5, y1); }
    else for (let y = y0; y <= y1; y += 24) { g.moveTo(x0, y + 0.5); g.lineTo(x1, y + 0.5); }
    g.stroke();
    g.strokeStyle = rgba(COL.belt, 0.6); g.lineWidth = 3;
    g.beginPath();
    if (along) { g.moveTo(x0, y0 + 2); g.lineTo(x1, y0 + 2); g.moveTo(x0, y1 - 2); g.lineTo(x1, y1 - 2); }
    else { g.moveTo(x0 + 2, y0); g.lineTo(x0 + 2, y1); g.moveTo(x1 - 2, y0); g.lineTo(x1 - 2, y1); }
    g.stroke();
  }

  // hull breaches: the deck simply isn't there
  if (world.voids.length) {
    const pat = hazardPattern(g);
    for (const z of world.voids) {
      if (z.well) { paintBlackHole(g, z.circle[0], z.circle[1], z.circle[2]); continue; }
      g.save(); zonePath(g, z); g.clip();
      g.fillStyle = '#010106'; zonePath(g, z); g.fill();
      g.drawImage(spaceBackdrop(), 0, 0);
      g.fillStyle = 'rgba(1,1,6,0.45)'; g.fillRect(0, 0, W, H);
      zonePath(g, z);
      g.strokeStyle = 'rgba(0,0,0,0.75)'; g.lineWidth = 46; g.stroke();
      g.strokeStyle = 'rgba(140,60,255,0.16)'; g.lineWidth = 90; g.globalCompositeOperation = 'lighter'; g.stroke();
      g.restore();
      g.save(); zonePath(g, z);
      g.strokeStyle = pat || COL.hazard; g.lineWidth = 9; g.stroke();
      g.strokeStyle = 'rgba(255,200,120,0.5)'; g.lineWidth = 1; g.stroke();
      g.restore();
    }
  }

  // wormhole pads (swirl is animated)
  for (const p of world.pads) {
    const pg = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, TELE_R + 14);
    pg.addColorStop(0, '#05010c'); pg.addColorStop(0.7, '#1a0830'); pg.addColorStop(1, 'rgba(60,20,110,0)');
    g.fillStyle = pg; g.beginPath(); g.arc(p.x, p.y, TELE_R + 14, 0, TAU); g.fill();
    g.save(); g.shadowColor = COL.tele; g.shadowBlur = 18;
    g.strokeStyle = COL.tele; g.lineWidth = 4; g.beginPath(); g.arc(p.x, p.y, TELE_R, 0, TAU); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(240,220,255,0.8)'; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, TELE_R, 0, TAU); g.stroke();
  }

  // the cup
  const { x: cx, y: cy } = world.cup;
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.beginPath(); g.arc(cx + 2, cy + 3, CUP_R + 5, 0, TAU); g.fill();
  const cg = g.createRadialGradient(cx - 4, cy - 5, 0, cx, cy, CUP_R);
  cg.addColorStop(0, '#000000'); cg.addColorStop(0.75, '#02040a'); cg.addColorStop(1, '#16203c');
  g.fillStyle = cg; g.beginPath(); g.arc(cx, cy, CUP_R, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(220,245,255,0.85)'; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, CUP_R, 0, TAU); g.stroke();
  g.strokeStyle = 'rgba(190,246,255,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, CUP_R + 9, 0, TAU); g.stroke();

  // the tee box
  const { x: tx, y: ty } = world.tee;
  g.strokeStyle = 'rgba(255,255,255,0.16)'; g.lineWidth = 2; g.setLineDash([6, 6]);
  g.beginPath(); g.roundRect(tx - 34, ty - 34, 68, 68, 10); g.stroke();
  g.setLineDash([]);
  g.fillStyle = rgba(ACCENT, 0.7);
  for (const s of [-1, 1]) { g.beginPath(); g.arc(tx + s * 26, ty - 26, 3, 0, TAU); g.fill(); }
  g.restore(); // deck clip

  // solid blocks (crates, ice blocks)
  for (const s of world.solids) {
    g.save();
    g.beginPath(); polyPath(g, s, true);
    const sg = g.createLinearGradient(0, Math.min(...s.map((p) => p[1])), 0, Math.max(...s.map((p) => p[1])));
    sg.addColorStop(0, '#2a1630'); sg.addColorStop(1, '#130a1a');
    g.fillStyle = sg; g.fill(); g.clip();
    g.strokeStyle = 'rgba(255,84,112,0.12)'; g.lineWidth = 6;
    g.beginPath();
    for (let k = -1200; k < 2400; k += 22) { g.moveTo(k, 0); g.lineTo(k + 1080, 1080); }
    g.stroke();
    g.restore();
  }

  // rails: the neon is painted once, so a real blur is affordable here
  g.save();
  g.lineJoin = 'round'; g.lineCap = 'round';
  const railPath = () => { g.beginPath(); for (const wl of def.walls) polyPath(g, wl.pts, wl.closed); };
  g.shadowColor = ACCENT; g.shadowBlur = 26;
  g.strokeStyle = ACCENT; g.lineWidth = WALL_R * 2;
  railPath(); g.stroke(); g.stroke();
  g.shadowBlur = 0;
  g.strokeStyle = tint(ACCENT, 0.55); g.lineWidth = 5; railPath(); g.stroke();
  g.strokeStyle = '#fff4f6'; g.lineWidth = 2; railPath(); g.stroke();
  g.restore();

  // bumpers
  for (const b of world.circles) {
    if (b.kind !== 'bumper') continue;
    g.save();
    const bg = g.createRadialGradient(b.x - b.r * 0.3, b.y - b.r * 0.3, 0, b.x, b.y, b.r);
    bg.addColorStop(0, '#1d4e66'); bg.addColorStop(0.7, '#0b2233'); bg.addColorStop(1, '#06121c');
    g.fillStyle = bg; g.beginPath(); g.arc(b.x, b.y, b.r, 0, TAU); g.fill();
    g.shadowColor = COL.bumper; g.shadowBlur = 22;
    g.strokeStyle = COL.bumper; g.lineWidth = 6; g.beginPath(); g.arc(b.x, b.y, b.r - 3, 0, TAU); g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = '#eaffff'; g.lineWidth = 2; g.stroke();
    g.strokeStyle = rgba(COL.bumper, 0.5); g.lineWidth = 2; g.beginPath(); g.arc(b.x, b.y, b.r * 0.45, 0, TAU); g.stroke();
    g.fillStyle = '#eaffff'; g.beginPath(); g.arc(b.x, b.y, 3, 0, TAU); g.fill();
    g.restore();
  }

  // planets
  for (const p of world.circles) {
    if (p.kind !== 'planet') continue;
    paintPlanet(g, p.x, p.y, p.r, R);
  }

  // slide tracks for the blast doors
  for (const m of world.movers) {
    if (!m.slide) continue;
    g.save();
    g.strokeStyle = rgba(COL.bar, 0.25); g.lineWidth = 2; g.setLineDash([4, 8]);
    g.beginPath();
    g.moveTo(m.slide[0] - m.axis[0] * m.amp - m.half[0], m.slide[1] - m.axis[1] * m.amp - m.half[1]);
    g.lineTo(m.slide[0] + m.axis[0] * m.amp + m.half[0], m.slide[1] + m.axis[1] * m.amp + m.half[1]);
    g.stroke();
    g.restore();
  }

  layerCache.set(world.index, c);
  return c;
}

function paintBlackHole(g, x, y, core) {
  g.save();
  // the deck sags and glows around it
  g.globalCompositeOperation = 'lighter';
  let rg = g.createRadialGradient(x, y, core, x, y, core * 4.2);
  rg.addColorStop(0, 'rgba(255,150,90,0.38)'); rg.addColorStop(0.25, 'rgba(194,123,255,0.22)'); rg.addColorStop(1, 'rgba(120,60,255,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(x, y, core * 4.2, 0, TAU); g.fill();
  g.globalCompositeOperation = 'source-over';
  rg = g.createRadialGradient(x, y, core * 0.6, x, y, core * 1.5);
  rg.addColorStop(0, 'rgba(0,0,0,1)'); rg.addColorStop(0.55, 'rgba(0,0,0,0.85)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rg; g.beginPath(); g.arc(x, y, core * 1.5, 0, TAU); g.fill();
  g.fillStyle = '#000'; g.beginPath(); g.arc(x, y, core, 0, TAU); g.fill();
  // photon ring
  g.shadowColor = '#ffb070'; g.shadowBlur = 16;
  g.strokeStyle = 'rgba(255,200,150,0.9)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, y, core + 1, 0, TAU); g.stroke();
  g.restore();
}

function paintPlanet(g, x, y, r, R) {
  g.save();
  // its shadow on the deck, then a halo of atmosphere
  g.fillStyle = 'rgba(0,0,0,0.45)'; g.beginPath(); g.arc(x + r * 0.22, y + r * 0.3, r * 1.02, 0, TAU); g.fill();
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(x, y, r * 0.9, x, y, r * 1.6);
  halo.addColorStop(0, rgba(COL.well, 0.35)); halo.addColorStop(1, rgba(COL.well, 0));
  g.fillStyle = halo; g.beginPath(); g.arc(x, y, r * 1.6, 0, TAU); g.fill();
  g.globalCompositeOperation = 'source-over';
  const pg = g.createRadialGradient(x - r * 0.4, y - r * 0.45, r * 0.05, x, y, r);
  pg.addColorStop(0, '#ffe2c4'); pg.addColorStop(0.35, '#ff9a6a'); pg.addColorStop(0.75, '#a8344a'); pg.addColorStop(1, '#2a0a24');
  g.fillStyle = pg; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.clip();
  // banded clouds
  for (let k = 0; k < 6; k++) {
    const yy = y - r + ((k + 0.5) / 6) * r * 2 + (R() - 0.5) * 8;
    g.fillStyle = k % 2 ? 'rgba(255,220,190,0.14)' : 'rgba(90,20,40,0.18)';
    g.beginPath(); g.ellipse(x, yy, r * 1.2, r * (0.06 + R() * 0.07), (R() - 0.5) * 0.15, 0, TAU); g.fill();
  }
  for (let k = 0; k < 5; k++) {
    const a = R() * TAU, d = R() * r * 0.7, cr = r * (0.06 + R() * 0.1);
    g.fillStyle = 'rgba(60,10,30,0.28)'; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, cr, 0, TAU); g.fill();
  }
  // terminator shading
  const sh = g.createRadialGradient(x - r * 0.5, y - r * 0.5, r * 0.6, x - r * 0.2, y - r * 0.2, r * 1.6);
  sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(10,0,20,0.75)');
  g.fillStyle = sh; g.fillRect(x - r, y - r, r * 2, r * 2);
  g.restore();
  g.strokeStyle = rgba(COL.well, 0.85); g.lineWidth = 2;
  g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke();
}

// ------------------------------------------------------------------ painting: shared bits
function drawFlag(ctx, x, y, t, lift, num) {
  const a = 1 - lift * 0.85;
  if (a <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = a;
  const top = y - 100 - lift * 30;
  // the stick's shadow falls across the deck
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 46, y + 34); ctx.stroke();
  const pg = ctx.createLinearGradient(x - 2, 0, x + 3, 0);
  pg.addColorStop(0, '#9aa6c0'); pg.addColorStop(0.5, '#ffffff'); pg.addColorStop(1, '#7a86a0');
  ctx.strokeStyle = pg; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y - (1 - lift) * 2); ctx.lineTo(x, top); ctx.stroke();
  // a pennant rippling in the recycled air
  const len = 58, ht = 34, pts = [];
  for (let i = 0; i <= 8; i++) {
    // top and bottom edges taper to the tip; the ripple grows away from the stick
    const u = i / 8, wv = Math.sin(t * 5.5 - u * 3.4) * 5 * u;
    pts.push([x + u * len, top + u * ht * 0.5 + wv, top + ht - u * ht * 0.5 + wv]);
  }
  ctx.beginPath();
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], pts[i][2]);
  ctx.closePath();
  const fg = ctx.createLinearGradient(x, top, x + len, top + ht);
  fg.addColorStop(0, tint(ACCENT, 0.25)); fg.addColorStop(1, shade(ACCENT, 0.25));
  ctx.fillStyle = fg; ctx.fill();
  ctx.strokeStyle = tint(ACCENT, 0.6, 0.9); ctx.lineWidth = 1.2; ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = '800 17px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(num), x + 21, top + ht * 0.47 + Math.sin(t * 5.5 - 1.2) * 2);
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
  ctx.letterSpacing = '0px';
}

// A controller button glyph centred on (x, y); returns its width.
function glyph(ctx, label, x, y, size) {
  ctx.save();
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  let wd;
  if (label.length === 1) {
    const r = size * 0.62;
    wd = r * 2;
    ctx.fillStyle = BTN_COL[label] || '#666';
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(size * 0.78)}px "Segoe UI", sans-serif`;
    ctx.fillText(label, x, y + size * 0.03);
  } else {
    ctx.font = `800 ${Math.round(size * 0.62)}px "Segoe UI", sans-serif`;
    wd = ctx.measureText(label).width + size * 0.9;
    ctx.fillStyle = '#3b4252';
    ctx.beginPath(); ctx.roundRect(x - wd / 2, y - size * 0.55, wd, size * 1.1, size * 0.3); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillText(label, x, y + size * 0.03);
  }
  ctx.restore();
  return wd;
}
// A line of text with button glyphs in it, centred on cx. parts: strings and { b: 'A' }.
function promptLine(ctx, parts, cx, y, size, color = '#fff') {
  ctx.save();
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${size * 0.12}px`;
  const gap = size * 0.35;
  const widths = parts.map((p) => (typeof p === 'string' ? ctx.measureText(p).width : (p.b.length === 1 ? size * 1.24 : 0) || measureGlyph(ctx, p.b, size)));
  const total = widths.reduce((s, w) => s + w, 0) + gap * (parts.length - 1);
  let x = cx - total / 2;
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  parts.forEach((p, i) => {
    if (typeof p === 'string') {
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.strokeText(p, x, y);
      ctx.fillStyle = color; ctx.fillText(p, x, y);
    } else glyph(ctx, p.b, x + widths[i] / 2, y, size);
    x += widths[i] + gap;
  });
  ctx.restore();
}
function measureGlyph(ctx, label, size) {
  ctx.save();
  ctx.font = `800 ${Math.round(size * 0.62)}px "Segoe UI", sans-serif`;
  const w = ctx.measureText(label).width + size * 0.9;
  ctx.restore();
  return w;
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
  const R = rng32(portrait ? 5150 : 7270);
  const L = Math.hypot(w, h);
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // deep space
  let g = ctx.createLinearGradient(0, 0, w * 0.4, h);
  g.addColorStop(0, '#0a0620'); g.addColorStop(0.55, '#060818'); g.addColorStop(1, '#020208');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const neb = portrait
    ? [[w * 0.2, h * 0.32, 420, '#ff3d7a', 0.22], [w * 0.9, h * 0.62, 460, '#6a3dff', 0.24], [w * 0.5, h * 0.95, 380, '#2fb8ff', 0.12]]
    : [[w * 0.62, h * 0.2, 520, '#ff3d7a', 0.2], [w * 0.95, h * 0.85, 560, '#6a3dff', 0.24], [w * 0.3, h * 0.9, 420, '#2fb8ff', 0.1]];
  for (const [x, y, r, col, a] of neb) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r * s);
    rg.addColorStop(0, rgba(col, a)); rg.addColorStop(1, rgba(col, 0));
    ctx.fillStyle = rg; ctx.fillRect(x - r * s, y - r * s, r * s * 2, r * s * 2);
  }
  for (let i = 0; i < 260; i++) {
    const x = R() * w, y = R() * h, big = R() < 0.1;
    ctx.fillStyle = `rgba(225,235,255,${0.25 + R() * 0.6})`;
    ctx.fillRect(x, y, (big ? 2.2 : 1.1) * s, (big ? 2.2 : 1.1) * s);
  }
  ctx.globalCompositeOperation = 'source-over';

  // a ringed gas giant hanging behind the station
  const gx = portrait ? w * 0.9 : w * 0.88, gy = portrait ? h * 0.36 : h * 0.2, gr = (portrait ? 190 : 210) * s;
  const ring = (front) => {
    ctx.save();
    ctx.translate(gx, gy); ctx.rotate(-0.38); ctx.scale(1, 0.22);
    ctx.beginPath();
    if (front) ctx.arc(0, 0, gr * 1.75, 0, Math.PI); else ctx.arc(0, 0, gr * 1.75, Math.PI, TAU);
    ctx.strokeStyle = 'rgba(255,190,210,0.45)'; ctx.lineWidth = gr * 0.32; ctx.stroke();
    ctx.strokeStyle = 'rgba(255,120,150,0.28)'; ctx.lineWidth = gr * 0.08;
    ctx.beginPath();
    if (front) ctx.arc(0, 0, gr * 2.02, 0, Math.PI); else ctx.arc(0, 0, gr * 2.02, Math.PI, TAU);
    ctx.stroke();
    ctx.restore();
  };
  ring(false);
  g = ctx.createRadialGradient(gx - gr * 0.45, gy - gr * 0.5, gr * 0.1, gx, gy, gr);
  g.addColorStop(0, '#ffd9e4'); g.addColorStop(0.35, '#e0607e'); g.addColorStop(0.8, '#5a1a4a'); g.addColorStop(1, '#1a0620');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(gx, gy, gr, 0, TAU); ctx.clip();
  for (let k = 0; k < 9; k++) {
    ctx.fillStyle = k % 2 ? 'rgba(255,220,230,0.12)' : 'rgba(60,10,40,0.2)';
    ctx.beginPath(); ctx.ellipse(gx, gy - gr + (k + 0.5) * (gr * 2 / 9), gr * 1.3, gr * 0.07, -0.38, 0, TAU); ctx.fill();
  }
  g = ctx.createRadialGradient(gx - gr * 0.5, gy - gr * 0.5, gr * 0.7, gx - gr * 0.2, gy - gr * 0.2, gr * 1.7);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(5,0,15,0.85)');
  ctx.fillStyle = g; ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  ctx.restore();
  ring(true);

  // the floating course, in perspective: u across, v away from us, z up
  const ix = portrait ? w * 0.5 : w * 0.67, iy = portrait ? h * 0.66 : h * 0.6;
  const f = (portrait ? 760 : 820) * s, T = 1.0, cT = Math.cos(T), sT = Math.sin(T), Z0 = 1500, vI = 560;
  const P = (u, v, z = 0) => {
    const Y = (v - vI) * cT + z * sT, Z = Z0 + (v - vI) * sT - z * cT;
    return [ix + (f * u) / Z, iy - (f * Y) / Z, f / Z];
  };
  const outline = [[-300, 0], [300, 0], [520, 160], [520, 900], [380, 1100], [-380, 1100], [-520, 900], [-520, 160]];
  const path = (pts, z) => { ctx.beginPath(); pts.forEach(([u, v], i) => { const [x, y] = P(u, v, z); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.closePath(); };
  // glow under the platform, then its hull
  const [px0, py0, pk0] = P(0, 520, -120);
  ctx.globalCompositeOperation = 'lighter';
  g = ctx.createRadialGradient(px0, py0, 0, px0, py0, 620 * pk0);
  g.addColorStop(0, rgba(ACCENT, 0.4)); g.addColorStop(1, rgba(ACCENT, 0));
  ctx.save(); ctx.translate(px0, py0); ctx.scale(1, 0.55); ctx.translate(-px0, -py0);
  ctx.fillStyle = g; ctx.fillRect(px0 - 620 * pk0, py0 - 620 * pk0, 1240 * pk0, 1240 * pk0);
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
  path(outline, -70);
  g = ctx.createLinearGradient(0, P(0, 1100, -70)[1], 0, P(0, 0, -70)[1]);
  g.addColorStop(0, '#120c22'); g.addColorStop(1, '#262040');
  ctx.fillStyle = g; ctx.fill();
  // side walls of the platform (front faces)
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i], b = outline[(i + 1) % outline.length];
    const A0 = P(a[0], a[1], 0), B0 = P(b[0], b[1], 0), A1 = P(a[0], a[1], -70), B1 = P(b[0], b[1], -70);
    ctx.beginPath(); ctx.moveTo(A0[0], A0[1]); ctx.lineTo(B0[0], B0[1]); ctx.lineTo(B1[0], B1[1]); ctx.lineTo(A1[0], A1[1]); ctx.closePath();
    const lit = b[0] - a[0] > 0 ? 0.55 : 0.3;
    ctx.fillStyle = `rgba(${40 + lit * 60 | 0},${34 + lit * 40 | 0},${70 + lit * 60 | 0},1)`; ctx.fill();
  }
  // deck
  path(outline, 0);
  g = ctx.createLinearGradient(0, P(0, 1100)[1], 0, P(0, 0)[1]);
  g.addColorStop(0, '#0c1430'); g.addColorStop(1, '#16224a');
  ctx.fillStyle = g; ctx.fill();
  ctx.save();
  path(outline, 0); ctx.clip();
  ctx.strokeStyle = 'rgba(140,175,255,0.13)'; ctx.lineWidth = 1 * s;
  ctx.beginPath();
  for (let u = -560; u <= 560; u += 80) { const a = P(u, 0), b = P(u, 1120); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  for (let v = 0; v <= 1120; v += 80) { const a = P(-560, v), b = P(560, v); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
  ctx.stroke();
  // a cryo patch and a conveyor give the deck some texture
  ctx.fillStyle = 'rgba(150,225,255,0.13)';
  const ice = [[200, 120], [470, 180], [470, 470], [230, 430]];
  path(ice, 0); ctx.fill();
  ctx.save(); path(ice, 0); ctx.clip();
  ctx.strokeStyle = 'rgba(225,250,255,0.22)'; ctx.lineWidth = 3 * s;
  for (let k = 0; k < 4; k++) { const a = P(170 + k * 90, 470), b = P(290 + k * 90, 110); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
  ctx.restore();
  ctx.strokeStyle = 'rgba(200,245,255,0.55)'; ctx.lineWidth = 1.5 * s; path(ice, 0); ctx.stroke();
  ctx.fillStyle = '#071618';
  path([[-470, 300], [-360, 300], [-360, 800], [-470, 800]], 0); ctx.fill();
  ctx.strokeStyle = rgba(COL.belt, 0.75); ctx.lineWidth = 3 * s;
  for (let v = 330; v < 800; v += 70) {
    const a = P(-450, v), m = P(-415, v + 26), b = P(-380, v);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(m[0], m[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.restore();

  // the planetoid's gravity field, a cup with its flag, bumpers and the putt's orbit
  const pl = [-10, 600], plR = 70;
  ctx.save();
  ctx.setLineDash([6 * s, 9 * s]);
  for (let k = 1; k <= 3; k++) {
    ctx.strokeStyle = rgba(COL.well, 0.42 - k * 0.1); ctx.lineWidth = 2 * s;
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) { const a = (i / 64) * TAU, [x, y] = P(pl[0] + Math.cos(a) * (plR + k * 60), pl[1] + Math.sin(a) * (plR + k * 60)); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
  }
  ctx.restore();
  const drawBumper = (u, v, r) => {
    const [x, y, k] = P(u, v, 10);
    ctx.save();
    ctx.translate(x, y); ctx.scale(1, cT * 1.05);
    ctx.shadowColor = COL.bumper; ctx.shadowBlur = 20 * s;
    ctx.fillStyle = '#0b2233'; ctx.beginPath(); ctx.arc(0, 0, r * k, 0, TAU); ctx.fill();
    ctx.strokeStyle = COL.bumper; ctx.lineWidth = 6 * k; ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 2 * k; ctx.stroke();
    ctx.restore();
  };
  drawBumper(330, 760, 46);
  drawBumper(-300, 980, 40);
  // the cup, far end
  const cupP = [170, 960];
  {
    const [x, y, k] = P(cupP[0], cupP[1]);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(artGlow(COL.cup), x - 70 * k, y - 40 * k, 140 * k, 80 * k);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(x, y, 36 * k, 36 * k * cT, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(220,245,255,0.9)'; ctx.lineWidth = 2.5 * k; ctx.stroke();
  }
  // the ball's orbit: where it has been (bright) and where it is going (dotted)
  const bez = (p0, p1, p2, p3, t) => { const m = 1 - t; return [m * m * m * p0[0] + 3 * m * m * t * p1[0] + 3 * m * t * t * p2[0] + t * t * t * p3[0], m * m * m * p0[1] + 3 * m * m * t * p1[1] + 3 * m * t * t * p2[1] + t * t * t * p3[1]]; };
  const trail = [[170, -10], [-40, 120], [-300, 230], [-260, 430]];
  const ahead = [[-260, 430], [-250, 720], [-40, 900], [cupP[0], cupP[1]]];
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i <= 70; i++) {
    const t = i / 70, [u, v] = bez(...trail, t), [x, y, k] = P(u, v, 12);
    const rr = (10 + 22 * t) * k;
    const rg = ctx.createRadialGradient(x, y, 0, x, y, rr);
    rg.addColorStop(0, `rgba(255,220,230,${0.05 + 0.3 * t})`); rg.addColorStop(0.45, rgba(ACCENT, 0.05 + 0.2 * t)); rg.addColorStop(1, rgba(ACCENT, 0));
    ctx.fillStyle = rg; ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 1; i <= 16; i++) {
    const t = i / 16.8, [u, v] = bez(...ahead, t), [x, y, k] = P(u, v, 6);
    ctx.fillStyle = `rgba(255,235,240,${0.85 - t * 0.5})`;
    ctx.beginPath(); ctx.arc(x, y, 5 * k, 0, TAU); ctx.fill();
  }
  // the planetoid itself
  {
    const [x, y, k] = P(pl[0], pl[1], plR * 0.55);
    const r = plR * k;
    const [sx, sy] = P(pl[0] + 40, pl[1] - 30, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.ellipse(sx, sy, r * 1.05, r * 1.05 * cT, 0, 0, TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(artGlow(COL.well), x - r * 2, y - r * 2, r * 4, r * 4);
    ctx.globalCompositeOperation = 'source-over';
    paintPlanet(ctx, x, y, r, rng32(31));
  }
  // flag on the cup
  {
    const [x, y, k] = P(cupP[0], cupP[1]);
    ctx.save();
    ctx.translate(x, y); ctx.scale(k * 1.7, k * 1.7); ctx.translate(-x, -y);
    drawFlag(ctx, x, y, 0.6, 0, 9);
    ctx.restore();
  }
  // the ball
  {
    const [u, v] = trail[3], [x, y, k] = P(u, v, 20);
    const r = 22 * k;
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(artGlow('#ffd6df'), x - r * 5, y - r * 5, r * 10, r * 10);
    ctx.globalCompositeOperation = 'source-over';
    g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.7, '#f1f3ff'); g.addColorStop(1, '#b9c0dd');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
  // the neon rail round the deck, thicker where it's nearer
  ctx.save();
  ctx.shadowColor = ACCENT; ctx.shadowBlur = 22 * s;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i], b = outline[(i + 1) % outline.length];
      const A = P(a[0], a[1], 8), B = P(b[0], b[1], 8);
      ctx.strokeStyle = pass ? '#fff2f5' : ACCENT;
      ctx.lineWidth = (pass ? 3.5 : 11) * (A[2] + B[2]) / 2;
      ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // vignette
  g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, L * 0.62);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.65)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  // title
  let tx, y1, y2, size1, size2, maxW, align;
  if (portrait) {
    g = ctx.createLinearGradient(0, 0, 0, h * 0.42);
    g.addColorStop(0, 'rgba(3,2,12,0.92)'); g.addColorStop(0.6, 'rgba(3,2,12,0.55)'); g.addColorStop(1, 'rgba(3,2,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h * 0.42);
    g = ctx.createLinearGradient(0, h * 0.84, 0, h);
    g.addColorStop(0, 'rgba(3,2,12,0)'); g.addColorStop(1, 'rgba(3,2,12,0.9)');
    ctx.fillStyle = g; ctx.fillRect(0, h * 0.84, w, h * 0.16);
    tx = w / 2; align = 'center'; size1 = 168 * s; y1 = 190 * s; size2 = 66 * s; y2 = 268 * s; maxW = w * 0.86;
  } else {
    g = ctx.createLinearGradient(0, 0, w * 0.62, 0);
    g.addColorStop(0, 'rgba(3,2,12,0.94)'); g.addColorStop(0.5, 'rgba(3,2,12,0.7)'); g.addColorStop(1, 'rgba(3,2,12,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w * 0.62, h);
    tx = 76 * s; align = 'left'; size1 = 180 * s; y1 = h * 0.5 + 6 * s; size2 = 72 * s; y2 = y1 + 88 * s; maxW = w * 0.42;
  }
  const lines = [
    { text: 'ORBIT', size: size1, weight: 900, spacing: size1 * 0.03, y: y1 },
    { text: 'GOLF', size: size2, weight: 300, spacing: size2 * 0.62, y: y2 },
  ];
  const off = document.createElement('canvas');
  off.width = w; off.height = h;
  const o = off.getContext('2d');
  o.textAlign = align; o.textBaseline = 'alphabetic';
  for (const ln of lines) {
    ln.size = fitFont(o, ln.text, ln.size, ln.weight, ln.spacing, maxW);
    ln.font = o.font; ln.ls = o.letterSpacing;
    ln.width = o.measureText(ln.text).width;
    const fg = o.createLinearGradient(0, ln.y - ln.size * 0.74, 0, ln.y);
    fg.addColorStop(0, '#ffffff'); fg.addColorStop(0.48, '#ffe6ec'); fg.addColorStop(0.5, '#ff9fb2'); fg.addColorStop(1, ACCENT);
    o.fillStyle = fg;
    o.fillText(ln.text, tx, ln.y);
  }
  // an orbit ring swung around the title: the back half sits behind the letters, the front half over them
  const tw = lines[0].width;
  const ocx = align === 'center' ? tx : tx + tw / 2, ocy = y1 - lines[0].size * 0.36;
  const orw = Math.min(tw * 0.62, portrait ? w * 0.46 : tw), orh = lines[0].size * 0.32;
  const orbit = (front) => {
    ctx.save();
    ctx.translate(ocx, ocy); ctx.rotate(-0.12);
    ctx.beginPath(); ctx.ellipse(0, 0, orw, orh, 0, front ? 0 : Math.PI, front ? Math.PI : TAU);
    ctx.strokeStyle = front ? 'rgba(255,230,236,0.9)' : 'rgba(255,140,165,0.45)'; ctx.lineWidth = (front ? 3 : 2) * s;
    ctx.shadowColor = ACCENT; ctx.shadowBlur = 14 * s;
    ctx.stroke();
    if (front) {
      const a = 0.62, bx = Math.cos(a) * orw, by = Math.sin(a) * orh;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(artGlow('#ffd6df'), bx - 40 * s, by - 40 * s, 80 * s, 80 * s);
      ctx.globalCompositeOperation = 'source-over';
      ctx.shadowBlur = 0; ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(bx, by, 8 * s, 0, TAU); ctx.fill();
    }
    ctx.restore();
  };
  orbit(false);
  ctx.save();
  ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.globalCompositeOperation = 'lighter';
  for (const ln of lines) {
    ctx.font = ln.font; ctx.letterSpacing = ln.ls;
    const dx = ln.size * 0.028;
    ctx.fillStyle = 'rgba(255,40,120,0.55)'; ctx.fillText(ln.text, tx - dx, ln.y + dx * 0.3);
    ctx.fillStyle = 'rgba(60,170,255,0.5)'; ctx.fillText(ln.text, tx + dx, ln.y - dx * 0.3);
  }
  ctx.restore();
  ctx.save();
  ctx.shadowColor = rgba(ACCENT, 0.9); ctx.shadowBlur = 30 * s;
  ctx.drawImage(off, 0, 0);
  ctx.restore();
  ctx.drawImage(off, 0, 0);
  orbit(true);

  // genre line
  ctx.save();
  ctx.textBaseline = 'middle';
  const tagSize = 22 * s;
  ctx.font = `600 ${tagSize}px "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${tagSize * 0.42}px`;
  const tag = 'MINI GOLF';
  const tgw = ctx.measureText(tag).width;
  const ty = portrait ? h - 46 * s : y2 + 56 * s;
  const tl = portrait ? w / 2 - tgw / 2 : tx;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,235,240,0.92)';
  ctx.fillText(tag, tl, ty);
  ctx.strokeStyle = ACCENT; ctx.lineWidth = 2 * s;
  ctx.beginPath();
  if (portrait) {
    ctx.moveTo(tl - 70 * s, ty); ctx.lineTo(tl - 22 * s, ty);
    ctx.moveTo(tl + tgw + 12 * s, ty); ctx.lineTo(tl + tgw + 60 * s, ty);
  } else {
    ctx.moveTo(tl + tgw + 18 * s, ty); ctx.lineTo(tl + tgw + 120 * s, ty);
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

// The art is painted once, outside a running game, so it makes its own glow sprites.
const artGlows = new Map();
function artGlow(color) {
  if (artGlows.has(color)) return artGlows.get(color);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, color); grd.addColorStop(0.25, rgba(color, 0.6)); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  artGlows.set(color, c);
  return c;
}

// ------------------------------------------------------------------ the game
export default {
  key: 'golf',
  title: 'Orbit Golf',
  tagline: 'Mini golf',
  accent: ACCENT,
  controls: [
    ['Left stick', 'Aim'],
    ['LB / RB · D-pad', 'Fine-tune the aim'],
    ['Hold A', 'Charge, let go to putt'],
    ['B', 'Cancel the putt'],
    ['Keyboard', 'A / D turn · Q / E nudge · Space putt · K cancel'],
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
      hole: 0, world: null, layer: null, ball: newBall(0, 0),
      phase: 'intro', phaseT: 0, clock: 0, introT: 0,
      strokes: 0, bounces: 0, rest: { x: 0, y: 0 },
      aim: 0, stickMag: 0, turnT: 0, fineT: 0,
      charging: false, chargeT: 0, power: 0, tick: 0,
      score: 0, card: [], over: false,
      stats: { holes: 0, aces: 0, toPar: 0, finished: false, maxBankSink: 0 },
      trail: [], parts: [], pops: [], banner: null, celebrate: null, shake: 0,
      sink: null, fall: null, appear: 0, lastResult: null, putted: false,
      sfxBudget: 0,
    };
    const ev = newEvents(true);

    // ---------------------------------------------------------- sound
    const snd = (voices) => { if (S.sfxBudget > 0) { S.sfxBudget--; api.sfx(voices); } };
    const panOf = (x) => clamp((x - W / 2) / 800, -0.8, 0.8);
    const sfx = {
      putt: (p) => snd([
        { noise: true, from: 3200, peakAt: 1900, to: 900, dur: 0.06, q: 1.2, peak: 0.1 + 0.22 * p },
        { tone: 760, to: 380, type: 'triangle', peak: 0.1 + 0.12 * p, attack: 0.002, decay: 0.08 },
        { tone: 210, to: 120, peak: 0.08 * p, attack: 0.002, decay: 0.1 },
      ]),
      clack: (k, x) => snd([
        { tone: 1500 + rnd(-120, 120), to: 950, type: 'triangle', peak: 0.12 * k, attack: 0.001, decay: 0.05, pan: panOf(x) },
        { noise: true, from: 4200, peakAt: 3000, to: 1600, dur: 0.045, q: 2, peak: 0.13 * k, panFrom: panOf(x), panTo: panOf(x) },
      ]),
      bumper: (k, x) => snd([
        { tone: 420, to: 860, peak: 0.16 * k + 0.04, attack: 0.002, decay: 0.16, pan: panOf(x) },
        { tone: 1290, to: 1720, peak: 0.05, attack: 0.002, decay: 0.12, pan: panOf(x) },
      ]),
      planet: (k, x) => snd([
        { tone: 170, to: 70, peak: 0.22 * k + 0.05, attack: 0.003, decay: 0.22, pan: panOf(x) },
        { noise: true, from: 700, peakAt: 400, to: 150, dur: 0.14, q: 0.8, peak: 0.15 * k, type: 'lowpass' },
      ]),
      clang: (k, x) => snd([
        { tone: 980, type: 'square', peak: 0.035 * k + 0.01, attack: 0.002, decay: 0.12, pan: panOf(x) },
        { tone: 1470, peak: 0.06 * k + 0.02, attack: 0.002, decay: 0.22, pan: panOf(x) },
        { tone: 2210, peak: 0.03 * k, attack: 0.002, decay: 0.14, pan: panOf(x) },
      ]),
      tele: () => snd([
        { tone: 300, to: 1800, peak: 0.1, attack: 0.01, decay: 0.22 },
        { noise: true, from: 600, peakAt: 6000, to: 9000, dur: 0.3, q: 1.5, peak: 0.1 },
        { tone: 1800, to: 520, at: 0.12, peak: 0.08, attack: 0.005, decay: 0.25 },
      ]),
      fall: () => snd([
        { tone: 720, to: 90, peak: 0.15, attack: 0.01, decay: 0.75 },
        { noise: true, from: 2200, peakAt: 900, to: 140, dur: 0.75, q: 0.7, peak: 0.2, type: 'lowpass' },
      ]),
      appear: () => snd([
        { tone: 600, to: 1200, peak: 0.06, attack: 0.02, decay: 0.2 },
        { noise: true, from: 3000, peakAt: 8000, to: 6000, dur: 0.25, q: 2, peak: 0.05 },
      ]),
      sink: () => snd([
        { tone: 330, to: 140, type: 'triangle', peak: 0.24, attack: 0.002, decay: 0.18 },
        { noise: true, from: 2600, peakAt: 1500, to: 600, dur: 0.1, q: 1.5, peak: 0.16 },
        { noise: true, at: 0.08, from: 2000, peakAt: 1200, to: 500, dur: 0.08, q: 1.5, peak: 0.1 },
        ...[1046.5, 1318.51, 1567.98].map((f, i) => ({ tone: f, at: 0.14 + i * 0.05, peak: 0.08, attack: 0.003, decay: 0.6 })),
      ]),
      lip: () => snd([
        { tone: 900, to: 620, peak: 0.07, attack: 0.002, decay: 0.05 },
        { tone: 760, to: 520, at: 0.06, peak: 0.06, attack: 0.002, decay: 0.05 },
        { noise: true, from: 3000, peakAt: 2000, to: 900, dur: 0.1, q: 1.6, peak: 0.06 },
      ]),
      tick: (p) => snd([{ tone: 480 + p * 900, peak: 0.022, attack: 0.001, decay: 0.03 }]),
      cancel: () => snd([{ tone: 520, to: 300, type: 'triangle', peak: 0.07, attack: 0.003, decay: 0.09 }]),
      ace: () => snd([
        ...[523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093].map((f, i) => ({ tone: f, at: i * 0.07, peak: 0.09, attack: 0.004, decay: 1.1, pan: (i - 3) * 0.18 })),
        ...[1046.5, 1567.98, 2093].map((f, i) => ({ tone: f * 2.01, at: 0.35 + i * 0.1, peak: 0.03, decay: 0.9 })),
        { noise: true, at: 0.1, from: 5000, peakAt: 10000, to: 7000, dur: 1.2, q: 3, peak: 0.06 },
      ]),
      birdie: () => snd([523.25, 659.25, 783.99, 1046.5].map((f, i) => ({ tone: f, at: i * 0.07, peak: 0.08, attack: 0.004, decay: 0.7 }))),
      par: () => snd([{ tone: 659.25, peak: 0.07, decay: 0.4 }, { tone: 783.99, at: 0.08, peak: 0.07, decay: 0.5 }]),
      meh: () => snd([{ tone: 392, peak: 0.07, type: 'triangle', decay: 0.3 }, { tone: 330, at: 0.12, type: 'triangle', peak: 0.07, decay: 0.45 }]),
      pickup: () => snd([{ tone: 440, to: 220, type: 'sawtooth', peak: 0.04, attack: 0.01, decay: 0.45 }, { tone: 330, to: 160, at: 0.08, peak: 0.08, decay: 0.5 }]),
      next: () => snd([{ tone: 1318.5, peak: 0.08, decay: 0.3 }, { tone: 1975.5, at: 0.05, peak: 0.07, decay: 0.4 }]),
      card: () => snd([{ tone: 880, peak: 0.05, decay: 0.25 }, { tone: 1174.66, at: 0.06, peak: 0.05, decay: 0.35 }]),
    };

    // ---------------------------------------------------------- particles & popups
    function part(p) { if (S.parts.length < 600) S.parts.push(p); }
    function sparks(x, y, col, n, sp, nx = 0, ny = 0) {
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(ny, nx) + rnd(-1.2, 1.2), v = rnd(sp * 0.3, sp);
        part({ t: 1, x, y, vx: (nx || ny ? Math.cos(a) : rnd(-1, 1)) * v, vy: (nx || ny ? Math.sin(a) : rnd(-1, 1)) * v, s: rnd(4, 10), c: col, age: 0, life: rnd(0.2, 0.45), drag: 5 });
      }
    }
    function ringFx(x, y, col, r0, grow, life = 0.4, wd = 4) { part({ t: 3, x, y, s: r0, grow, c: col, age: 0, life, vx: 0, vy: 0, wd }); }
    function flashFx(x, y, col, size, life = 0.25) { part({ t: 2, x, y, s: size, c: col, age: 0, life, vx: 0, vy: 0 }); }
    function popup(x, y, text, color, size = 26, life = 1.1) {
      if (S.pops.length > 12) S.pops.shift();
      S.pops.push({ x: clamp(x, 160, W - 160), y: clamp(y, 150, H - 40), text, color, size, age: 0, life });
    }

    // ---------------------------------------------------------- hole flow
    function loadHole(i) {
      S.hole = i;
      S.world = buildHole(HOLES[i], i);
      S.layer = paintHole(S.world);
      const t = S.world.tee;
      S.ball = newBall(t.x, t.y);
      S.rest = { x: t.x, y: t.y };
      const def0 = HOLES[i];
      S.aim = def0.aim !== undefined ? (def0.aim * Math.PI) / 180 : Math.atan2(S.world.cup.y - t.y, S.world.cup.x - t.x);
      S.strokes = 0; S.bounces = 0; S.charging = false; S.power = 0; S.putted = false;
      ev.lastKey = -1; ev.lastT = -9; // the new hole's clock starts again at zero
      S.trail = []; S.pops = []; S.sink = null; S.fall = null; S.celebrate = null; S.appear = 1;
      S.phase = 'intro'; S.phaseT = 0; S.introT = 0;
      const def = HOLES[i];
      S.banner = { title: `HOLE ${i + 1}`, sub: def.name.toUpperCase(), par: def.par, tip: def.tip || null, t: 0, dur: 2.6 };
    }

    function putt(p) {
      const b = S.ball;
      S.strokes++;
      S.bounces = 0;
      S.putted = true;
      ev.lastKey = -1; ev.lastT = -9; // every putt starts its bank count fresh
      const v = VMAX * p;
      b.vx = Math.cos(S.aim) * v; b.vy = Math.sin(S.aim) * v;
      b.still = 0; b.rollT = 0;
      S.rest = { x: b.x, y: b.y };
      S.phase = 'roll'; S.phaseT = 0;
      S.trail = [];
      sfx.putt(p);
      sparks(b.x - Math.cos(S.aim) * BALL_R, b.y - Math.sin(S.aim) * BALL_R, '#ffe0e8', 6, 160 + 300 * p, -Math.cos(S.aim), -Math.sin(S.aim));
      ringFx(b.x, b.y, '#ffffff', BALL_R, 30 + 40 * p, 0.3, 3);
    }

    function physics(dt) {
      const b = S.ball;
      clearEvents(ev);
      stepBall(S.world, b, dt, ev);
      for (const h of ev.hits) onHit(h);
      if (ev.tele >= 0) onTele(ev.tele);
      if (ev.lip) onLip(ev.lip);
      S.bounces += ev.bounces;
      if (ev.cup) { startSink(); return; }
      if (ev.void) { startFall(ev.void); return; }
      if (!onCourse(S.world, b.x, b.y)) { rescue(); return; }
      const sp = Math.hypot(b.vx, b.vy);
      if (S.phase === 'roll') {
        const last = S.trail[S.trail.length - 1];
        if (!last || Math.hypot(b.x - last.x, b.y - last.y) > 6) { S.trail.push({ x: b.x, y: b.y }); if (S.trail.length > 28) S.trail.shift(); }
        if (ev.rest) endPutt();
      } else if ((S.phase === 'aim' || S.phase === 'intro') && sp > 30) {
        // knocked by something moving while we lined up: the putt so far keeps rolling, no stroke
        S.charging = false; S.power = 0;
        S.phase = 'roll'; S.phaseT = 0; b.rollT = 0;
      }
    }

    function endPutt() {
      const b = S.ball;
      S.rest = { x: b.x, y: b.y };
      if (S.strokes >= MAX_STROKES) { finishHole(false); return; }
      S.phase = 'aim'; S.phaseT = 0;
    }

    function onHit(h) {
      const k = clamp(h.hit / 900, 0.15, 1);
      const o = h.obj;
      if (o.kind === 'bumper') {
        o.flash = 1;
        sfx.bumper(k, h.x);
        sparks(h.x, h.y, COL.bumper, 5 + Math.round(6 * k), 260, h.nx, h.ny);
        ringFx(o.x, o.y, COL.bumper, o.r, 26, 0.35, 5);
        S.shake = Math.max(S.shake, 4 * k);
      } else if (o.kind === 'planet') {
        o.flash = 1;
        sfx.planet(k, h.x);
        sparks(h.x, h.y, COL.well, 4 + Math.round(5 * k), 200, h.nx, h.ny);
      } else if (o.kind === 'bar') {
        o.flash = 1;
        sfx.clang(k, h.x);
        sparks(h.x, h.y, COL.bar, 4 + Math.round(6 * k), 240, h.nx, h.ny);
      } else {
        sfx.clack(k, h.x);
        sparks(h.x, h.y, tint(ACCENT, 0.4), 3 + Math.round(5 * k), 220, h.nx, h.ny);
        flashFx(h.x, h.y, ACCENT, 26 + 30 * k, 0.2);
      }
    }

    function onTele(from) {
      const P = S.world.pads, a = P[from], b = P[1 - from];
      sfx.tele();
      for (const p of [a, b]) { ringFx(p.x, p.y, COL.tele, 10, 70, 0.5, 5); flashFx(p.x, p.y, COL.tele, 90, 0.35); sparks(p.x, p.y, '#e6ccff', 10, 280); }
      S.trail = [];
    }

    function onLip(speed) {
      sfx.lip();
      const c = S.world.cup;
      popup(c.x, c.y - 46, speed > 1100 ? 'SKIMMED OVER' : 'LIPPED OUT', '#ffd0d8', 26);
      sparks(c.x, c.y, '#e8fbff', 6, 160);
    }

    function startSink() {
      const b = S.ball, c = S.world.cup;
      S.sink = { x: b.x, y: b.y };
      b.vx = 0; b.vy = 0;
      S.phase = 'sink'; S.phaseT = 0;
      S.charging = false;
      sfx.sink();
      ringFx(c.x, c.y, COL.cup, CUP_R, 70, 0.6, 5);
      flashFx(c.x, c.y, COL.cup, 140, 0.5);
      sparks(c.x, c.y, '#ffffff', 16, 360);
    }

    function startFall(z) {
      const b = S.ball;
      // into a black hole it spirals down to the centre; through a breach it drifts on as it drops
      S.fall = { x: b.x, y: b.y, vx: b.vx * 0.25, vy: b.vy * 0.25, well: z.well ? { x: z.circle[0], y: z.circle[1] } : null };
      b.vx = 0; b.vy = 0;
      S.phase = 'void'; S.phaseT = 0;
      S.charging = false;
      sfx.fall();
      ringFx(b.x, b.y, z.well ? '#ffb070' : '#b07bff', 6, 60, 0.7, 3);
    }

    function respawn() {
      const b = S.ball;
      S.strokes++;
      popup(S.rest.x, S.rest.y - 60, '+1 STROKE', '#ffb36b', 30, 1.4);
      Object.assign(b, newBall(S.rest.x, S.rest.y));
      for (let k = 0; k < S.world.pads.length; k++) { const p = S.world.pads[k]; if (Math.hypot(b.x - p.x, b.y - p.y) < TELE_R + 10) b.lock = k; }
      S.fall = null; S.trail = []; S.appear = 1;
      sfx.appear();
      ringFx(b.x, b.y, '#ffffff', 40, -30, 0.45, 3);
      if (S.strokes >= MAX_STROKES) { finishHole(false); return; }
      S.phase = 'aim'; S.phaseT = 0;
    }

    // Shouldn't ever happen, but a ball that somehow leaves the deck comes back free of charge.
    function rescue() {
      const b = S.ball;
      Object.assign(b, newBall(S.rest.x, S.rest.y));
      S.trail = []; S.appear = 1;
      S.phase = 'aim'; S.phaseT = 0;
    }

    function finishHole(holed) {
      const def = HOLES[S.hole], par = def.par, n = S.strokes;
      let kind;
      if (!holed) kind = 'picked';
      else if (n === 1) kind = 'ace';
      else if (n - par <= -2) kind = 'eagle';
      else if (n - par === -1) kind = 'birdie';
      else if (n === par) kind = 'par';
      else if (n - par === 1) kind = 'bogey';
      else if (n - par === 2) kind = 'double';
      else kind = 'worse';
      const banks = holed ? S.bounces : 0;
      const pts = POINTS[kind], bonus = Math.min(BANK_CAP, BANK_PTS * banks);
      S.score += pts + bonus;
      const entry = { par, strokes: n, kind, pts, bonus, banks };
      S.card.push(entry);
      S.lastResult = entry;
      const st = S.stats;
      st.holes++;
      if (kind === 'ace') st.aces++;
      st.toPar += (holed ? n : PICKED_STROKES) - par;
      if (holed) st.maxBankSink = Math.max(st.maxBankSink, banks);
      if (S.card.length >= HOLES.length) st.finished = true;
      const r = RESULT[kind];
      S.celebrate = { text: kind === 'worse' ? `+${n - par}` : r.text, color: r.color, kind, t: 0, bonus, banks, pts };
      S.phase = 'holed'; S.phaseT = 0;
      S.sfxBudget = 99;
      const c = S.world.cup;
      if (kind === 'ace') {
        sfx.ace();
        S.shake = 10;
        for (let i = 0; i < 90; i++) {
          const a = rnd(0, TAU), v = rnd(200, 900);
          part({ t: 4, x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rnd(5, 11), rot: rnd(0, TAU), vr: rnd(-12, 12), c: ['#ffd84a', ACCENT, '#4ad8ff', '#5dff9a', '#ffffff', '#c27bff'][i % 6], age: 0, life: rnd(1.2, 2.2), drag: 1.6 });
        }
        ringFx(c.x, c.y, '#ffd84a', 20, 400, 0.9, 8);
      } else if (kind === 'eagle' || kind === 'birdie') {
        sfx.birdie();
        for (let i = 0; i < 40; i++) {
          const a = rnd(0, TAU), v = rnd(150, 600);
          part({ t: 4, x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, s: rnd(4, 9), rot: rnd(0, TAU), vr: rnd(-10, 10), c: [r.color, '#ffffff', ACCENT][i % 3], age: 0, life: rnd(0.9, 1.6), drag: 1.8 });
        }
        ringFx(c.x, c.y, r.color, 20, 260, 0.7, 6);
      } else if (kind === 'par') sfx.par();
      else if (kind === 'picked') sfx.pickup();
      else sfx.meh();
      if (bonus) popup(c.x, c.y - 70, `BANK SHOT ×${banks}  +${bonus.toLocaleString()}`, '#ffe27a', 28, 1.8);
    }

    function toCard() {
      S.phase = S.card.length >= HOLES.length ? 'final' : 'card';
      S.phaseT = 0;
      S.sfxBudget = 99;
      sfx.card();
    }

    function endRun() {
      if (S.over) return;
      S.over = true;
      S.phase = 'done';
      api.gameOver({ score: S.score, stats: statsNow(), title: 'Course complete', message: summary() });
    }

    function statsNow() {
      const st = S.stats;
      return { holes: st.holes, aces: st.aces, toPar: st.toPar, finished: st.finished, maxBankSink: st.maxBankSink };
    }

    function summary() {
      const st = S.stats;
      const parts = [st.toPar === 0 ? 'Even par' : st.toPar < 0 ? `${-st.toPar} under par` : `${st.toPar} over par`];
      const birdies = S.card.filter((c) => c.kind === 'birdie' || c.kind === 'eagle').length;
      if (st.aces) parts.push(`${st.aces} hole${st.aces > 1 ? 's' : ''} in one`);
      else if (birdies) parts.push(`${birdies} birdie${birdies > 1 ? 's' : ''} or better`);
      else parts.push(`${totalStrokes()} strokes`);
      return parts.join(' · ');
    }
    const totalStrokes = () => S.card.reduce((s, c) => s + (c.kind === 'picked' ? PICKED_STROKES : c.strokes), 0);

    // ---------------------------------------------------------- input
    function aimInput(dt) {
      const inp = api.input;
      const dpad = inp.down('left') || inp.down('right') || inp.down('up') || inp.down('down');
      const mv = inp.move, mag = Math.hypot(mv.x, mv.y);
      // The stick sets the aim outright. (The d-pad and WASD also drive "move", so while one of
      // them is held the move vector is ignored and they turn the aim instead.) A stick springing
      // back to centre passes through other angles, so a falling magnitude doesn't steer.
      if (!dpad && mag > 0.5 && mag >= S.stickMag - 0.04) {
        S.aim += wrapAngle(Math.atan2(mv.y, mv.x) - S.aim) * Math.min(1, dt * 30);
      }
      S.stickMag = dpad ? 0 : mag;
      const turn = (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0);
      if (turn) {
        // a tap is a hair; holding it creeps, then swings round quickly
        const deg = S.turnT === 0 ? 0.3 : Math.min(140, 8 + 220 * Math.max(0, S.turnT - 0.3)) * dt;
        S.aim += (turn * deg * Math.PI) / 180;
        S.turnT += dt;
      } else S.turnT = 0;
      const fine = (inp.down('rb') ? 1 : 0) - (inp.down('lb') ? 1 : 0);
      if (fine) {
        const deg = S.fineT === 0 ? 0.1 : Math.min(10, 1.5 + 6 * S.fineT) * dt;
        S.aim += (fine * deg * Math.PI) / 180;
        S.fineT += dt;
      } else S.fineT = 0;
      S.aim = wrapAngle(S.aim);
      // the hole's title card gets out of the way as soon as you start lining up
      const bn = S.banner;
      if (bn && bn.t < bn.dur - 0.35 && (mag > 0.3 || dpad || fine || inp.down('a'))) bn.t = bn.dur - 0.35;

      if (!S.charging) {
        if (inp.pressed('a')) { S.charging = true; S.chargeT = 0; S.power = 0; S.tick = 0; }
      } else if (inp.pressed('b')) {
        S.charging = false; S.power = 0;
        sfx.cancel();
      } else if (inp.down('a')) {
        S.chargeT += dt;
        S.power = meter(S.chargeT);
        const step = Math.floor(S.power * 10 + 0.5);
        if (step !== S.tick) { S.tick = step; sfx.tick(S.power); }
      } else {
        const p = S.power;
        S.charging = false; S.power = 0;
        if (p >= MIN_POWER) putt(p);
      }
    }

    // ---------------------------------------------------------- update
    function idle(dt) { setTime(S.world, S.world.t + dt); }

    function updateFx(dt) {
      for (let i = S.parts.length - 1; i >= 0; i--) {
        const p = S.parts[i];
        p.age += dt;
        if (p.age >= p.life) { S.parts[i] = S.parts[S.parts.length - 1]; S.parts.pop(); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.drag) { const k = Math.max(0, 1 - p.drag * dt); p.vx *= k; p.vy *= k; }
        if (p.t === 4) p.rot += p.vr * dt;
      }
      for (let i = S.pops.length - 1; i >= 0; i--) { const p = S.pops[i]; p.age += dt; p.y -= 40 * dt * (1 - p.age / p.life); if (p.age >= p.life) S.pops.splice(i, 1); }
      for (const c of S.world.circles) if (c.flash > 0) c.flash = Math.max(0, c.flash - dt * 4);
      for (const m of S.world.movers) if (m.flash > 0) m.flash = Math.max(0, m.flash - dt * 4);
      S.shake = Math.max(0, S.shake - dt * 30);
      S.appear = Math.max(0, S.appear - dt * 2.5);
      if (S.banner) { S.banner.t += dt; if (S.banner.t > S.banner.dur) S.banner = null; }
      if (S.celebrate) S.celebrate.t += dt;
      if (S.phase !== 'roll' && S.trail.length && Math.floor(S.clock * 60) % 2 === 0) S.trail.shift();
    }

    function update(dt) {
      S.clock += dt;
      S.sfxBudget = 5;
      S.phaseT += dt;
      S.introT += dt;
      updateFx(dt);
      const inp = api.input;
      switch (S.phase) {
        case 'intro':
          physics(dt);
          if (S.phase === 'intro' && S.phaseT > INTRO_LOCK) { S.phase = 'aim'; S.phaseT = 0; }
          break;
        case 'aim': aimInput(dt); physics(dt); break;
        case 'roll': physics(dt); break;
        case 'sink': idle(dt); if (S.phaseT > 0.55) finishHole(true); break;
        case 'void': idle(dt); if (S.phaseT > 0.8) respawn(); break;
        case 'holed': idle(dt); if (S.phaseT > 2.1) toCard(); break;
        case 'card':
          idle(dt);
          if ((S.phaseT > 0.7 && inp.pressed('a')) || S.phaseT > 15) { sfx.next(); loadHole(S.hole + 1); }
          break;
        case 'final':
          idle(dt);
          if ((S.phaseT > 1.2 && inp.pressed('a')) || S.phaseT > 20) endRun();
          break;
        default: idle(dt);
      }
    }

    // ---------------------------------------------------------- draw
    function drawBelts(ctx) {
      const t = S.world.t;
      for (const z of S.world.belts) {
        const [x0, y0, x1, y1] = z.rect;
        ctx.save();
        ctx.beginPath(); polyPath(ctx, S.world.outer, true); ctx.clip();
        ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
        const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
        ctx.translate(cx, cy); ctx.rotate(Math.atan2(z.dy, z.dx));
        // the bed's extent along / across the belt
        const hw = Math.abs(z.dx) > 0.5 ? (x1 - x0) / 2 : (y1 - y0) / 2;
        const hh = Math.abs(z.dx) > 0.5 ? (y1 - y0) / 2 : (x1 - x0) / 2;
        const sp = 56, off = ((t * z.speed * 0.5) % sp + sp) % sp;
        const rows = Math.max(1, Math.round((hh * 2) / 64));
        ctx.beginPath();
        for (let r = 0; r < rows; r++) {
          const yy = -hh + ((r + 0.5) / rows) * hh * 2;
          for (let x = -hw - sp + off; x < hw + sp; x += sp) {
            ctx.moveTo(x - 9, yy - 13); ctx.lineTo(x + 5, yy); ctx.lineTo(x - 9, yy + 13);
          }
        }
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        ctx.strokeStyle = rgba(COL.belt, 0.22); ctx.lineWidth = 11; ctx.stroke();
        ctx.strokeStyle = rgba(COL.belt, 0.85); ctx.lineWidth = 3.5; ctx.stroke();
        ctx.restore();
      }
    }

    function drawPads(ctx) {
      const t = S.clock;
      for (let k = 0; k < S.world.pads.length; k++) {
        const p = S.world.pads[k];
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 3 + k * 2);
        ctx.drawImage(glow(COL.tele, 64), p.x - 64, p.y - 64, 128, 128);
        ctx.globalAlpha = 1;
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const a = t * 2.4 * (k ? -1 : 1) + (i * TAU) / 3, rr = TELE_R - 6 - i * 5;
          ctx.strokeStyle = i === 0 ? 'rgba(240,220,255,0.9)' : rgba(COL.tele, 0.75);
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, a, a + 2.1); ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    function drawWells(ctx) {
      const t = S.clock;
      for (const g of S.world.wells) {
        const col = g.hole ? COL.tele : COL.well;
        const inner = g.hole ? g.core + 26 : g.r + 16;
        ctx.save();
        ctx.setLineDash([8, 14]);
        ctx.lineWidth = 2;
        for (let k = 0; k < 4; k++) {
          // rings slide inward, the way the field pulls
          const u = ((k + (t * 0.35) % 1) / 4);
          const r = g.reach - (g.reach - inner) * u;
          ctx.strokeStyle = rgba(col, 0.08 + 0.32 * u);
          ctx.lineDashOffset = -t * 30 * (k % 2 ? 1 : -1);
          ctx.beginPath(); ctx.arc(g.x, g.y, r, 0, TAU); ctx.stroke();
        }
        ctx.setLineDash([]);
        if (g.hole) {
          // the accretion disc: hot arcs whipping round the rim, faster the closer they are
          ctx.lineCap = 'round';
          ctx.globalCompositeOperation = 'lighter';
          for (let k = 0; k < 6; k++) {
            const rr = g.core + 6 + k * 6, a = t * (4.2 - k * 0.5) + k * 1.7;
            ctx.strokeStyle = k < 2 ? 'rgba(255,214,170,0.75)' : rgba(k < 4 ? '#ff8a5c' : COL.tele, 0.5 - k * 0.05);
            ctx.lineWidth = 3 - k * 0.3;
            ctx.beginPath(); ctx.arc(g.x, g.y, rr, a, a + 1.6 + (k % 2) * 0.8); ctx.stroke();
          }
          ctx.globalCompositeOperation = 'source-over';
        }
        ctx.restore();
      }
    }

    function drawBumperFlash(ctx) {
      ctx.globalCompositeOperation = 'lighter';
      for (const c of S.world.circles) {
        const base = c.kind === 'bumper' ? 0.18 + 0.06 * Math.sin(S.clock * 3 + c.key) : 0;
        const a = base + c.flash * 0.8;
        if (a <= 0.01) continue;
        const col = c.kind === 'bumper' ? COL.bumper : COL.well;
        ctx.globalAlpha = Math.min(1, a);
        const z = c.r * (1.9 + c.flash * 0.5);
        ctx.drawImage(glow(col, 64), c.x - z, c.y - z, z * 2, z * 2);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const c of S.world.circles) {
        if (c.kind !== 'bumper' || c.flash <= 0) continue;
        ctx.strokeStyle = `rgba(255,255,255,${c.flash})`; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(c.x, c.y, c.r - 3 + (1 - c.flash) * 4, 0, TAU); ctx.stroke();
      }
    }

    function drawMovers(ctx) {
      for (const m of S.world.movers) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + m.flash * 0.5;
        const n = 5;
        for (let i = 0; i <= n; i++) {
          const x = lerp(m.ax, m.bx, i / n), y = lerp(m.ay, m.by, i / n);
          ctx.drawImage(glow(COL.bar, 32), x - 28, y - 28, 56, 56);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.lineCap = 'round';
        ctx.strokeStyle = shade(COL.bar, 0.35); ctx.lineWidth = BAR_R * 2 + 2;
        ctx.beginPath(); ctx.moveTo(m.ax, m.ay); ctx.lineTo(m.bx, m.by); ctx.stroke();
        ctx.strokeStyle = COL.bar; ctx.lineWidth = BAR_R * 2 - 4;
        ctx.stroke();
        ctx.strokeStyle = m.flash > 0 ? '#ffffff' : '#fff6d6'; ctx.lineWidth = 3;
        ctx.stroke();
        // warning chevrons along the bar
        const dx = m.bx - m.ax, dy = m.by - m.ay, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
        ctx.strokeStyle = 'rgba(40,24,0,0.55)'; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let s = 18; s < len - 12; s += 18) {
          const x = m.ax + ux * s, y = m.ay + uy * s;
          ctx.moveTo(x - uy * 5 - ux * 3, y + ux * 5 - uy * 3); ctx.lineTo(x + ux * 3, y + uy * 3); ctx.lineTo(x + uy * 5 - ux * 3, y - ux * 5 - uy * 3);
        }
        ctx.stroke();
        if (m.spin) {
          ctx.fillStyle = '#1b1406'; ctx.beginPath(); ctx.arc(m.cx, m.cy, 14, 0, TAU); ctx.fill();
          ctx.strokeStyle = COL.bar; ctx.lineWidth = 3; ctx.stroke();
          ctx.fillStyle = '#fff6d6'; ctx.beginPath(); ctx.arc(m.cx, m.cy, 4, 0, TAU); ctx.fill();
        }
      }
    }

    function drawCup(ctx) {
      const c = S.world.cup;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.32 + 0.12 * Math.sin(S.clock * 2.6);
      ctx.drawImage(glow(COL.cup, 64), c.x - 70, c.y - 70, 140, 140);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      const pulse = (S.clock * 0.7) % 1;
      ctx.strokeStyle = `rgba(190,246,255,${0.35 * (1 - pulse)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(c.x, c.y, CUP_R + 6 + pulse * 26, 0, TAU); ctx.stroke();
    }

    function flagLift() {
      const b = S.ball, c = S.world.cup;
      if (S.phase === 'sink' || S.phase === 'holed' || S.phase === 'card' || S.phase === 'final' || S.phase === 'done') return 1;
      const d = Math.hypot(b.x - c.x, b.y - c.y);
      return clamp(1 - (d - 70) / 170, 0, 1);
    }

    function drawPreview(ctx) {
      const b = S.ball;
      const dx = Math.cos(S.aim), dy = Math.sin(S.aim);
      const ray = rayCast(S.world, b.x, b.y, dx, dy, PREVIEW_LEN);
      const march = (S.clock * 60) % 22;
      ctx.fillStyle = '#ffffff';
      for (let s = BALL_R + 10 + march; s < ray.len; s += 22) {
        const k = 1 - s / PREVIEW_LEN;
        ctx.globalAlpha = 0.25 + 0.6 * k;
        ctx.beginPath(); ctx.arc(b.x + dx * s, b.y + dy * s, 2.2 + 1.6 * k, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (ray.hit) {
        const x = b.x + dx * ray.len, y = b.y + dy * ray.len;
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.arc(x, y, BALL_R, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
      }
      // the aim arrow at the ball
      ctx.save();
      ctx.translate(b.x, b.y); ctx.rotate(S.aim);
      ctx.fillStyle = rgba(ACCENT, 0.95);
      ctx.beginPath(); ctx.moveTo(BALL_R + 22, 0); ctx.lineTo(BALL_R + 10, -7); ctx.lineTo(BALL_R + 10, 7); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    function drawPower(ctx) {
      const b = S.ball, p = S.power;
      const r = 36;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 6;
      ctx.stroke();
      const col = p < 0.5 ? mix('#5dff9a', '#ffd84a', p * 2) : mix('#ffd84a', ACCENT, (p - 0.5) * 2);
      if (p > 0.002) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.5;
        ctx.drawImage(glow(p < 0.5 ? '#5dff9a' : ACCENT, 48), b.x - 60, b.y - 60, 120, 120);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = col; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(b.x, b.y, r, -Math.PI / 2, -Math.PI / 2 + p * TAU); ctx.stroke();
      }
      ctx.font = '700 20px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const ty = b.y + r + 24 < H - 20 ? b.y + r + 24 : b.y - r - 24;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(`${Math.round(p * 100)}%`, b.x, ty);
      ctx.fillStyle = col; ctx.fillText(`${Math.round(p * 100)}%`, b.x, ty);
      ctx.restore();
    }

    function drawBall(ctx) {
      const b = S.ball;
      let x = b.x, y = b.y, sc = 1, alpha = 1;
      if (S.phase === 'sink' && S.sink) {
        const k = clamp(S.phaseT / 0.35, 0, 1), c = S.world.cup;
        x = lerp(S.sink.x, c.x, k); y = lerp(S.sink.y, c.y, k);
        sc = 1 - 0.55 * k; alpha = 1 - clamp((S.phaseT - 0.25) / 0.3, 0, 1);
      } else if (S.phase === 'void' && S.fall) {
        const k = clamp(S.phaseT / 0.75, 0, 1), f = S.fall;
        if (f.well) {
          const a0 = Math.atan2(f.y - f.well.y, f.x - f.well.x), r0 = Math.hypot(f.x - f.well.x, f.y - f.well.y);
          const a = a0 + k * k * 9, r = r0 * (1 - k);
          x = f.well.x + Math.cos(a) * r; y = f.well.y + Math.sin(a) * r;
        } else {
          x = f.x + f.vx * S.phaseT * (1 - k * 0.5) + Math.cos(S.phaseT * 14) * 10 * k;
          y = f.y + f.vy * S.phaseT * (1 - k * 0.5) + Math.sin(S.phaseT * 14) * 10 * k;
        }
        sc = 1 - 0.9 * k; alpha = 1 - k * k;
      } else if (S.phase === 'holed' || S.phase === 'card' || S.phase === 'final' || S.phase === 'done') return;
      if (S.appear > 0) { sc *= 1 + S.appear * 0.8; alpha *= 1 - S.appear * 0.6; }
      if (alpha <= 0.01) return;
      const r = BALL_R * sc;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.ellipse(x + 3 * sc, y + 5 * sc, r, r * 0.8, 0, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = alpha * 0.75;
      ctx.drawImage(glow('#ffd6df', 48), x - 40 * sc, y - 40 * sc, 80 * sc, 80 * sc);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = alpha;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 0, x, y, r);
      g.addColorStop(0, '#ffffff'); g.addColorStop(0.65, '#f2f4ff'); g.addColorStop(1, '#aab2d4');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }

    function drawTrail(ctx) {
      const tr = S.trail, n = tr.length;
      if (!n) return;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < n; i++) {
        const k = (i + 1) / n, rr = BALL_R * (0.5 + k * 1.2);
        ctx.globalAlpha = k * 0.5;
        ctx.drawImage(glow(ACCENT, 32), tr[i].x - rr * 2, tr[i].y - rr * 2, rr * 4, rr * 4);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    function drawParts(ctx) {
      ctx.globalCompositeOperation = 'lighter';
      for (const p of S.parts) {
        const k = p.age / p.life;
        if (p.t === 1) {
          ctx.globalAlpha = 1 - k;
          ctx.drawImage(glow(p.c, 24), p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
        } else if (p.t === 2) {
          ctx.globalAlpha = (1 - k) * 0.8;
          const z = p.s * (0.6 + k * 0.8);
          ctx.drawImage(glow(p.c, 64), p.x - z, p.y - z, z * 2, z * 2);
        } else if (p.t === 3) {
          ctx.globalAlpha = 1 - k;
          ctx.strokeStyle = p.c; ctx.lineWidth = p.wd * (1 - k) + 0.5;
          ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.s + p.grow * k), 0, TAU); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      for (const p of S.parts) {
        if (p.t !== 4) continue;
        const k = p.age / p.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.fillStyle = p.c;
        const c = Math.cos(p.rot), s = Math.sin(p.rot) * 0.5 + 0.5;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot * 0.5); ctx.scale(1, Math.abs(c) * 0.8 + 0.2);
        ctx.fillRect(-p.s / 2, -p.s * 0.3, p.s, p.s * 0.6 + s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }

    function drawPops(ctx) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const p of S.pops) {
        const k = p.age / p.life;
        ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        ctx.font = `700 ${Math.round(p.size)}px "Segoe UI", sans-serif`;
        ctx.letterSpacing = '2px';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color; ctx.fillText(p.text, p.x, p.y);
      }
      ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }

    // Hole 1 teaches the controls in place; later holes name their new idea at the bottom.
    function drawHints(ctx) {
      if (S.phase !== 'aim' && S.phase !== 'intro') return;
      if (S.hole === 0 && S.phase === 'aim') {
        // in the open space under the bay, clear of the rails
        const y0 = Math.max(...S.world.outer.map((p) => p[1])) + 84;
        const a = clamp(S.phaseT / 0.3, 0, 1) * (0.8 + 0.2 * Math.sin(S.clock * 4));
        ctx.globalAlpha = a;
        if (!S.putted) {
          if (S.charging) {
            promptLine(ctx, ['LET GO OF', { b: 'A' }, 'TO PUTT'], W / 2, y0, 28);
            promptLine(ctx, ['THE METER SWINGS UP AND BACK DOWN', ' · ', { b: 'B' }, 'CANCELS'], W / 2, y0 + 52, 21, 'rgba(255,255,255,0.75)');
          } else {
            promptLine(ctx, ['HOLD', { b: 'A' }, 'TO CHARGE A PUTT'], W / 2, y0, 28);
            promptLine(ctx, ['LEFT STICK AIMS', ' · ', { b: 'LB' }, { b: 'RB' }, 'OR D-PAD FINE-TUNE', ' · ', 'THE DOTS SHOW YOUR LINE'], W / 2, y0 + 52, 21, 'rgba(255,255,255,0.75)');
          }
        } else if (S.strokes === 1) {
          promptLine(ctx, ['SINK IT WITH THIS PUTT FOR PAR'], W / 2, y0, 26, 'rgba(255,255,255,0.85)');
        }
        ctx.globalAlpha = 1;
      }
      const tip = HOLES[S.hole].tip;
      if (tip && !S.putted && S.phase === 'aim') {
        ctx.globalAlpha = clamp(S.phaseT / 0.4, 0, 1) * 0.9;
        promptLine(ctx, [tip.toUpperCase()], W / 2, H - 34, 20, tint(ACCENT, 0.5));
        ctx.globalAlpha = 1;
      }
    }

    function drawBanner(ctx, bn) {
      const a = Math.min(1, bn.t / 0.2) * Math.min(1, (bn.dur - bn.t) / 0.4);
      if (a <= 0) return;
      const cy = 520;
      ctx.save();
      ctx.globalAlpha = a;
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, 'rgba(3,4,14,0)'); g.addColorStop(0.5, 'rgba(3,4,14,0.84)'); g.addColorStop(1, 'rgba(3,4,14,0)');
      const tall = bn.tip ? 250 : 210;
      ctx.fillStyle = g; ctx.fillRect(0, cy - 120, W, tall);
      const lg = ctx.createLinearGradient(0, 0, W, 0);
      lg.addColorStop(0, rgba(ACCENT, 0)); lg.addColorStop(0.5, tint(ACCENT, 0.4, 0.9)); lg.addColorStop(1, rgba(ACCENT, 0));
      ctx.fillStyle = lg; ctx.fillRect(0, cy - 120, W, 2); ctx.fillRect(0, cy - 120 + tall, W, 2);
      const e = Math.min(1, bn.t / 0.35), sc = 0.84 + 0.16 * (1 + 2.2 * Math.pow(e - 1, 3) + 1.2 * Math.pow(e - 1, 2));
      ctx.translate(W / 2, cy); ctx.scale(sc, sc);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      chromaText(ctx, bn.title, 0, 6, 96, 800, 10, '#ffffff');
      ctx.font = '600 30px "Segoe UI", sans-serif'; ctx.letterSpacing = '7px';
      ctx.fillStyle = ACCENT;
      ctx.fillText(`${bn.sub}  ·  PAR ${bn.par}`, 0, 56);
      ctx.letterSpacing = '0px';
      if (bn.tip) {
        ctx.font = '400 24px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(235,240,255,0.85)';
        ctx.fillText(bn.tip, 0, 100);
      }
      ctx.restore();
    }

    function drawCelebrate(ctx, c) {
      if (S.phase !== 'holed') return;
      const t = c.t;
      const a = Math.min(1, t / 0.15) * Math.min(1, (2.1 - t) / 0.3);
      if (a <= 0) return;
      const big = c.kind === 'ace' || c.kind === 'eagle' || c.kind === 'birdie';
      const e = Math.min(1, t / 0.4), pop = 1 + 2.4 * Math.pow(e - 1, 3) + 1.4 * Math.pow(e - 1, 2);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.translate(W / 2, 560);
      ctx.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (big) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a * 0.6;
        ctx.drawImage(glow(c.color, 64), -420, -170, 840, 300);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = a;
      }
      let face = c.color;
      if (c.kind === 'ace') {
        const sh = (S.clock * 0.8) % 1;
        const pg = ctx.createLinearGradient(-360, 0, 360, 0);
        pg.addColorStop(0, '#ffb43a'); pg.addColorStop(clamp(sh - 0.1, 0, 1), '#ffe27a'); pg.addColorStop(clamp(sh, 0, 1), '#ffffff'); pg.addColorStop(clamp(sh + 0.1, 0, 1), '#ffe27a'); pg.addColorStop(1, '#ffb43a');
        face = pg;
      }
      chromaText(ctx, c.text, 0, 0, big ? 128 : 88, 900, big ? 10 : 8, face);
      ctx.font = '600 28px "Segoe UI", sans-serif'; ctx.letterSpacing = '6px';
      ctx.fillStyle = 'rgba(240,244,255,0.9)';
      const n = S.lastResult ? S.lastResult.strokes : 0;
      const sub = c.kind === 'picked' ? `${MAX_STROKES} STROKES · BALL PICKED UP` : `${n} STROKE${n === 1 ? '' : 'S'}  ·  +${(c.pts + c.bonus).toLocaleString()}`;
      ctx.fillText(sub, 0, 56);
      ctx.letterSpacing = '0px';
      ctx.restore();
    }

    function drawCard(ctx, final) {
      const k = clamp(S.phaseT / 0.3, 0, 1);
      ctx.save();
      ctx.fillStyle = `rgba(2,3,10,${0.72 * k})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = k;
      ctx.translate(0, (1 - k) * 30);
      const pw = 1320, ph = 660, px = (W - pw) / 2, py = 220;
      const g = ctx.createLinearGradient(0, py, 0, py + ph);
      g.addColorStop(0, 'rgba(18,22,48,0.97)'); g.addColorStop(1, 'rgba(8,10,26,0.97)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 18); ctx.fill();
      ctx.strokeStyle = rgba(ACCENT, 0.6); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = ACCENT; ctx.fillRect(px + 40, py, pw - 80, 3);
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const last = S.lastResult;
      ctx.font = '600 22px "Segoe UI", sans-serif'; ctx.letterSpacing = '6px'; ctx.fillStyle = 'rgba(200,210,240,0.7)';
      if (final) {
        ctx.fillText('ORBIT GOLF  ·  COURSE COMPLETE', W / 2, py + 58);
        const tp = S.stats.toPar;
        const head = tp === 0 ? 'EVEN PAR' : tp < 0 ? `${-tp} UNDER PAR` : `${tp} OVER PAR`;
        chromaText(ctx, head, W / 2, py + 138, 76, 800, 8, tp < 0 ? '#5dff9a' : tp === 0 ? '#ffffff' : '#ffb36b');
        ctx.font = '400 26px "Segoe UI", sans-serif'; ctx.letterSpacing = '1px'; ctx.fillStyle = 'rgba(235,240,255,0.85)';
        const count = (k) => S.card.filter((c) => c.kind === k).length;
        const bits = [`${totalStrokes()} strokes`];
        for (const [k, one, many] of [['ace', 'hole in one', 'holes in one'], ['eagle', 'eagle', 'eagles'], ['birdie', 'birdie', 'birdies']]) {
          const n = count(k);
          if (n) bits.push(`${n} ${n > 1 ? many : one}`);
        }
        ctx.fillText(bits.join('  ·  '), W / 2, py + 186);
      } else {
        ctx.fillText(`HOLE ${S.hole + 1}  ·  ${HOLES[S.hole].name.toUpperCase()}`, W / 2, py + 58);
        const r = RESULT[last.kind];
        chromaText(ctx, last.kind === 'worse' ? `+${last.strokes - last.par}` : r.text.replace('!', ''), W / 2, py + 138, 76, 800, 8, r.color);
        ctx.font = '400 26px "Segoe UI", sans-serif'; ctx.letterSpacing = '1px'; ctx.fillStyle = 'rgba(235,240,255,0.85)';
        let line = last.kind === 'picked' ? `Picked up after ${MAX_STROKES} strokes` : `${r.short}  ${last.pts.toLocaleString()}`;
        if (last.bonus) line += `   +   Bank shot ×${last.banks}  ${last.bonus.toLocaleString()}`;
        ctx.fillText(line, W / 2, py + 186);
      }
      ctx.letterSpacing = '0px';

      // the card itself
      const tx = px + 70, colW = 96, labW = 180, totW = 150;
      const ty = py + 236, rowH = 58;
      const rows = ['HOLE', 'PAR', 'STROKES', 'POINTS'];
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(tx, ty, labW + colW * 9 + totW, rowH * 4);
      const cur = final ? -1 : S.hole;
      if (cur >= 0) { ctx.fillStyle = rgba(ACCENT, 0.16); ctx.fillRect(tx + labW + cur * colW, ty, colW, rowH * 4); }
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = 1; r < 4; r++) { ctx.moveTo(tx, ty + r * rowH + 0.5); ctx.lineTo(tx + labW + colW * 9 + totW, ty + r * rowH + 0.5); }
      for (let c = 0; c <= 9; c++) { const x = tx + labW + c * colW + 0.5; ctx.moveTo(x, ty); ctx.lineTo(x, ty + rowH * 4); }
      ctx.stroke();
      ctx.textBaseline = 'middle';
      rows.forEach((lab, r) => {
        const y = ty + r * rowH + rowH / 2;
        ctx.textAlign = 'left'; ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(200,210,240,0.6)';
        ctx.fillText(lab, tx + 22, y);
        ctx.letterSpacing = '0px';
        ctx.textAlign = 'center';
        for (let c = 0; c < 9; c++) {
          const x = tx + labW + c * colW + colW / 2;
          const e = S.card[c];
          let text = '', col = '#fff', font = '400 26px "Segoe UI", sans-serif';
          if (r === 0) { text = String(c + 1); col = c === cur ? '#fff' : 'rgba(255,255,255,0.75)'; font = '700 24px "Segoe UI", sans-serif'; }
          else if (r === 1) { text = String(HOLES[c].par); col = 'rgba(255,255,255,0.7)'; }
          else if (r === 2) {
            if (e) { text = e.kind === 'picked' ? 'PU' : String(e.strokes); col = RESULT[e.kind].color; font = '700 28px "Segoe UI", sans-serif'; }
            else { text = '·'; col = 'rgba(255,255,255,0.25)'; }
          } else if (e) { text = (e.pts + e.bonus).toLocaleString(); col = 'rgba(255,255,255,0.8)'; font = '400 19px "Segoe UI", sans-serif'; }
          ctx.font = font; ctx.fillStyle = col;
          if (r === 2 && e && (e.kind === 'ace' || e.kind === 'eagle' || e.kind === 'birdie')) {
            ctx.strokeStyle = col; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(x, y, 20, 0, TAU); ctx.stroke();
            if (e.kind !== 'birdie') { ctx.beginPath(); ctx.arc(x, y, 25, 0, TAU); ctx.stroke(); }
          }
          if (text) ctx.fillText(text, x, y + 1);
        }
        const x = tx + labW + 9 * colW + totW / 2;
        let text = '';
        ctx.font = '700 24px "Segoe UI", sans-serif'; ctx.fillStyle = '#fff';
        if (r === 0) { text = 'TOTAL'; ctx.font = '600 18px "Segoe UI", sans-serif'; ctx.letterSpacing = '4px'; ctx.fillStyle = 'rgba(200,210,240,0.7)'; }
        else if (r === 1) { text = String(COURSE_PAR); ctx.font = '400 26px "Segoe UI", sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.7)'; }
        else if (r === 2) text = S.card.length ? String(totalStrokes()) : '–';
        else { text = S.score.toLocaleString(); ctx.fillStyle = '#ffe27a'; }
        ctx.fillText(text, x, y + 1);
        ctx.letterSpacing = '0px';
      });

      // running totals and the way on
      const fy = ty + rowH * 4 + 62;
      ctx.textAlign = 'left'; ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = 'rgba(200,210,240,0.65)';
      ctx.fillText('TO PAR', tx, fy);
      ctx.font = '300 44px "Segoe UI", sans-serif'; ctx.letterSpacing = '0px';
      const tp = S.stats.toPar;
      ctx.fillStyle = tp < 0 ? '#5dff9a' : tp === 0 ? '#ffffff' : '#ffb36b';
      ctx.fillText(toParText(tp), tx + 130, fy + 2);
      ctx.textAlign = 'right'; ctx.font = '600 20px "Segoe UI", sans-serif'; ctx.letterSpacing = '5px'; ctx.fillStyle = 'rgba(200,210,240,0.65)';
      const sx = tx + labW + colW * 9 + totW;
      ctx.fillText('POINTS', sx - 230, fy);
      ctx.font = '300 44px "Segoe UI", sans-serif'; ctx.letterSpacing = '0px'; ctx.fillStyle = '#fff';
      ctx.fillText(S.score.toLocaleString(), sx, fy + 2);
      if (S.phaseT > (final ? 1.2 : 0.7)) {
        ctx.globalAlpha = k * (0.75 + 0.25 * Math.sin(S.clock * 4));
        promptLine(ctx, [{ b: 'A' }, final ? 'FINISH' : `NEXT · HOLE ${S.hole + 2}`], W / 2, py + ph - 44, 24);
      }
      ctx.restore();
    }

    function draw(ctx) {
      ctx.save();
      const fade = clamp(S.introT / 0.45, 0, 1);
      if (S.shake > 0) ctx.translate(Math.sin(S.clock * 91) * S.shake, Math.cos(S.clock * 73) * S.shake);
      ctx.drawImage(S.layer, 0, 0);
      drawBelts(ctx);
      drawWells(ctx);
      drawPads(ctx);
      drawBumperFlash(ctx);
      drawCup(ctx);
      drawMovers(ctx);
      if (S.phase === 'aim') drawPreview(ctx);
      drawTrail(ctx);
      drawBall(ctx);
      if (S.phase === 'aim' && S.charging) drawPower(ctx);
      const c = S.world.cup;
      drawFlag(ctx, c.x, c.y, S.clock, flagLift(), S.hole + 1);
      drawParts(ctx);
      drawPops(ctx);
      ctx.restore();

      ctx.save();
      if (fade < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - fade})`; ctx.fillRect(0, 0, W, H); }
      drawHints(ctx);
      const def = HOLES[S.hole];
      api.hud(ctx, {
        score: S.score,
        left: [`Hole ${S.hole + 1} of ${HOLES.length}`, `Par ${def.par}`, `Strokes ${S.strokes}`],
        right: [`To par ${toParText(S.stats.toPar)}`],
      });
      if (S.banner && S.phase !== 'card' && S.phase !== 'final') drawBanner(ctx, S.banner);
      if (S.celebrate) drawCelebrate(ctx, S.celebrate);
      if (S.phase === 'card') drawCard(ctx, false);
      if (S.phase === 'final' || S.phase === 'done') drawCard(ctx, true);
      ctx.restore();
    }

    loadHole(0);
    return { update, draw, result: () => ({ score: S.score, stats: statsNow() }) };
  },
};
