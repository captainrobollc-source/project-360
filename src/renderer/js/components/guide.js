// The Guide: curved overlay summoned by the Xbox button / hotkey, over the dashboard
// or over a running game (overlay window).
import { h, artUrl, clamp } from '../util.js';
import { iconEl, avatar, icon } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { state, on, gameById, setting, recentGames } from '../store.js';
import { getRoot, button, confirm, claimLayer, releaseLayer } from './modal.js';
import { createRing, batteryEl, batteryText } from './ring.js';
import { coverTile } from './tiles.js';
import { isRunning as arcadeRunning, quitGame as quitArcade } from '../arcade/engine.js';
import { lastSlot, suppressHeld } from '../input.js';
import * as music from './music.js';

const ACTIVE = new Set(['launching', 'running', 'untracked']);
const clockText = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function createGuide({ mode, goto, toast, launch, signIn }) {
  let cur = null;

  function sessionText(st) {
    if (st.phase === 'launching') return 'Starting…';
    if (st.phase === 'untracked') return 'Running';
    const mins = Math.max(0, Math.round((Date.now() - (st.runningSince || Date.now())) / 60000));
    return `${st.kind === 'media' ? 'Open' : 'Playing'} · ${mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} hr ${mins % 60} min`}`;
  }

  const go = (blade) => {
    close({ notify: false });
    if (arcadeRunning()) quitArcade(); // the arcade sits on top of the blades: leave it to go there
    if (mode === 'overlay') window.p360.launcher.showDashboard(blade);
    else goto && goto(blade);
  };

  function padChips() {
    return h('div.pads', {}, ...state.pads.map((p) => h(`div.padchip${p.connected ? '.on' : ''}`, {},
      iconEl('controller'), h('span', {}, `P${p.slot + 1}`),
      p.connected ? batteryEl(p.battery) : h('span', {}, '—'),
      p.connected ? h('span', { style: { fontSize: '16px' } }, batteryText(p.battery)) : null)));
  }

  async function open(slot) {
    suppressHeld();
    const guideSlot = Number.isInteger(slot) ? slot : lastSlot;
    const mineSlot = (state.slots || []).find((x) => x.slot === guideSlot);
    if (cur) return;
    sound.play('guide');
    document.body.classList.add('guide-open');
    const root = getRoot();
    const scrim = h('div.scrim');
    const panel = h('div.guide');
    const z = claimLayer();
    scrim.style.zIndex = String(z - 1);
    panel.style.zIndex = String(z);
    root.append(scrim, panel);
    const focus = new nav.Focus(panel);
    const ring = createRing();
    const clock = h('div.clock', {}, clockText());
    const st = state.launcher;
    const game = ACTIVE.has(st.phase) ? (gameById(st.id) || { id: st.id, title: st.title, art: {} }) : null;
    const p = state.settings.profile || {};
    const unsigned = !!(mineSlot && !mineSlot.profileId && mineSlot.connected);

    panel.append(h('div.ghead', {}, avatar(p.avatar || 0), h('div', {},
      h('div.gt', {}, p.gamertag || 'Player'),
      h('div.gs', {}, h('span.gcoin', {}, 'G'), `${state.achievements.totals.score.toLocaleString()}`, game ? '  ·  In game' : '')), h('div.spacer'), clock, ring.el));
    ring.update(state.pads, state.activeSlot >= 0 ? state.activeSlot : guideSlot);

    const body = h('div.gbody', { 'data-scroll': '' });
    panel.append(body);
    let firstFocus = null;
    let sessionEl = null;

    if (game) {
      const coverUrl = artUrl(game, 'cover');
      sessionEl = h('div.s', {}, sessionText(st));
      const btns = h('div.btnrow');
      if (st.phase === 'running') btns.append(button(st.kind === 'media' ? 'Resume' : 'Resume game', { icon: 'play', onActivate: () => { close({ notify: false }); window.p360.launcher.resume(); } }));
      btns.append(button(st.kind === 'media' ? 'Close app' : 'Close game', { icon: 'close', danger: true, onActivate: () => forceClose(st) }));
      btns.append(button('Dashboard', { icon: 'home', onActivate: () => go('home') }));
      body.append(h('div.now', {}, h('div.cover', {}, coverUrl ? h('img', { src: coverUrl, alt: '' }) : null),
        h('div.meta', {}, h('div.t', {}, game.title), sessionEl, btns)));
      firstFocus = btns.firstChild;
      if (st.emulator === 'retroarch' && st.phase === 'running') {
        // Talks to RetroArch over its local command port; the game resumes on Save/Load.
        const cmd = (c, msg, resume = true) => async () => {
          try { await window.p360.emu.command(c); toast && toast({ title: msg, duration: 1800, sound: 'select' }); } catch { /* ignore */ }
          if (resume) { close({ notify: false }); window.p360.launcher.resume(); }
        };
        body.append(h('div.section-k', {}, 'Emulator'));
        body.append(h('div.btnrow', {},
          button('Save state', { icon: 'folder', onActivate: cmd('SAVE_STATE', 'State saved') }),
          button('Load state', { icon: 'restart', onActivate: cmd('LOAD_STATE', 'State loaded') }),
          button('Reset', { icon: 'power', onActivate: cmd('RESET', 'Game reset') }),
          button('Emulator menu', { icon: 'gear', onActivate: cmd('MENU_TOGGLE', 'RetroArch menu') })));
      }
    } else {
      const btns = h('div.btnrow', {},
        button('Home', { icon: 'home', onActivate: () => go('home') }),
        button('My games', { icon: 'grid', onActivate: () => go('games') }),
        button('Media', { icon: 'film', onActivate: () => go('media') }),
        button('Marketplace', { icon: 'star', onActivate: () => go('marketplace') }),
        button('Settings', { icon: 'gear', onActivate: () => go('system') }));
      body.append(btns);
      firstFocus = btns.firstChild;
      const recent = recentGames(5);
      if (recent.length && launch) {
        body.append(h('div.section-k', {}, 'Jump back in'));
        const row = h('div.recent');
        for (const g of recent) {
          const t = coverTile(g);
          t._activate = () => { close({ notify: false }); launch(g.id); };
          row.append(t);
        }
        body.append(row);
      }
    }

    // Music
    if (state.nowPlaying && state.nowPlaying.track) {
      const np = state.nowPlaying;
      const name = h('span.name', {}, `${np.track.title} — ${np.track.artist}`);
      const mrow = h('div.grow', { 'data-focus': '' }, h('div.k', {}, iconEl('music'), 'Music'), h('div.v', {}, h('span.ar', {}, '◀'), name, h('span.ar', {}, '▶')));
      mrow._activate = () => { music.toggle(); };
      mrow._adjust = (d) => { if (d > 0) music.next(); else music.prev(); sound.play('tick'); };
      body.append(mrow);
      const off = on('nowPlaying', (n) => { if (n && n.track) name.textContent = `${n.playing ? '' : '❚❚  '}${n.track.title} — ${n.track.artist}`; });
      panel._offs = [off];
    }

    // Volume
    const volFill = h('div.fill', { style: { width: '0%' } });
    const volKnob = h('div.knob', { style: { left: '0%' } });
    const volPct = h('div.pct', {}, '—');
    const volIcon = h('span', { style: { display: 'contents' } }, iconEl('volume'));
    const volRow = h('div.grow', { 'data-focus': '' }, h('div.k', {}, volIcon, 'Volume'),
      h('div.v', {}, h('span.ar', {}, '◀'), h('div.slider', {}, volFill, volKnob), h('span.ar', {}, '▶'), volPct));
    let vol = { volume: 0, muted: false };
    const paintVol = () => {
      const pc = Math.round(vol.volume * 100);
      volFill.style.width = `${vol.muted ? 0 : pc}%`;
      volKnob.style.left = `${vol.muted ? 0 : pc}%`;
      volPct.textContent = vol.muted ? 'Muted' : `${pc}%`;
      volIcon.replaceChildren(iconEl(vol.muted ? 'mute' : 'volume'));
    };
    let volSeq = 0;
    volRow._adjust = async (d) => {
      vol.volume = clamp(Math.round((vol.volume + d * 0.05) * 20) / 20, 0, 1);
      const wasMuted = vol.muted;
      vol.muted = false;
      paintVol();
      sound.play('tick');
      // Held RT/▶ sends many steps; only the newest response may update the knob.
      const mySeq = ++volSeq;
      const target = vol.volume;
      try {
        let res = await window.p360.system.volume('set', target);
        if (wasMuted || res.muted) res = await window.p360.system.volume('mute', false);
        if (mySeq === volSeq) { vol = res; paintVol(); }
      } catch { /* ignore */ }
    };
    volRow._activate = async () => { try { vol = await window.p360.system.volume('mute', !vol.muted); paintVol(); } catch { /* ignore */ } };
    body.append(volRow);
    window.p360.system.volume('get').then((v) => { vol = v; paintVol(); }).catch(() => { volPct.textContent = 'N/A'; });

    // Output device
    const outName = h('span.name', {}, 'Loading…');
    const outRow = h('div.grow', { 'data-focus': '' }, h('div.k', {}, iconEl('speaker'), 'Output'), h('div.v', {}, h('span.ar', {}, '◀'), outName, h('span.ar', {}, '▶')));
    let devices = [];
    const paintOut = () => { const d = devices.find((x) => x.default); outName.textContent = d ? d.name : devices.length ? 'Select a device' : 'No devices'; };
    outRow._adjust = async (d) => {
      if (devices.length < 2) return;
      const i = Math.max(0, devices.findIndex((x) => x.default));
      const nxt = devices[(i + d + devices.length) % devices.length];
      devices = devices.map((x) => ({ ...x, default: x.id === nxt.id }));
      paintOut();
      sound.play('tick');
      try { devices = await window.p360.system.setAudioDevice(nxt.id); paintOut(); } catch (e) { toast && toast({ title: 'Could not switch output', text: e.message, sound: 'error' }); }
    };
    outRow._activate = () => outRow._adjust(1);
    body.append(outRow);
    window.p360.system.audioDevices().then((d) => { devices = d; paintOut(); }).catch(() => { outName.textContent = 'Unavailable'; });

    // Players: one profile per controller, like the console.
    body.append(h('div.section-k', {}, 'Players'));
    const playersRow = h('div.players');
    const paintPlayers = () => {
      const focusedSlot = focus.current && playersRow.contains(focus.current) ? focus.current._slot : null;
      playersRow.replaceChildren();
      const slots = (state.slots || []).length ? state.slots : state.pads.filter((x) => x.connected).map((x) => ({ slot: x.slot, connected: true }));
      for (const sl of slots) {
        const pad = state.pads[sl.slot];
        const card = h(`div.player${sl.active ? '.active' : ''}${sl.profileId ? '' : '.empty'}`, { 'data-focus': '' },
          h('div.pnum', {}, `P${sl.slot + 1}`),
          sl.profileId ? avatar(sl.avatar || 0) : h('div.pplus', { html: icon('plus') }),
          h('div.ptx', {}, h('div.pn', {}, sl.profileId ? sl.gamertag : 'Sign in'), h('div.ps', {}, sl.profileId ? `${sl.score}G${sl.connected ? '' : ' · controller off'}` : 'Press A to choose a profile')),
          pad && pad.connected ? batteryEl(pad.battery) : null);
        card._activate = async () => {
          if (!signIn) return;
          if (!sl.profileId) { signInFromGuide(sl.slot); return; }
          const pick = await (await import('./modal.js')).menu({ title: `${sl.gamertag} · Player ${sl.slot + 1}`, items: [
            { label: 'Switch profile', value: 'switch', icon: 'user' },
            { label: 'Sign out', value: 'out', icon: 'close' },
          ] });
          if (pick === 'switch') signInFromGuide(sl.slot);
          if (pick === 'out') { await window.p360.profiles.signOut(sl.slot); }
        };
        card._slot = sl.slot;
        playersRow.append(card);
        if (focusedSlot === sl.slot) focus.set(card);
      }
      if (focusedSlot !== null && !playersRow.contains(focus.current)) { const f = playersRow.querySelector('[data-focus]'); if (f) focus.set(f); }
      if (!slots.length) playersRow.append(h('div.ps.none', {}, 'No controllers connected'));
    };
    paintPlayers();
    body.append(playersRow);
    let padsEl = h('div');

    body.append(h('div.section-k', {}, 'Power & profile'));
    body.append(h('div.power', {},
      button('Turn off', { icon: 'power', onActivate: () => power('shutdown', 'Turn off the console?', 'The PC will shut down. Running games will be closed.') }),
      button('Restart', { icon: 'restart', onActivate: () => power('restart', 'Restart the console?', 'Running games will be closed.') }),
      button('Sleep', { icon: 'sleep', onActivate: () => { close(); setTimeout(() => window.p360.system.power('sleep'), 400); } }),
      button('Exit to desktop', { icon: 'desktop', onActivate: () => power('desktop', 'Exit to the Windows desktop?', 'Project 360 will close and the Windows desktop will start.') })));
    if (unsigned && signIn) {
      // Guide pressed on a controller with nobody signed in: offer sign-in first.
      const b = button(`Sign in · Player ${guideSlot + 1}`, { icon: 'user', onActivate: () => signInFromGuide(guideSlot) });
      body.prepend(h('div.btnrow', {}, b));
      firstFocus = b;
    }

    const layer = {
      focus,
      prompts: () => {
        const pr = [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Close' }];
        if (focus.current && focus.current._adjust) pr.splice(1, 0, { btn: 'dpad', label: 'Adjust' });
        pr.push({ btn: ['lt', 'rt'], label: 'Volume', side: 'right' });
        return pr;
      },
      handle(action) {
        if (['up', 'down', 'left', 'right'].includes(action)) focus.handleDir(action);
        else if (action === 'a') { if (focus.activate()) sound.play('select'); }
        else if (action === 'b' || action === 'guide') close();
        else if (action === 'lt') volRow._adjust(-1);
        else if (action === 'rt') volRow._adjust(1);
        else if (action === 'y' && state.nowPlaying) music.toggle();
      },
    };
    nav.push(layer);
    focus.set(firstFocus || volRow);

    const timer = setInterval(() => { clock.textContent = clockText(); if (sessionEl) sessionEl.textContent = sessionText(state.launcher); }, 15000);
    const unsubPads = on('pads', () => { ring.update(state.pads, state.activeSlot >= 0 ? state.activeSlot : lastSlot); });
    const unsubSlots = on('slots', () => { paintPlayers(); ring.update(state.pads, state.activeSlot >= 0 ? state.activeSlot : lastSlot); });
    const unsubLauncher = on('launcher', (s) => { if (game && s.phase === 'idle') close({ notify: false }); });
    cur = { panel, scrim, layer, timer, z, unsub: () => { unsubPads(); unsubSlots(); unsubLauncher(); (panel._offs || []).forEach((f) => f()); } };
    requestAnimationFrame(() => requestAnimationFrame(() => { panel.classList.add('in'); scrim.classList.add('in'); }));
  }

  async function forceClose(st) {
    const ok = await confirm({
      title: `Close ${st.title}?`,
      text: st.kind === 'media' ? 'The app will be closed.' : 'The game will be closed. Unsaved progress may be lost.',
      buttons: [{ label: st.kind === 'media' ? 'Close app' : 'Close game', value: true, danger: true, icon: 'close' }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    sound.play('back');
    await window.p360.launcher.forceClose();
  }

  async function power(action, title, text) {
    const labels = { restart: 'Restart', shutdown: 'Turn off', desktop: 'Exit to desktop' };
    const ok = await confirm({ title, text, buttons: [{ label: labels[action], value: true, danger: action !== 'desktop' }, { label: 'Cancel', value: false }] });
    if (!ok) return;
    close({ notify: false });
    window.p360.system.power(action);
  }

  // Sign-in replaces the Guide. In the in-game overlay, give input back to the game once it's
  // done (or cancelled), unless the Guide was opened again meanwhile.
  function signInFromGuide(slot) {
    close({ notify: false });
    Promise.resolve(signIn(slot)).catch(() => {}).finally(() => {
      if (mode === 'overlay' && !cur) window.p360.overlay.guideClosed();
    });
  }

  function close({ notify = true } = {}) {
    if (!cur) return;
    const c = cur;
    cur = null;
    clearInterval(c.timer);
    c.unsub();
    while (nav.top() && nav.top() !== c.layer && nav.depth() > 0) {
      const t = nav.top();
      if (t.handle) t.handle('b'); else break;
      if (nav.top() === t) break;
    }
    nav.pop(c.layer);
    releaseLayer(c.z);
    document.body.classList.remove('guide-open');
    sound.play('back');
    c.panel.classList.remove('in');
    c.scrim.classList.remove('in');
    setTimeout(() => { c.panel.remove(); c.scrim.remove(); }, 380);
    if (mode === 'overlay' && notify) window.p360.overlay.guideClosed();
  }

  return { open, close, toggle(slot) { if (cur) close(); else open(slot); }, get isOpen() { return !!cur; } };
}

export { icon };
