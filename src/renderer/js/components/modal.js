// Modal layers: generic modal, confirm dialog, option menu, on-screen keyboard.
import { h } from '../util.js';
import { iconEl, avatar, AVATARS } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { captureKeys } from '../input.js';

let root = null;
export function setRoot(el) { root = el; }
export function getRoot() { return root; }

// Every modal stacks above whatever opened it: the dashboard, the Guide (80), the photo viewer
// (120) or the setup wizard (250). Below the screensaver (400).
const Z_BASE = 260;
let openCount = 0;
let zTop = Z_BASE;

// Overlay layers (modals, the Guide, the viewer) take the next z-index up, so whatever opened
// last is on top. While any is open the prompt bar rides above them all.
export function claimLayer() {
  if (openCount++ === 0) zTop = Z_BASE;
  zTop += 2;
  document.body.classList.add('has-layer');
  return zTop;
}
export function releaseLayer() {
  openCount = Math.max(0, openCount - 1);
  if (!openCount) document.body.classList.remove('has-layer');
}

export function modal({ panelClass = 'dialog', build, handle, prompts, onClose, scrim = true, sound: openSound = null }) {
  const scrimEl = scrim ? h('div.scrim') : null;
  const panel = h(`div.${panelClass.split(' ').join('.')}`);
  const z = claimLayer();
  if (scrimEl) scrimEl.style.zIndex = String(z - 1);
  panel.style.zIndex = String(z);
  if (scrimEl) root.append(scrimEl);
  root.append(panel);
  const focus = new nav.Focus(panel);
  let closed = false;

  const layer = {
    focus,
    prompts: prompts || (() => [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }]),
    handle(action, info) {
      if (handle && handle(action, info)) return;
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right') focus.handleDir(action);
      else if (action === 'a') { if (focus.activate()) sound.play('select'); }
      else if (action === 'b') { sound.play('back'); close(null); }
    },
  };

  function close(value) {
    if (closed) return;
    closed = true;
    releaseLayer();
    nav.pop(layer);
    panel.classList.remove('in');
    if (scrimEl) scrimEl.classList.remove('in');
    setTimeout(() => { panel.remove(); if (scrimEl) scrimEl.remove(); }, 380);
    if (onClose) onClose(value);
  }

  build(panel, close, focus);
  nav.push(layer);
  if (openSound) sound.play(openSound);
  requestAnimationFrame(() => requestAnimationFrame(() => { panel.classList.add('in'); if (scrimEl) scrimEl.classList.add('in'); }));
  if (!focus.current) focus.first();
  return { close, panel, focus, layer };
}

export function button(label, { icon, danger, onActivate, right } = {}) {
  const el = h('div.pill-btn', { 'data-focus': '' }, icon ? iconEl(icon) : null, h('span', {}, label), right !== undefined ? h('span.val', {}, right) : null);
  if (danger) el.classList.add('danger');
  el._activate = onActivate;
  return el;
}

// confirm({ title, text, buttons: [{ label, value, danger, icon }] }) -> Promise<value|null>
export function confirm({ title, text, buttons, cls = '' }) {
  const btns = buttons || [{ label: 'OK', value: true }, { label: 'Cancel', value: false }];
  return new Promise((resolve) => {
    modal({
      panelClass: `dialog ${cls}`.trim(),
      sound: 'guide',
      onClose: (v) => resolve(v === undefined ? null : v),
      build(panel, close, focus) {
        const list = h('div.btns');
        for (const b of btns) list.append(button(b.label, { icon: b.icon, danger: b.danger, right: b.right, onActivate: () => close(b.value) }));
        panel.append(...[h('h3', {}, title || ''), text ? h('p', {}, text) : null, list].filter(Boolean));
        focus.set(list.firstChild);
      },
    });
  });
}

export function menu({ title, items }) {
  return confirm({ title, buttons: items, cls: 'popmenu' });
}

// Gamer picture grid. Resolves to the chosen index, or null on Back.
export function avatarPicker({ title = 'Choose a gamer picture', current = 0 } = {}) {
  return new Promise((resolve) => {
    modal({
      panelClass: 'dialog avpick',
      prompts: () => [{ btn: 'a', label: 'Choose' }, { btn: 'b', label: 'Back' }],
      onClose: (v) => resolve(v === undefined ? null : v),
      build(panel, close, focus) {
        const grid = h('div.avgrid');
        AVATARS.forEach((_, i) => {
          const cell = h('div.avcell', { 'data-focus': '' }, avatar(i));
          cell._activate = () => close(i);
          if (i === current) cell.classList.add('current');
          grid.append(cell);
        });
        panel.append(h('h3', {}, title), grid);
        const cur = grid.children[current] || grid.children[0];
        if (cur) focus.set(cur);
      },
    });
  });
}

