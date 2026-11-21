// Layer stack + spatial focus navigation for 10-foot UI.
import { h } from './util.js';
import * as sound from './sound.js';

const stack = [];
let promptsEl = null;

export function mountPrompts(el) { promptsEl = el; refreshPrompts(); }

export function push(layer) {
  stack.push(layer);
  refreshPrompts();
  return layer;
}

export function pop(layer) {
  const i = stack.lastIndexOf(layer);
  if (i >= 0) stack.splice(i, 1);
  refreshPrompts();
}

export function top() { return stack[stack.length - 1]; }
export function depth() { return stack.length; }

export function dispatch(action, info) {
  const layer = top();
  if (layer && layer.handle) layer.handle(action, info);
}

// prompts: [{ btn:'a'|'b'|'x'|'y'|'lb'|'rb'|'lt'|'rt'|'start'|'back'|'dpad', label, side:'left'|'right' }]
export function glyph(btn) {
  const map = { lb: ['bumper', 'LB'], rb: ['bumper', 'RB'], lt: ['trigger', 'LT'], rt: ['trigger', 'RT'], start: ['meta', '≡'], back: ['meta', '⧉'], dpad: ['meta', '✛'] };
  const [cls, text] = map[btn] || [btn, btn.toUpperCase()];
  return h(`span.btn-glyph.${cls}`, {}, text);
}

export function promptRow(prompts) {
  return prompts.map((p) => h('div.prompt', {}, ...(Array.isArray(p.btn) ? p.btn.map(glyph) : [glyph(p.btn)]), h('span', {}, p.label)));
}

export function refreshPrompts() {
  if (!promptsEl) return;
  const layer = top();
  const prompts = (layer && layer.prompts && layer.prompts()) || [];
  const left = prompts.filter((p) => p.side !== 'right');
  const right = prompts.filter((p) => p.side === 'right');
  promptsEl.replaceChildren(
    h('div.left', {}, ...promptRow(left)),
    h('div.right', {}, ...promptRow(right)),
  );
}

// ------------------------------------------------------------------ spatial focus
function visible(el) {
  if (!el.isConnected) return false;
  if (el.checkVisibility) return el.checkVisibility({ checkVisibilityCSS: true });
  return el.offsetParent !== null;
}

function gap(a1, a2, b1, b2) { return Math.max(0, Math.max(a1, b1) - Math.min(a2, b2)); }

export function pick(items, cur, dir) {
  const r = cur.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const horiz = dir === 'left' || dir === 'right';
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const dx = bx - cx, dy = by - cy;
    if (dir === 'right' && (dx <= 2 || b.left < r.left + 2)) continue;
    if (dir === 'left' && (dx >= -2 || b.right > r.right - 2)) continue;
    if (dir === 'down' && (dy <= 2 || b.top < r.top + 2)) continue;
    if (dir === 'up' && (dy >= -2 || b.bottom > r.bottom - 2)) continue;
    const along = horiz ? Math.abs(dx) : Math.abs(dy);
    const perpGap = horiz ? gap(r.top, r.bottom, b.top, b.bottom) : gap(r.left, r.right, b.left, b.right);
    const perpCenter = horiz ? Math.abs(dy) : Math.abs(dx);
    const score = along + perpGap * 6 + perpCenter * 0.35;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function scrollIntoScroller(el) {
  const sc = el.closest('[data-scroll]');
  if (!sc) return;
  const sr = sc.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  const scale = sr.height / sc.offsetHeight || 1;
  const pad = 70 * scale;
  if (er.top < sr.top + pad) sc.scrollTop -= (sr.top + pad - er.top) / scale;
  else if (er.bottom > sr.bottom - pad) sc.scrollTop += (er.bottom - (sr.bottom - pad)) / scale;
}

// Focus manager for one root. Focusable elements carry [data-focus].
export class Focus {
  constructor(root, { onChange } = {}) {
    this.root = root;
    this.current = null;
    this.onChange = onChange;
  }

  items() { return [...this.root.querySelectorAll('[data-focus]')].filter(visible); }

  set(el, { silent = true } = {}) {
    if (!el) return;
    if (this.current && this.current !== el) this.current.classList.remove('focused');
    const changed = this.current !== el;
    this.current = el;
    el.classList.add('focused');
    scrollIntoScroller(el);
    if (changed && !silent) sound.play('tick');
    if (this.onChange) this.onChange(el);
    refreshPrompts();
  }

  first() { const it = this.items(); if (it.length) this.set(it[0]); return it[0]; }

  ensure() {
    if (this.current && this.current.isConnected && visible(this.current)) { this.current.classList.add('focused'); return this.current; }
    return this.first();
  }

  move(dir) {
    const cur = this.ensure();
    if (!cur) return false;
    const next = pick(this.items(), cur, dir);
    if (!next) return false;
    this.set(next, { silent: false });
    return true;
  }

  // Handles directions; returns true if focus moved or an adjustable element consumed it.
  handleDir(action) {
    const cur = this.ensure();
    if (cur && (action === 'left' || action === 'right') && cur._adjust) {
      cur._adjust(action === 'left' ? -1 : 1);
      return true;
    }
    return this.move(action);
  }

  activate() {
    const cur = this.ensure();
    if (cur && cur._activate) { cur._activate(); return true; }
    return false;
  }
}

// Mouse support: clicking a focusable element focuses + activates it on the top layer.
export function initMouse() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-focus]');
    const layer = top();
    if (!el || !layer || !layer.focus || !layer.focus.root.contains(el)) return;
    layer.focus.set(el);
    if (el._activate) el._activate(); else layer.handle('a', { device: 'mouse' });
  });
  // Only follow the pointer when it actually moved; elements sliding under a resting
  // cursor (blade transitions) must not steal focus from the controller.
  let movedAt = 0;
  document.addEventListener('mousemove', () => { movedAt = performance.now(); }, { passive: true });
  document.addEventListener('mouseover', (e) => {
    if (performance.now() - movedAt > 120) return;
    const el = e.target.closest('[data-focus]');
    const layer = top();
    if (!el || !layer || !layer.focus || !layer.focus.root.contains(el)) return;
    if (document.body.classList.contains('hide-cursor')) return;
    if (layer.focus.current !== el) layer.focus.set(el);
  });
}
