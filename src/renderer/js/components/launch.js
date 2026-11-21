// Launch cover: full-screen splash that stays above store launchers and Windows pop-ups
// until the real game window is up, then fades to black and steps aside.
import { h, artUrl } from '../util.js';
import { orb } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { gameById, state, setting } from '../store.js';
import { getRoot } from './modal.js';
import * as music from './music.js';

let splash = null;
let musicPaused = false;
let inFlight = false; // one launch at a time, even if A is pressed twice
let toastFn = () => {};
export function setToast(fn) { toastFn = fn; }

const LAUNCHER_NAME = { 'steam.exe': 'Steam', 'steamwebhelper.exe': 'Steam', 'EpicGamesLauncher.exe': 'Epic Games', 'EpicWebHelper.exe': 'Epic Games', 'GalaxyClient.exe': 'GOG Galaxy', 'EADesktop.exe': 'EA app', 'UbisoftConnect.exe': 'Ubisoft Connect', 'upc.exe': 'Ubisoft Connect', 'Battle.net.exe': 'Battle.net' };

function showSplash(item) {
  hideSplash(true);
  const bg = h('div.bg');
  const hero = artUrl(item, 'hero') || artUrl(item, 'banner') || artUrl(item, 'cover');
  if (hero) bg.style.backgroundImage = `url("${hero}")`;
  const coverUrl = artUrl(item, 'cover');
  const cover = h('div.cover', {}, coverUrl ? h('img', { src: coverUrl, alt: '' }) : null);
  if (!coverUrl && item.color) cover.style.background = item.color;
  const status = h('span', {}, 'Loading…');
  const attention = h('div.attention', { style: { display: 'none' } });
  const hint = h('div.lhint', {}, ...nav.promptRow([{ btn: 'b', label: 'Back to dashboard' }]));
  const el = h('div.launch', {}, bg,
    h('div.center', {}, cover, h('div', {}, h('div.lt', {}, item.title), h('div.ls', {}, orb('fast'), status))),
    h('div.lbar', {}, h('i')), attention, hint, h('div.blackout'));
  getRoot().append(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
  const layer = {
    prompts: () => (splash && splash.att ? [{ btn: 'a', label: 'Show it' }, { btn: 'b', label: 'Back to dashboard' }] : [{ btn: 'b', label: 'Back to dashboard' }]),
    handle(action) {
      if (action === 'a' && splash && splash.att) { sound.play('select'); window.p360.launcher.showAttention(); }
      if (action === 'b') { sound.play('back'); window.p360.launcher.detach(); hideSplash(); }
    },
  };
  nav.push(layer);
  splash = { el, layer, status, attention, hint, id: item.id, att: null };
  if (!setting('audio.musicInGames') && music.isPlaying()) { music.pause(); musicPaused = true; }
}

export function hideSplash(immediate = false) {
  if (!splash) return;
  const s = splash;
  splash = null;
  nav.pop(s.layer);
  s.el.classList.remove('in');
  setTimeout(() => s.el.remove(), immediate ? 0 : 450);
}

export async function launchGame(id) {
  const g = gameById(id);
  if (!g) return;
  if (state.launcher.phase !== 'idle') {
    toastFn({ title: `${state.launcher.title} is running`, text: 'Close it from the Guide first', sound: 'error' });
    return;
  }
  if (inFlight) return;
  inFlight = true;
  sound.play('launch');
  showSplash(g);
  try { await window.p360.library.launch(id); }
  catch (e) {
    hideSplash();
    const need = /NEEDS_EMULATOR:(\w+)/.exec(e.message);
    if (need) offerEmulator(need[1], g);
    else toastFn({ title: `Couldn't start ${g.title}`, text: e.message, sound: 'error' });
  }
  finally { setTimeout(() => { inFlight = false; }, 1500); }
}

async function offerEmulator(emuId, game) {
  let st = null;
  try { st = await window.p360.emu.status(); } catch { /* ignore */ }
  const e = st && st.emulators.find((x) => x.id === emuId);
  if (!e) return toastFn({ title: `Couldn't start ${game.title}`, text: 'Emulator unavailable', sound: 'error' });
  const { confirm } = await import('./modal.js');
  const ok = await confirm({
    title: `${game.platform || 'This game'} needs ${e.name}`,
    text: `${e.about}

Install the official ${e.name} build from ${e.site}? It’s set up for your controller automatically, then ${game.title} starts.`,
    buttons: [{ label: `Install ${e.name} and play`, value: true, icon: 'play' }, { label: 'Not now', value: false }],
  });
  if (!ok) return;
  toastFn({ kind: 'orb', icon: 'folder', title: `Installing ${e.name}…`, text: 'This only happens once', duration: 4000 });
  try { await window.p360.emu.install(emuId); }
  catch (err) { return toastFn({ title: `Couldn't install ${e.name}`, text: err.message, sound: 'error' }); }
  inFlight = false;
  launchGame(game.id);
}

export async function launchMedia(item) {
  if (state.launcher.phase !== 'idle') {
    toastFn({ title: `${state.launcher.title} is running`, text: 'Close it from the Guide first', sound: 'error' });
    return;
  }
  if (inFlight) return;
  inFlight = true;
  sound.play('launch');
  showSplash(item);
  try { await window.p360.media.launch(item.id); }
  catch (e) { hideSplash(); toastFn({ title: `Couldn't open ${item.title}`, text: e.message, sound: 'error' }); }
  finally { setTimeout(() => { inFlight = false; }, 1500); }
}

export async function openWeb(item) {
  if (state.launcher.phase !== 'idle') {
    toastFn({ title: `${state.launcher.title} is running`, text: 'Close it from the Guide first', sound: 'error' });
    return;
  }
  sound.play('launch');
  showSplash({ id: item.id, title: item.title, art: {}, color: '#1b2a17' });
  try { await window.p360.media.openWeb(item); }
  catch (e) { hideSplash(); toastFn({ title: `Couldn't open ${item.title}`, text: e.message, sound: 'error' }); }
}

export function onReveal() { if (splash) splash.el.classList.add('reveal'); }

export function onLauncherState(st) {
  if (st.phase === 'idle') {
    if (musicPaused) { musicPaused = false; music.resume(); }
    return hideSplash();
  }
  if (!splash) return;
  if (st.phase === 'running') splash.status.textContent = st.kind === 'media' ? 'Opening…' : 'Starting game…';
  if (st.phase === 'untracked') splash.status.textContent = 'Still waiting for the game…';
  const att = st.attention;
  splash.att = att;
  if (att) {
    const who = LAUNCHER_NAME[att.exe] || 'The launcher';
    const msg = att.updating ? `${who} is open — it may be updating or signing in.` : `${who} needs your attention: “${att.title}”`;
    splash.attention.replaceChildren(h('span', {}, msg), ...nav.promptRow([{ btn: 'a', label: 'Show it' }]));
    splash.attention.style.display = '';
  } else splash.attention.style.display = 'none';
  nav.refreshPrompts();
}