// ------------------------------------------------------------------ on-screen keyboard
const PAGES = {
  lower: ['1234567890', 'qwertyuiop', 'asdfghjkl-', 'zxcvbnm_.@'],
  upper: ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL-', 'ZXCVBNM_.@'],
  sym: ['!@#$%^&*()', '~`+=[]{}\\|', ';:\'",.<>/?', '-_€£¥§°•…·'],
};

export function osk({ title = 'Enter text', value = '', placeholder = '', maxLength = 256 }) {
  return new Promise((resolve) => {
    let text = String(value || '');
    let page = 'lower';
    let releaseKeys = null;
    let fieldEl, keysEl, focusRef;

    const render = () => {
      fieldEl.replaceChildren(text ? h('span', {}, text) : h('span.ph', {}, placeholder), h('span.caret'));
      fieldEl.scrollLeft = fieldEl.scrollWidth;
    };
    const insert = (s) => { if (text.length < maxLength) { text += s; render(); } };
    const backspace = () => { text = text.slice(0, -1); render(); };

    const buildKeys = () => {
      const prevIndex = focusRef && focusRef.current ? [...keysEl.children].indexOf(focusRef.current) : 0;
      keysEl.replaceChildren();
      for (const row of PAGES[page]) for (const ch of row) {
        const k = h('div.key', { 'data-focus': '' }, ch);
        k._activate = () => { insert(ch); if (page === 'upper') { page = 'lower'; buildKeys(); } };
        keysEl.append(k);
      }
      const special = [
        ['Shift', 'wide', () => { page = page === 'upper' ? 'lower' : 'upper'; buildKeys(); }, page === 'upper'],
        ['&#?', 'wide', () => { page = page === 'sym' ? 'lower' : 'sym'; buildKeys(); }, page === 'sym'],
        ['Space', 'space', () => insert(' ')],
        ['⌫', '', () => backspace()],
        ['Done', '', () => finish(text)],
      ];
      for (const [label, cls, fn, on] of special) {
        const k = h(`div.key${cls ? '.' + cls : ''}${on ? '.on' : ''}`, { 'data-focus': '' }, label);
        k._activate = fn;
        keysEl.append(k);
      }
      if (focusRef) focusRef.set(keysEl.children[Math.max(0, Math.min(prevIndex, keysEl.children.length - 1))]);
    };

    let finish = () => {};
    const m = modal({
      panelClass: 'dialog osk',
      sound: 'guide',
      onClose: (v) => { if (releaseKeys) releaseKeys(); resolve(v); },
      prompts: () => [
        { btn: 'a', label: 'Type' }, { btn: 'x', label: 'Backspace' }, { btn: 'y', label: 'Space' },
        { btn: 'lt', label: 'Shift' }, { btn: 'start', label: 'Done' }, { btn: 'b', label: 'Cancel', side: 'right' },
      ],
      handle(action) {
        if (action === 'x') { backspace(); sound.play('tick'); return true; }
        if (action === 'y') { insert(' '); sound.play('tick'); return true; }
        if (action === 'lt') { page = page === 'upper' ? 'lower' : 'upper'; buildKeys(); return true; }
        if (action === 'rt') { page = page === 'sym' ? 'lower' : 'sym'; buildKeys(); return true; }
        if (action === 'start') { sound.play('select'); finish(text); return true; }
        if (action === 'a') { if (focusRef.activate()) sound.play('tick'); return true; }
        return false;
      },
      build(panel, close, focus) {
        focusRef = focus;
        finish = (v) => close(v);
        fieldEl = h('div.field');
        keysEl = h('div.keys');
        panel.append(h('h3', {}, title), fieldEl, keysEl,
          h('div.legend', {}, ...nav.promptRow([{ btn: 'x', label: 'Backspace' }, { btn: 'y', label: 'Space' }, { btn: 'lt', label: 'Shift' }, { btn: 'start', label: 'Done' }])));
        render();
        buildKeys();
        focus.set(keysEl.children[10]);
      },
    });

    releaseKeys = captureKeys((e) => {
      if (e.key === 'Enter') { m.close(text); return true; }
      if (e.key === 'Escape') { m.close(null); return true; }
      if (e.key === 'Backspace') { backspace(); return true; }
      if (e.ctrlKey && e.key.toLowerCase() === 'v') {
        navigator.clipboard.readText().then((t) => insert(t.replace(/[\r\n]/g, ''))).catch(() => {});
        return true;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey) { insert(e.key); return true; }
      return false;
    });
  });
}
