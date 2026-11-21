// 3D avatar renderer (three.js): builds a stylised full-body character from an avatar
// description (model.js) and animates it. Original character design.
import * as THREE from '../../vendor/three/three.module.min.js';
import { DEFAULT } from './model.js';

const R = 0.42;            // head radius
const TAU = Math.PI * 2;
const HEIGHT = { short: 0.88, average: 1, tall: 1.12 };
const BUILD = { slim: 0.86, average: 1, broad: 1.18 };

// ------------------------------------------------------------------ materials
function shade(hex, f) {
  const c = new THREE.Color(hex);
  const hsl = {};
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l * f)));
  return `#${c.getHexString()}`;
}

class Materials {
  constructor() { this.cache = new Map(); }
  get(color, { rough = 0.62, metal = 0, emissive = null, opacity = 1 } = {}) {
    const key = `${color}|${rough}|${metal}|${emissive}|${opacity}`;
    if (!this.cache.has(key)) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, transparent: opacity < 1, opacity });
      if (emissive) { m.emissive = new THREE.Color(emissive); m.emissiveIntensity = 0.6; }
      this.cache.set(key, m);
    }
    return this.cache.get(key);
  }
  dispose() { for (const m of this.cache.values()) m.dispose(); this.cache.clear(); }
}

// ------------------------------------------------------------------ face texture
// The face is painted onto the head sphere's texture. A point on the head at (yaw, pitch)
// radians from the front maps to canvas x = (0.25 + yaw/2π)·W, y = (0.5 − pitch/π)·H.
const FW = 2048;
const FH = 1024;
const PX = FW / TAU; // canvas pixels per radian

