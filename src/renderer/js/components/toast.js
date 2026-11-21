// Bottom-center pill notifications that bloom out of a spinning orb.
// Kinds: orb (default), achievement, signin (gamer pic + ring), controller/battery (ring).
import { h, wait } from '../util.js';
import { orb, avatar, icon } from '../icons.js';
import { ringSvg } from './ring.js';
import * as sound from '../sound.js';
import * as store from '../store.js';

function iconFor(t) {
  if (t.kind === 'achievement') return h('div.ticon', {}, h('div.trophy', { html: icon('trophy') }));
  if (t.kind === 'signin') return h('div.ticon', {}, avatar(t.avatar || 0));
  if (t.kind === 'controller' || t.kind === 'battery') {
    const lit = store.state.pads.filter((p) => p.connected).map((p) => p.slot);
    return h('div.ticon', { html: ringSvg(lit, t.slot ?? -1, 'ringsvg') });
  }
  const o = orb('fast');
  const wrap = h('div.ticon', {}, o);
  if (t.icon) wrap.append(h('div.glyph', { html: icon(t.icon) }));
  return wrap;
}

export function createToasts(stage, { onIdle } = {}) {
  const wrap = h('div.toasts');
  stage.append(wrap);
  const queue = [];
  let busy = false;

  async function run() {
    if (busy) return;
    busy = true;
    while (queue.length) {
      const t = queue.shift();
      const sub = h('div.ts', {}, t.text || '');
      if (t.kind === 'signin' && t.slot !== undefined) {
        const lit = store.state.pads.filter((p) => p.connected).map((p) => p.slot);
        sub.prepend(h('span.ring', { html: ringSvg(lit.length ? lit : [t.slot], t.slot) }));
      }
      const el = h(`div.toast${t.kind ? '.' + t.kind : ''}`, {}, iconFor(t), h('div.tx', {}, h('div.tt', {}, t.title || ''), t.text ? sub : null));
      wrap.replaceChildren(el);
      await wait(30);
      el.classList.add('in');
      sound.play(t.sound || 'toast');
      setTimeout(() => el.querySelector('.orb')?.classList.remove('fast'), 900);
      await wait(t.duration || 4200);
      el.classList.add('out');
      await wait(650);
      el.remove();
    }
    busy = false;
    if (onIdle) onIdle();
  }

  return {
    show(t) {
      if (queue.some((q) => q.title === t.title && q.text === t.text)) return;
      // Keep a history for the Social › Notifications list.
      const list = [{ ...t, at: Date.now() }, ...(store.state.notifications || [])].slice(0, 60);
      store.set('notifications', list);
      queue.push(t);
      run();
    },
  };
}
