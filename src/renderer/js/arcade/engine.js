// Arcade engine: runs one built-in game full screen inside the dashboard.
//
// A game module (see pulse.js / prism.js / glow.js) exports:
//   { key, title, tagline, accent, controls: [[input, action], ...],
//     art: { cover(ctx, w, h), hero(ctx, w, h) },
//     create(api) -> { update(dt), draw(ctx) } }
//
// api (passed to create):
//   w, h            1920 × 1080 canvas
//   input           .move {x,y} / .aim {x,y} in -1..1 (left / right stick, d-pad, WASD / arrow keys)
//                   .down(b) / .pressed(b)  b: a b x y lb rb lt rt up down left right
//   sfx(voices)     sound effects (sound.js sfx: tones and noise bursts)
//   rand(a, b)      random number in [a, b)
//   time()          seconds of play so far (pauses excluded)
//   best            this player's best score so far (for the HUD)
//   hud(ctx, { score, left: [...], right: [...] })   draws the standard top bar
//   glow(color, radius)   cached soft-glow sprite (canvas) for additive drawing
//   gameOver({ score, stats })   ends the run (stats feed the achievements)
import { h } from '../util.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { claimLayer, releaseLayer, button, getRoot } from '../components/modal.js';
import { captureKeys } from '../input.js';
import { state } from '../store.js';
import { avatar } from '../icons.js';

const W = 1920;
const H = 1080;

// ------------------------------------------------------------------ input
const BTN = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, up: 12, down: 13, left: 14, right: 15 };
const KEYS = {
  a: ['Space', 'Enter', 'KeyJ'], b: ['KeyK', 'Backspace'], x: ['KeyU', 'ShiftLeft'], y: ['KeyI'],
  lb: ['KeyQ'], rb: ['KeyE'], lt: ['KeyZ'], rt: ['KeyC'],
  up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'],
};
const AIM_KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

function dead(x, y, dz) {
  const m = Math.hypot(x, y);
  if (m < dz) return { x: 0, y: 0 };
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return { x: x * k, y: y * k };
}

function createInput() {
  const keys = new Set();
  const taps = new Set(); // keys pressed since the last frame (a quick tap still counts once)
  let now = {};
  let prev = {};
  const input = {
    move: { x: 0, y: 0 },
    aim: { x: 0, y: 0 },
    down: (b) => !!now[b],
    pressed: (b) => !!now[b] && !prev[b],
    any: () => Object.keys(now).some((k) => now[k] && !prev[k]),
    keys,
    taps,
    poll() {
      const held = new Set([...keys, ...taps]);
      taps.clear();
      prev = now;
      now = {};
      let mx = 0, my = 0, ax = 0, ay = 0;
      for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) {
        if (!gp || !gp.connected) continue;
        const b = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
        for (const [name, i] of Object.entries(BTN)) if (b(i)) now[name] = true;
        const l = dead(gp.axes[0] || 0, gp.axes[1] || 0, 0.2);
        const r = dead(gp.axes[2] || 0, gp.axes[3] || 0, 0.25);
        if (Math.hypot(l.x, l.y) > Math.hypot(mx, my)) { mx = l.x; my = l.y; }
        if (Math.hypot(r.x, r.y) > Math.hypot(ax, ay)) { ax = r.x; ay = r.y; }
      }
      for (const [name, codes] of Object.entries(KEYS)) if (codes.some((c) => held.has(c))) now[name] = true;
      // Arrow keys aim (twin-stick on a keyboard) and also count as the d-pad.
      for (const [dir, code] of Object.entries(AIM_KEYS)) if (held.has(code)) now[dir] = true;
      if (now.left) mx = -1; if (now.right) mx = 1; if (now.up) my = -1; if (now.down) my = 1;
      const kax = (held.has('ArrowRight') ? 1 : 0) - (held.has('ArrowLeft') ? 1 : 0);
      const kay = (held.has('ArrowDown') ? 1 : 0) - (held.has('ArrowUp') ? 1 : 0);
      if (kax || kay) { const m = Math.hypot(kax, kay); ax = kax / m; ay = kay / m; }
      const mm = Math.hypot(mx, my);
      if (mm > 1) { mx /= mm; my /= mm; }
      input.move = { x: mx, y: my };
      input.aim = { x: ax, y: ay };
    },
  };
  return input;
}

