// Home blade: spotlight of the last played game, recent games, quick tiles.
import { h, artUrl, fmtAgo, fmtPlaytime } from '../util.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { state, visibleGames, recentGames } from '../store.js';
import { wideTile, quickTile } from '../components/tiles.js';
import { launchGame } from '../components/launch.js';
import { openDetails } from '../components/details.js';
import { on } from '../store.js';
import { onActivity } from '../input.js';
import { avatarFor } from '../avatar/model.js';
// three.js (~700 KB) loads after boot, the first time Home needs the avatar.
const avatarRender = () => import('../avatar/render.js');
const openAvatarEditor = (opts) => import('../avatar/editor.js').then((m) => m.openAvatarEditor(opts));

const SLEEP_AFTER_MS = 90 * 1000;

export function homeBlade(ctx) {
  const root = h('div.home');
  // ---- your avatar (NXE-style, standing at the left of Home)
  const avHost = h('div.av-stage');
  const avName = h('div.av-name');
  const avEl = h('div.home-avatar', { 'data-focus': '', 'data-key': 'avatar' }, avHost, avName);
  avEl._activate = () => openAvatarEditor({ toast: ctx.toast });
  let stage = null;
  let active = false;
  let sleeping = false;
  let lastActivity = Date.now();
  let greeted = null;

  const focus = new nav.Focus(root, { onChange: (el) => {
    const g = el.dataset.id && state.library.find((x) => x.id === el.dataset.id);
    ctx.setAmbient(g ? artUrl(g, 'hero') : null);
    lookAtFocus(el);
  } });
  let focusKey = null;

  function avatarsList() {
    const me = state.settings.profile || {};
    const list = [{ key: me.id || 'me', config: avatarFor(me), primary: true }];
    for (const sl of state.slots || []) {
      if (sl.profileId && sl.profileId !== me.id && list.length < 3) list.push({ key: sl.profileId, config: avatarFor({ id: sl.profileId, avatar3d: sl.avatar3d }) });
    }
    return list;
  }
  function paintAvatar() {
    const me = state.settings.profile || {};
    avName.replaceChildren(h('div.t', {}, me.gamertag || 'Player'), h('div.s', {}, h('span.gcoin', {}, 'G'), `${state.achievements.totals.score.toLocaleString()}`));
    if (!stage) return;
    stage.setAvatars(avatarsList());
    // A new player took over the dashboard: say hi.
    if (me.id && greeted !== me.id) { greeted = me.id; setTimeout(() => stage && stage.react('wave'), 400); }
  }
  function lookAtFocus(el) {
    if (!stage) return;
    stage.setFocused(el === avEl);
    if (el === avEl) { stage.lookAt(0, 0); return; }
    const a = avEl.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (!a.width || !r.width) return;
    const headX = a.left + a.width / 2;
    const headY = a.top + a.height * 0.28;
    stage.lookAt((r.left + r.width / 2 - headX) / (a.width * 2.6), (r.top + r.height / 2 - headY) / (a.height * 0.9));
  }
  const hidden = () => !active || ['suspended', 'arcade-open', 'avedit-open', 'viewer-open'].some((c) => document.body.classList.contains(c));
  let loading = false;
  function ensureStage() {
    if (stage || loading || !avHost.isConnected || !avHost.clientWidth) return;
    loading = true;
    avatarRender().then(({ createAvatarStage }) => {
      stage = createAvatarStage(avHost, { fps: 30, framing: 'full' });
      stage.isHidden = hidden;
      paintAvatar();
      if (focus.current) lookAtFocus(focus.current);
    }).catch((e) => console.error('[avatar]', e)).finally(() => { loading = false; });
  }
  on('settings', paintAvatar);
  on('slots', paintAvatar);
  on('achievements', () => { const s = avName.querySelector('.s'); if (s) s.lastChild.textContent = `${state.achievements.totals.score.toLocaleString()}`; });
  window.p360.on('toast', (t) => {
    if (!stage || !t) return;
    if (t.kind === 'achievement') { wake(); stage.react('cheer'); }
    else if (t.kind === 'signin') { wake(); stage.react('wave'); }
  });
  function wake() { lastActivity = Date.now(); if (sleeping && stage) { sleeping = false; stage.sleep(false); stage.react('stretch'); } }
  onActivity(() => wake());
  setInterval(() => {
    if (stage && !sleeping && active && Date.now() - lastActivity > SLEEP_AFTER_MS) { sleeping = true; stage.sleep(true); }
  }, 5000);

  function render() {
    if (focus.current) focusKey = focus.current.dataset.key;
    const all = visibleGames();
    const recent = recentGames(5);
    const extra = all.filter((g) => !recent.includes(g)).sort((a, b) => (b.favorite - a.favorite) || (b.addedAt - a.addedAt));
    const picks = [...recent, ...extra].slice(0, 5);
    const spot = picks[0];

    for (const c of [...root.children]) if (c !== avEl) c.remove(); // the avatar's 3D view stays put
    if (!avEl.parentNode) root.append(avEl);
    let spotEl;
    if (spot) {
      spotEl = wideTile(spot, { kind: 'hero', cls: 'spot', sub: spot.lastPlayed ? `Last played ${fmtAgo(spot.lastPlayed).toLowerCase()} · ${fmtPlaytime(spot.playtime)}` : 'Ready to play' });
      spotEl.append(h('div.kicker', {}, spot.lastPlayed ? 'Continue playing' : 'Jump in'));
      const logo = !spot.systemId && artUrl(spot, 'logo'); // retro tiles compose their own logo
      if (logo) {
        const img = h('img.logo', { src: logo, alt: '' });
        img.onerror = () => img.remove();
        spotEl.append(img);
        spotEl.querySelector('.label .t').style.display = 'none';
      }
      spotEl._activate = () => launchGame(spot.id);
    } else {
      spotEl = quickTile({ title: 'Add your games', sub: 'Steam, Epic, GOG and Xbox games are found automatically. Add folders or emulators in System › Library.', icon: 'plus', c1: '#2f9a14', c2: '#0d3b0d' });
      spotEl.classList.add('spot');
      spotEl._activate = () => ctx.goto('system', { section: 'library' });
    }
    spotEl.dataset.key = 'spot';
    root.append(spotEl);

    const recentEl = h('div.recent');
    picks.slice(1, 5).forEach((g, i) => {
      const t = wideTile(g, { kind: 'banner', sub: g.lastPlayed ? fmtAgo(g.lastPlayed) : 'New' });
      t.dataset.key = `r${i}`;
      t._activate = () => launchGame(g.id);
      recentEl.append(t);
    });
    root.append(recentEl);

    const favs = all.filter((g) => g.favorite).length;
    const quick = h('div.quick');
    const q = [
      ['games', { title: 'My games', sub: `${all.length} games`, icon: 'grid', c1: '#3d8c1c', c2: '#123d0c' }, () => ctx.goto('games', { filter: 'all' })],
      ['favs', { title: 'Favorites', sub: `${favs} pinned`, icon: 'heart', c1: '#8c7a1c', c2: '#3a2f0a' }, () => ctx.goto('games', { filter: 'fav' })],
      ['media', { title: 'Media', sub: `${state.media.length} apps`, icon: 'film', c1: '#1c5a8c', c2: '#0a2236' }, () => ctx.goto('media')],
      ['market', { title: 'Marketplace', sub: 'Deals & free games', icon: 'star', c1: '#d9761a', c2: '#4a2208' }, () => ctx.goto('marketplace')],
      ['social', { title: 'Achievements', sub: `${state.achievements.totals.score.toLocaleString()}G`, icon: 'trophy', c1: '#5a3a8c', c2: '#1e1236' }, () => ctx.goto('social')],
      ['system', { title: 'Settings', sub: 'Console & library', icon: 'gear', c1: '#4a525b', c2: '#1a1d21' }, () => ctx.goto('system')],
    ];
    for (const [key, def, fn] of q) {
      const t = quickTile(def);
      t.dataset.key = key;
      t.classList.add('reflect');
      t._activate = fn;
      quick.append(t);
    }
    root.append(quick);
    ctx.setSub(recent.length ? '' : '');

    const again = focusKey && root.querySelector(`[data-key="${focusKey}"]`);
    if (again) focus.set(again);
    else focus.current = null;
  }

  return {
    id: 'home',
    label: 'home',
    accent: '#76b900',
    focus,
    mount(content) { content.append(root); render(); setTimeout(ensureStage, 1200); },
    activate() {
      active = true;
      ensureStage();
      if (stage) stage.resume();
      focus.ensure() || focus.first();
    },
    deactivate() { active = false; },
    refresh(what) { if (what === 'library' || what === 'media' || what === 'achievements') { render(); } },
    prompts() {
      const el = focus.current;
      if (el === avEl) return [{ btn: 'a', label: 'Edit avatar' }];
      const p = [{ btn: 'a', label: el && el.dataset.id ? 'Play' : 'Select' }];
      if (el && el.dataset.id) p.push({ btn: 'x', label: 'Game details' });
      return p;
    },
    handle(action) {
      if (['up', 'down', 'left', 'right'].includes(action)) { focus.handleDir(action); return true; }
      if (action === 'a') { if (focus.activate()) sound.play('select'); return true; }
      if (action === 'x' && focus.current && focus.current.dataset.id) { openDetails(focus.current.dataset.id, { toast: ctx.toast }); return true; }
      if (action === 'y') { ctx.goto('games', { search: true }); return true; }
      return false;
    },
  };
}