class Face {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = FW;
    this.canvas.height = FH;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.key = '';
  }
  P(yaw, pitch) { return [(0.25 + yaw / TAU) * FW, (0.5 - pitch / Math.PI) * FH]; }

  paint(a, expr = {}) {
    const eyes = expr.eyes || 'open';     // open · closed · happy · surprised
    const mouth = expr.mouth || a.mouth;  // config mouth unless an expression overrides it
    const key = JSON.stringify([a.skin, a.eyes, a.eyeColor, a.brows, a.mouth, a.nose, a.extras, a.facialHair, a.hairColor, eyes, mouth]);
    if (key === this.key) return;
    this.key = key;
    const c = this.ctx;
    c.save();
    c.fillStyle = a.skin;
    c.fillRect(0, 0, FW, FH);
    // soft shading so the face isn't flat: darker under the chin and toward the sides
    const [cx, cy] = this.P(0, 0);
    const g = c.createRadialGradient(cx, cy - 40, 60, cx, cy, PX * 1.6);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    c.fillStyle = g;
    c.fillRect(0, 0, FW, FH);

    const ink = shade(a.skin, 0.32);
    const hairInk = shade(a.hairColor, 0.8);

    // stubble / beard base under the features
    if (a.facialHair === 'stubble' || a.facialHair === 'beard') {
      c.fillStyle = a.facialHair === 'beard' ? hairInk : `${shade(a.hairColor, 0.9)}55`;
      c.beginPath();
      const pts = [[-0.62, -0.12], [-0.55, -0.42], [-0.3, -0.6], [0, -0.66], [0.3, -0.6], [0.55, -0.42], [0.62, -0.12], [0.42, -0.22], [0.16, -0.18], [0, -0.21], [-0.16, -0.18], [-0.42, -0.22]];
      pts.forEach(([y, p], i) => { const [x, yy] = this.P(y, p); if (i) c.lineTo(x, yy); else c.moveTo(x, yy); });
      c.closePath();
      c.fill();
    }

    // cheeks and freckles
    if (a.extras === 'cheeks' || a.extras === 'both') {
      for (const s of [-1, 1]) {
        const [x, y] = this.P(s * 0.43, -0.13);
        const cg = c.createRadialGradient(x, y, 0, x, y, PX * 0.12);
        cg.addColorStop(0, 'rgba(240,90,110,0.45)');
        cg.addColorStop(1, 'rgba(240,90,110,0)');
        c.fillStyle = cg;
        c.fillRect(x - PX * 0.13, y - PX * 0.13, PX * 0.26, PX * 0.26);
      }
    }
    if (a.extras === 'freckles' || a.extras === 'both') {
      c.fillStyle = shade(a.skin, 0.62);
      const spots = [[-0.4, -0.06], [-0.34, -0.1], [-0.45, -0.12], [-0.38, -0.15], [0.4, -0.06], [0.34, -0.1], [0.45, -0.12], [0.38, -0.15], [-0.1, -0.05], [0.1, -0.05]];
      for (const [yw, p] of spots) { const [x, y] = this.P(yw, p); c.beginPath(); c.arc(x, y, 5, 0, TAU); c.fill(); }
    }

    // eyes
    for (const s of [-1, 1]) this.eye(c, a, s, eyes, ink);

    // brows
    c.strokeStyle = hairInk;
    c.lineCap = 'round';
    const bw = { soft: 9, straight: 10, arched: 10, thick: 18, angled: 12 }[a.brows] || 10;
    c.lineWidth = bw;
    for (const s of [-1, 1]) {
      const lift = eyes === 'surprised' ? 0.05 : 0;
      const [x0, y0] = this.P(s * 0.15, 0.25 + lift);
      const [x1, y1] = this.P(s * 0.44, 0.24 + lift);
      const [mx, my] = this.P(s * 0.3, ({ arched: 0.29, soft: 0.26, straight: 0.235, thick: 0.25, angled: 0.25 }[a.brows] || 0.26) + lift);
      c.beginPath();
      if (a.brows === 'angled') { const [ax, ay] = this.P(s * 0.17, 0.205 + lift); c.moveTo(ax, ay); c.lineTo(x1, y1 + 6); }
      else { c.moveTo(x0, y0); c.quadraticCurveTo(mx, my, x1, y1); }
      c.stroke();
    }

    // nose
    if (a.nose !== 'none') {
      const [nx, ny] = this.P(0, -0.1);
      c.fillStyle = shade(a.skin, 0.78);
      c.beginPath();
      if (a.nose === 'dot') c.ellipse(nx, ny, 9, 7, 0, 0, TAU);
      else if (a.nose === 'long') { c.ellipse(nx, ny + 4, 13, 26, 0, 0, TAU); }
      else c.ellipse(nx, ny, 18, 12, 0, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.25)';
      c.beginPath();
      c.ellipse(nx - 5, ny - 5, 5, 3, 0, 0, TAU);
      c.fill();
    }

    // mustache / goatee on top of the beard base
    if (a.facialHair === 'mustache' || a.facialHair === 'beard') {
      c.fillStyle = hairInk;
      c.beginPath();
      const [lx, ly] = this.P(-0.2, -0.24);
      const [rx, ry] = this.P(0.2, -0.24);
      const [tx, ty] = this.P(0, -0.17);
      c.moveTo(lx, ly + 10);
      c.quadraticCurveTo(lx + 20, ty - 4, tx, ty + 6);
      c.quadraticCurveTo(rx - 20, ty - 4, rx, ry + 10);
      c.quadraticCurveTo(tx, ty + 30, lx, ly + 10);
      c.fill();
    }
    if (a.facialHair === 'goatee') {
      c.fillStyle = hairInk;
      const [gx, gy] = this.P(0, -0.47);
      c.beginPath();
      c.ellipse(gx, gy, 46, 36, 0, 0, TAU);
      c.fill();
    }

    this.mouth(c, a, mouth, ink);
    c.restore();
    this.texture.needsUpdate = true;
  }

  eye(c, a, s, state, ink) {
    const [x, y] = this.P(s * 0.29, 0.0);
    const style = a.eyes;
    const F = 1.4;
    const w = (style === 'wide' ? 46 : style === 'almond' ? 44 : 40) * F;
    const hgt = (style === 'wide' ? 54 : style === 'almond' ? 34 : style === 'sleepy' ? 34 : 48) * F;
    c.lineCap = 'round';
    if (state === 'closed' || state === 'happy' || style === 'happy') {
      c.strokeStyle = ink;
      c.lineWidth = 11;
      c.beginPath();
      if (state === 'happy' || style === 'happy') c.arc(x, y + 18, w * 0.75, Math.PI * 1.15, Math.PI * 1.85); // ^ ^
      else c.arc(x, y - 8, w * 0.85, Math.PI * 0.15, Math.PI * 0.85); // gently closed
      c.stroke();
      return;
    }
    if (style === 'dot') {
      c.fillStyle = '#16181b';
      c.beginPath();
      c.ellipse(x, y, state === 'surprised' ? 30 : 24, state === 'surprised' ? 38 : 32, 0, 0, TAU);
      c.fill();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(x - 7, y - 11, 7, 0, TAU);
      c.fill();
      return;
    }
    const big = state === 'surprised' ? 1.15 : 1;
    // white
    c.fillStyle = '#fbfbfb';
    c.beginPath();
    if (style === 'almond') {
      c.moveTo(x - w * big, y);
      c.quadraticCurveTo(x, y - hgt * 1.3 * big, x + w * big, y);
      c.quadraticCurveTo(x, y + hgt * 1.3 * big, x - w * big, y);
    } else c.ellipse(x, y, w * big, hgt * big, 0, 0, TAU);
    c.fill();
    c.save();
    c.clip();
    // iris, pupil, highlights
    const ir = (state === 'surprised' ? 22 : 28) * (style === 'wide' ? 1.1 : 1) * F;
    c.fillStyle = a.eyeColor;
    c.beginPath(); c.arc(x + s * 3, y + 4, ir, 0, TAU); c.fill();
    c.fillStyle = shade(a.eyeColor, 0.55);
    c.beginPath(); c.arc(x + s * 3, y + 4, ir, 0, TAU); c.lineWidth = 5; c.strokeStyle = shade(a.eyeColor, 0.6); c.stroke();
    c.fillStyle = '#0d0e10';
    c.beginPath(); c.arc(x + s * 3, y + 5, ir * 0.48, 0, TAU); c.fill();
    c.fillStyle = '#fff';
    c.beginPath(); c.arc(x - 8 + s * 3, y - 8, ir * 0.3, 0, TAU); c.fill();
    c.beginPath(); c.arc(x + 9 + s * 3, y + 12, ir * 0.13, 0, TAU); c.fill();
    // sleepy: heavy upper lid
    if (style === 'sleepy') {
      c.fillStyle = shade(a.skin, 0.88);
      c.fillRect(x - w - 4, y - hgt - 4, w * 2 + 8, hgt * 0.95);
    }
    c.restore();
    // lash line
    c.strokeStyle = ink;
    c.lineWidth = 9;
    c.beginPath();
    if (style === 'almond') { c.moveTo(x - w * big, y); c.quadraticCurveTo(x, y - hgt * 1.3 * big, x + w * big, y); }
    else c.ellipse(x, y, w * big, hgt * big, 0, Math.PI * 1.08, Math.PI * 1.92);
    c.stroke();
  }

  mouth(c, a, kind, ink) {
    const [x, y] = this.P(0, -0.27);
    c.save();
    c.translate(x, y); c.scale(1.3, 1.3); c.translate(-x, -y);
    try { this.mouthShape(c, a, kind, ink, x, y); } finally { c.restore(); }
  }

  mouthShape(c, a, kind, ink, x, y) {
    c.lineCap = 'round';
    c.strokeStyle = ink;
    c.lineWidth = 9;
    const lips = shade(a.skin, 0.55);
    if (kind === 'neutral') { c.beginPath(); c.moveTo(x - 34, y); c.lineTo(x + 34, y); c.stroke(); return; }
    if (kind === 'smirk') { c.beginPath(); c.moveTo(x - 36, y + 2); c.quadraticCurveTo(x + 6, y + 12, x + 40, y - 14); c.stroke(); return; }
    if (kind === 'small') { c.fillStyle = lips; c.beginPath(); c.ellipse(x, y, 14, 11, 0, 0, TAU); c.fill(); return; }
    if (kind === 'open' || kind === 'cheer') {
      const w = kind === 'cheer' ? 50 : 34;
      const hh = kind === 'cheer' ? 46 : 34;
      c.fillStyle = '#5a1f24';
      c.beginPath(); c.ellipse(x, y + 4, w, hh, 0, 0, TAU); c.fill();
      c.fillStyle = '#e9707b';
      c.beginPath(); c.ellipse(x, y + hh * 0.55, w * 0.7, hh * 0.45, 0, 0, Math.PI); c.fill();
      c.fillStyle = '#fff';
      c.fillRect(x - w * 0.7, y + 4 - hh + 4, w * 1.4, hh * 0.3);
      return;
    }
    if (kind === 'grin') {
      c.fillStyle = '#5a1f24';
      c.beginPath(); c.moveTo(x - 50, y - 6); c.quadraticCurveTo(x, y + 62, x + 50, y - 6); c.closePath(); c.fill();
      c.fillStyle = '#fff';
      c.beginPath(); c.moveTo(x - 44, y - 2); c.quadraticCurveTo(x, y + 14, x + 44, y - 2); c.lineTo(x + 44, y - 6); c.lineTo(x - 44, y - 6); c.fill();
      return;
    }
    // smile (and tongue = smile + tongue)
    c.beginPath(); c.moveTo(x - 44, y - 8); c.quadraticCurveTo(x, y + 36, x + 44, y - 8); c.stroke();
    if (kind === 'tongue') { c.fillStyle = '#e9707b'; c.beginPath(); c.ellipse(x + 10, y + 18, 16, 14, 0.2, 0, Math.PI); c.fill(); }
  }

  dispose() { this.texture.dispose(); }
}

