// System blade: settings, themes, library, artwork, web & media, audio, controllers,
// storage, network test, console info, power & shell.
import { h, clamp } from '../util.js';
import * as sound from '../sound.js';
import { state, setting, saveSetting, set as setState, track } from '../store.js';
import { confirm, osk, button, menu } from '../components/modal.js';
import { addDevice, joinWifi, listenForPairing, bars, KIND_LABEL } from '../components/devices.js';
import { batteryEl, batteryText } from '../components/ring.js';
import { createSplit } from './split.js';
import { revealInScroller } from '../nav.js';
import { THEMES, BACKGROUNDS } from '../theme.js';

// ------------------------------------------------------------------ row builders
function row(k, d, right, cls = '') {
  const focusable = cls !== 'info';
  // A stable key per row: a background re-render (Wi-Fi rescan, battery refresh) keeps focus on
  // the same row instead of whatever lands at the same position.
  return h(`div.row${cls ? '.' + cls : ''}`, { 'data-focus': focusable ? '' : null, 'data-key': focusable ? `row:${k}` : null }, h('div.txt', {}, h('div.k', {}, k), d ? h('div.d', {}, d) : null), right);
}
function toggleRow(k, d, get, setter) {
  const t = h('div.toggle');
  const paint = () => t.classList.toggle('on', !!get());
  paint();
  const r = row(k, d, t);
  r._activate = async () => { await setter(!get()); paint(); };
  r._paint = paint;
  return r;
}
const settingToggle = (k, d, path, after) => toggleRow(k, d, () => setting(path), async (v) => { await saveSetting(path, v); if (after) after(v); });
function selectRow(k, d, options, get, setter) {
  const val = h('div.val');
  const paint = () => { const o = options().find((x) => x.value === get()); val.textContent = o ? o.label : String(get() ?? '—'); };
  paint();
  const r = row(k, d, h('div.arrows', {}, h('span.ar', {}, '◀'), val, h('span.ar', {}, '▶')));
  r._adjust = async (dir) => {
    const opts = options();
    if (!opts.length) return;
    const i = Math.max(0, opts.findIndex((o) => o.value === get()));
    sound.play('tick');
    await setter(opts[(i + dir + opts.length) % opts.length].value);
    paint();
  };
  r._activate = () => r._adjust(1);
  r._paint = paint;
  return r;
}
function sliderRow(k, d, get, setter, { step = 0.1, fmt = (v) => `${Math.round(v * 100)}%` } = {}) {
  const fill = h('div.fill'), knob = h('div.knob'), pct = h('div.val', { style: { width: '80px' } });
  const paint = () => { const v = get() ?? 0; fill.style.width = `${v * 100}%`; knob.style.left = `${v * 100}%`; pct.textContent = fmt(v); };
  paint();
  const r = row(k, d, h('div.arrows', {}, h('span.ar', {}, '◀'), h('div.slider', {}, fill, knob), h('span.ar', {}, '▶'), pct));
  r._adjust = async (dir) => { await setter(clamp(Math.round(((get() ?? 0) + dir * step) * 100) / 100, 0, 1)); paint(); sound.play('tick'); };
  r._paint = paint;
  return r;
}
function actionRow(k, d, fn, valText = '') { const r = row(k, d, h('div.val', {}, valText || '›')); r._activate = fn; return r; }
function textRow(k, d, path, { secret = false } = {}) {
  const val = h('div.val');
  const paint = () => { const v = setting(path) || ''; val.textContent = !v ? 'Not set' : secret ? `••••••••${v.slice(-4)}` : v; };
  paint();
  const r = row(k, d, val);
  r._activate = async () => { const v = await osk({ title: k, value: setting(path) || '', maxLength: 200 }); if (v === null) return; await saveSetting(path, v.trim()); paint(); };
  return r;
}
const info = (k, d, v) => row(k, d, v ? h('div.val', {}, v) : null, 'info');
// "L 80% · R 90% · Case 40% ⚡" for AirPods; "Battery 70%" for other headsets.
function headsetBattery(b) {
  if (!b) return '';
  const pct = (n, charging) => `${n}%${charging ? ' ⚡' : ''}`;
  const parts = [];
  if (b.left != null && b.right != null && b.left === b.right && !!b.chargingLeft === !!b.chargingRight) parts.push(`Buds ${pct(b.left, b.chargingLeft)}`);
  else {
    if (b.left != null) parts.push(`L ${pct(b.left, b.chargingLeft)}`);
    if (b.right != null) parts.push(`R ${pct(b.right, b.chargingRight)}`);
  }
  if (b.case != null) parts.push(`Case ${pct(b.case, b.chargingCase)}`);
  if (!parts.length && b.level != null) parts.push(`Battery ${b.level}%`);
  return parts.join(' · ');
}
const gb = (n) => (n == null ? '—' : n >= 1e12 ? `${(n / 1e12).toFixed(2)} TB` : `${(n / 1e9).toFixed(1)} GB`);

