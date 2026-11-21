// Blade-style split view: glossy list on the left, content pane on the right.
// Moving through the list swaps the pane (like the original console's blades).
import { h } from '../util.js';
import { iconEl } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';

export function createSplit({ sections, render, onSection }) {
  const list = h('div.bl-list', { 'data-scroll': '' });
  const pane = h('div.pane');
  const root = h('div.split', {}, list, pane);
  let current = null;
  let token = 0;

  const focus = new nav.Focus(root, {
    onChange: (el) => {
      if (el.dataset.section && el.dataset.section !== current) select(el.dataset.section, { keepFocus: true });
    },
  });

  const inPane = (el) => el && pane.contains(el);
  const paneItems = () => [...pane.querySelectorAll('[data-focus]')].filter((e) => e.offsetParent !== null);
  const listItem = (id = current) => list.querySelector(`[data-section="${id}"]`);
  // Pane containers ignore null/false children so renderers can append conditionally.
  const makeScroll = () => {
    const el = h('div.pane-scroll', { 'data-scroll': '' });
    const append = el.append.bind(el);
    el.append = (...nodes) => append(...nodes.filter((n) => n !== null && n !== undefined && n !== false));
    return el;
  };

  function renderList() {
    const secs = sections();
    const focusedId = focus.current && list.contains(focus.current) ? focus.current.dataset.section : null;
    list.replaceChildren();
    for (const s of secs) {
      const it = h(`div.bl-item${s.id === current ? '.selected' : ''}`, { 'data-focus': '', 'data-section': s.id }, iconEl(s.icon || 'app'), h('span', {}, s.label), s.count !== undefined ? h('span.cnt', {}, String(s.count)) : null);
      it._activate = () => { const f = paneItems()[0]; if (f) focus.set(f, { silent: false }); };
      list.append(it);
      if (focusedId === s.id) { it.classList.add('focused'); focus.current = it; }
    }
  }

  async function select(id, { keepFocus = false } = {}) {
    current = id;
    renderList();
    const my = ++token;
    const scroll = makeScroll();
    pane.replaceChildren(scroll);
    await render(id, scroll, { isCurrent: () => my === token, focus });
    if (my !== token) return;
    if (onSection) onSection(id);
    if (!keepFocus) { const it = listItem(); if (it) focus.set(it); }
    nav.refreshPrompts();
  }

  function rerender() {
    const idx = focus.current && inPane(focus.current) ? paneItems().indexOf(focus.current) : -1;
    // Rows with a stable data-key (tracks, networks, devices) keep focus even if rows above change.
    const key = idx >= 0 ? focus.current.dataset.key : undefined;
    const scrollTop = pane.firstChild ? pane.firstChild.scrollTop : 0;
    const my = ++token;
    const scroll = makeScroll();
    Promise.resolve(render(current, scroll, { isCurrent: () => my === token, focus })).then(() => {
      if (my !== token) return;
      pane.replaceChildren(scroll);
      scroll.scrollTop = scrollTop;
      renderList();
      if (idx >= 0) {
        const items = paneItems();
        const t = (key !== undefined && items.find((e) => e.dataset.key === key)) || items[Math.min(idx, items.length - 1)];
        if (t) focus.set(t); else { const it = listItem(); if (it) focus.set(it); }
      }
      nav.refreshPrompts();
    });
  }

  function handle(action) {
    const el = focus.ensure();
    if (!el) return false;
    const horiz = action === 'left' || action === 'right';
    if (['up', 'down', 'left', 'right'].includes(action)) {
      if (inPane(el)) {
        if (horiz && el._adjust) { el._adjust(action === 'left' ? -1 : 1); return true; }
        const next = nav.pick(paneItems(), el, action);
        if (next) { focus.set(next, { silent: false }); return true; }
        if (action === 'left') { focus.set(listItem(), { silent: false }); return true; }
        return true;
      }
      if (action === 'right') { const f = paneItems()[0]; if (f) focus.set(f, { silent: false }); return true; }
      if (action === 'left') return false;
      focus.move(action);
      return true;
    }
    if (action === 'a') { if (focus.activate()) sound.play('select'); return true; }
    if (action === 'b' && inPane(el)) { sound.play('back'); focus.set(listItem()); return true; }
    return false;
  }

  return {
    root, list, pane, focus,
    current: () => current,
    select, rerender, renderList, handle,
    inPane: () => inPane(focus.current),
    activate() { if (!focus.ensure()) { const it = listItem(); if (it) focus.set(it); } },
  };
}