// ------------------------------------------------------------------ geometry helpers
const capsule = (r, len) => new THREE.CapsuleGeometry(r, len, 8, 20);
function mesh(geo, mat, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); return m; }
function cap(scale, thetaLen, tilt, gap = 0) {
  const geo = gap ? new THREE.SphereGeometry(R * scale, 48, 28, Math.PI / 2 + gap / 2, TAU - gap, 0, thetaLen)
    : new THREE.SphereGeometry(R * scale, 48, 28, 0, TAU, 0, thetaLen);
  return { geo, tilt };
}
// point on the head surface at yaw/pitch (radians from the front) and radius factor k
function onHead(yaw, pitch, k = 1) {
  return new THREE.Vector3(R * k * Math.sin(yaw) * Math.cos(pitch), R * k * Math.sin(pitch), R * k * Math.cos(yaw) * Math.cos(pitch));
}

// ------------------------------------------------------------------ build
export function buildAvatar(input, mats = new Materials()) {
  const a = { ...DEFAULT, ...(input || {}) };
  const hf = HEIGHT[a.height] || 1;
  const bf = BUILD[a.build] || 1;
  const skin = mats.get(a.skin, { rough: 0.58 });
  const topM = mats.get(a.topColor, { rough: 0.72 });
  const accentM = mats.get(a.topAccent, { rough: 0.7 });
  const bottomM = mats.get(a.bottomColor, { rough: 0.8 });
  const shoeM = mats.get(a.shoeColor, { rough: 0.5 });
  const soleM = mats.get(a.shoes === 'boots' ? '#2a2420' : '#f2f2f0', { rough: 0.7 });
  const hairM = mats.get(a.hairColor, { rough: 0.58 });

  const root = new THREE.Group();
  const body = new THREE.Group(); // everything that bobs / jumps
  root.add(body);

  const legSeg = 0.3 * hf;
  const ankle = 0.1;
  const hipY = legSeg * 2 + ankle;

  // ---- legs
  const legs = {};
  const longLegs = a.bottom === 'jeans' || a.bottom === 'joggers';
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.115 * bf, hipY, 0);
    body.add(hip);
    const thighM = a.bottom === 'skirt' ? skin : bottomM;
    hip.add(mesh(capsule(0.1 * Math.max(0.9, bf), legSeg - 0.06), thighM, 0, -legSeg / 2, 0));
    const knee = new THREE.Group();
    knee.position.set(0, -legSeg, 0);
    hip.add(knee);
    knee.add(mesh(capsule(0.088 * Math.max(0.92, bf), legSeg - 0.06), longLegs ? bottomM : skin, 0, -legSeg / 2, 0));
    if (a.bottom === 'shorts') { const cuff = mesh(new THREE.CylinderGeometry(0.112 * bf, 0.115 * bf, 0.07, 20), bottomM, 0, -legSeg + 0.06, 0); hip.add(cuff); }
    if (a.bottom === 'joggers') knee.add(mesh(new THREE.CylinderGeometry(0.094, 0.094, 0.05, 20), mats.get(shade(a.bottomColor, 0.75)), 0, -legSeg + 0.03, 0));
    // shoe
    const foot = new THREE.Group();
    foot.position.set(0, -legSeg, 0);
    knee.add(foot);
    const shoe = mesh(capsule(0.078, 0.14), shoeM, 0, -ankle + 0.07, 0.05);
    shoe.rotation.x = Math.PI / 2;
    shoe.scale.set(1.22, 1, 0.85);
    foot.add(shoe);
    const sole = mesh(capsule(0.082, 0.15), soleM, 0, -ankle + 0.035, 0.05);
    sole.rotation.x = Math.PI / 2;
    sole.scale.set(1.28, 1, 0.42);
    foot.add(sole);
    if (a.shoes === 'high' || a.shoes === 'boots') {
      const h = a.shoes === 'boots' ? 0.2 : 0.13;
      foot.add(mesh(new THREE.CylinderGeometry(0.098, 0.1, h, 20), shoeM, 0, -ankle + 0.08 + h / 2, 0));
    }
    legs[s] = { hip, knee };
  }

  // ---- pelvis / skirt
  const pelvis = mesh(new THREE.SphereGeometry(1, 24, 16), bottomM, 0, hipY + 0.03, 0);
  pelvis.scale.set(0.235 * bf, 0.13, 0.165);
  body.add(pelvis);
  if (a.bottom === 'skirt') {
    const skirt = mesh(new THREE.CylinderGeometry(0.22 * bf, 0.36 * bf, 0.34 * hf, 28, 1, true), mats.get(a.bottomColor, { rough: 0.8 }), 0, hipY - 0.1 * hf, 0);
    skirt.material.side = THREE.DoubleSide;
    body.add(skirt);
  }

  // ---- torso
  const spine = new THREE.Group();
  spine.position.set(0, hipY + 0.02, 0);
  body.add(spine);
  const torsoH = 0.6 * hf;
  const torso = mesh(capsule(0.21, torsoH - 0.42), a.top === 'tank' ? topM : topM, 0, torsoH / 2, 0);
  torso.scale.set(1.12 * bf, 1, 0.74);
  spine.add(torso);
  const neckY = torsoH + 0.02;
  spine.add(mesh(new THREE.CylinderGeometry(0.066, 0.072, 0.12, 16), skin, 0, neckY, 0));

  // top details
  if (a.top === 'tee' || a.top === 'jersey' || a.top === 'tank') {
    const collar = mesh(new THREE.TorusGeometry(0.085, 0.018, 8, 24), a.top === 'jersey' ? accentM : mats.get(shade(a.topColor, 0.82)), 0, neckY - 0.045, 0.005);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1.15, 1, 1);
    spine.add(collar);
  }
  if (a.top === 'jersey') {
    for (const yy of [0.34, 0.42]) {
      const band = mesh(new THREE.TorusGeometry(0.213, 0.016, 8, 40), accentM, 0, torsoH * yy + 0.02, 0);
      band.rotation.x = Math.PI / 2;
      band.scale.set(1.12 * bf, 0.74, 1);
      spine.add(band);
    }
  }
  if (a.top === 'hoodie') {
    const hood = mesh(new THREE.TorusGeometry(0.13, 0.06, 12, 28), topM, 0, neckY - 0.03, -0.05);
    hood.rotation.x = Math.PI / 2 - 0.35;
    hood.scale.set(1.25, 1.1, 1);
    spine.add(hood);
    const pocket = mesh(new THREE.BoxGeometry(0.26 * bf, 0.1, 0.03), mats.get(shade(a.topColor, 0.86)), 0, torsoH * 0.22, 0.152);
    spine.add(pocket);
    for (const s of [-1, 1]) spine.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.13, 6), accentM, s * 0.04, neckY - 0.13, 0.15));
  }
  if (a.top === 'jacket') {
    spine.add(mesh(new THREE.BoxGeometry(0.11, torsoH * 0.78, 0.04), accentM, 0, torsoH * 0.5, 0.148));
    for (const s of [-1, 1]) {
      const lapel = mesh(new THREE.BoxGeometry(0.07, 0.17, 0.025), mats.get(shade(a.topColor, 0.85)), s * 0.07, neckY - 0.1, 0.15);
      lapel.rotation.z = s * 0.35;
      spine.add(lapel);
    }
  }
  if (a.top === 'sweater') {
    const hem = mesh(new THREE.TorusGeometry(0.21, 0.025, 8, 40), mats.get(shade(a.topColor, 0.82)), 0, 0.05, 0);
    hem.rotation.x = Math.PI / 2;
    hem.scale.set(1.12 * bf, 0.74, 1);
    spine.add(hem);
    const crew = mesh(new THREE.TorusGeometry(0.08, 0.025, 8, 24), mats.get(shade(a.topColor, 0.82)), 0, neckY - 0.045, 0);
    crew.rotation.x = Math.PI / 2;
    spine.add(crew);
  }

  // ---- arms
  const arms = {};
  const upperLen = 0.24 * hf;
  const foreLen = 0.22 * hf;
  const sleeveUpper = a.top === 'tank' ? skin : topM;
  const sleeveFore = ['hoodie', 'jacket', 'sweater'].includes(a.top) ? topM : skin;
  for (const s of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(s * 0.255 * bf, torsoH - 0.07, 0);
    spine.add(shoulder);
    shoulder.add(mesh(new THREE.SphereGeometry(0.079 * Math.max(0.95, bf), 18, 14), sleeveUpper));
    shoulder.add(mesh(capsule(0.074 * Math.max(0.92, bf), upperLen - 0.08), sleeveUpper, 0, -upperLen / 2, 0));
    if (a.top === 'jersey') { const st = mesh(new THREE.TorusGeometry(0.077, 0.012, 6, 20), accentM, 0, -upperLen + 0.07, 0); st.rotation.x = Math.PI / 2; shoulder.add(st); }
    const elbow = new THREE.Group();
    elbow.position.set(0, -upperLen, 0);
    shoulder.add(elbow);
    elbow.add(mesh(capsule(0.066, foreLen - 0.07), sleeveFore, 0, -foreLen / 2, 0));
    if (sleeveFore === topM && a.top !== 'jacket') { const cuff = mesh(new THREE.TorusGeometry(0.066, 0.016, 6, 18), mats.get(shade(a.topColor, 0.8)), 0, -foreLen + 0.04, 0); cuff.rotation.x = Math.PI / 2; elbow.add(cuff); }
    const hand = mesh(new THREE.SphereGeometry(0.078, 18, 14), skin, 0, -foreLen - 0.03, 0);
    hand.scale.set(0.9, 1.05, 0.8);
    elbow.add(hand);
    arms[s] = { shoulder, elbow };
  }

  // ---- head
  const neck = new THREE.Group();
  neck.position.set(0, neckY + 0.04, 0);
  spine.add(neck);
  const head = new THREE.Group();
  head.position.set(0, R * 0.88, 0);
  neck.add(head);
  const face = new Face();
  face.paint(a);
  const headMesh = mesh(new THREE.SphereGeometry(R, 64, 40), new THREE.MeshStandardMaterial({ map: face.texture, roughness: 0.6 }));
  headMesh.scale.set(1, 1, 0.97);
  head.add(headMesh);
  for (const s of [-1, 1]) {
    const ear = mesh(new THREE.SphereGeometry(R * 0.16, 16, 12), skin, s * R * 0.97, -R * 0.03, -R * 0.02);
    ear.scale.set(0.45, 1, 0.75);
    head.add(ear);
  }
  if (a.facialHair === 'beard') {
    const beard = mesh(new THREE.SphereGeometry(R * 1.0, 40, 24, Math.PI * 0.16, Math.PI * 0.68, Math.PI * 0.58, Math.PI * 0.32), hairM, 0, 0, 0.012);
    beard.scale.set(1.04, 1.02, 1.04);
    head.add(beard);
  }

  // ---- hair
  const hatOnTop = ['cap', 'backcap', 'beanie', 'crown'].includes(a.hat);
  const hair = new THREE.Group();
  head.add(hair);
  const addCap = ({ geo, tilt }, m = hairM) => { const h = new THREE.Mesh(geo, m); h.rotation.x = tilt; hair.add(h); return h; };
  const style = a.hair;
  if (style !== 'bald') {
    if (style === 'buzz' || style === 'mohawk') addCap(cap(1.018, Math.PI * 0.5, -0.4), style === 'mohawk' ? mats.get(shade(a.hairColor, 0.7)) : hairM);
    else if (style === 'bob') addCap(cap(1.09, Math.PI * 0.64, -0.12, Math.PI * 0.72));
    else if (style === 'curly') addCap(cap(1.07, Math.PI * 0.55, -0.36));
    else addCap(cap(1.06, Math.PI * 0.53, -0.42));
    // a side-swept fringe breaks up the straight hairline of the short styles
    if (['short', 'spiky', 'swept', 'curly'].includes(style)) {
      const fringe = mesh(new THREE.SphereGeometry(R, 32, 20), hairM, -R * 0.18, R * 0.5, R * 0.74);
      fringe.scale.set(0.62, 0.26, 0.34);
      fringe.rotation.z = 0.42;
      fringe.rotation.x = -0.35;
      hair.add(fringe);
      const fringe2 = mesh(new THREE.SphereGeometry(R, 32, 20), hairM, R * 0.32, R * 0.56, R * 0.68);
      fringe2.scale.set(0.42, 0.22, 0.3);
      fringe2.rotation.z = -0.3;
      fringe2.rotation.x = -0.4;
      hair.add(fringe2);
    }
    // sideburns for the short styles
    if (['short', 'spiky', 'swept', 'buzz', 'mohawk'].includes(style)) {
      for (const s of [-1, 1]) { const sb = mesh(new THREE.BoxGeometry(0.03, 0.12, 0.06), hairM, s * R * 0.94, R * 0.12, R * 0.12); sb.rotation.y = s * 0.4; hair.add(sb); }
    }
    if (!hatOnTop) {
      if (style === 'spiky') {
        const spikes = [[0, 1.0, 0.25], [0.35, 0.95, 0.1], [-0.35, 0.95, 0.1], [0.2, 0.85, -0.45], [-0.2, 0.85, -0.45], [0, 0.95, -0.25], [0.5, 0.7, -0.2], [-0.5, 0.7, -0.2], [0, 0.65, 0.65]];
        for (const [x, y, z] of spikes) {
          const dir = new THREE.Vector3(x, y, z).normalize();
          const cone = mesh(new THREE.ConeGeometry(R * 0.16, R * 0.42, 12), hairM);
          cone.position.copy(dir.clone().multiplyScalar(R * 1.0));
          cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          hair.add(cone);
        }
      }
      if (style === 'swept') {
        const q = mesh(new THREE.SphereGeometry(R, 32, 20), hairM, R * 0.12, R * 0.72, R * 0.42);
        q.scale.set(0.62, 0.36, 0.5);
        q.rotation.z = -0.3;
        hair.add(q);
      }
      if (style === 'curly') {
        const n = 46;
        for (let i = 0; i < n; i++) {
          const t = i / n;
          const yy = 1 - t * 0.95;
          const rr = Math.sqrt(1 - yy * yy);
          const th = i * 2.399963;
          const p = new THREE.Vector3(Math.cos(th) * rr, yy, Math.sin(th) * rr);
          if (p.z > 0.55 && p.y < 0.45) continue; // keep the face clear
          if (p.y < -0.05) continue;
          const b = mesh(new THREE.SphereGeometry(R * 0.17, 12, 10), hairM);
          b.position.copy(p.applyAxisAngle(new THREE.Vector3(1, 0, 0), -0.25).multiplyScalar(R * 1.04));
          hair.add(b);
        }
      }
      if (style === 'bun') hair.add(mesh(new THREE.SphereGeometry(R * 0.36, 24, 18), hairM, 0, R * 0.92, -R * 0.42));
      if (style === 'mohawk') {
        for (let i = 0; i < 7; i++) {
          const ang = -0.9 + i * 0.32;
          const p = new THREE.Vector3(0, Math.cos(ang), Math.sin(ang)).multiplyScalar(R * 1.05);
          const fin = mesh(new THREE.ConeGeometry(R * 0.17, R * 0.5, 4), hairM);
          fin.scale.set(0.45, 1, 1);
          fin.position.copy(p);
          fin.rotation.x = ang;
          hair.add(fin);
        }
      }
    }
    if (style === 'long') {
      const back = mesh(capsule(R * 0.62, R * 1.1), hairM, 0, -R * 0.42, -R * 0.38);
      back.scale.set(1.28, 1, 0.62);
      hair.add(back);
      for (const s of [-1, 1]) { const lock = mesh(capsule(R * 0.2, R * 0.8), hairM, s * R * 0.86, -R * 0.35, R * 0.05); lock.rotation.z = s * 0.06; hair.add(lock); }
    }
    if (style === 'ponytail') {
      hair.add(mesh(new THREE.SphereGeometry(R * 0.14, 14, 10), mats.get(a.topAccent), 0, R * 0.25, -R * 1.0));
      const tail = mesh(capsule(R * 0.17, R * 0.75), hairM, 0, -R * 0.2, -R * 1.12);
      tail.rotation.x = 0.35;
      hair.add(tail);
    }
  }

  // ---- hats
  const hatM = mats.get(a.hatColor, { rough: 0.7 });
  if (a.hat === 'cap' || a.hat === 'backcap') {
    const dome = mesh(new THREE.SphereGeometry(R * 1.12, 48, 24, 0, TAU, 0, Math.PI * 0.47), hatM);
    dome.rotation.x = -0.18;
    head.add(dome);
    const back = a.hat === 'backcap' ? -1 : 1;
    const brim = mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.62, R * 0.05, 32, 1, false, 0, Math.PI), mats.get(shade(a.hatColor, 0.85), { rough: 0.7 }), 0, R * 0.32, back * R * 0.82);
    brim.rotation.y = back > 0 ? -Math.PI / 2 : Math.PI / 2;
    brim.rotation.z = back * 0.18;
    brim.scale.set(1, 1, 1.25);
    head.add(brim);
    head.add(mesh(new THREE.SphereGeometry(R * 0.07, 10, 8), hatM, 0, R * 1.12, -R * 0.2));
  } else if (a.hat === 'beanie') {
    const dome = mesh(new THREE.SphereGeometry(R * 1.12, 48, 24, 0, TAU, 0, Math.PI * 0.5), hatM);
    dome.rotation.x = -0.28;
    dome.scale.set(1, 1.08, 1);
    head.add(dome);
    const band = mesh(new THREE.TorusGeometry(R * 1.08, R * 0.11, 12, 48), mats.get(shade(a.hatColor, 0.85)), 0, R * 0.12, -R * 0.12);
    band.rotation.x = Math.PI / 2 - 0.28;
    head.add(band);
    head.add(mesh(new THREE.SphereGeometry(R * 0.2, 16, 12), mats.get(a.topAccent), 0, R * 1.2, -R * 0.35));
  } else if (a.hat === 'headphones') {
    const band = mesh(new THREE.TorusGeometry(R * 1.12, R * 0.06, 10, 40, Math.PI), mats.get('#26292d', { rough: 0.4 }), 0, R * 0.05, 0);
    head.add(band);
    for (const s of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(R * 0.28, R * 0.28, R * 0.18, 24), hatM, s * R * 1.04, 0, 0);
      cup.rotation.z = Math.PI / 2;
      head.add(cup);
      const pad = mesh(new THREE.TorusGeometry(R * 0.2, R * 0.07, 10, 20), mats.get('#1a1b1d'), s * R * 0.97, 0, 0);
      pad.rotation.y = Math.PI / 2;
      head.add(pad);
    }
  } else if (a.hat === 'crown') {
    const gold = mats.get('#f2c240', { rough: 0.28, metal: 0.85 });
    head.add(mesh(new THREE.CylinderGeometry(R * 0.62, R * 0.66, R * 0.28, 32, 1, true), gold, 0, R * 0.98, -R * 0.05));
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * TAU;
      const sp = mesh(new THREE.ConeGeometry(R * 0.11, R * 0.3, 8), gold, Math.sin(ang) * R * 0.62, R * 1.25, Math.cos(ang) * R * 0.62 - R * 0.05);
      head.add(sp);
      if (i % 2 === 0) head.add(mesh(new THREE.SphereGeometry(R * 0.06, 10, 8), mats.get(['#e0304a', '#2f8fe0', '#2fc06a', '#b04ae0'][i / 2], { rough: 0.2, metal: 0.3 }), Math.sin(ang) * R * 0.65, R * 0.98, Math.cos(ang) * R * 0.65 - R * 0.05));
    }
  }

  // ---- glasses
  if (a.glasses !== 'none') {
    const frameM = mats.get(a.glasses === 'shades' ? '#111214' : '#26292d', { rough: 0.35, metal: 0.2 });
    const g = new THREE.Group();
    head.add(g);
    const square = a.glasses === 'square' || a.glasses === 'shades';
    for (const s of [-1, 1]) {
      const p = onHead(s * 0.3, 0.03, 1.035);
      const ring = mesh(square ? new THREE.TorusGeometry(R * 0.21, R * 0.025, 6, 4) : new THREE.TorusGeometry(R * 0.17, R * 0.022, 8, 28), frameM);
      ring.position.copy(p);
      ring.lookAt(p.clone().multiplyScalar(2));
      if (square) ring.rotateZ(Math.PI / 4);
      g.add(ring);
      if (a.glasses === 'shades') {
        const lens = mesh(new THREE.CircleGeometry(R * 0.2, square ? 4 : 24), mats.get('#0b0c10', { rough: 0.1, metal: 0.4, opacity: 0.88 }));
        lens.position.copy(onHead(s * 0.3, 0.03, 1.03));
        lens.lookAt(lens.position.clone().multiplyScalar(2));
        if (square) lens.rotateZ(Math.PI / 4);
        g.add(lens);
      }
      const arm = mesh(new THREE.BoxGeometry(R * 0.03, R * 0.03, R * 0.85), frameM, s * R * 0.84, R * 0.05, R * 0.38);
      arm.rotation.y = s * 0.12;
      g.add(arm);
    }
    const bridge = mesh(new THREE.CylinderGeometry(R * 0.018, R * 0.018, R * 0.16, 6), frameM);
    bridge.position.copy(onHead(0, 0.06, 1.05));
    bridge.rotation.z = Math.PI / 2;
    g.add(bridge);
  }

  return {
    root, body, spine, neck, head, arms, legs, face, config: a, hipY,
    dispose() {
      face.dispose();
      root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o === headMesh) o.material.dispose(); });
    },
  };
}

