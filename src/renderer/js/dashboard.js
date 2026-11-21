// Dashboard: header, stacked blades (LB/RB sweep between them), prompts bar.
import { h } from './util.js';
import { avatar, icon } from './icons.js';
import * as nav from './nav.js';
import * as sound from './sound.js';
import { state, on, setting, track } from './store.js';
import { createRing } from './components/ring.js';
import { lastSlot } from './input.js';
import { marketBlade } from './blades/marketplace.js';
import { socialBlade } from './blades/social.js';
import { homeBlade } from './blades/home.js';
import { gamesBlade } from './blades/games.js';
import { retroBlade } from './blades/retro.js';
import { mediaBlade } from './blades/media.js';
import { systemBlade } from './blades/system.js';

const L = 48;      // left margin
const S = 58;      // visible sliver of a stacked blade
const W = 1476;    // blade width: 1920 - 2*48 - 6*58
const HOME = 2;

export function createDashboard(stage, { toast, guide, signIn }) {
  // ---- header
  const ring = createRing();
  const clock = h('div.clock');
  const chip = h('div.gamer-chip');
  const tabs = h('div.blade-tabs');
  const npMini = h('div.np-mini');
  const header = h('div.header', {}, chip, tabs, h('div.header-right', {}, npMini, clock, ring.el));
  const paintProfile = () => {
    const p = state.settings.profile || {};
    const others = (state.slots || []).filter((x) => x.profileId && !x.active);
    chip.replaceChildren(...[avatar(p.avatar || 0), h('div', {},
      h('div.tag', {}, p.gamertag || 'Player', state.activeSlot >= 0 ? h('span.pslot', {}, `P${state.activeSlot + 1}`) : null),
      h('div.gs', {}, h('span.gcoin', {}, 'G'), state.achievements.totals.score.toLocaleString())),
      others.length ? h('div.others', {}, ...others.map((o) => { const a = avatar(o.avatar || 0); a.title = o.gamertag; return h('div.other', {}, a, h('span', {}, `P${o.slot + 1}`)); })) : null].filter(Boolean));
  };
  const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  tickClock();
  setInterval(tickClock, 10000);
  paintProfile();
  on('settings', paintProfile);
  on('achievements', paintProfile);
  on('slots', () => { paintProfile(); ring.update(state.pads, state.activeSlot >= 0 ? state.activeSlot : lastSlot); });
  const ringSlot = () => (state.activeSlot >= 0 ? state.activeSlot : lastSlot);
  ring.update(state.pads, ringSlot());
  on('pads', () => ring.update(state.pads, ringSlot()));
  on('nowPlaying', (np) => {
    if (!np || !np.track) { npMini.replaceChildren(); return; }
    npMini.innerHTML = `${icon(np.playing ? 'music' : 'sleep')}`;
    npMini.append(h('span', {}, `${np.track.title} · ${np.track.artist}`));
  });

  const bladesEl = h('div.blades');
  const prompts = h('div.prompts');
  stage.append(header, bladesEl, prompts);
  nav.mountPrompts(prompts);

  let active = HOME;
  const ctx = { toast, signIn, goto: (id, opts) => goto(id, opts), refreshPrompts: () => nav.refreshPrompts() };

  const defs = [marketBlade, socialBlade, homeBlade, gamesBlade, retroBlade, mediaBlade, systemBlade];
  const blades = defs.map((make, i) => {
    const content = h('div.content');
    const ambient = h('div.ambient');
    const sub = h('div.blade-sub');
    const b = make({ ...ctx, setAmbient: (url) => setAmbient(ambient, url), setSub: (t) => { sub.textContent = t || ''; } });
    const el = h('div.blade', { style: { '--accent': b.accent || 'var(--lime)', zIndex: i } },
      ambient, h('div.accent'), h('div.sliver-label', {}, b.label), h('div.blade-title', {}, b.label), sub, content, h('div.shade'));
    el.addEventListener('click', (e) => { if (blades[active] !== blade && !e.target.closest('[data-focus]')) switchTo(i); });
    const blade = { ...b, el, content };
    b.mount(content);
    bladesEl.append(el);
    const tab = h('div.bt', {}, b.label);
    tab.addEventListener('click', () => switchTo(i));
    tabs.append(tab);
    return blade;
  });

  let hideTimer = null;
  function layout() {
    blades.forEach((b, i) => {
      const x = i <= active ? L + i * S : L + W + (i - 1) * S;
      b.el.style.transform = `translate3d(${x}px, 0, 0)`;
      b.el.classList.toggle('active', i === active);
      b.el.classList.toggle('inactive', i !== active);
      if (i === active) b.el.classList.remove('content-hidden');
      tabs.children[i].classList.toggle('on', i === active);
    });
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => blades.forEach((b, i) => b.el.classList.toggle('content-hidden', i !== active)), 700);
    const ribbons = document.querySelector('#backdrop .ribbons');
    if (ribbons) ribbons.style.transform = `translate3d(${-(active - HOME) * 40}px, 0, 0) scale(1.08)`;
  }

  function switchTo(i, { silent = false } = {}) {
    i = Math.max(0, Math.min(blades.length - 1, i));
    if (i === active) return false;
    const dir = i > active ? 1 : -1;
    blades[active].deactivate && blades[active].deactivate();
    active = i;
    layout();
    if (!silent) sound.play('blade', { dir });
    blades[active].activate();
    track('blade', { id: blades[active].id });
    nav.refreshPrompts();
    return true;
  }

  function goto(id, opts) {
    const i = blades.findIndex((b) => b.id === id);
    if (i < 0) return;
    if (!switchTo(i)) blades[i].activate();
    if (opts && blades[i].open) blades[i].open(opts);
  }

  function setAmbient(el, url) {
    if (!url) { el.classList.remove('on'); return; }
    if (el.dataset.url === url) { el.classList.add('on'); return; }
    el.classList.remove('on');
    const img = new Image();
    img.onload = () => { el.dataset.url = url; el.style.backgroundImage = `url("${url}")`; el.classList.add('on'); };
    img.src = url;
  }

  const layer = {
    get focus() { return blades[active].focus; },
    prompts() {
      const p = blades[active].prompts ? blades[active].prompts() : [];
      return [...p, { btn: ['lb', 'rb'], label: 'Switch blade', side: 'right' }];
    },
    handle(action, info) {
      if (action === 'lb') return switchTo(active - 1);
      if (action === 'rb') return switchTo(active + 1);
      if (action === 'guide') return guide.toggle();
      if (blades[active].handle(action, info)) return;
      if (action === 'b' && active !== HOME) switchTo(HOME);
      if (action === 'start') goto('system');
    },
  };

  nav.push(layer);
  layout();
  blades[active].activate();

  for (const key of ['library', 'settings', 'media', 'pads', 'achievements', 'notifications', 'nowPlaying']) {
    on(key, () => blades.forEach((b) => b.refresh && b.refresh(key)));
  }
  window.p360.on('nav:goto', (id) => goto(id));

  return {
    goto,
    layer,
    // Blades slide in from the right after the boot sequence.
    enter() {
      blades.forEach((b, i) => { b.el.style.transition = 'none'; b.el.style.transform = `translate3d(${2000 + i * 120}px,0,0)`; });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        blades.forEach((b, i) => { b.el.style.transition = `transform 900ms var(--ease-swoosh) ${i * 70}ms`; });
        layout();
        sound.play('blade', { dir: -1 });
        setTimeout(() => blades.forEach((b) => { b.el.style.transition = ''; }), 1600);
      }));
    },
  };
}
