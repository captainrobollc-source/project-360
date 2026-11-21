// Project 360 — main process.
const { app, BrowserWindow, ipcMain, protocol, globalShortcut, screen, dialog, shell, nativeImage } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');

const { JsonStore } = require('./store');
const native = require('./native');
const radio = require('./radio');
const launcher = require('./launcher');
const system = require('./system');
const media = require('./media');
const tvbrowser = require('./tvbrowser');
const { Library } = require('./library');
const { ArtManager, safeId, sniffMime } = require('./art');
const { findSteamRoot } = require('./library/steam');
const { Achievements } = require('./achievements');
const { StoreManager } = require('./stores');
const { Emulation } = require('./emulation');

// Data services are loaded lazily so a missing/broken one never takes the dashboard down.
function svc(name) {
  try { return require(`./${name}`); } catch (e) { console.warn(`[main] ${name} unavailable:`, e.message); return null; }
}

const ARGS = new Set(process.argv.slice(1));
const WINDOWED = ARGS.has('--windowed');
const DEV = ARGS.has('--dev');
const AS_SHELL = ARGS.has('--shell');

protocol.registerSchemesAsPrivileged([
  { scheme: 'p360', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

// Dev/test runs can use an isolated data folder (and run beside a normal instance).
const TEST_DATA = DEV && process.env.P360_USERDATA;
if (TEST_DATA) app.setPath('userData', TEST_DATA);
else if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const USER = app.getPath('userData');
// Crash logs, crash dumps, heartbeat + watchdog — before anything else can fail.
const reliability = require('./reliability');
reliability.setup({ userDir: USER, shell: AS_SHELL, useWatchdog: !DEV || process.env.P360_WATCHDOG === '1' });
const RECOVERED = ARGS.has('--recovered');
const { Backups } = require('./reliability/backup');
const { Updater } = require('./reliability/updater');
const settings = new JsonStore(path.join(USER, 'settings.json'), {
  console: {
    startWithWindows: false, kiosk: true, hideCursor: true, guideHotkey: 'Alt+G', backStartGuide: true,
    coverPopups: true, hideTaskbar: true, bootAnimation: true, askProfile: false, screensaverMin: 10, firstRun: true, setupDone: false,
  },
  library: { steam: true, epic: true, gog: true, xbox: true, custom: true, customFolders: [], emulators: [], manualGames: [], showHidden: false },
  art: { steamGridDbKey: '', igdbClientId: '', igdbClientSecret: '' },
  audio: { uiSounds: true, uiVolume: 0.7, soundPack: 'default', musicInGames: true },
  media: { custom: [], browser: 'auto', folders: { music: [], pictures: [], videos: [] } },
  theme: { name: 'classic', background: 'default' },
  games: { view: 'carousel' },
  social: { steamApiKey: '', steamId: '' },
  market: { country: 'US' },
  stores: { installDir: '', downloadDir: '', deleteInstallers: true, keys: {} },
  emulation: { root: '', extraFolders: {} },
  updates: { repo: '', auto: true, beta: false },
  profiles: [],
  activeProfile: 'p1',
});

// ------------------------------------------------------------------ profiles
function ensureProfiles() {
  let list = settings.get('profiles');
  if (!Array.isArray(list) || !list.length) {
    const old = settings.data.profile || {};
    list = [{ id: 'p1', gamertag: (old.gamertag || os.userInfo().username || 'Player').slice(0, 15), motto: old.motto ?? 'Ready to play.', avatar: old.avatar || 0, createdAt: Date.now() }];
    settings.data.profiles = list;
    settings.data.activeProfile = 'p1';
    delete settings.data.profile;
    settings.save();
  }
}
ensureProfiles();
const activeProfile = () => settings.get('profiles').find((p) => p.id === settings.get('activeProfile')) || settings.get('profiles')[0];
const settingsView = () => ({ ...settings.data, profile: activeProfile() });

const library = new Library(USER, settings);
library.profileId = activeProfile().id;
const art = new ArtManager(path.join(USER, 'art'), library, settings, findSteamRoot);
const emulation = new Emulation({ userDir: USER, settings });
library.registerScanner('emulation', emulation);
const achievements = new Achievements(() => library.profileData(), () => library.user.save());
const arcade = require('./arcade').create({ settings, library, achievements, profiles: () => settings.get('profiles') || [] });
library.registerScanner('arcade', arcade.scanner);
// ------------------------------------------------------------------ per-controller profiles
// Each controller slot can have its own signed-in profile. The controller in use decides whose
// dashboard it is (favorites, gamer card, achievements); games credit whoever launched them.
const slotProfiles = {}; // slot → profile id (this session)
let launchProfile = null;
const profileById = (id) => settings.get('profiles').find((p) => p.id === id);
function withProfile(id, fn) {
  const prev = library.profileId;
  library.profileId = id || prev;
  try { return fn(); } finally { library.profileId = prev; }
}
function slotOf(profileId) {
  const e = Object.entries(slotProfiles).find(([, id]) => id === profileId);
  return e ? Number(e[0]) : -1;
}
function slotsView() {
  const active = settings.get('activeProfile');
  const slots = new Set([...Object.keys(slotProfiles).map(Number), ...pads.filter((p) => p.connected).map((p) => p.slot)]);
  return [...slots].sort((a, b) => a - b).map((slot) => {
    const prof = profileById(slotProfiles[slot]);
    return {
      slot,
      connected: !!(pads[slot] && pads[slot].connected),
      profileId: prof ? prof.id : null,
      gamertag: prof ? prof.gamertag : null,
      avatar: prof ? prof.avatar : 0,
      score: prof ? withProfile(prof.id, () => achievements.score()) : 0,
      active: !!prof && prof.id === active,
    };
  });
}
function broadcastSlots() { broadcast('profiles:slots', { slots: slotsView(), activeSlot: slotOf(settings.get('activeProfile')) }); }
function setActive(id) {
  if (!id || settings.get('activeProfile') === id) return false;
  settings.data.activeProfile = id;
  settings.save();
  library.setProfile(id);
  broadcast('settings:updated', settingsView());
  broadcast('achievements:updated', { list: achievements.list(), totals: achievements.totals() });
  broadcastSlots();
  return true;
}

const backups = new Backups({ userDir: USER, version: app.getVersion(), flush: () => { settings.flush(); library.flush(); try { emulation.state.flush(); } catch { /* ignore */ } } });
const updater = new Updater({ settings, shell: AS_SHELL });
const SOUNDS_DIR = path.join(USER, 'sounds');
const THUMBS_DIR = path.join(USER, 'thumbs');

let main = null;
let overlay = null;
let curtain = null; // black window at the bottom of the z-order: hides the desktop during games
let overlayGuideOpen = false;
let overlayToasts = false;
let suspended = false;
let signedIn = false;
let signedInBefore = false;
let emuOn = false;
let signInWin = null; // store sign-in window (controller drives the pointer while it's open)

// ------------------------------------------------------------------ windows
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const INDEX = path.join(__dirname, '..', 'renderer', 'index.html');
const coverOn = () => !WINDOWED && settings.get('console.coverPopups');

function createMain() {
  const kiosk = !WINDOWED && settings.get('console.kiosk');
  main = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    show: false,
    frame: WINDOWED,
    fullscreen: !WINDOWED,
    kiosk,
    autoHideMenuBar: true,
    backgroundColor: '#05070a',
    title: 'Project 360',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  main.setMenu(null);
  // Stay above store launchers, update prompts and other desktop windows while visible.
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  main.loadFile(INDEX, { query: { mode: 'dashboard' } });
  main.once('ready-to-show', () => { main.show(); main.focus(); });
  main.on('closed', () => { main = null; app.quit(); });
  if (DEV) main.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') main.webContents.toggleDevTools();
  });
}

function createOverlay() {
  const b = screen.getPrimaryDisplay().bounds;
  overlay = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    focusable: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true);
  overlay.loadFile(INDEX, { query: { mode: 'overlay' } });
  overlay.on('closed', () => { overlay = null; });
}

