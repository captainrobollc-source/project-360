// Renderer entry. Same bundle runs as the dashboard and as the transparent in-game overlay.
import { h } from './util.js';
import * as store from './store.js';
import * as input from './input.js';
import * as nav from './nav.js';
import * as sound from './sound.js';
import * as theme from './theme.js';
import { setRoot } from './components/modal.js';
import { createToasts } from './components/toast.js';
import { createGuide } from './components/guide.js';
import { setToast, onLauncherState, hideSplash, onReveal, launchGame } from './components/launch.js';
import { createDashboard } from './dashboard.js';
import { initArcadeArt } from './arcade/index.js';
import { playBoot, signIn, runSetup, createSaver } from './screens.js';

const mode = new URLSearchParams(location.search).get('mode') || 'dashboard';

// Renderer errors go to the main log (System › Console info).
window.addEventListener('error', (e) => { try { window.p360.logs.error(`${mode}: ${e.message} @ ${e.filename}:${e.lineno}`); } catch { /* ignore */ } });
window.addEventListener('unhandledrejection', (e) => { try { window.p360.logs.error(`${mode}: unhandled rejection ${e.reason && e.reason.stack ? e.reason.stack : e.reason}`); } catch { /* ignore */ } });
document.body.classList.add(`mode-${mode}`);

const stage = document.getElementById('stage');
function fit() {
  // #stage sits at 50%/50% with origin 0 0; scale, then pull back by half the scaled size.
  const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  stage.style.transform = `translate(${-960 * s}px, ${-540 * s}px) scale(${s})`;
}
window.addEventListener('resize', fit);
fit();

async function boot() {
  const init = await window.p360.init(mode);
  for (const [k, v] of Object.entries(init)) store.state[k] = v;
  store.state.mode = mode;
  theme.init();

  sound.configure({ enabled: store.setting('audio.uiSounds'), volume: store.setting('audio.uiVolume') });
  const pack = init.soundPacks.find((p) => p.name === store.setting('audio.soundPack'));
  if (pack) sound.loadPack(pack);

  setRoot(stage);
  input.init();
  nav.initMouse();

  const toasts = createToasts(stage, { onIdle: () => { if (mode === 'overlay') window.p360.overlay.toastsIdle(); } });
  const toast = (t) => toasts.show(t);
  setToast(toast);

  let dashboard = null;
  let saver = null;
  const doSignIn = (slot) => signIn({ allowCancel: true, slot: slot ?? input.lastSlot });
  // In the overlay the launch cover can't live in this window: the dashboard launches instead.
  const launchVia = mode === 'overlay' ? (id) => window.p360.launcher.launchFromDashboard(id) : (id) => launchGame(id);
  const guide = createGuide({ mode, goto: (id) => dashboard && dashboard.goto(id), toast, launch: launchVia, signIn: doSignIn });

  input.setHandler((action, info) => {
    if (saver && saver.poke()) return; // input only woke the screen
    // Home key / a DirectInput pad's Home button: same as the Xbox button, over any dialog.
    if (action === 'guide' && mode !== 'overlay' && dashboard) { guide.toggle(info && info.slot); return; }
    nav.dispatch(action, info);
  });

  // ---- live updates from main
  window.p360.on('debug:action', (a) => nav.dispatch(a, { slot: 0, device: 'keyboard' }));
  window.p360.on('native:ready', (info) => { store.state.native = info; });
  window.p360.on('profiles:slots', (d) => {
    store.state.activeSlot = d.activeSlot;
    if (d.activeSlot !== input.lastSlot) input.resetActivity(); // the next press re-claims the dashboard
    store.set('slots', d.slots);
  });
  window.p360.on('toast', (t) => toast(t));
  window.p360.on('toast:record', (t) => toasts.record(t));
  window.p360.on('library:updated', (lib) => store.set('library', lib));
  window.p360.on('pads', (p) => store.set('pads', p));
  window.p360.on('settings:updated', (s) => store.set('settings', s));
  window.p360.on('media:updated', (m) => store.set('media', m));
  window.p360.on('achievements:updated', (a) => store.set('achievements', a));
  window.p360.on('launcher:state', (st) => {
    store.set('launcher', st);
    if (mode !== 'overlay') onLauncherState(st);
  });
  window.p360.on('app:suspend', (s) => {
    store.state.suspended = s;
    document.body.classList.toggle('suspended', s);
    input.releaseAll();
    if (s) { if (saver) saver.hide(); if (guide.isOpen) guide.close({ notify: false }); }
    else hideSplash();
    if (saver) saver.poke();
  });

  if (mode === 'overlay') {
    const prompts = h('div.prompts.overlay-prompts');
    stage.append(prompts);
    nav.mountPrompts(prompts);
    nav.push({ prompts: () => [], handle(action) { if (action === 'guide') guide.open(); } });
    const style = document.createElement('style');
    style.textContent = '.overlay-prompts{z-index:85;opacity:0;transition:opacity .25s}.guide-open .overlay-prompts{opacity:1}';
    document.head.append(style);
    window.p360.on('guide:open', (d) => guide.open(d && d.slot));
    window.p360.on('guide:close', () => {
      guide.close({ notify: false });
      for (let i = 0; i < 8 && nav.depth() > 1; i++) {
        const t = nav.top();
        if (t.handle) t.handle('b', { device: 'system' });
        if (nav.top() === t) nav.pop(t); // a layer that won't close on B still stops taking input
      }
    });
  } else {
    const first = !init.signedIn;
    if (first && store.setting('console.bootAnimation')) document.body.classList.add('entering');
    initArcadeArt(); // built-in games draw their own library art
    dashboard = createDashboard(stage, { toast, guide, signIn: doSignIn });
    stage.querySelector('.prompts').style.zIndex = 85;
    window.p360.on('guide:toggle', (d) => { if (saver && saver.poke()) return; guide.toggle(d && d.slot); }); // first press only wakes the screen
    window.p360.on('launch:reveal', () => onReveal());
    window.p360.on('launch:game', (id) => launchGame(id));
    window.p360.on('profiles:signedOut', (d) => signIn({ allowCancel: false, slot: d && d.slot !== undefined ? d.slot : input.lastSlot }));

    if (first) {
      if (store.setting('console.bootAnimation')) {
        await playBoot(stage);
        document.body.classList.remove('entering');
        dashboard.enter();
      }
      if (!store.setting('console.setupDone')) await runSetup(stage, { toast });
      const profiles = await window.p360.profiles.list();
      if (profiles.length > 1 || store.setting('console.askProfile')) await signIn({ allowCancel: false });
      else store.set('settings', await window.p360.profiles.signIn(profiles[0].id, input.lastSlot));
    }
    saver = createSaver(stage);
    let mx = -1, my = -1;
    document.addEventListener('mousemove', (e) => {
      if (e.screenX === mx && e.screenY === my) return; // synthetic moves from layout changes
      mx = e.screenX; my = e.screenY;
      saver.poke();
    }, { passive: true });
    document.addEventListener('click', (e) => { if (saver.poke()) { e.stopPropagation(); e.preventDefault(); } }, true);
    document.addEventListener('wheel', () => saver.poke(), { passive: true });
  }

  store.on('settings', (s) => {
    sound.configure({ enabled: s.audio.uiSounds, volume: s.audio.uiVolume });
    const want = s.audio.soundPack || 'default';
    if (want !== sound.currentPack()) sound.loadPack((store.state.soundPacks || []).find((p) => p.name === want) || null);
  });
}

boot().catch((e) => {
  console.error(e);
  stage.append(h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', fontSize: '28px', color: '#fff' } }, `Project 360 failed to start: ${e.message}`));
});