// ------------------------------------------------------------------ helpers for games
const glowCache = new Map();
export function glowSprite(color, radius = 32) {
  const key = `${color}|${radius}`;
  if (glowCache.has(key)) return glowCache.get(key);
  const c = document.createElement('canvas');
  c.width = c.height = radius * 2;
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

function drawHud(ctx, def, { score = 0, left = [], right = [] } = {}, best = 0) {
  ctx.save();
  const grd = ctx.createLinearGradient(0, 0, 0, 110);
  grd.addColorStop(0, 'rgba(0,0,0,.65)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, W, 110);
  ctx.textBaseline = 'top';
  ctx.fillStyle = def.accent || '#8cff4a';
  ctx.font = '600 26px "Segoe UI", sans-serif';
  ctx.fillText(def.title.toUpperCase(), 48, 30);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  ctx.font = '22px "Segoe UI", sans-serif';
  let x = 48 + ctx.measureText(def.title.toUpperCase()).width + 40;
  for (const t of left) { ctx.fillText(t, x, 33); x += ctx.measureText(t).width + 34; }
  ctx.textAlign = 'right';
  ctx.fillStyle = '#fff';
  ctx.font = '300 54px "Segoe UI", sans-serif';
  ctx.fillText(Math.round(score).toLocaleString(), W - 48, 18);
  ctx.font = '20px "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,.6)';
  const bits = [...right, best ? `Best ${Math.round(best).toLocaleString()}` : null].filter(Boolean);
  ctx.fillText(bits.join('   ·   '), W - 48, 80);
  ctx.restore();
}

// ------------------------------------------------------------------ leaderboard UI
function boardEl(rows, { highlightAt } = {}) {
  if (!rows || !rows.length) return h('div.arc-board.empty', {}, 'No scores yet. Be the first on the board.');
  return h('div.arc-board', {}, ...rows.slice(0, 10).map((r) => {
    const a = avatar(r.avatar || 0);
    return h(`div.arc-row${highlightAt && r.at === highlightAt ? '.me' : ''}`, {},
      h('span.rk', {}, `${r.rank}`), a, h('span.gt', {}, r.gamertag), h('span.sc', {}, r.score.toLocaleString()));
  }));
}

// ------------------------------------------------------------------ run a game
let current = null;

export function isRunning() { return !!current; }

export async function runGame(def, { onExit } = {}) {
  if (current) return;
  const root = h('div.arcade');
  root.style.zIndex = String(claimLayer());
  const canvas = h('canvas', { width: W, height: H });
  const overlay = h('div.arc-overlay');
  root.append(canvas, overlay);
  getRoot().append(root);
  document.body.classList.add('arcade-open');
  const ctx = canvas.getContext('2d');
  const input = createInput();
  const focus = new nav.Focus(overlay);

  let board = [];
  try { board = await window.p360.arcade.board(def.key); } catch { /* offline store: empty board */ }
  const myBest = () => board.filter((r) => r.pid === state.settings.activeProfile).reduce((m, r) => Math.max(m, r.score), 0);

  let mode = 'title'; // title · play · pause · over
  let game = null;
  let playTime = 0;
  let raf = 0;
  let last = 0;
  let ended = false;
  let heroCache = null;

  // Keyboard: track held keys ourselves; while playing swallow them so the dashboard doesn't react.
  const onKeyDown = (e) => { input.keys.add(e.code); input.taps.add(e.code); };
  const onKeyUp = (e) => { input.keys.delete(e.code); };
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  const releaseKeys = captureKeys((e) => {
    if (mode !== 'play') return false;          // menus use normal navigation
    if (e.code === 'Escape' || e.code === 'KeyP') pause();
    return true;
  });
  const blur = () => { input.keys.clear(); if (mode === 'play') pause(); };
  window.addEventListener('blur', blur);

  const api = {
    w: W, h: H,
    input,
    sfx: (v) => sound.sfx(v),
    rand: (a = 0, b = 1) => a + Math.random() * (b - a),
    time: () => playTime,
    get best() { return myBest(); },
    hud: (c, o) => drawHud(c, def, o, myBest()),
    glow: glowSprite,
    gameOver: (result) => { if (mode === 'play') finish(result || {}); },
  };

  function start() {
    overlay.replaceChildren();
    overlay.classList.remove('in');
    playTime = 0;
    input.taps.clear(); input.poll(); input.poll(); // the A that chose "Play" isn't the game's first press
    game = def.create(api);
    mode = 'play';
    sound.play('select');
    nav.refreshPrompts();
  }

  function menu(title, sub, items, extra) {
    overlay.replaceChildren();
    const panel = h('div.arc-panel', {}, h('div.arc-title', { style: { color: def.accent } }, title), sub ? h('div.arc-sub', {}, sub) : null);
    if (extra) panel.append(extra);
    const btns = h('div.arc-btns');
    for (const it of items) btns.append(button(it.label, { icon: it.icon, onActivate: it.fn }));
    panel.append(btns);
    overlay.append(panel);
    overlay.classList.add('in');
    focus.set(btns.firstChild);
    nav.refreshPrompts();
  }

  function titleScreen() {
    mode = 'title';
    const how = h('div.arc-controls', {}, ...(def.controls || []).map(([k, v]) => h('div', {}, h('b', {}, k), h('span', {}, v))));
    const side = h('div.arc-split', {}, h('div', {}, h('div.arc-k', {}, 'How to play'), how), h('div', {}, h('div.arc-k', {}, 'Leaderboard'), boardEl(board)));
    menu(def.title, def.tagline, [
      { label: 'Play', icon: 'play', fn: start },
      { label: 'Back to dashboard', icon: 'home', fn: exit },
    ], side);
  }

  function pause() {
    if (mode !== 'play') return;
    mode = 'pause';
    sound.play('back');
    menu('Paused', null, [
      { label: 'Resume', icon: 'play', fn: resume },
      { label: 'Restart', icon: 'restart', fn: () => { submit({ score: 0, stats: {} }, true); start(); } },
      { label: 'Quit to dashboard', icon: 'home', fn: () => { submit({ score: 0, stats: {} }, true); exit(); } },
    ]);
  }

  function resume() {
    overlay.replaceChildren();
    overlay.classList.remove('in');
    mode = 'play';
    input.taps.clear(); input.poll(); input.poll();
    last = performance.now();
    nav.refreshPrompts();
  }

  async function submit(result, quiet) {
    const seconds = playTime;
    playTime = 0;
    if (seconds < 3 && !result.score) return null;
    try { return await window.p360.arcade.finish(def.key, { seconds, score: result.score || 0, stats: result.stats || {} }); }
    catch (e) { if (!quiet) console.warn('[arcade]', e.message); return null; }
  }

  async function finish(result) {
    mode = 'over';
    const score = Math.round(result.score || 0);
    const res = await submit({ ...result, score });
    if (ended) return;
    if (res && res.board) board = res.board;
    const mine = res && res.rank ? board[res.rank - 1] : null;
    const msg = res && res.rank === 1 ? 'New top score!' : res && res.rank ? `#${res.rank} on the leaderboard` : res && res.personalBest ? 'Personal best!' : `Best: ${myBest().toLocaleString()}`;
    sound.play(res && res.rank ? 'achievement' : 'toast');
    menu('Game over', null, [
      { label: 'Play again', icon: 'restart', fn: start },
      { label: 'Back to dashboard', icon: 'home', fn: exit },
    ], h('div.arc-over', {}, h('div.arc-score', {}, score.toLocaleString()), h('div.arc-msg', {}, msg), boardEl(board, { highlightAt: mine && mine.at })));
  }

  function exit() {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('blur', blur);
    releaseKeys();
    nav.pop(layer);
    releaseLayer();
    document.body.classList.remove('arcade-open');
    root.classList.add('out');
    setTimeout(() => root.remove(), 300);
    current = null;
    sound.play('back');
    if (onExit) onExit();
  }

  const layer = {
    focus,
    prompts: () => (mode === 'play'
      ? [{ btn: 'start', label: 'Pause' }]
      : [{ btn: 'a', label: 'Select' }, ...(mode === 'pause' ? [{ btn: 'b', label: 'Resume' }] : mode === 'title' ? [{ btn: 'b', label: 'Back' }] : [])]),
    handle(action, info) {
      if (mode === 'play') {
        if (action === 'start' || action === 'back' || (action === 'b' && info && info.device === 'keyboard')) pause();
        return; // the game reads the controller itself
      }
      if (['up', 'down', 'left', 'right'].includes(action)) focus.handleDir(action);
      else if (action === 'a') { if (focus.activate()) sound.play('select'); }
      else if (action === 'b') { if (mode === 'pause') resume(); else if (mode === 'title') exit(); }
      else if (action === 'start' && mode === 'pause') resume();
    },
  };
  nav.push(layer);

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, Math.max(0, (t - (last || t)) / 1000));
    last = t;
    // The Guide (or anything else) opened on top: pause the run.
    if (mode === 'play' && nav.top() !== layer) pause();
    if (mode === 'play' && game) {
      input.poll();
      playTime += dt;
      try { game.update(dt); } catch (e) { console.error('[arcade]', e); finish({ score: 0 }); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (game) {
      try { game.draw(ctx); } catch (e) { console.error('[arcade]', e); }
    } else if (def.art && def.art.hero) {
      if (!heroCache) {
        heroCache = document.createElement('canvas');
        heroCache.width = W; heroCache.height = H;
        try { def.art.hero(heroCache.getContext('2d'), W, H); } catch (e) { console.error('[arcade] art', e); }
      }
      ctx.drawImage(heroCache, 0, 0);
    }
  }
  requestAnimationFrame((t) => { last = t; frame(t); });
  requestAnimationFrame(() => root.classList.add('in'));
  current = { def, exit };
  titleScreen();
}