function createCurtain() {
  const b = screen.getPrimaryDisplay().bounds;
  curtain = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    show: false, frame: false, resizable: false, movable: false, skipTaskbar: true,
    focusable: false, hasShadow: false, backgroundColor: '#000000',
    webPreferences: { sandbox: true, contextIsolation: true },
  });
  curtain.setIgnoreMouseEvents(true);
  curtain.on('closed', () => { curtain = null; });
}

function showCurtain() {
  if (!curtain || WINDOWED) return;
  curtain.showInactive();
  native.call('wins.bottom', hwndOf(curtain)).catch(() => {});
}

const mainVisible = () => !!main && main.isVisible() && !main.isMinimized();
const hwndOf = (w) => { const h = w.getNativeWindowHandle(); return h.length >= 8 ? h.readBigUInt64LE(0).toString() : String(h.readUInt32LE(0)); };

function send(win, ch, data) { if (win && !win.isDestroyed()) win.webContents.send(ch, data); }
function broadcast(ch, data) { send(main, ch, data); send(overlay, ch, data); }

async function focusWindow(win) {
  if (!win) return;
  win.show();
  win.focus();
  try { await native.call('focus.hwnd', hwndOf(win)); } catch { /* best effort */ }
}

function suspendDashboard() {
  if (!main || suspended) return;
  suspended = true;
  send(main, 'app:suspend', true);
  showCurtain();
  main.setAlwaysOnTop(false);
  main.hide(); // stops compositing/rendering, frees GPU time for the game
  updateEmu();
}

async function restoreDashboard() {
  if (!main) return;
  applyTaskbar();
  suspended = false;
  send(main, 'app:suspend', false);
  main.show();
  if (curtain && curtain.isVisible()) curtain.hide();
  if (!WINDOWED && !main.isFullScreen()) main.setFullScreen(true);
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  updateEmu(); // the dashboard owns the pad again: controller mouse off
  await focusWindow(main);
}

// ------------------------------------------------------------------ toasts + guide
function toast(t) {
  const payload = { id: Date.now() + Math.random(), ...t };
  if (mainVisible() && !overlayGuideOpen) return send(main, 'toast', payload);
  if (!overlay) return;
  overlayToasts = true;
  if (!overlay.isVisible()) overlay.showInactive();
  send(overlay, 'toast', payload);
}

async function openOverlayGuide(slot) {
  if (!overlay) return;
  overlayGuideOpen = true;
  updateEmu();
  overlay.setIgnoreMouseEvents(false);
  send(overlay, 'guide:open', { slot });
  await focusWindow(overlay);
  if (launcher.current) achievements.track('guide');
}

function closeOverlayGuide() {
  if (!overlay) return;
  overlayGuideOpen = false;
  overlay.setIgnoreMouseEvents(true);
  send(overlay, 'guide:close');
  if (!overlayToasts) overlay.hide();
  updateEmu();
}

function onGuide(slot = 0) {
  if (signInWin) { signInWin.close(); return; } // Guide button cancels a store sign-in
  if (slotProfiles[slot]) setActive(slotProfiles[slot]);
  if (mainVisible()) {
    focusWindow(main);
    return send(main, 'guide:toggle', { slot });
  }
  if (overlayGuideOpen) { closeOverlayGuide(); launcher.focusGame(); }
  else openOverlayGuide(slot);
}

// Controller → mouse/keyboard while a desktop/web app is in front (and the Guide is closed).
function updateEmu() {
  const st = launcher.state();
  const want = !!signInWin || !!(st.phase === 'running' && st.revealed && st.controllerMouse && !overlayGuideOpen && !mainVisible());
  if (want === emuOn) return;
  emuOn = want;
  native.call(want ? 'emu.on' : 'emu.off').catch(() => {});
}

// ------------------------------------------------------------------ controllers
const pads = [0, 1, 2, 3].map((s) => ({ slot: s, connected: false, battery: null }));
const masks = [0, 0, 0, 0];
let chordTimer = null;

function inputTarget() {
  if (signInWin) return null;
  if (overlayGuideOpen) return overlay;
  if (mainVisible()) return main;
  return null;
}

native.on('in', ({ s, b }) => {
  const prev = masks[s] || 0;
  masks[s] = b;
  const pressed = b & ~prev;
  if (pressed & (1 << 10)) onGuide(s);
  if (settings.get('console.backStartGuide')) {
    const both = (b & 0x30) === 0x30;
    if (both && (prev & 0x30) !== 0x30) chordTimer = setTimeout(() => { if ((masks[s] & 0x30) === 0x30) onGuide(s); }, 700);
    if (!both) clearTimeout(chordTimer);
  }
  if (signInWin) return; // controller mouse is driving the sign-in window
  const target = inputTarget();
  if (target) return send(target, 'pad', { s, b });
  // Built-in TV apps get the pad as key presses.
  const h = launcher.current && launcher.current.handle;
  if (h && h.pad) h.pad(b & ~(1 << 10));
});

native.on('guide', ({ s }) => onGuide(s));