export function systemBlade(ctx) {
  let wifiCache = null;   // { at, data } from the last Wi-Fi scan
  let wifiScanning = false;
  let joining = false; // a Wi-Fi connect is in progress
  let btConnecting = null; // { id, on } while a Bluetooth connect/disconnect is in progress
  let btPoll = null; // keeps battery levels fresh while System › Bluetooth is open
  let bladeActive = false;
  let updateBusy = false; // an update check/download is running
  let netTest = { running: false, res: null }; // last connection test, kept across re-renders
  const SECTIONS = [
    ['console', 'Console', 'tv'], ['themes', 'Themes', 'image'], ['library', 'Library', 'grid'], ['artwork', 'Artwork', 'star'],
    ['web', 'Web & media', 'globe'], ['audio', 'Audio', 'volume'], ['controllers', 'Controllers', 'controller'],
    ['storage', 'Storage', 'folder'], ['network', 'Network', 'wifi'], ['bluetooth', 'Bluetooth', 'bluetooth'], ['info', 'Console info', 'info'], ['updates', 'Updates', 'restart'], ['backup', 'Backup & restore', 'shield'], ['power', 'Power & shell', 'power'],
  ];

  const B = {
    console: () => [
      settingToggle('Start with Windows', 'Launch Project 360 automatically when you sign in.', 'console.startWithWindows'),
      settingToggle('Full-screen kiosk mode', 'Borderless full screen that covers the taskbar.', 'console.kiosk'),
      settingToggle('Hide the Windows taskbar', 'Keeps the taskbar out of sight while Project 360 runs. It comes back when you exit to the desktop.', 'console.hideTaskbar'),
      settingToggle('Hide Windows pop-ups', 'Keeps store launchers, update prompts and other windows behind the dashboard and the launch screen.', 'console.coverPopups'),
      settingToggle('Boot animation', 'Play the startup sequence when the console starts.', 'console.bootAnimation'),
      selectRow('Screen saver', 'Dim the dashboard after a period of inactivity.', () => [0, 5, 10, 20, 30].map((m) => ({ value: m, label: m ? `${m} minutes` : 'Off' })), () => setting('console.screensaverMin') ?? 10, (v) => saveSetting('console.screensaverMin', v)),
      settingToggle('Hide mouse cursor', 'Hide the cursor 2 seconds after controller input.', 'console.hideCursor'),
      settingToggle('Back + Start opens the Guide', 'Hold both for a moment. Handy for pads without a Guide button.', 'console.backStartGuide'),
      selectRow('Guide keyboard shortcut', 'Global hotkey that opens the Guide, even in games.',
        () => ['Alt+G', 'Control+Alt+G', 'F10', 'Control+Shift+Home', ''].map((v) => ({ value: v, label: v ? v.replace('Control', 'Ctrl') : 'Off' })),
        () => setting('console.guideHotkey'), (v) => saveSetting('console.guideHotkey', v)),
      actionRow('Run initial setup again', 'Profile, Xbox button, web apps, theme.', async () => { await saveSetting('console.setupDone', false); window.p360.app.relaunch(); }),
      actionRow('Restart dashboard', 'Reload Project 360.', () => window.p360.app.relaunch()),
    ],

    themes: () => {
      const grid = h('div.tilegrid', { style: { marginBottom: '26px' } });
      for (const t of THEMES) {
        const sw = h(`div.theme-swatch${setting('theme.name') === t.id ? '.current' : ''}`, { 'data-focus': '' },
          h('div.sw-bg', { style: { background: t.bg } }), h('div.sw-blade', { style: { background: t.blade, boxShadow: '-8px 0 20px rgba(0,0,0,.5)' } }),
          h('div.sw-name', {}, t.name), h('div.sw-check', {}, '✓'));
        sw._activate = async () => { await saveSetting('theme.name', t.id); track('theme'); split.rerender(); };
        grid.append(sw);
      }
      return [h('div.lead', {}, 'Choose a dashboard theme.'), grid,
        selectRow('Background', 'Use the theme’s artwork, or the art of the game you played last.', () => BACKGROUNDS.map((b) => ({ value: b.id, label: b.name })), () => setting('theme.background') || 'default', (v) => saveSetting('theme.background', v))];
    },

    library: () => {
      const lib = setting('library') || {};
      const rows = [
        settingToggle('Steam', 'libraryfolders.vdf + app manifests', 'library.steam'),
        settingToggle('Epic Games Store', 'Launcher install manifests', 'library.epic'),
        settingToggle('GOG Galaxy', 'Installed GOG games', 'library.gog'),
        settingToggle('Xbox app / PC Game Pass', 'Packaged games with MicrosoftGame.config', 'library.xbox'),
        settingToggle('Local folders & emulators', 'Shortcut folders, added programs and ROMs', 'library.custom'),
        settingToggle('Show hidden games', null, 'library.showHidden'),
        actionRow('Rescan now', `${state.library.length} games in library`, async () => { ctx.toast({ title: 'Scanning library…', duration: 2200 }); const r = await window.p360.library.rescan(); if (r) ctx.toast({ title: 'Library updated', text: `${r.total} games`, sound: 'select' }); }),
        actionRow('Add a game…', 'Pick an .exe, shortcut (.lnk) or .url file.', async () => { const p = await window.p360.library.addGame(); if (p) ctx.toast({ title: 'Game added', text: p.split('\\').pop() }); }),
        actionRow('Add a games folder…', 'Every shortcut/.exe in the folder becomes a game.', () => window.p360.library.addFolder('games')),
      ];
      for (const f of lib.customFolders || []) {
        rows.push(actionRow(f, 'Games folder · A to remove', async () => {
          if (await confirm({ title: 'Remove this folder?', text: f, buttons: [{ label: 'Remove', value: true, danger: true }, { label: 'Cancel', value: false }] }))
            await saveSetting('library.customFolders', (setting('library.customFolders') || []).filter((x) => x !== f));
        }, '✕'));
      }
      for (const m of lib.manualGames || []) {
        rows.push(actionRow(m.title || m.target.split('\\').pop(), 'Added program · A to remove', async () => {
          if (await confirm({ title: 'Remove this program?', text: m.target, buttons: [{ label: 'Remove', value: true, danger: true }, { label: 'Cancel', value: false }] }))
            await saveSetting('library.manualGames', (setting('library.manualGames') || []).filter((x) => x.target !== m.target));
        }, '✕'));
      }
      rows.push(info('Emulators', `${(lib.emulators || []).length} configured. Add emulator profiles to settings.json (see README); set "libretroSystem" for automatic box art.`));
      return rows;
    },

    artwork: () => [
      info('Artwork', 'Art comes from Steam, Epic, GOG and the Microsoft Store automatically — no keys needed. For anything unusual, press X on a game › Change artwork. Optional keys add even more sources.'),
      actionRow('Download missing artwork', null, async () => { await window.p360.library.fetchMissingArt(); ctx.toast({ title: 'Fetching artwork…', duration: 2400 }); }),
      actionRow('Re-download all artwork', 'Clears the art cache and fetches everything again.', async () => {
        if (await confirm({ title: 'Re-download all artwork?', text: 'The cache is cleared and art reappears as it downloads.', buttons: [{ label: 'Re-download', value: true }, { label: 'Cancel', value: false }] })) await window.p360.library.clearArt();
      }),
      textRow('SteamGridDB API key', 'Optional · steamgriddb.com › Preferences › API', 'art.steamGridDbKey', { secret: true }),
      textRow('IGDB client ID', 'Optional · Twitch developer app', 'art.igdbClientId'),
      textRow('IGDB client secret', 'Optional', 'art.igdbClientSecret', { secret: true }),
    ],

    web: () => {
      const b = state.browsers || {};
      const opts = [{ value: 'auto', label: b.firefox ? 'Automatic (Firefox)' : 'Automatic (Edge)' }];
      if (b.firefox) opts.push({ value: 'firefox', label: 'Firefox — your profile' });
      if (b.edge) opts.push({ value: 'edge', label: 'Edge — kiosk profile' });
      const folders = setting('media.folders') || {};
      return [
        selectRow('Web app browser', b.firefox ? 'Firefox uses your normal profile: sign-ins, bookmarks and add-ons like uBlock Origin.' : 'Install Firefox to use your own sign-ins and add-ons.', () => opts, () => setting('media.browser') || 'auto', (v) => saveSetting('media.browser', v)),
        info('Controller in web apps', 'Left stick: pointer · A: click · X: right-click · B: back · Right stick: scroll · D-pad: arrows · Y: play/pause · LB/RB: tab · Start: enter · Back: esc · R3: full screen'),
        settingToggle('Keep music playing in games', 'Otherwise music pauses when a game starts and resumes after.', 'audio.musicInGames'),
        actionRow('Add a music folder…', (folders.music || []).join(' · ') || 'Your Music folder is included automatically.', () => window.p360.library.addFolder('music')),
        actionRow('Add a pictures folder…', (folders.pictures || []).join(' · ') || 'Steam screenshots, Game Bar captures and Pictures are included.', () => window.p360.library.addFolder('pictures')),
        actionRow('Add a videos folder…', (folders.videos || []).join(' · ') || 'Your Videos folder and captures are included.', () => window.p360.library.addFolder('videos')),
      ];
    },

    audio: () => {
      const vol = { volume: 0, muted: false };
      let devices = [];
      const sysVol = sliderRow('System volume', null, () => vol.volume, async (v) => { vol.volume = v; try { Object.assign(vol, await window.p360.system.volume('set', v)); } catch { /* ignore */ } }, { step: 0.05, fmt: (v) => (vol.muted ? 'Muted' : `${Math.round(v * 100)}%`) });
      const mute = toggleRow('Mute', null, () => vol.muted, async (v) => { Object.assign(vol, await window.p360.system.volume('mute', v)); sysVol._paint(); });
      const out = selectRow('Output device', 'Switches the Windows default playback device.', () => devices.map((d) => ({ value: d.id, label: d.name })), () => (devices.find((d) => d.default) || {}).id, async (id) => { devices = await window.p360.system.setAudioDevice(id); });
      window.p360.system.volume('get').then((v) => { Object.assign(vol, v); sysVol._paint(); mute._paint(); }).catch(() => {});
      window.p360.system.audioDevices().then((d) => { devices = d; out._paint(); }).catch(() => {});
      return [
        sysVol, mute, out,
        settingToggle('UI sounds', 'Blade swooshes, ticks, chimes.', 'audio.uiSounds', (v) => sound.configure({ enabled: v })),
        sliderRow('UI sound volume', null, () => setting('audio.uiVolume'), async (v) => { await saveSetting('audio.uiVolume', v); sound.configure({ volume: v }); }),
        selectRow('Sound pack', 'Drop .wav/.ogg packs into the sounds folder.', () => [{ value: 'default', label: 'Built-in' }, ...state.soundPacks.map((p) => ({ value: p.name, label: p.name }))],
          () => setting('audio.soundPack') || 'default', async (v) => { await saveSetting('audio.soundPack', v); await sound.loadPack(state.soundPacks.find((p) => p.name === v)); sound.play('select'); }),
        actionRow('Open sound packs folder', 'Files: blade, tick, select, back, guide, toast, error, launch, achievement, boot, signin.', async () => { await window.p360.system.openSoundsFolder(); setState('soundPacks', await window.p360.system.soundPacks()); }),
      ];
    },

    controllers: () => {
      const gbRow = toggleRow('Xbox button opens the Guide', 'Turns off Windows’ “Open Xbox Game Bar using this button”, so the button belongs to Project 360.', () => state.gameBarFree, async (v) => {
        try { const on = await window.p360.system.gameBar(!v); state.gameBarFree = !on; ctx.toast({ title: v ? 'Xbox button opens the Guide' : 'Xbox button opens Game Bar', sound: 'select' }); } catch (e) { ctx.toast({ title: 'Could not change it', text: e.message, sound: 'error' }); }
      });
      window.p360.system.gameBar().then((on) => { state.gameBarFree = !on; gbRow._paint(); }).catch(() => {});
      const rows = [gbRow];
      for (const p of state.pads) {
        const right = p.connected ? h('div.arrows', {}, batteryEl(p.battery), h('div.val', {}, batteryText(p.battery))) : h('div.val', {}, 'Not connected');
        const r = row(`Player ${p.slot + 1}`, p.connected ? 'XInput controller · A to test rumble' : null, right);
        r._activate = () => { if (p.connected) window.p360.system.rumble(p.slot, 40000, 40000, 300); };
        rows.push(r);
      }
      rows.push(info('PlayStation & other controllers', 'DirectInput pads work on the dashboard; the PS button opens the Guide in games.'));
      rows.push(info('Steam Input', 'If Steam opens Big Picture when you press the Xbox button, turn off Steam › Settings › Controller › “Guide Button Focuses Steam”.'));
      return rows;
    },

    storage: async () => {
      let drives = [];
      try { drives = await window.p360.system.storage(); } catch { /* ignore */ }
      if (!drives.length) return [info('Storage', 'Drive information is unavailable.')];
      const out = [];
      for (const d of drives) {
        const used = d.total - d.free;
        const games = d.gamesSize || (d.games || []).reduce((s, g) => s + (g.size || 0), 0);
        const el = h('div.drive.card', { 'data-focus': '', style: { padding: '20px 24px' } },
          h('div.dh', {}, h('span', {}, `${d.label || 'Local Disk'} (${d.drive})`), h('span', {}, `${gb(d.free)} free of ${gb(d.total)}`)),
          h('div.dbar', {}, h('i.games', { style: { width: `${(games / d.total) * 100}%` } }), h('i.other', { style: { width: `${(Math.max(0, used - games) / d.total) * 100}%` } })),
          (d.games || []).length ? h('div', { style: { marginTop: '12px', fontSize: '18px', color: 'var(--ink-dim)', lineHeight: 1.6 } }, (d.games || []).slice(0, 6).map((g) => `${g.title} ${g.size ? gb(g.size) : ''}`).join('  ·  ')) : null);
        out.push(el);
      }
      out.push(info('Legend', 'Green: games · Gray: everything else'));
      return out;
    },

    network: async () => {
      const rows = [];
      let radios = [];
      try { radios = await window.p360.radio.radios(); } catch { /* helper missing */ }
      const wifiRadio = radios.find((r) => r.kind === 'wifi');
      if (wifiRadio) {
        rows.push(toggleRow('Wi-Fi', wifiRadio.state === 'on' ? 'On' : 'Off', () => wifiRadio.state === 'on', async (v) => {
          try { radios = await window.p360.radio.set('wifi', v); wifiCache = null; } catch (e) { ctx.toast({ title: e.message, sound: 'error' }); }
          split.rerender();
        }));
      }
      // Show the last scan right away; rescan once when the section opens.
      const fresh = wifiCache && Date.now() - wifiCache.at < 20000;
      if (!fresh && (!wifiRadio || wifiRadio.state === 'on')) {
        if (!wifiCache) { try { wifiCache = { at: 0, data: await window.p360.wifi.list(false) }; } catch (e) { wifiCache = { at: Date.now(), data: { available: false, error: e.message, networks: [] } }; } }
        if (!wifiScanning) {
          wifiScanning = true;
          // A failed scan is cached too (as "unavailable"), so it doesn't re-render and rescan in a loop.
          window.p360.wifi.list(true).then((data) => { wifiCache = { at: Date.now(), data }; })
            .catch((e) => { wifiCache = { at: Date.now(), data: (wifiCache && wifiCache.data) || { available: false, error: e.message, networks: [] } }; }).finally(() => {
            wifiScanning = false;
            if (split.current() === 'network') split.rerender();
          });
        }
      }
      const data = wifiCache && wifiCache.data;
      if (wifiRadio && wifiRadio.state !== 'on') rows.push(info('Wi-Fi is off', 'Turn it on to see networks.'));
      else if (!data) rows.push(info(wifiScanning ? 'Searching…' : 'Wi-Fi unavailable', null));
      else if (!data.available) rows.push(info('Wi-Fi unavailable', data.error || 'No Wi-Fi adapter found. Wired connections work as usual.'));
      else {
        rows.push(h('h3.sec', {}, wifiScanning ? 'available networks · searching…' : 'available networks'));
        for (const n of data.networks) {
          const on = n.ssid === data.connected;
          const band = n.ghz ? (n.ghz >= 5.9 ? '6 GHz' : n.ghz >= 5 ? '5 GHz' : '2.4 GHz') : null;
          const detail = [on ? 'Connected' : null, n.secure ? 'Secured' : 'Open', band, n.saved && !on ? 'Saved' : null].filter(Boolean).join(' · ');
          const r = row(n.ssid, detail, h('div.val.wbars', {}, bars(n.bars)), on ? 'connected' : '');
          r.dataset.key = `wifi:${n.ssid}`; // keeps focus on this network when a rescan reorders the list
          r._activate = async () => {
            if (joining) return;
            joining = true;
            try { await activateNetwork(); } finally { joining = false; }
          };
          const activateNetwork = async () => {
            if (on || n.saved) {
              const items = on ? [{ label: 'Disconnect', value: 'off', icon: 'close' }] : [{ label: 'Connect', value: 'on', icon: 'wifi' }];
              items.push({ label: 'Forget network', value: 'forget', icon: 'eyeoff', danger: true }, { label: 'Cancel', value: null });
              const pick = await menu({ title: n.ssid, items });
              if (pick === 'off') {
                await window.p360.wifi.disconnect().catch(() => {});
                ctx.toast({ title: `Disconnected from ${n.ssid}`, sound: 'back' });
              } else if (pick === 'on') {
                await joinWifi(n, { toast: ctx.toast });
              } else if (pick === 'forget') {
                const ok = await confirm({ title: `Forget ${n.ssid}?`, text: 'The saved password is removed. You can join again later.', buttons: [{ label: 'Forget', value: true, danger: true }, { label: 'Cancel', value: false }] });
                if (!ok) return;
                const res = await window.p360.wifi.forget(n.ssid).catch(() => ({ ok: false }));
                ctx.toast({ title: res.ok ? `Forgot ${n.ssid}` : `Couldn’t forget ${n.ssid}`, sound: res.ok ? 'back' : 'error' });
              } else return;
            } else if (!(await joinWifi(n, { toast: ctx.toast }))) return;
            wifiCache = null;
            split.rerender();
          };
          rows.push(r);
        }
        if (!data.networks.length) rows.push(info('No networks found', null));
        rows.push(actionRow('Search again', 'Look for Wi-Fi networks nearby.', () => { wifiCache = null; split.rerender(); }));
      }

      // Test results live outside the pane so a background Wi-Fi refresh doesn't wipe them.
      const results = h('div.nettest');
      const paintTest = (el) => {
        if (netTest.running) el.replaceChildren(info('Testing…', 'Network adapter · DNS · Internet · Steam · Epic · Xbox'));
        else el.replaceChildren(...(netTest.res || []).map((r) => row(r.label, r.detail || (r.ms ? `${r.ms} ms` : ''), h(`div.check.${r.ok ? 'ok' : 'bad'}`, {}, r.ok ? '✓' : '✕'), 'info')));
      };
      paintTest(results);
      const liveResults = () => (split.current() === 'network' && split.pane.querySelector('.nettest')) || null;
      const runTest = async () => {
        if (netTest.running) return;
        netTest = { running: true, res: null };
        const el = liveResults();
        if (el) { paintTest(el); requestAnimationFrame(() => revealInScroller(el)); }
        let res = [];
        try { res = await window.p360.system.network(); } catch { /* ignore */ }
        netTest = { running: false, res };
        const done = liveResults();
        if (done) { paintTest(done); requestAnimationFrame(() => revealInScroller(done)); }
        const ok = res.length && res.every((r) => r.ok);
        ctx.toast({ title: ok ? 'Connection test passed' : 'Connection problems found', sound: ok ? 'select' : 'error' });
      };
      rows.push(h('h3.sec', {}, 'connection'));
      rows.push(actionRow('Test network connection', netTest.res ? 'Run it again to refresh the results below.' : 'Checks your adapter, DNS, internet and game services.', runTest));
      rows.push(results);
      return rows;
    },

    bluetooth: async () => {
      listenForPairing();
      const rows = [];
      let radios = [];
      try { radios = await window.p360.radio.radios(); } catch (e) { return [info('Bluetooth unavailable', e.message)]; }
      const bt = radios.find((r) => r.kind === 'bluetooth');
      if (!bt) return [info('No Bluetooth adapter', 'This PC doesn’t have Bluetooth, or it’s turned off in Device Manager. A USB Bluetooth adapter works too.')];
      rows.push(toggleRow('Bluetooth', bt.state === 'on' ? 'On' : 'Off', () => bt.state === 'on', async (v) => {
        try { await window.p360.radio.set('bluetooth', v); } catch (e) { ctx.toast({ title: e.message, sound: 'error' }); }
        split.rerender();
      }));
      if (bt.state !== 'on') { rows.push(info('Bluetooth is off', 'Turn it on to add or use wireless devices.')); return rows; }
      rows.push(actionRow('Add a device', 'Controllers, headphones, keyboards and more.', async () => { if (await addDevice({ toast: ctx.toast })) split.rerender(); }));
      let paired = [];
      try { paired = await window.p360.bt.paired(); } catch (e) { rows.push(info('Couldn’t list devices', e.message)); }
      rows.push(h('h3.sec', {}, 'your devices'));
      if (!paired.length) rows.push(info('No devices yet', 'Pick Add a device to pair one.'));
      const connectTo = async (d, on) => {
        if (btConnecting) { ctx.toast({ title: 'One moment', text: 'Another device is still connecting.', sound: 'error' }); return; }
        btConnecting = { id: d.id, on };
        split.rerender(); // paints "Connecting…" on its row (and keeps it through re-renders)
        let res;
        try { res = await window.p360.bt.connect(d.id, on); } catch (e) { res = { ok: false, error: e.message }; }
        btConnecting = null;
        if (res.ok) ctx.toast({ title: on ? `${d.name} connected` : `${d.name} disconnected`, sound: on ? 'select' : 'back' });
        else {
          ctx.toast({
            title: on ? `Couldn’t connect ${d.name}` : `Couldn’t disconnect ${d.name}`, sound: 'error',
            text: res.error || (on ? 'Make sure it’s on and close by. AirPods: take them out of the case.' : 'Try again in a moment.'),
          });
        }
        split.rerender();
      };
      if (!btPoll) {
        btPoll = setInterval(() => {
          if (split.current() !== 'bluetooth') { clearInterval(btPoll); btPoll = null; return; }
          if (!bladeActive || document.hidden) return; // another blade, a game or the desktop is in front
          window.p360.bt.paired().catch(() => {}); // a change re-renders through the bt.paired event
        }, 10000);
      }
      for (const d of paired) {
        const batt = headsetBattery(d.battery);
        const busy = btConnecting && btConnecting.id === d.id ? (btConnecting.on ? 'Connecting…' : 'Disconnecting…') : '';
        const r = row(d.name, `${KIND_LABEL[d.kind] || 'Bluetooth'} · ${d.connected ? 'Connected' : d.audio ? 'Not connected · A to connect' : 'Not connected'}`, h('div.val', {}, busy || batt || (d.connected ? '●' : '')), d.connected ? 'connected' : '');
        r.dataset.key = `bt:${d.id}`;
        r._activate = async () => {
          const items = [];
          if (d.audio) items.push(d.connected ? { label: 'Disconnect', value: 'disconnect', icon: 'close' } : { label: 'Connect', value: 'connect', icon: 'headset' });
          items.push({ label: 'Remove device', value: 'remove', icon: 'close', danger: true }, { label: 'Cancel', value: null });
          const pick = await menu({ title: d.name, items });
          if (pick === 'connect' || pick === 'disconnect') { connectTo(d, pick === 'connect'); return; }
          if (pick !== 'remove') return;
          const ok = await confirm({ title: `Remove ${d.name}?`, text: 'It’s unpaired from this PC. To use it again, pair it with Add a device.', buttons: [{ label: 'Remove', value: true, danger: true }, { label: 'Cancel', value: false }] });
          if (!ok) return;
          let res = null;
          try { res = await window.p360.bt.unpair(d.id); } catch (e) { res = { ok: false, status: e.message }; }
          ctx.toast({ title: res.ok ? `${d.name} removed` : `Couldn’t remove ${d.name}`, text: res.ok ? '' : res.status, sound: res.ok ? 'back' : 'error' });
          split.rerender();
        };
        rows.push(r);
      }
      rows.push(info('Tip', 'Controllers and keyboards reconnect when you turn them on. Headphones busy with another device (AirPods on your phone) don’t switch by themselves: press A on them and pick Connect. AirPods show their battery while they’re out of the case or the lid is open.'));
      return rows;
    },

    info: async () => {
      let i = {};
      try { i = await window.p360.system.info(); } catch { /* ignore */ }
      const sec = i.uptimeSec || 0;
      const up = !sec ? '—' : sec >= 86400 ? `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h` : sec >= 3600 ? `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m` : `${Math.max(1, Math.floor(sec / 60))}m`;
      return [
        info('Project 360', 'Console dashboard for Windows', `v${state.version || ''}`),
        info('System', null, `${i.os || 'Windows'} ${i.osBuild || ''}`),
        info('Processor', null, i.cpu ? `${i.cpu} · ${i.cores} threads` : '—'),
        info('Graphics', null, i.gpu || '—'),
        info('Memory', null, i.ramTotal ? `${gb(i.ramTotal)} (${gb(i.ramFree)} free)` : '—'),
        info('Uptime', null, up),
        info('Native helper', 'XInput, Guide button, battery, audio, process tracking, controller mouse', state.native ? `Running · ${state.native.xinput}${state.native.guide ? ' · Guide ✓' : ''}` : 'Unavailable'),
        info('Keyboard', 'Arrows/WASD move · Enter select · Esc back · Q/E switch blade · X/Y actions · Home or Alt+G Guide · Ctrl+Alt+Shift+E desktop'),
        actionRow('Open logs folder', 'Crash logs and diagnostics (also kept automatically).', () => window.p360.logs.open()),
        await (async () => {
          let text = '';
          try { text = await window.p360.logs.tail(); } catch { /* ignore */ }
          const lines = text.split('\n').filter((l) => /\[(warn|error)\]/.test(l)).slice(-6);
          return info('Recent problems', lines.length ? lines.map((l) => l.slice(11, 19) + ' ' + l.replace(/^\S+\s/, '').slice(0, 140)).join('\n') : 'Nothing logged — all good.');
        })(),
        actionRow('Quit Project 360', null, async () => { if (await confirm({ title: 'Quit Project 360?', buttons: [{ label: 'Quit', value: true, danger: true }, { label: 'Cancel', value: false }] })) window.p360.app.quit(); }),
      ];
    },

    updates: async () => {
      let st = {};
      try { st = await window.p360.updates.status(); } catch { /* ignore */ }
      const label = {
        dev: 'Running from source — updates work in the installed app',
        unconfigured: 'Not set up — add your GitHub repository below',
        idle: 'Ready to check', checking: 'Checking…', current: 'You’re up to date',
        available: `Version ${st.available} is available`, downloading: `Downloading ${st.available || 'update'} · ${st.progress || 0}%`,
        ready: `Version ${st.available} is ready to install`, error: `Couldn’t check: ${st.error || ''}`,
      }[st.state] || st.state;
      const rows = [
        info('Version', label, `v${st.version || state.version || ''}`),
        actionRow('Check for updates', st.checkedAt ? `Last checked ${new Date(st.checkedAt).toLocaleString()}` : null, async () => {
          if (updateBusy || st.state === 'checking' || st.state === 'downloading') return;
          updateBusy = true;
          ctx.toast({ title: 'Checking for updates…', duration: 1800 });
          try { await window.p360.updates.check(); } catch (e) { ctx.toast({ title: 'Couldn’t check for updates', text: e.message, sound: 'error' }); }
          finally { updateBusy = false; }
          split.rerender();
        }),
      ];
      if (st.state === 'available') rows.push(actionRow('Download update', null, async () => {
        if (updateBusy) return;
        updateBusy = true;
        ctx.toast({ title: `Downloading ${st.available}…`, duration: 2500 });
        try { await window.p360.updates.download(); } catch (e) { ctx.toast({ title: 'Download failed', text: e.message, sound: 'error' }); }
        finally { updateBusy = false; }
        split.rerender();
      }));
      if (st.state === 'ready') rows.push(actionRow(`Install ${st.available} and restart`, 'A backup is made first. Takes about a minute.', async () => {
        if (await confirm({ title: `Install update ${st.available}?`, text: 'Project 360 restarts when it’s done.', buttons: [{ label: 'Install and restart', value: true }, { label: 'Later', value: false }] })) window.p360.updates.install();
      }));
      rows.push(
        settingToggle('Download updates automatically', 'Updates install the next time Project 360 restarts — never during a game.', 'updates.auto'),
        settingToggle('Beta updates', 'Get pre-release versions early.', 'updates.beta'),
        textRow('Update source (GitHub repository)', st.repo || 'owner/repo — only needed if your build doesn’t include it', 'updates.repo'),
      );
      return rows;
    },

    backup: async () => {
      let list = [];
      try { list = await window.p360.backups.list(); } catch { /* ignore */ }
      const reasons = { daily: 'Daily', manual: 'Manual', update: 'Before update', 'before-restore': 'Before restore', 'before-import': 'Before import' };
      const rows = [
        info('What’s backed up', 'Profiles, gamertags and achievements, playtime and favorites, all settings and keys, emulator setup and your library’s art choices. A backup is made automatically every day and before every update.'),
        actionRow('Back up now', null, async () => { await window.p360.backups.create(); ctx.toast({ title: 'Backup saved', sound: 'select' }); split.rerender(); }),
        actionRow('Export backup to a file…', 'Save a .p360backup file to keep somewhere safe or move to another PC.', async () => { const f = await window.p360.backups.exportFile(); if (f) ctx.toast({ title: 'Backup exported', text: f.split('\\').pop(), sound: 'select' }); }),
        actionRow('Import a backup file…', 'Replaces your current profiles and settings (a backup of them is made first).', async () => {
          if (!(await confirm({ title: 'Import a backup?', text: 'Your current profiles and settings are replaced. A backup of them is made first, and Project 360 restarts.', buttons: [{ label: 'Choose file', value: true }, { label: 'Cancel', value: false }] }))) return;
          try { await window.p360.backups.importFile(); } catch (e) { ctx.toast({ title: 'Import failed', text: e.message, sound: 'error' }); }
        }),
      ];
      if (list.length) rows.push(info('Restore', 'Pick a backup to go back to. Project 360 restarts afterwards.'));
      for (const b of list.slice(0, 12)) {
        rows.push(actionRow(new Date(b.at).toLocaleString(), `${reasons[b.reason] || b.reason}${b.version ? ` · v${b.version}` : ''}`, async () => {
          if (!(await confirm({ title: 'Restore this backup?', text: `${new Date(b.at).toLocaleString()} (${reasons[b.reason] || b.reason}).\nYour current state is backed up first, then Project 360 restarts.`, buttons: [{ label: 'Restore', value: true, danger: true }, { label: 'Cancel', value: false }] }))) return;
          await window.p360.backups.restore(b.id);
        }, 'Restore'));
      }
      return rows;
    },

    power: () => {
      const shellRow = toggleRow('Console shell mode', 'Replace explorer.exe for this Windows account so the PC boots straight into Project 360.', () => state.shellMode, async (v) => {
        if (v) {
          const ok = await confirm({
            title: 'Enable console shell mode?',
            text: 'After you sign out or restart, Windows starts Project 360 instead of the desktop for this account.\n\nWays back to Windows:\n• Guide › Exit to desktop\n• Ctrl+Alt+Shift+E at any time\n• If Project 360 closes or crashes, the desktop starts automatically\n• Ctrl+Shift+Esc › Task Manager › Run “explorer”',
            buttons: [{ label: 'Enable shell mode', value: true }, { label: 'Cancel', value: false }],
          });
          if (!ok) return;
        }
        try { const r = await window.p360.system.shellMode(v); state.shellMode = r.enabled; ctx.toast({ title: r.enabled ? 'Shell mode on' : 'Shell mode off', text: 'Takes effect at next sign-in', sound: 'select' }); }
        catch (e) { ctx.toast({ title: 'Could not change shell', text: e.message, sound: 'error' }); }
      });
      window.p360.system.shellMode().then((r) => { state.shellMode = r.enabled; shellRow._paint(); }).catch(() => {});
      const pw = (action, title, text) => async () => {
        const ok = action === 'sleep' || await confirm({ title, text, buttons: [{ label: 'Yes', value: true, danger: action !== 'desktop' }, { label: 'Cancel', value: false }] });
        if (ok) window.p360.system.power(action);
      };
      return [
        shellRow,
        actionRow('Exit to Windows desktop', 'Starts explorer.exe and closes Project 360.', pw('desktop', 'Exit to the Windows desktop?', 'Project 360 will close.')),
        actionRow('Show Windows desktop', 'Starts Explorer and minimizes Project 360 (Guide button brings it back).', () => window.p360.system.explorer()),
        actionRow('Sleep', null, pw('sleep')),
        actionRow('Restart', null, pw('restart', 'Restart the console?', 'Running games will be closed.')),
        actionRow('Turn off', null, pw('shutdown', 'Turn off the console?', 'Running games will be closed.')),
      ];
    },
  };

  const split = createSplit({
    sections: () => SECTIONS.map(([id, label, icon]) => ({ id, label, icon })),
    async render(id, pane, { isCurrent }) {
      const label = SECTIONS.find(([s]) => s === id)[1];
      pane.append(h('h2', {}, label.toLowerCase()));
      const rows = await B[id]();
      if (!isCurrent()) return;
      pane.append(...rows);
    },
  });

  // Paired devices changed in the background (connected, paired, removed): refresh the list.
  window.p360.on('radio:event', (ev) => { if (ev.type === 'bt.paired' && bladeActive && split.current() === 'bluetooth') split.rerender(); });
  // Update progress (checking, downloading %, ready) arrives as it happens.
  window.p360.on('update:status', () => { if (bladeActive && split.current() === 'updates') split.rerender(); });

  return {
    id: 'system',
    label: 'system',
    accent: '#aab2ba',
    focus: split.focus,
    mount(content) { content.append(split.root); split.select('console'); },
    activate() {
      bladeActive = true;
      split.activate();
      ctx.setSub('');
      const cur = split.current();
      if (cur === 'bluetooth' || cur === 'updates') split.rerender(); // may have changed while away
    },
    deactivate() { bladeActive = false; },
    open(opts) { if (opts.section) split.select(opts.section); },
    refresh(what) {
      const cur = split.current();
      if (what === 'pads' && cur === 'controllers') split.rerender();
      if (what === 'settings' && (cur === 'library' || cur === 'themes' || cur === 'web')) split.rerender();
    },
    prompts() {
      const el = split.focus.current;
      const p = [{ btn: 'a', label: 'Select' }];
      if (el && el._adjust) p.push({ btn: 'dpad', label: 'Change' });
      if (split.inPane()) p.push({ btn: 'b', label: 'Back' });
      return p;
    },
    handle: (a) => split.handle(a),
  };
}

export { button };