// ------------------------------------------------------------------ animation
const smooth = (x) => x * x * (3 - 2 * x);
const lerp = (a, b, t) => a + (b - a) * t;

// Actions: duration (s) and a pose function of progress p ∈ [0,1] and time t.
const ACTIONS = {
  wave: { dur: 2.4, expr: { eyes: 'happy', mouth: 'grin' }, pose: (p, t) => ({ rArmZ: -2.55, rArmX: -0.15, rElbowZ: -0.55 + Math.sin(t * 13) * 0.45, headZ: 0.08 }) },
  cheer: { dur: 2.0, expr: { eyes: 'happy', mouth: 'cheer' }, pose: (p, t) => ({ lArmZ: 2.2, rArmZ: -2.2, lElbowZ: 0.25, rElbowZ: -0.25, jump: Math.abs(Math.sin(p * Math.PI * 3)) * 0.22 * (1 - p * 0.3) }) },
  nod: { dur: 1.0, expr: { mouth: 'smile' }, pose: (p) => ({ headX: Math.sin(p * Math.PI * 2) * 0.18 }) },
  stretch: { dur: 2.6, expr: { eyes: 'closed', mouth: 'open' }, pose: (p) => ({ lArmZ: 2.35, rArmZ: -2.35, lElbowZ: 0.35, rElbowZ: -0.35, spineX: -0.06, headX: -0.22 }) },
  look: { dur: 3.4, expr: {}, pose: (p) => ({ headY: Math.sin(p * Math.PI * 2) * 0.55 }) },
};