native.on('pad', ({ s, c }) => {
  if (!pads[s]) return;
  const was = pads[s].connected;
  pads[s].connected = c;
  if (!c) pads[s].battery = null;
  broadcast('pads', pads);
  broadcastSlots();
  if (c && !was) {
    const who = profileById(slotProfiles[s]);
    toast({ kind: 'controller', slot: s, title: who ? `${who.gamertag}'s controller connected` : 'Controller connected', text: who || !signedIn ? `Player ${s + 1}` : `Player ${s + 1} · press the Xbox button to sign in`, sound: 'toast' });
    native.call('pad.rumble', s, 22000, 22000, 160).catch(() => {});
    native.call('pad.battery').catch(() => {});
  } else if (!c && was) {
    toast({ kind: 'controller', slot: s, title: 'Controller disconnected', text: `Player ${s + 1} · reconnect to continue`, sound: 'back' });
  }
});

native.on('bat', ({ s, type, lvl }) => {
  if (!pads[s]) return;
  const prev = pads[s].battery;
  pads[s].battery = { type, level: lvl };
  broadcast('pads', pads);
  const wireless = type === 2 || type === 3;
  if (wireless && lvl <= 1 && (!prev || prev.level > lvl)) {
    toast({ kind: 'battery', slot: s, title: lvl === 0 ? 'Batteries critical' : 'Batteries low', text: `Player ${s + 1} controller`, sound: 'error' });
  }
});

native.on('exit', () => { taskbarHidden = false; emuOn = false; });
native.on('ready', (info) => {
  native.call('pad.battery').catch(() => {});
  applyTaskbar();
  updateEmu();
  broadcast('native:ready', info);
});

// The Windows taskbar stays hidden while the console runs (restored on exit, by the helper too).
let taskbarHidden = false;
function applyTaskbar(force) {
  const want = force !== undefined ? force : (!WINDOWED && !!settings.get('console.hideTaskbar'));
  if (want === taskbarHidden) return;
  taskbarHidden = want;
  native.call(want ? 'taskbar.hide' : 'taskbar.show').catch(() => {});
}

// ------------------------------------------------------------------ launcher
findSteamRoot().then((r) => { launcher.steamRoot = r; });
launcher.internal = (item) => tvbrowser.open(item, { cacheDir: USER });

launcher.on('state', (st) => {
  broadcast('launcher:state', st);
  updateEmu();
});

// The real game window is up: fade out the cover and get out of the way.
launcher.on('reveal', async ({ hwnd, internal }) => {
  send(main, 'launch:reveal');
  await new Promise((r) => setTimeout(r, internal ? 200 : 650));
  if (!launcher.current) return;
  suspendDashboard();
  if (hwnd) { try { await native.call('focus.hwnd', hwnd); } catch { /* ignore */ } }
  else launcher.focusGame();
  updateEmu();
});

launcher.on('failed', ({ item, error }) => {
  toast({ kind: 'orb', icon: 'close', title: `Couldn't start ${item.title}`, text: error, sound: 'error' });
  if (!mainVisible()) restoreDashboard();
});

launcher.on('exited', async (info) => {
  if (info.kind === 'game' && info.seconds > 0) {
    withProfile(launchProfile, () => {
      library.recordSession(info.id, info.seconds);
      achievements.track('session', { seconds: info.seconds, startedAt: info.startedAt }, { games: library.view() });
    });
  }
  launchProfile = null;
  if (overlayGuideOpen) closeOverlayGuide();
  emuOn = true; updateEmu();
  if (!mainVisible()) await restoreDashboard();
  if (info.reason !== 'detached') {
    const mins = Math.max(1, Math.round(info.seconds / 60));
    toast({ kind: 'orb', title: info.title, text: info.reason === 'killed' ? 'Closed' : info.seconds ? `Played for ${fmtDuration(mins)}` : 'Closed', sound: 'toast' });
  }
  maybeRescan();
});

function fmtDuration(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

let lastScan = 0;
function maybeRescan(force = false) {
  if (!force && Date.now() - lastScan < 10 * 60 * 1000) return Promise.resolve();
  lastScan = Date.now();
  return library.scan().then((r) => { art.fetchMissing(); return r; }).catch((e) => console.error('[scan]', e));
}

function launchWeb(item) {
  // Open a store page / URL with the configured browser, as a tracked media app.
  const web = media.list(settings, USER).find((m) => m.engine);
  if (!web) return shell.openExternal(item.url);
  const launch = { ...web.launch, args: web.launch.args.map((a) => (a === web.url ? item.url : a)) };
  return launcher.launch({ id: `web:${item.id || item.url}`, title: item.title, controllerMouse: true, launch, watch: web.watch, art: item.art }, 'media');
}

// ------------------------------------------------------------------ library + achievements fan-out
let libTimer = null;
let firstScanDone = false;
library.on('changed', () => {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => broadcast('library:updated', library.view()), 250);
});
library.on('scanned', ({ added }) => {
  if (firstScanDone && added.length) toast({ kind: 'orb', title: `${added.length} new game${added.length > 1 ? 's' : ''} added`, text: 'Library updated', sound: 'toast' });
  firstScanDone = true;
  if (signedIn) achievements.track('library', {}, { games: library.view() });
});
achievements.on('unlock', (a) => {
  const who = launchProfile && launchProfile !== settings.get('activeProfile') ? profileById(launchProfile) : null;
  toast({ kind: 'achievement', icon: a.icon, title: who ? `${who.gamertag} unlocked an achievement` : 'Achievement unlocked', text: `${a.points}G – ${a.title}`, sound: 'achievement', duration: 5200 });
  // Unlocks at game exit fire inside withProfile(launcher's profile): read the list after it
  // returns, so the dashboard shows the active player's achievements.
  setImmediate(() => broadcast('achievements:updated', { list: achievements.list(), totals: achievements.totals() }));
});

