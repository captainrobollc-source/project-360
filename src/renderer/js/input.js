// Unified input: native XInput masks (from main), Gamepad API (DirectInput/HID pads),
// keyboard and mouse -> logical actions.
import { state, setting } from './store.js';

const BITS = { up: 0, down: 1, left: 2, right: 3, start: 4, back: 5, ls: 6, rs: 7, lb: 8, rb: 9, guide: 10, a: 12, b: 13, x: 14, y: 15, lt: 16, rt: 17 };
const REPEAT = new Set(['up', 'down', 'left', 'right', 'lt', 'rt']);
const KEYMAP = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  Enter: 'a', NumpadEnter: 'a', Space: 'a',
  Escape: 'b', Backspace: 'b',
  KeyX: 'x', KeyY: 'y', KeyF: 'y',
  KeyQ: 'lb', KeyE: 'rb', PageUp: 'lt', PageDown: 'rt',
  Home: 'guide', F1: 'start', Tab: 'rb',
};

let handler = () => {};
let nativeSeen = false; // set once the native helper delivers controller input
const keyCaptures = []; // stack: the newest capture wins; releasing one restores the previous
let heldKeys = new Set(); // keys held when held input was suppressed: their auto-repeat is ignored
const sources = {};
let cursorTimer = null;
export let lastSlot = 0;
export let lastDevice = 'pad';

export function setHandler(fn) { handler = fn; }
export function captureKeys(fn) {
  keyCaptures.push(fn);
  return () => { const i = keyCaptures.lastIndexOf(fn); if (i >= 0) keyCaptures.splice(i, 1); };
}

// Buttons/keys still held right now stop counting until they're released (a menu that pops up
// mid-game mustn't receive the stick that was steering, or its auto-repeat).
export function suppressHeld() {
  for (const src of Object.values(sources)) {
    for (const t of Object.values(src.timers)) clearTimeout(t);
    src.timers = {};
    src.ignore = src.mask;
  }
  heldKeys = new Set(downKeys);
}
const downKeys = new Set();

let reportedSlot = -1;
export function resetActivity() { reportedSlot = -1; }
function fire(action, slot, device) {
  lastDevice = device;
  if (device === 'pad') {
    lastSlot = slot;
    scheduleCursorHide();
    // Another player's controller: their profile takes over the dashboard.
    if (slot !== reportedSlot) { reportedSlot = slot; window.p360.profiles.activity(slot).catch(() => {}); }
  }
  handler(action, { slot, device });
}

function scheduleCursorHide() {
  if (!setting('console.hideCursor')) return;
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => document.body.classList.add('hide-cursor'), 2000);
}

function feed(key, mask, slot, { allowGuide }) {
  const src = sources[key] || (sources[key] = { mask: 0, timers: {}, ignore: 0 });
  src.ignore = (src.ignore || 0) & mask; // released buttons count again
  const pressed = mask & ~src.mask & ~src.ignore;
  const released = src.mask & ~mask;
  src.mask = mask;
  for (const [name, bit] of Object.entries(BITS)) {
    const m = 1 << bit;
    if (released & m) { clearTimeout(src.timers[name]); delete src.timers[name]; }
    if (!(pressed & m)) continue;
    if (name === 'guide' && !allowGuide) continue; // native Guide is handled globally by main
    fire(name, slot, 'pad');
    if (REPEAT.has(name)) {
      let delay = 110;
      const tick = () => {
        if (!(src.mask & m) || (src.ignore & m)) return;
        fire(name, slot, 'pad');
        delay = Math.max(55, delay - 8);
        src.timers[name] = setTimeout(tick, delay);
      };
      src.timers[name] = setTimeout(tick, 380);
    }
  }
}

// Drop held buttons (e.g. when the dashboard is suspended) so nothing auto-repeats.
export function releaseAll() {
  for (const src of Object.values(sources)) {
    for (const t of Object.values(src.timers)) clearTimeout(t);
    src.timers = {};
    src.mask = 0;
  }
}