export class Rig {
  constructor(built) {
    this.b = built;
    this.t = Math.random() * 10;
    this.action = null;
    this.look = { yaw: 0, pitch: 0, cy: 0, cp: 0 };
    this.sleeping = false;
    this.sleepW = 0;
    this.blinkAt = 2 + Math.random() * 3;
    this.blinking = 0;
    this.turn = 0;          // extra rotation (editor)
    this.turnNow = 0;
  }

  play(name) { if (ACTIONS[name] && !this.sleeping) this.action = { name, t: 0 }; }
  setLook(yaw, pitch) { this.look.yaw = yaw; this.look.pitch = pitch; }
  sleep(on) { if (on !== this.sleeping) { this.sleeping = on; if (on) this.action = null; } }

  update(dt) {
    this.t += dt;
    const t = this.t;
    const b = this.b;
    const pose = { lArmZ: 0.14, rArmZ: -0.14, lArmX: 0, rArmX: 0, lElbowZ: 0.05, rElbowZ: -0.05, headX: 0, headY: 0, headZ: 0, spineX: 0, jump: 0 };
    let expr = {};

    // action with fade in/out
    if (this.action) {
      const A = ACTIONS[this.action.name];
      this.action.t += dt;
      const p = Math.min(1, this.action.t / A.dur);
      const w = smooth(Math.min(1, Math.min(p, 1 - p) / 0.14));
      const ap = A.pose(p, t);
      for (const k of Object.keys(ap)) pose[k] = lerp(pose[k] || 0, ap[k], w);
      if (w > 0.3) expr = A.expr;
      if (p >= 1) this.action = null;
    }

    // sleep blend
    this.sleepW += ((this.sleeping ? 1 : 0) - this.sleepW) * Math.min(1, dt * 2);
    const sw = this.sleepW;
    pose.headX += 0.34 * sw;
    pose.headZ += 0.18 * sw;
    pose.spineX += 0.07 * sw;
    if (sw > 0.5) expr = { eyes: 'closed', mouth: 'small' };

    // look-at (eased), suppressed while asleep
    this.look.cy += (this.look.yaw * (1 - sw) - this.look.cy) * Math.min(1, dt * 5);
    this.look.cp += (this.look.pitch * (1 - sw) - this.look.cp) * Math.min(1, dt * 5);

    // breathing + idle sway
    const breath = Math.sin(t * (this.sleeping ? 1.4 : 2.2));
    b.spine.scale.y = 1 + breath * 0.012;
    b.spine.rotation.x = pose.spineX + breath * 0.01;
    b.spine.rotation.z = Math.sin(t * 0.6) * 0.02 * (1 - sw);
    b.body.position.y = pose.jump;
    // Pose values are "outward" amounts: the left arm swings out toward −x (negative z
    // rotation), the right arm toward +x (positive z rotation).
    b.arms[-1].shoulder.rotation.z = -pose.lArmZ - Math.sin(t * 2.2) * 0.015;
    b.arms[1].shoulder.rotation.z = -pose.rArmZ + Math.sin(t * 2.2) * 0.015;
    b.arms[-1].shoulder.rotation.x = pose.lArmX + Math.sin(t * 0.9) * 0.03;
    b.arms[1].shoulder.rotation.x = pose.rArmX - Math.sin(t * 0.9) * 0.03;
    b.arms[-1].elbow.rotation.z = -pose.lElbowZ;
    b.arms[1].elbow.rotation.z = -pose.rElbowZ;
    b.arms[-1].elbow.rotation.x = -0.12;
    b.arms[1].elbow.rotation.x = -0.12;
    b.neck.rotation.x = pose.headX - this.look.cp;
    b.neck.rotation.y = pose.headY + this.look.cy + Math.sin(t * 0.45) * 0.04 * (1 - sw);
    b.neck.rotation.z = pose.headZ;
    // weight shift
    b.legs[-1].hip.rotation.z = Math.sin(t * 0.6) * 0.015;
    b.legs[1].hip.rotation.z = Math.sin(t * 0.6) * 0.015;

    // editor turntable
    this.turnNow += (this.turn - this.turnNow) * Math.min(1, dt * 6);
    b.root.rotation.y = this.turnNow + Math.sin(t * 0.35) * 0.06 * (1 - sw);

    // blinking
    this.blinkAt -= dt;
    if (this.blinkAt <= 0) { this.blinking = 0.13; this.blinkAt = 2.2 + Math.random() * 3.5; }
    if (this.blinking > 0) { this.blinking -= dt; if (!expr.eyes) expr = { ...expr, eyes: 'closed' }; }
    b.face.paint(b.config, expr);
  }
}