// ------------------------------------------------------------------ sound packs
function soundPacks() {
  fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  const readme = path.join(SOUNDS_DIR, 'README.txt');
  if (!fs.existsSync(readme)) {
    fs.writeFileSync(readme, [
      'Project 360 sound packs',
      '',
      'Create a folder here (e.g. "classic") and drop .wav / .ogg / .mp3 files named:',
      '  blade, tick, select, back, guide, toast, error, launch, achievement, boot, signin',
      'Missing files fall back to the built-in synthesized sounds.',
      'Then pick the pack in System > Audio.',
    ].join('\r\n'));
  }
  const packs = [];
  for (const d of fs.readdirSync(SOUNDS_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const files = {};
    for (const f of fs.readdirSync(path.join(SOUNDS_DIR, d.name))) {
      const m = f.match(/^(\w+)\.(wav|ogg|mp3)$/i);
      if (m) files[m[1].toLowerCase()] = `p360://sounds/${encodeURIComponent(d.name)}/${encodeURIComponent(f)}`;
    }
    packs.push({ name: d.name, files });
  }
  return packs;
}

// ------------------------------------------------------------------ local media
let mediaCache = null;
async function scanMedia(force = false) {
  const lm = svc('localmedia');
  if (!lm) return { music: [], pictures: [], videos: [], roots: [] };
  if (mediaCache && !force) return mediaCache;
  const root = await findSteamRoot();
  mediaCache = await lm.scanAll({
    extraFolders: settings.get('media.folders') || {},
    steamRoot: root,
    gameNameForAppId: (appid) => { const g = library.game(`steam:${appid}`); return g ? g.title : null; },
  });
  return mediaCache;
}
const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64url = (s) => Buffer.from(s, 'base64url').toString('utf8');
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

async function serveFile(req, file) {
  const stat = await fs.promises.stat(file);
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
    const start = m[1] ? Number(m[1]) : 0;
    const end = Math.min(m[2] ? Number(m[2]) : stat.size - 1, stat.size - 1);
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { 'content-type': mime, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes', 'content-length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-type': mime, 'accept-ranges': 'bytes', 'content-length': String(stat.size) } });
}

async function thumbnail(file) {
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  const key = crypto.createHash('sha1').update(file).digest('hex');
  const out = path.join(THUMBS_DIR, key + '.jpg');
  if (fs.existsSync(out)) return fs.promises.readFile(out);
  let img;
  try { img = await nativeImage.createThumbnailFromPath(file, { width: 480, height: 270 }); }
  catch { img = nativeImage.createFromPath(file).resize({ width: 480 }); }
  const buf = img.toJPEG(82);
  await fs.promises.writeFile(out, buf);
  return buf;
}

// ------------------------------------------------------------------ IPC
function initPayload(mode) {
  return {
    mode,
    version: app.getVersion(),
    settings: settingsView(),
    library: library.view(),
    pads,
    launcher: launcher.state(),
    media: media.list(settings, USER),
    browsers: media.browsers(),
    sessions: library.sessions().slice(0, 30),
    soundPacks: soundPacks(),
    native: native.ready ? native.info : null,
    achievements: { list: achievements.list(), totals: achievements.totals() },
    slots: slotsView(),
    activeSlot: slotOf(settings.get('activeProfile')),
    signedIn,
    asShell: AS_SHELL,
    windowed: WINDOWED,
  };
}

function handle(ch, fn) {
  ipcMain.handle(ch, async (e, ...args) => {
    try { return { ok: true, value: await fn(e, ...args) }; }
    catch (err) { return { ok: false, error: err.message }; }
  });
}

handle('app:init', (e, mode) => initPayload(mode));
handle('library:get', () => library.view());
handle('library:rescan', async () => maybeRescan(true));
// ---- Built-in arcade (the games run inside the dashboard renderer)
handle('arcade:board', (e, key) => arcade.board(key));
handle('arcade:finish', (e, key, result) => {
  const res = arcade.finish(key, result, settings.get('activeProfile'));
  broadcast('library:updated', library.view ? library.view() : undefined);
  return res;
});

handle('game:launch', async (e, id) => {
  const g = library.game(id);
  if (!g) throw new Error('Game not found');
  if (g.source === 'arcade') throw new Error('ARCADE'); // the renderer runs these itself
  if (g.systemId) {
    // Emulated game: make sure its emulator / core is there (cores install on demand).
    g.launch = emulation.relaunchInfo(g);
    if (g.launch.type === 'core-missing') {
      toast({ kind: 'orb', icon: 'controller', title: `Setting up ${g.platform}`, text: 'Downloading the emulator core…', duration: 3000 });
      await emulation.installCore(g.launch.target);
      g.launch = emulation.relaunchInfo(g);
    }
    if (g.launch.type === 'emulator-missing') throw new Error(`NEEDS_EMULATOR:${g.launch.target}`);
    g.watch = { dirs: [], exes: [path.basename(g.launch.target)] };
    library.lib.save();
  }
  const st = await launcher.launch(g, 'game');
  launchProfile = settings.get('activeProfile');
  achievements.track('launch', { source: g.source });
  const slot = pads.findIndex((p) => p.connected);
  if (slot >= 0) native.call('pad.rumble', slot, 30000, 12000, 220).catch(() => {});
  return st;
});
handle('media:launch', async (e, id) => {
  const m = media.list(settings, USER).find((x) => x.id === id);
  if (!m) throw new Error('App not found');
  achievements.track('media');
  return launcher.launch(m, 'media');
});
handle('web:open', async (e, item) => launchWeb(item));
handle('game:update', (e, id, patch) => {
  const allowed = {};
  if ('favorite' in patch) allowed.favorite = !!patch.favorite;
  if ('hidden' in patch) allowed.hidden = !!patch.hidden;
  const r = library.patchUser(id, allowed);
  if (allowed.hidden) achievements.track('hide', { playtime: r.playtime });
  achievements.track('library', {}, { games: library.view() });
  return r;
});
handle('game:refreshArt', (e, id) => { art.refresh(id); return true; });
handle('art:fetchMissing', () => { art.fetchMissing(); return true; });
handle('art:clear', () => { art.clearCache(); art.fetchMissing(); return true; });
handle('art:search', async (e, query) => (art.searchArt ? art.searchArt(query) : []));
handle('art:apply', async (e, id, candidate) => {
  if (!art.applyArt) throw new Error('Not supported');
  const r = await art.applyArt(id, candidate);
  if (r && r.ok === false) throw new Error(r.error || 'No usable images');
  return r;
});
handle('sessions:get', () => library.sessions().slice(0, 30));

handle('settings:set', async (e, key, value) => {
  if (key.startsWith('profile.')) {
    const p = activeProfile();
    const field = key.slice(8);
    if (field === 'avatar' && p.avatar !== value) achievements.track('avatar');
    p[field] = value;
    settings.save();
    if (['avatar', 'gamertag'].includes(field)) broadcastSlots(); // other players' views of this profile
  } else {
    settings.set(key, value);
  }
  if (key === 'console.startWithWindows') settings.set(key, system.setStartup(value));
  if (key === 'console.kiosk' && main && !WINDOWED) main.setKiosk(!!value);
  if (key === 'console.coverPopups' && main && mainVisible()) main.setAlwaysOnTop(coverOn(), 'normal');
  if (key === 'console.hideTaskbar') applyTaskbar();
  if (key === 'console.guideHotkey') registerShortcuts();
  if (key.startsWith('theme.')) achievements.track('theme');
  if (key.startsWith('library.')) maybeRescan(true);
  if (key.startsWith('art.')) art.fetchMissing();
  if (key.startsWith('media.')) { if (key.startsWith('media.folders')) mediaCache = null; broadcast('media:updated', media.list(settings, USER)); }
  broadcast('settings:updated', settingsView());
  return settingsView();
});

// Profiles
handle('profiles:list', () => settings.get('profiles').map((p) => ({ ...p, score: scoreFor(p.id) })));
function scoreFor(id) {
  const prev = library.profileId;
  library.profileId = id;
  const s = achievements.score();
  library.profileId = prev;
  return s;
}
handle('profiles:create', (e, { gamertag, avatar = 0 }) => {
  const id = 'p' + Date.now().toString(36);
  settings.get('profiles').push({ id, gamertag: String(gamertag || 'Player').slice(0, 15), motto: '', avatar, createdAt: Date.now() });
  settings.save();
  return id;
});
handle('profiles:delete', (e, id) => {
  const list = settings.get('profiles');
  if (list.length <= 1) throw new Error('You need at least one profile');
  settings.data.profiles = list.filter((p) => p.id !== id);
  for (const [k, v] of Object.entries(slotProfiles)) if (v === id) delete slotProfiles[k];
  if (launchProfile === id) launchProfile = null;
  library.deleteProfileData(id);
  if (settings.get('activeProfile') === id) {
    const next = Object.values(slotProfiles)[0] || settings.data.profiles[0].id;
    settings.data.activeProfile = next;
    library.setProfile(next);
    broadcast('achievements:updated', { list: achievements.list(), totals: achievements.totals() });
  }
  settings.save();
  broadcast('settings:updated', settingsView());
  broadcastSlots();
  return true;
});
handle('profiles:signIn', (e, id, slot = 0) => {
  const p = settings.get('profiles').find((x) => x.id === id) || activeProfile();
  // A profile can only be signed in on one controller at a time.
  for (const [k, v] of Object.entries(slotProfiles)) if (v === p.id) delete slotProfiles[k];
  slotProfiles[slot] = p.id;
  settings.data.activeProfile = p.id;
  settings.save();
  library.setProfile(p.id);
  signedIn = true;
  broadcastSlots();
  broadcast('settings:updated', settingsView());
  broadcast('achievements:updated', { list: achievements.list(), totals: achievements.totals() });
  toast({ kind: 'signin', slot, avatar: p.avatar, title: `${p.gamertag} signed in`, text: `Player ${slot + 1} · ${achievements.score()}G`, sound: 'signin' });
  achievements.track('boot');
  achievements.track('signin');
  if (RECOVERED && !signedInBefore) setTimeout(() => toast({ kind: 'orb', icon: 'restart', title: 'Project 360 restarted', text: 'It closed unexpectedly and was restarted automatically · System › Console info has the logs' }), 2500);
  signedInBefore = true;
  achievements.track('library', {}, { games: library.view() });
  return settingsView();
});
handle('profiles:signOut', (e, slot) => {
  if (slot === undefined || slot === null) slot = slotOf(settings.get('activeProfile'));
  const id = slotProfiles[slot];
  const prof = profileById(id);
  delete slotProfiles[slot];
  if (prof) toast({ kind: 'signin', slot, avatar: prof.avatar, title: `${prof.gamertag} signed out`, text: `Player ${slot + 1}`, sound: 'back' });
  const others = Object.values(slotProfiles);
  if (id === settings.get('activeProfile')) {
    if (others.length) setActive(others[0]);
    else { signedIn = false; broadcast('profiles:signedOut', { slot }); }
  }
  broadcastSlots();
  return true;
});
handle('profiles:slots', () => ({ slots: slotsView(), activeSlot: slotOf(settings.get('activeProfile')) }));
// The controller that last pressed something decides whose dashboard it is.
handle('profiles:activity', (e, slot) => {
  if (slotProfiles[slot]) setActive(slotProfiles[slot]);
  return true;
});

handle('achievements:get', () => ({ list: achievements.list(), totals: achievements.totals() }));
handle('achievements:track', (e, event, data) => { achievements.track(event, data || {}, { games: library.view() }); return true; });

// System
handle('system:volume', async (e, op, v) => {
  if (op === 'set') return native.call('vol.set', Math.max(0, Math.min(1, v)));
  if (op === 'mute') return native.call('vol.mute', v ? 1 : 0);
  return native.call('vol.get');
});
handle('system:audioDevices', () => native.call('audio.list'));
handle('system:setAudioDevice', (e, id) => native.call('audio.setDefault', id));
handle('system:power', (e, action) => { if (action === 'desktop') applyTaskbar(false); return system.power(action); });
handle('system:explorer', async () => {
  applyTaskbar(false);
  await system.launchExplorer();
  if (main) { main.setAlwaysOnTop(false); main.minimize(); }
});
handle('system:startup', () => system.getStartup());
handle('system:shellMode', (e, enable) => (enable === undefined ? system.getShellMode() : system.setShellMode(enable)));
handle('system:gameBar', (e, enabled) => (enabled === undefined ? system.getGameBarButton() : system.setGameBarButton(enabled)));
handle('system:openSoundsFolder', () => { soundPacks(); return shell.openPath(SOUNDS_DIR); });
handle('system:info', async () => {
  const si = svc('sysinfo');
  let gpuName = '';
  try { const g = await app.getGPUInfo('basic'); gpuName = (g.gpuDevice || []).find((d) => d.active)?.deviceString || (g.gpuDevice || [])[0]?.deviceString || ''; } catch { /* ignore */ }
  return si ? si.getInfo({ gpuName }) : { gpu: gpuName };
});
handle('system:storage', async () => { const si = svc('sysinfo'); return si ? si.getStorage(Object.values(library.games())) : []; });
handle('system:network', async () => { const si = svc('sysinfo'); return si ? si.testNetwork() : []; });

// ---- Bluetooth & Wi-Fi (System › Bluetooth / Network)
radio.events.on('event', (ev) => send(main, 'radio:event', ev));
handle('radio:radios', () => radio.radios());
handle('radio:set', (e, kind, on) => radio.setRadio(kind, on));
handle('bt:paired', () => radio.paired());
handle('bt:scan', (e, on) => radio.scan(on));
handle('bt:pair', (e, id) => radio.pair(id));
handle('bt:reply', (e, id, accept, pin) => radio.reply(id, accept, pin));
handle('bt:unpair', (e, id) => radio.unpair(id));
handle('wifi:list', (e, rescan) => radio.wifi(rescan !== false));
handle('wifi:connect', (e, ssid, password, auto) => radio.connect(ssid, password, auto));
handle('wifi:disconnect', () => radio.disconnect());
handle('wifi:forget', (e, ssid) => radio.forget(ssid));
handle('sounds:list', () => soundPacks());
handle('pads:refresh', () => native.call('pad.battery'));
handle('pad:rumble', (e, slot, l, r, ms) => native.call('pad.rumble', slot, l, r, ms));

// Marketplace / friends / local media
handle('market:get', async (e, force) => {
  const m = svc('market');
  if (!m) return { sections: [], offline: true };
  return m.getMarket({ cacheFile: path.join(USER, 'market.json'), country: settings.get('market.country') || 'US', maxAgeMs: force ? 0 : 3600000, force: !!force });
});
handle('social:get', async () => {
  const s = svc('social');
  if (!s) return { needsKey: true };
  const apiKey = settings.get('social.steamApiKey');
  const steamId = settings.get('social.steamId') || s.detectSteamId();
  if (!apiKey) return { needsKey: true, steamId };
  const r = await s.getFriends({ apiKey, steamId });
  if (r && r.friends && r.friends.length) achievements.track('friends');
  return { ...r, steamId };
});
handle('social:recent', async () => {
  const s = svc('social');
  const apiKey = settings.get('social.steamApiKey');
  if (!s || !apiKey) return [];
  return s.getRecentGames({ apiKey, steamId: settings.get('social.steamId') || s.detectSteamId() });
});
handle('localmedia:scan', async (e, force) => {
  const r = await scanMedia(force);
  const enc = (list) => list.map((x) => ({ ...x, url: `p360://media/${b64url(x.path)}`, thumb: `p360://thumb/${b64url(x.path)}` }));
  return { music: enc(r.music || []), pictures: enc(r.pictures || []), videos: enc(r.videos || []) };
});

// Launcher
handle('launcher:resume', async () => {
  if (overlayGuideOpen) closeOverlayGuide();
  if (launcher.state().phase === 'running') { suspendDashboard(); return launcher.focusGame(); }
  return false;
});
handle('launcher:forceClose', () => launcher.forceClose());
handle('launcher:detach', () => launcher.detach());
handle('launcher:showAttention', async () => { suspendDashboard(); return launcher.focusGame(); });
handle('launcher:showDashboard', async (e, blade) => {
  if (overlayGuideOpen) closeOverlayGuide();
  await restoreDashboard();
  if (blade) send(main, 'nav:goto', blade);
});

handle('overlay:guideClosed', () => {
  overlayGuideOpen = false;
  if (overlay) overlay.setIgnoreMouseEvents(true);
  if (!overlayToasts && overlay) overlay.hide();
  launcher.focusGame();
  updateEmu();
});
handle('overlay:toastsIdle', () => {
  overlayToasts = false;
  if (!overlayGuideOpen && overlay) overlay.hide();
});

handle('dialog:addGame', async () => {
  main.setAlwaysOnTop(false);
  const r = await dialog.showOpenDialog(main, { title: 'Add a game', properties: ['openFile'], filters: [{ name: 'Programs & shortcuts', extensions: ['exe', 'lnk', 'url'] }] });
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  if (r.canceled || !r.filePaths[0]) return null;
  const list = settings.get('library.manualGames') || [];
  list.push({ target: r.filePaths[0] });
  settings.set('library.manualGames', list);
  await maybeRescan(true);
  return r.filePaths[0];
});
handle('dialog:addFolder', async (e, kind = 'games') => {
  main.setAlwaysOnTop(false);
  const r = await dialog.showOpenDialog(main, { title: kind === 'games' ? 'Add a games folder' : `Add a ${kind} folder`, properties: ['openDirectory'] });
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  if (r.canceled || !r.filePaths[0]) return null;
  if (kind === 'games') {
    const list = settings.get('library.customFolders') || [];
    if (!list.includes(r.filePaths[0])) list.push(r.filePaths[0]);
    settings.set('library.customFolders', list);
    await maybeRescan(true);
  } else {
    const folders = settings.get('media.folders') || {};
    folders[kind] = [...new Set([...(folders[kind] || []), r.filePaths[0]])];
    settings.set('media.folders', folders);
    mediaCache = null;
  }
  broadcast('settings:updated', settingsView());
  return r.filePaths[0];
});

handle('app:quit', () => { app.exit(0); });
const relaunchArgs = () => ({ args: process.argv.slice(1).filter((a) => a !== '--recovered') });
handle('app:relaunch', () => {
  if (AS_SHELL) return app.exit(65);
  app.relaunch(relaunchArgs());
  app.exit(0);
});

// ------------------------------------------------------------------ store accounts + downloads
const stores = new StoreManager({
  userDir: USER,
  settings,
  onInstalled: async ({ title, exe }) => {
    // Archives/unknown installers: add the game's exe to the library ourselves.
    if (exe) {
      const list = settings.get('library.manualGames') || [];
      if (!list.some((m) => m.target === exe)) { list.push({ target: exe, title }); settings.set('library.manualGames', list); }
    }
    await maybeRescan(true);
    toast({ kind: 'orb', icon: 'controller', title: `${title} installed`, text: 'Ready to play in My games', sound: 'achievement' });
  },
});
stores.on('downloads', (v) => broadcast('downloads:updated', v));
// Steam / Epic show their own install dialog: step aside so it can be confirmed.
stores.on('client', async ({ client, title }) => {
  await new Promise((r) => setTimeout(r, 1200));
  if (main) { main.setAlwaysOnTop(false); main.minimize(); }
  toast({ kind: 'orb', icon: 'folder', title: `Confirm in ${client}`, text: `${title} · then press the Xbox button to come back`, duration: 6000 });
});

function openStoreSignIn(id) {
  const c = stores.connector(id);
  if (signInWin) signInWin.close();
  const ses = stores.session(id);
  signInWin = new BrowserWindow({
    parent: main, modal: !WINDOWED, width: 1280, height: 860, fullscreen: !WINDOWED, autoHideMenuBar: true,
    backgroundColor: '#ffffff', title: `Sign in to ${c.name}`,
    webPreferences: { session: ses, contextIsolation: true, sandbox: true },
  });
  signInWin.setMenu(null);
  signInWin.loadURL(c.signInUrl);
  updateEmu();
  let done = false;
  const timer = setInterval(async () => {
    if (done || !signInWin || signInWin.isDestroyed()) return;
    try {
      const st = await c.status(ses, stores.ctx(id));
      if (st.signedIn && !done && (!c.client || st.mode === 'store')) { // client stores: wait for a real store sign-in
        done = true;
        toast({ kind: 'orb', icon: 'user', title: `Signed in to ${c.name}`, text: st.user ? `as ${st.user}` : 'Scanning your library…', sound: 'signin' });
        if (signInWin) signInWin.close();
        stores.library(id, true).then(() => broadcast('stores:updated')).catch(() => broadcast('stores:updated'));
      }
    } catch { /* still signing in */ }
  }, 2500);
  const thisWin = signInWin;
  signInWin.on('closed', () => {
    clearInterval(timer);
    if (signInWin !== thisWin) return; // replaced by a newer sign-in window
    signInWin = null;
    updateEmu();
    broadcast('stores:updated');
    if (main) focusWindow(main);
  });
}

handle('stores:list', () => stores.list());
handle('stores:signIn', (e, id) => { openStoreSignIn(id); return true; });
handle('stores:signOut', async (e, id) => { await stores.signOut(id); broadcast('stores:updated'); return true; });
handle('stores:library', (e, id, force) => stores.library(id, force));
handle('stores:options', (e, id, gameId) => stores.downloads(id, gameId));
handle('downloads:start', (e, store, gameId, optionId, opts) => stores.start(store, gameId, optionId, opts));
handle('downloads:list', () => stores.view());
handle('downloads:pause', (e, id) => stores.pause(id));
handle('downloads:resume', (e, id) => stores.resume(id));
handle('downloads:cancel', (e, id) => stores.cancel(id));
handle('downloads:remove', (e, id) => stores.remove(id));
handle('downloads:install', (e, id) => stores.installNow(id));
handle('downloads:folder', (e, id) => stores.openFolder(id));
handle('stores:pickFolder', async (e, kind) => {
  main.setAlwaysOnTop(false);
  const r = await dialog.showOpenDialog(main, { title: kind === 'install' ? 'Where should games be installed?' : 'Where should downloads go?', properties: ['openDirectory', 'createDirectory'] });
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  if (r.canceled || !r.filePaths[0]) return null;
  settings.set(kind === 'install' ? 'stores.installDir' : 'stores.downloadDir', r.filePaths[0]);
  broadcast('settings:updated', settingsView());
  return r.filePaths[0];
});
handle('stores:paths', () => ({ install: stores.installDir(), download: stores.downloadDir() }));

// ------------------------------------------------------------------ emulation
emulation.on('updated', (st) => broadcast('emu:updated', st));
emulation.on('installed', ({ name }) => {
  toast({ kind: 'orb', icon: 'controller', title: `${name} installed`, text: 'Ready to play', sound: 'achievement' });
  maybeRescan(true);
});
handle('emu:status', () => emulation.status());
handle('emu:install', async (e, id) => { await emulation.install(id); await maybeRescan(true); return emulation.status(); });
handle('emu:command', (e, cmd) => emulation.retroarch(cmd));
handle('emu:ps3fw', () => emulation.installPs3Firmware());
handle('emu:freeFiles', async () => { const done = await emulation.installFreeFiles(); await maybeRescan(true); return done; });
emulation.on('firmware', ({ name }) => toast({ kind: 'orb', icon: 'controller', title: `${name} installed`, text: 'PS3 games are ready', sound: 'achievement' }));
emulation.on('firmwareFailed', ({ error }) => toast({ title: 'PS3 firmware not installed', text: error, sound: 'error' }));
handle('emu:openFolder', async (e, kind, systemId) => {
  const d = emulation.dirs();
  const target = kind === 'bios' ? d.bios : kind === 'root' ? d.root : systemId ? emulation.romDir(emulation.system(systemId)) : d.roms;
  // Step aside so Explorer is visible; the Guide button brings the dashboard back.
  applyTaskbar(false);
  if (main) { main.setAlwaysOnTop(false); main.minimize(); }
  await shell.openPath(target);
  return target;
});

// ------------------------------------------------------------------ logs / backups / updates
handle('logs:tail', () => reliability.logger.tail(200));
handle('logs:open', async () => {
  applyTaskbar(false);
  if (main) { main.setAlwaysOnTop(false); main.minimize(); }
  return shell.openPath(reliability.logger.dir());
});
handle('renderer:error', (e, msg) => { console.error('[renderer]', String(msg).slice(0, 2000)); return true; });
handle('backups:list', () => backups.list());
handle('backups:create', () => backups.create('manual'));
// Restored files must not be overwritten by a pending save in the moment before the restart.
function freezeStores() { for (const st of [settings, library.lib, library.user, emulation.state, stores.state]) { try { st.freeze(); } catch { /* ignore */ } } }
handle('backups:restore', (e, id) => { backups.restore(id); freezeStores(); setTimeout(() => { if (AS_SHELL) app.exit(65); else { app.relaunch(relaunchArgs()); app.exit(0); } }, 600); return true; });
handle('backups:export', async () => {
  main.setAlwaysOnTop(false);
  const r = await dialog.showSaveDialog(main, { title: 'Export a backup', defaultPath: path.join(app.getPath('documents'), `Project 360 backup ${new Date().toISOString().slice(0, 10)}.p360backup`), filters: [{ name: 'Project 360 backup', extensions: ['p360backup'] }] });
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  if (r.canceled || !r.filePath) return null;
  return backups.exportTo(r.filePath);
});
handle('backups:import', async () => {
  main.setAlwaysOnTop(false);
  const r = await dialog.showOpenDialog(main, { title: 'Import a backup', properties: ['openFile'], filters: [{ name: 'Project 360 backup', extensions: ['p360backup', 'json'] }] });
  if (coverOn()) main.setAlwaysOnTop(true, 'normal');
  if (r.canceled || !r.filePaths[0]) return null;
  backups.importFrom(r.filePaths[0]);
  freezeStores();
  setTimeout(() => { if (AS_SHELL) app.exit(65); else { app.relaunch(relaunchArgs()); app.exit(0); } }, 600);
  return r.filePaths[0];
});
handle('update:status', () => ({ ...updater.status, configured: updater.configured(), packaged: app.isPackaged, repo: updater.repo() }));
handle('update:check', () => updater.check(false));
handle('update:download', () => updater.download());
handle('update:install', () => updater.install());

// ------------------------------------------------------------------ shortcuts
function registerShortcuts() {
  globalShortcut.unregisterAll();
  const hk = settings.get('console.guideHotkey');
  if (hk) { try { globalShortcut.register(hk, () => onGuide(0)); } catch (e) { console.warn('hotkey', e.message); } }
  // Fail-safe: always available way back to the Windows desktop.
  globalShortcut.register('Control+Alt+Shift+E', async () => {
    applyTaskbar(false);
    await system.launchExplorer();
    if (main) { main.setAlwaysOnTop(false); main.minimize(); }
  });
}

// ------------------------------------------------------------------ dev: scripted UI test
// P360_SCRIPT=steps.json with --dev: [{ "wait": 500 }, { "action": "rb" }, { "shot": "out.png" }, ...]
let launchedAt = 0;
let lingerPid = 0;
async function runDevScript(file) {
  const steps = JSON.parse(fs.readFileSync(file, 'utf8'));
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  await delay(2500);
  for (const s of steps) {
    if (s.wait) await delay(s.wait);
    if (s.action) send(inputTarget() || main, 'debug:action', s.action);
    if (s.guide) onGuide(0);
    if (s.overlayGuide) openOverlayGuide(0);
    if (s.closeOverlay) closeOverlayGuide();
    if (s.toast) toast(s.toast);
    if (s.eval) console.log('[dev] eval', JSON.stringify(await main.webContents.executeJavaScript(s.eval)));
    if (s.launchTest) {
      const t = typeof s.launchTest === 'string' ? { target: s.launchTest } : s.launchTest;
      launchedAt = Date.now();
      await launcher.launch({ id: 'dev:test', title: 'Launcher test', launch: { type: 'exe', target: t.target, args: t.args || [] }, watch: { dirs: [], exes: t.exes || [] } }, t.kind || 'media');
    }
    if (s.hideGameWindow && launcher.current && launcher.current.window) {
      lingerPid = launcher.current.mainPid; // simulate a game whose process outlives its window
      await native.call('wins.hide', launcher.current.window.hwnd);
    }
    if (s.killLinger && lingerPid) { try { require('child_process').execFileSync('taskkill.exe', ['/PID', String(lingerPid), '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* gone */ } }
    if (s.killMain && launcher.current && launcher.current.mainPid) {
      // Only the exact process the test launched.
      require('child_process').execFileSync('taskkill.exe', ['/PID', String(launcher.current.mainPid), '/F'], { windowsHide: true, stdio: 'ignore' });
    }
    if (s.waitIdle) {
      const t0 = Date.now();
      while (launcher.current && Date.now() - t0 < s.waitIdle) await delay(100);
      console.log('[dev] idle after', Date.now() - t0, 'ms; mainVisible', mainVisible());
    }
    if (s.state) console.log('[dev] launcher', JSON.stringify(launcher.state()), 'mainVisible', mainVisible(), 'overlayVisible', !!overlay && overlay.isVisible(), 'emu', emuOn);
    if (s.forceClose) await launcher.forceClose();
    if (s.hang) { const until = Date.now() + s.hang; while (Date.now() < until) { /* dev: simulate a frozen main process */ } }
    if (s.storeDownloadTest) {
      // Exercise the download manager with a local URL (no store account needed).
      const job = {
        id: `test-${Date.now()}`, store: 'gog', gameId: 'dev-test', optionId: 'x', title: s.storeDownloadTest.title || 'Download Test',
        image: null, install: 'auto', installAfter: true, dir: path.join(stores.downloadDir(), 'Download Test'),
        files: [{ url: s.storeDownloadTest.url, name: 'test.zip', size: 0, received: 0, done: false, path: null }], state: 'queued', createdAt: Date.now(),
      };
      stores.jobs().unshift(job);
      stores.pump();
    }
    if (s.dlState) console.log('[dev] downloads', JSON.stringify(stores.view().map((d) => ({ t: d.title, s: d.state, r: d.received, tot: d.total, e: d.error, exe: d.installedExe }))));
    if (s.shot) {
      const win = s.overlay ? overlay : main;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(s.shot, img.toPNG());
      console.log('[dev] shot', s.shot);
    }
    if (s.quit) app.exit(0);
  }
}

// ------------------------------------------------------------------ boot
app.whenReady().then(() => {
  protocol.handle('p360', async (req) => {
    try {
      const u = new URL(req.url);
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (u.hostname === 'media' || u.hostname === 'thumb') {
        const file = unb64url(parts[0] || '');
        const lm = svc('localmedia');
        if (!lm || !lm.isAllowedPath(file) || !fs.existsSync(file)) return new Response('forbidden', { status: 403 });
        if (u.hostname === 'thumb') return new Response(await thumbnail(file), { headers: { 'content-type': 'image/jpeg', 'cache-control': 'max-age=31536000' } });
        return serveFile(req, file);
      }
      let file;
      if (u.hostname === 'art') file = path.join(USER, 'art', safeId(parts[0]), parts[1].replace(/[^a-z]/g, ''));
      else if (u.hostname === 'sounds') file = path.join(SOUNDS_DIR, path.basename(parts[0]), path.basename(parts[1]));
      if (!file || !fs.existsSync(file)) return new Response('not found', { status: 404 });
      const buf = await fs.promises.readFile(file);
      const ext = path.extname(file).toLowerCase();
      const mime = ext === '.ogg' ? 'audio/ogg' : ext === '.wav' ? 'audio/wav' : ext === '.mp3' ? 'audio/mpeg' : sniffMime(buf);
      return new Response(buf, { headers: { 'content-type': mime, 'cache-control': 'max-age=31536000' } });
    } catch (e) {
      return new Response(String(e.message), { status: 500 });
    }
  });

  launcher.screen = screen.getPrimaryDisplay().size;
  native.start();
  createMain();
  createOverlay();
  createCurtain();
  const recoveredToast = () => toast({ kind: 'orb', icon: 'restart', title: 'Dashboard recovered', text: 'Something went wrong and was fixed automatically', sound: 'toast' });
  reliability.guardWindow(main, 'dashboard', { onRecovered: recoveredToast });
  reliability.guardWindow(overlay, 'overlay', {
    onRecovered: () => {
      overlayGuideOpen = false;
      overlayToasts = false;
      if (overlay && !overlay.isDestroyed()) { overlay.setIgnoreMouseEvents(true); overlay.hide(); }
      updateEmu();
    },
  });
  try { backups.autoDaily(); } catch (e) { console.warn('[backup] daily backup failed:', e.message); }
  updater.blocked = () => !!launcher.current; // never interrupt a game
  updater.on('status', (st) => broadcast('update:status', st));
  updater.on('ready', (v) => toast({ kind: 'orb', icon: 'restart', title: `Update ${v} ready`, text: 'Installs when you restart · System › Updates', sound: 'toast', duration: 6000 }));
  updater.on('installing', () => { try { backups.create('update'); } catch { /* ignore */ } });
  updater.init();
  // Warm up the Bluetooth/Wi-Fi helper so System › Bluetooth opens instantly.
  setTimeout(() => radio.prewarm(), 8000);
  registerShortcuts();
  if (settings.get('console.startWithWindows')) system.setStartup(true);
  setTimeout(() => maybeRescan(true), 800);
  setTimeout(() => { stores.pump(); stores.resumeClientWatches(); }, 4000);
  if (DEV) {
    for (const w of [main, overlay]) w.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[renderer:${w === main ? 'main' : 'overlay'}]`, e.message, e.sourceId ? `${e.sourceId}:${e.lineNumber}` : '');
    });
    if (process.env.P360_SCRIPT) runDevScript(process.env.P360_SCRIPT).catch((e) => console.error('[dev script]', e));
  }
});

app.on('second-instance', () => { if (main) restoreDashboard(); });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  library.flush();
  settings.flush();
  if (emuOn) native.call('emu.off').catch(() => {});
  if (taskbarHidden) native.call('taskbar.show').catch(() => {});
  native.stop();
  radio.stop();
  if (AS_SHELL && updater.installing) app.exit(66); // shell launcher waits for the installer, then relaunches
});
process.on('uncaughtException', (e) => console.error('[main] uncaught', e));