// --- Gamepad API (non-XInput pads, or everything if the native helper is missing)
function gamepadMask(gp) {
  const b = (i) => gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.5);
  let m = 0;
  const set = (name, on) => { if (on) m |= 1 << BITS[name]; };
  set('a', b(0)); set('b', b(1)); set('x', b(2)); set('y', b(3));
  set('lb', b(4)); set('rb', b(5)); set('lt', b(6)); set('rt', b(7));
  set('back', b(8)); set('start', b(9)); set('ls', b(10)); set('rs', b(11));
  set('up', b(12)); set('down', b(13)); set('left', b(14)); set('right', b(15));
  set('guide', b(16));
  const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  if (Math.max(Math.abs(ax), Math.abs(ay)) > 0.5) {
    if (Math.abs(ax) > Math.abs(ay)) set(ax > 0 ? 'right' : 'left', true);
    else set(ay > 0 ? 'down' : 'up', true);
  }
  // Non-standard mapping: d-pad often reported as a hat on axis 9.
  if (gp.mapping !== 'standard' && gp.axes.length > 9) {
    const hat = gp.axes[9];
    if (hat > -1.1 && hat < 1.1 && Math.abs(hat) <= 1) {
      const dirs = [[-1, 'up'], [-0.71, 'up'], [-0.43, 'right'], [-0.14, 'down'], [0.14, 'down'], [0.43, 'left'], [0.71, 'left'], [1, 'up']];
      for (const [v, name] of dirs) if (Math.abs(hat - v) < 0.1) set(name, true);
    }
  }
  return m;
}

// DirectInput pads (DualSense, Switch Pro…) take a free player slot 1–4 instead of "Player 5+".
const directSlots = new Map(); // Gamepad API index → slot
function slotForDirect(index) {
  if (directSlots.has(index)) {
    const s = directSlots.get(index);
    if (!(state.pads[s] && state.pads[s].connected)) return s;
    directSlots.delete(index); // an Xbox pad took this player number since: pick another
  }
  const used = new Set([...(state.pads || []).filter((p) => p.connected).map((p) => p.slot), ...directSlots.values()]);
  for (let s = 0; s < 4; s++) if (!used.has(s)) { directSlots.set(index, s); return s; }
  return 4 + index;
}
window.addEventListener('gamepaddisconnected', (e) => {
  directSlots.delete(e.gamepad.index);
  const src = sources[`gp${e.gamepad.index}`];
  if (src) { for (const t of Object.values(src.timers)) clearTimeout(t); src.timers = {}; src.mask = 0; }
});

function pollGamepads() {
  if (!document.hidden && !state.suspended) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const nativeOk = !!state.native || nativeSeen;
    const nativePads = (state.pads || []).filter((p) => p.connected).length;
    const fed = new Set();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      // The native helper already delivers every XInput pad. Chromium can expose the same pad
      // under many names, so while native pads are connected only accept pads that can't be
      // XInput (Sony / Nintendo), otherwise every press would be counted twice.
      const knownDirect = /054c|057e|wireless controller \(standard|dualsense|dualshock|pro controller/i.test(gp.id);
      if (nativeOk && (/xinput|xbox/i.test(gp.id) || (nativePads > 0 && !knownDirect))) continue;
      const sony = /054c|dualsense|dualshock/i.test(gp.id);
      fed.add(`gp${gp.index}`);
      feed(`gp${gp.index}`, gamepadMask(gp), slotForDirect(gp.index), { allowGuide: !(nativeOk && sony) });
    }
    // pads that stopped reporting (filtered out, unplugged) let go of held buttons
    for (const [k, src] of Object.entries(sources)) if (k.startsWith('gp') && !fed.has(k) && src.mask) feed(k, 0, 0, { allowGuide: false });
  }
  requestAnimationFrame(pollGamepads);
}

export function init() {
  window.p360.on('pad', ({ s, b }) => { nativeSeen = true; feed(`x${s}`, b, s, { allowGuide: false }); });

  window.addEventListener('keydown', (e) => {
    downKeys.add(e.code);
    const cap = keyCaptures[keyCaptures.length - 1];
    if (cap && cap(e)) { e.preventDefault(); return; }
    if (e.repeat && heldKeys.has(e.code)) { e.preventDefault(); return; }
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let action = KEYMAP[e.code];
    if (e.code === 'Tab' && e.shiftKey) action = 'lb';
    if (!action) return;
    e.preventDefault();
    if (e.repeat && !REPEAT.has(action)) return;
    fire(action, 0, 'keyboard');
  });

  window.addEventListener('keyup', (e) => { downKeys.delete(e.code); heldKeys.delete(e.code); });
  window.addEventListener('blur', () => { downKeys.clear(); heldKeys.clear(); });

  window.addEventListener('mousemove', () => {
    clearTimeout(cursorTimer);
    document.body.classList.remove('hide-cursor');
    lastDevice = 'mouse';
  });

  let wheelAt = 0;
  window.addEventListener('wheel', (e) => {
    const now = Date.now();
    if (now - wheelAt < 90) return;
    wheelAt = now;
    fire(e.deltaY > 0 ? 'down' : 'up', 0, 'mouse');
  }, { passive: true });

  requestAnimationFrame(pollGamepads);
}