// ------------------------------------------------------------------ stage
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function zTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.font = '600 52px "Segoe UI", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('z', 32, 34);
  return new THREE.CanvasTexture(c);
}

// framing: 'full' (whole body) or 'bust' (head and shoulders)
const FRAMES = { full: { y: 1.16, dist: 5.9, fov: 26 }, bust: { y: 1.86, dist: 4.1, fov: 24 }, group: { y: 1.1, dist: 8.4, fov: 26 } };

export function createAvatarStage(el, { fps = 30, framing = 'full', ring = true, accent = '#7cff4f' } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  el.append(renderer.domElement);
  renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 60);
  scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x3a3f46, 1.7));
  const front = new THREE.DirectionalLight(0xffffff, 0.8);
  front.position.set(0, 1.5, 8);
  scene.add(front);
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(-2.5, 4, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(new THREE.Color(accent), 0.9);
  rim.position.set(3, 3, -4);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xb8d4ff, 0.8);
  fill.position.set(4, 1, 3);
  scene.add(fill);

  const mats = new Materials();
  const shadowTex = blobTexture();
  const zTex = zTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  let ringMesh = null;
  if (ring) {
    ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 64), new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.y = 0.005;
    scene.add(ringMesh);
  }

  const actors = new Map(); // key → { built, rig, holder, shadow }
  let frame = FRAMES[framing] || FRAMES.full;
  let raf = 0;
  let paused = false;
  let last = 0;
  let acc = 0;
  let focusGlow = 0;
  let focused = false;
  const zs = [];

  function fit() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    // the dashboard stage is CSS-scaled: render at the real on-screen resolution
    const rect = el.getBoundingClientRect();
    const scale = rect.width / w || 1;
    renderer.setPixelRatio(Math.min(2.5, (window.devicePixelRatio || 1) * scale));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = frame.fov;
    camera.updateProjectionMatrix();
    camera.position.set(0, frame.y + 0.35, frame.dist);
    camera.lookAt(0, frame.y, 0);
  }
  const ro = new ResizeObserver(fit);
  ro.observe(el);
  fit();

  function layout() {
    const list = [...actors.values()];
    const primary = list.find((x) => x.primary) || list[0];
    const others = list.filter((x) => x !== primary);
    list.forEach((x) => { x.holder.position.set(0, 0, 0); x.holder.scale.setScalar(1); });
    others.forEach((x, i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const rank = Math.floor(i / 2) + 1;
      x.holder.position.set(side * 0.62 * rank, 0, -0.75 * rank);
      x.holder.scale.setScalar(0.8);
    });
    if (ringMesh && primary) ringMesh.position.x = primary.holder.position.x;
  }

  const api = {
    renderer, scene, camera,
    // [{ key, config, primary }]
    setAvatars(list) {
      const keep = new Set(list.map((x) => x.key));
      for (const [k, x] of actors) if (!keep.has(k)) { x.holder.removeFromParent(); x.built.dispose(); actors.delete(k); }
      for (const item of list) {
        const cur = actors.get(item.key);
        const sig = JSON.stringify(item.config);
        if (cur && cur.sig === sig) { cur.primary = !!item.primary; continue; }
        const built = buildAvatar(item.config, mats);
        const holder = new THREE.Group();
        holder.add(built.root);
        const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8), shadowMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.004;
        holder.add(shadow);
        scene.add(holder);
        const rig = new Rig(built);
        if (cur) { rig.t = cur.rig.t; rig.turn = cur.rig.turn; rig.turnNow = cur.rig.turnNow; rig.sleeping = cur.rig.sleeping; rig.sleepW = cur.rig.sleepW; cur.holder.removeFromParent(); cur.built.dispose(); }
        actors.set(item.key, { built, rig, holder, shadow, sig, primary: !!item.primary });
      }
      layout();
    },
    each(fn) { for (const x of actors.values()) fn(x.rig, x); },
    primary() { const l = [...actors.values()]; return (l.find((x) => x.primary) || l[0] || {}).rig || null; },
    react(name, key) { for (const [k, x] of actors) if (!key || k === key) x.rig.play(name); },
    sleep(on) { for (const x of actors.values()) x.rig.sleep(on); },
    lookAt(nx, ny) { for (const x of actors.values()) x.rig.setLook(Math.max(-0.7, Math.min(0.7, nx * 0.7)), Math.max(-0.35, Math.min(0.35, ny * 0.35))); },
    turn(delta) { const r = api.primary(); if (r) r.turn += delta; },
    setFraming(name) { frame = FRAMES[name] || FRAMES.full; fit(); },
    setFocused(on) { focused = on; },
    pause() { paused = true; },
    resume() { if (paused) { paused = false; last = 0; } },
    snapshot() { renderer.render(scene, camera); return renderer.domElement.toDataURL('image/png'); },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const x of actors.values()) x.built.dispose();
      actors.clear();
      mats.dispose();
      shadowTex.dispose();
      zTex.dispose();
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* ignore */ }
      renderer.domElement.remove();
    },
  };

  function loop(now) {
    raf = requestAnimationFrame(loop);
    if (paused || document.hidden || (api.isHidden && api.isHidden())) { last = 0; return; }
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / fps;
    last = now;
    acc += dt;
    if (acc < 1 / fps - 0.002) return;
    const step = acc;
    acc = 0;
    let anySleep = false;
    for (const x of actors.values()) { x.rig.update(step); if (x.rig.sleeping) anySleep = true; x.shadow.scale.setScalar(1 - x.built.body.position.y * 1.2); }
    focusGlow += ((focused ? 1 : 0) - focusGlow) * Math.min(1, step * 6);
    if (ringMesh) { ringMesh.material.opacity = 0.18 + 0.5 * focusGlow + Math.sin(now / 500) * 0.06 * focusGlow; ringMesh.scale.setScalar(1 + focusGlow * 0.08); }
    // floating z's while asleep
    if (anySleep && Math.random() < step * 0.9 && zs.length < 4) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: zTex, transparent: true, opacity: 0.9, depthWrite: false }));
      const p = api.primary() ? [...actors.values()].find((x) => x.rig === api.primary()).holder.position : { x: 0 };
      s.position.set(p.x + 0.35, 2.35, 0.2);
      s.scale.setScalar(0.22);
      s.userData.life = 0;
      scene.add(s);
      zs.push(s);
    }
    for (let i = zs.length - 1; i >= 0; i--) {
      const s = zs[i];
      s.userData.life += step;
      s.position.y += step * 0.25;
      s.position.x += Math.sin(s.userData.life * 3) * step * 0.12;
      s.material.opacity = Math.max(0, 0.9 - s.userData.life / 2.6);
      s.scale.setScalar(0.18 + s.userData.life * 0.06);
      if (s.userData.life > 2.6) { s.removeFromParent(); s.material.dispose(); zs.splice(i, 1); }
    }
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(loop);
  return api;
}
