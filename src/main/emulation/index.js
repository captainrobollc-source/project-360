// Built-in emulation: an EmuDeck-style folder layout, one-click installs of official
// open-source emulators, pre-configured for controller + full screen, ROM scanning into the
// library, and RetroArch control (save/load state, reset, menu) from the Guide.
const { app } = require('electron');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const dgram = require('dgram');
const fs = require('fs');
const path = require('path');
const { JsonStore } = require('../store');
const { hash, sortTitle } = require('../library/util');
const { SYSTEMS, EMULATORS, RA_CORES, SYSTEM_ASSETS, PS3_UPDATE_LIST } = require('./catalog');
const mv = require('./move');

const SEVENZR = 'https://www.7-zip.org/a/7zr.exe';
const MOVE_MARKER = '.p360-move-incomplete';
const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

function run(file, args, opts = {}) {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 30 * 60 * 1000, ...opts },
    (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })));
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

function findFile(dir, re, depth = 4) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && re.test(e.name)) return path.join(dir, e.name);
  if (depth <= 0) return null;
  for (const e of entries) if (e.isDirectory()) { const f = findFile(path.join(dir, e.name), re, depth - 1); if (f) return f; }
  return null;
}

// Display title from a file or folder name (no extension):
//   "Pokémon HeartGold (NTR-IPKE) (Rev. 0)"                    → "Pokémon HeartGold"
//   "SUPER MARIO 3D WORLD [Game]0005000010145d00](axekin.com)" → "Super Mario 3D World"
//   "The Legend of Zelda_ Phantom Hourglass"                    → "The Legend of Zelda: Phantom Hourglass"
const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs']);
const ROMAN = /^(i{1,3}|iv|vi{0,3}|ix|x|xi{1,3})$/i;
function titleCase(s) {
  return s.split(' ').map((w, i) => {
    if (/\d/.test(w) || ROMAN.test(w)) return w.toUpperCase(); // 3D, 64, II
    const lw = w.toLowerCase();
    if (i > 0 && SMALL_WORDS.has(lw)) return lw;
    return lw.charAt(0).toUpperCase() + lw.slice(1);
  }).join(' ');
}
function cleanTitle(name) {
  let t = String(name);
  if (!/\s/.test(t) && /\./.test(t)) t = t.replace(/\./g, ' ');          // Scene.Style.Names
  t = t.replace(/_\s+/g, ': ').replace(/_+/g, ' ');                        // "Zelda_ Phantom": a colon that couldn't be a file name
  t = t.replace(/\s*[([][^)\]]*[)\]]/g, ' ');                              // (USA) [!] (Rev 1) (Disc 1) (site.com)
  t = t.replace(/\b[0-9a-f]{16}\b/gi, ' ');                                // Wii U / Xbox 360 title ids
  t = t.replace(/[[\]()]/g, ' ');                                          // brackets left unbalanced
  t = t.replace(/\b[\w-]+\.(com|net|org|info|io|co|to)\b/gi, ' ');           // download-site tags
  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–:,]+|[\s\-–:,]+$/g, '').trim();
  // SHOUTED NAMES (three words or more, so "FIFA 09" stays) get normal capitals.
  if (t.split(' ').filter((w) => /[A-Z]/.test(w)).length >= 3 && t === t.toUpperCase()) t = titleCase(t);
  return t || String(name).trim();
}
const discOf = (name) => { const m = /[([]\s*(?:disc|disk|cd)\s*(\d+)/i.exec(name); return m ? Number(m[1]) : 0; };
// The name with its disc tag removed: discs of one game (same region, same version) share it.
const discKey = (name) => String(name).replace(/\s*[([]\s*(?:disc|disk|cd)\s*\d+[^)\]]*[)\]]/i, '').trim().toLowerCase();
// A Wii U NUS folder holds a game (title id 00050000…), not an update (0005000E…) or DLC
// (0005000C…). The id is read from title.tmd, or from the folder name when the file is short.
function wiiuGame(tmd, folderName) {
  let high = null;
  try {
    const fd = fs.openSync(tmd, 'r');
    try { const b = Buffer.alloc(4); if (fs.readSync(fd, b, 0, 4, 0x18c) === 4) high = b.toString('hex'); } finally { fs.closeSync(fd); }
  } catch { /* unreadable: use the name */ }
  if (!high || !/^0005/.test(high)) { const m = /\b(0005000[0-9a-f])[0-9a-f]{8}\b/i.exec(folderName); high = m ? m[1].toLowerCase() : null; }
  if (high === '0005000e' || high === '0005000c') return false;
  return !/[[(]\s*(update|dlc|patch)\s*[\])]/i.test(folderName);
}

// Names that say nothing about the game: use the folder's name instead.
const GENERIC = /^(default|eboot|game|title|boot|main|disc|image)$/i;
function titleFrom(file, folderName) {
  const base = path.basename(file, path.extname(file));
  return cleanTitle(GENERIC.test(base) && folderName ? folderName : base);
}

// Sets the keys we manage in an INI (or simple TOML) file, editing lines in place. Everything else
// is kept exactly: other keys, repeated keys (DuckStation/PCSX2 lists), comments, order.
function writeIni(file, sections, eol = '\r\n', sep = ' = ') {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { /* new */ }
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const todo = {};
  for (const [s, kv] of Object.entries(sections)) todo[s] = { ...kv };
  const out = [];
  const finishSection = (sec) => {
    const rest = todo[sec];
    if (!rest) return;
    delete todo[sec];
    const keys = Object.entries(rest);
    if (!keys.length) return;
    let blanks = 0;
    while (out.length && out[out.length - 1].trim() === '') { out.pop(); blanks++; }
    for (const [k, v] of keys) out.push(`${k}${sep}${v}`);
    while (blanks-- > 0) out.push('');
  };
  let cur = '';
  for (const line of lines) {
    const sec = line.match(/^\s*\[(.+)\]\s*$/);
    if (sec) { finishSection(cur); cur = sec[1].trim(); out.push(line); continue; }
    const kv = line.match(/^\s*([^=;#]+?)\s*=/);
    if (kv && todo[cur] && Object.prototype.hasOwnProperty.call(todo[cur], kv[1])) {
      out.push(`${kv[1]}${sep}${todo[cur][kv[1]]}`);
      delete todo[cur][kv[1]];
      continue;
    }
    out.push(line);
  }
  finishSection(cur);
  for (const sec of Object.keys(todo)) {
    if (!Object.keys(todo[sec]).length) continue;
    if (out.length) out.push('');
    if (sec) out.push(`[${sec}]`);
    finishSection(sec);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join(eol) + eol);
}
// The value of section/key in an INI file, or undefined.
function iniGet(file, section, key) {
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return undefined; }
  let cur = '';
  for (const line of lines) {
    const sec = line.match(/^\s*\[(.+)\]\s*$/);
    if (sec) { cur = sec[1].trim(); continue; }
    const kv = line.match(/^\s*([^=;#]+?)\s*=\s*(.*)$/);
    if (kv && cur === section && kv[1] === key) return kv[2].trim();
  }
  return undefined;
}
// Every key of one INI section.
function iniSection(file, section) {
  const out = {};
  let lines = [];
  try { lines = fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return out; }
  let cur = '';
  for (const line of lines) {
    const sec = line.match(/^\s*\[(.+)\]\s*$/);
    if (sec) { cur = sec[1].trim(); continue; }
    const kv = line.match(/^\s*([^=;#]+?)\s*=\s*(.*)$/);
    if (kv && cur === section) out[kv[1]] = kv[2].trim();
  }
  return out;
}
// Player 1 hasn't been set up by the player: no bindings, or only the keyboard keys an emulator
// maps by itself, on a plain controller type (a guitar, gun or mouse setup is theirs).
function padFree(file, types) {
  const p = iniSection(file, 'Pad1');
  if (p.Type && !types.includes(p.Type)) return false;
  return Object.entries(p).filter(([k]) => k !== 'Type').every(([, v]) => !v || /^Keyboard\//i.test(v));
}
const writeOnce = (file, body) => { if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); } };

// Controller bindings, matching what each emulator's own "automatic mapping" writes for an SDL
// game controller (checked against their source), minus the Guide button, which belongs to
// Project 360. Only written when the player has no bindings of their own.
const SDL_AXES = { LLeft: '-LeftX', LRight: '+LeftX', LUp: '-LeftY', LDown: '+LeftY', RLeft: '-RightX', RRight: '+RightX', RUp: '-RightY', RDown: '+RightY' };
const padBinds = (faces) => {
  const o = {
    Up: 'DPadUp', Right: 'DPadRight', Down: 'DPadDown', Left: 'DPadLeft', ...faces,
    Select: 'Back', Start: 'Start', L1: 'LeftShoulder', R1: 'RightShoulder', L2: '+LeftTrigger', R2: '+RightTrigger',
    L3: 'LeftStick', R3: 'RightStick', ...SDL_AXES, LargeMotor: 'LargeMotor', SmallMotor: 'SmallMotor',
  };
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, `SDL-0/${v}`]));
};
const DUCK_PAD = { Type: 'AnalogController', ...padBinds({ Triangle: 'Y', Circle: 'B', Cross: 'A', Square: 'X' }) };
const PCSX2_PAD = { Type: 'DualShock2', ...padBinds({ Triangle: 'FaceNorth', Circle: 'FaceEast', Cross: 'FaceSouth', Square: 'FaceWest' }) };
// Cemu: Wii U GamePad on XInput controller 1 (Cemu's own XInput defaults; positional face buttons).
const CEMU_MAP = [[1, 13], [2, 12], [3, 15], [4, 14], [5, 8], [6, 9], [7, 42], [8, 43], [9, 4], [10, 5], [11, 0], [12, 1], [13, 2], [14, 3], [15, 6], [16, 7], [17, 39], [18, 45], [19, 44], [20, 38], [21, 41], [22, 47], [23, 46], [24, 40]];
const CEMU_PAD = ['<?xml version="1.0" encoding="UTF-8"?>', '<emulated_controller>', '\t<type>Wii U GamePad</type>', '\t<toggle_display>0</toggle_display>', '\t<controller>',
  '\t\t<api>XInput</api>', '\t\t<uuid>0</uuid>', '\t\t<display_name>Controller 1</display_name>', '\t\t<rumble>0.5</rumble>',
  '\t\t<axis><deadzone>0.15</deadzone><range>1</range></axis>', '\t\t<rotation><deadzone>0.15</deadzone><range>1</range></rotation>', '\t\t<trigger><deadzone>0.15</deadzone><range>1</range></trigger>',
  '\t\t<mappings>', ...CEMU_MAP.map(([m, b]) => `\t\t\t<entry><mapping>${m}</mapping><button>${b}</button></entry>`), '\t\t</mappings>', '\t</controller>', '</emulated_controller>', ''].join('\r\n');
const CEMU_SETTINGS = '<?xml version="1.0" encoding="UTF-8"?>\r\n<content>\r\n\t<check_update>false</check_update>\r\n\t<fullscreen>true</fullscreen>\r\n</content>\r\n';
// RPCS3: player 1 on XInput (a fresh RPCS3 uses the keyboard); PS button on Back+Start, not Guide.
const RPCS3_PAD = 'Player 1 Input:\n  Handler: XInput\n  Device: "XInput Pad #1"\n  Config:\n    PS Button: "Back&Start"\n  Buddy Device: ""\n';
// RetroArch screen styles (per launch, through --appendconfig). CRT/LCD use shaders the RetroArch
// download ships in shaders\shaders_slang.
const SCREENS = {
  standard: { label: 'Standard' },
  pixel: { label: 'Pixel perfect', cfg: 'video_scale_integer = "true"\nvideo_smooth = "false"\n' },
  smooth: { label: 'Smooth', cfg: 'video_smooth = "true"\n' },
  retro: { label: 'CRT / LCD', cfg: 'video_shader_enable = "true"\n', tv: 'crt/crt-easymode.slangp', handheld: 'handheld/lcd-grid-v2.slangp' },
};
const HANDHELDS = new Set(['gb', 'gbc', 'gba', 'nds', 'gg', 'ngp']);
const CONFIG_VERSION = 2; // bump to re-run configure() for installed emulators after an update

const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

class Emulation extends EventEmitter {
  constructor({ userDir, settings }) {
    super();
    this.settings = settings;
    this.state = new JsonStore(path.join(userDir, 'emulation.json'), { emulators: {}, cores: {} });
    this.progress = {}; // id → { phase, received, total, error }
    this.ensureFolders();
    if ((this.state.data.configVersion || 0) < CONFIG_VERSION) setTimeout(() => this.reconfigureAll(), 4000);
  }

  reconfigureAll() {
    if (!this.driveReady() || this.moving) return;
    for (const e of EMULATORS) if (this.exeOf(e.id)) { try { this.configure(e.id); } catch (err) { console.error('[emulation] configure', e.id, err.message); } }
    this.state.data.configVersion = CONFIG_VERSION;
    this.state.save();
  }

  root() { return this.settings.get('emulation.root') || path.join(app.getPath('home'), 'Emulation'); }
  dirs() {
    const r = this.root();
    return { root: r, roms: path.join(r, 'roms'), bios: path.join(r, 'bios'), emulators: path.join(r, 'emulators'), saves: path.join(r, 'saves'), states: path.join(r, 'states'), tools: path.join(r, 'tools'), downloads: path.join(r, 'downloads') };
  }
  romDir(sys) { return path.join(this.dirs().roms, sys.id); }

  // The drive the Emulation folder lives on is plugged in (an external drive may not be).
  driveReady() { try { return fs.existsSync(path.parse(path.resolve(this.root())).root); } catch { return false; } }

  ensureFolders() {
    if (!this.driveReady()) return; // external drive unplugged: don't fail start-up over it
    try { this.makeFolders(); } catch (e) { console.error('[emulation] folders:', e.message); }
  }

  makeFolders() {
    const d = this.dirs();
    for (const k of ['roms', 'bios', 'emulators', 'saves', 'states', 'tools']) fs.mkdirSync(d[k], { recursive: true });
    for (const s of SYSTEMS) {
      const dir = this.romDir(s);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const readme = path.join(dir, '_put_games_here.txt');
      if (!fs.existsSync(readme)) {
        fs.writeFileSync(readme, `${s.name}\r\nPut your ${s.short} games here: ${s.exts.map((e) => '.' + e).join(' ')}` +
          (s.folders === 'ps3' ? '\r\nPS3 games can also be folders containing PS3_GAME\\USRDIR\\EBOOT.BIN.' : '') +
          (s.folders === 'wiiu' ? '\r\nWii U games can also be folders containing code\\*.rpx.' : '') + '\r\n');
      }
    }
    const biosReadme = path.join(d.bios, '_put_bios_here.txt');
    if (!fs.existsSync(biosReadme)) {
      fs.writeFileSync(biosReadme, ['BIOS / firmware files (dump these from your own consoles):', ...SYSTEMS.filter((s) => s.bios).map((s) => `  ${s.short}: ${s.bios.map((b) => b.files.join(' or ')).join(' + ')}${s.bios.every((b) => b.optional) ? ' (optional)' : ''}`)].join('\r\n'));
    }
  }

  // ------------------------------------------------------------------ status
  emuInfo(id) { return this.state.data.emulators[id] || null; }
  exeOf(id) { const i = this.emuInfo(id); return i && i.exe && fs.existsSync(i.exe) ? i.exe : null; }
  coreDll(core) {
    const ra = this.exeOf('retroarch');
    if (!ra) return null;
    const f = path.join(path.dirname(ra), 'cores', `${core}_libretro.dll`);
    return fs.existsSync(f) ? f : null;
  }

  biosStatus(sys) {
    if (!sys.bios) return { ok: true, needed: [] };
    const dir = this.dirs().bios;
    let files = [];
    try { files = fs.readdirSync(dir); } catch { /* none */ }
    const lower = new Set(files.map((f) => f.toLowerCase()));
    const missing = [];
    const optionalMissing = [];
    for (const b of sys.bios) {
      const sizeOk = (f) => {
        if (!b.minSize && !b.maxSize) return true;
        try { const n = fs.statSync(path.join(dir, f)).size; return (!b.minSize || n >= b.minSize) && (!b.maxSize || n <= b.maxSize); } catch { return false; }
      };
      const has = b.files.some((f) => lower.has(f.toLowerCase()) || fs.existsSync(path.join(dir, f))) || (b.match && files.some((f) => b.match.test(f) && sizeOk(f)));
      if (!has) (b.optional ? optionalMissing : missing).push(b.files.join(' or '));
    }
    return { ok: !missing.length, missing, optionalMissing, optional: sys.bios.every((b) => b.optional) };
  }

  status() {
    const counts = this.lastCounts || {};
    return {
      quickResume: this.quickResume(),
      screen: this.screen(),
      screens: Object.entries(SCREENS).map(([id, s]) => ({ id, label: s.label })),
      setup: this.setupPlan(),
      root: this.root(),
      dirs: this.dirs(),
      driveReady: this.driveReady(),
      move: this.progress.move || null,
      emulators: EMULATORS.map((e) => ({ id: e.id, name: e.name, about: e.about, license: e.license, site: e.site, installed: !!this.exeOf(e.id), version: (this.emuInfo(e.id) || {}).version || '', progress: this.progress[e.id] || null })),
      systems: SYSTEMS.map((s) => {
        const eff = this.effective(s);
        const emu = EMULATORS.find((e) => e.id === eff.emulator);
        return {
          id: s.id, name: s.name, short: s.short, maker: s.maker, year: s.year, color: s.color, exts: s.exts, folders: !!s.folders,
          emulator: eff.emulator, emulatorName: emu ? emu.name : eff.emulator, core: eff.core || null,
          usingFallback: !!eff.usingFallback, fallbackNote: s.fallback ? s.fallback.note : '', canRunWithoutBios: !!s.fallback,
          emulatorInstalled: !!this.exeOf(eff.emulator), coreInstalled: eff.core ? !!this.coreDll(eff.core) : true,
          bios: this.biosStatus(s), romDir: this.romDir(s), games: counts[s.id] || 0,
        };
      }),
    };
  }

  setProgress(id, p) {
    if (p) this.progress[id] = { ...(this.progress[id] || {}), ...p };
    else delete this.progress[id];
    // At most one broadcast per 250 ms, carrying the latest state. (A debounce would starve while
    // a copy reports every 250 ms, and the UI would see nothing until the end.)
    if (!this.progressTimer) this.progressTimer = setTimeout(() => { this.progressTimer = null; this.emit('updated', this.status()); }, 250);
  }

  // ------------------------------------------------------------------ downloads / extraction
  // Downloads to "<dest>.part" and renames only when complete, so a dropped connection or a full
  // disk never leaves a truncated file that later passes an existsSync() check.
  async download(url, dest, id) {
    const ctrl = new AbortController();
    let stalled = false;
    const stall = () => { stalled = true; ctrl.abort(); };
    let idle = setTimeout(stall, 60000); // no data for a minute: give up
    const bump = () => { clearTimeout(idle); idle = setTimeout(stall, 60000); };
    let failed = null;
    const part = `${dest}.part`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Project360' }, redirect: 'follow', signal: ctrl.signal });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const total = Number(res.headers.get('content-length')) || 0;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const out = fs.createWriteStream(part);
      out.on('error', (e) => { failed = e; ctrl.abort(); });
      let received = 0;
      let last = 0;
      try {
        for await (const chunk of res.body) {
          if (failed) break;
          bump();
          received += chunk.length;
          if (!out.write(chunk)) {
            await new Promise((r) => {
              const done = () => { out.off('drain', done); out.off('error', done); r(); };
              out.once('drain', done);
              out.once('error', done);
            });
          }
          if (id && Date.now() - last > 300) { last = Date.now(); this.setProgress(id, { phase: 'downloading', received, total }); }
        }
      } finally {
        await new Promise((r) => { if (out.destroyed) r(); else out.end(r); });
      }
      if (failed) throw failed;
      if (total && received < total) throw new Error('Download was interrupted');
      fs.renameSync(part, dest);
      return dest;
    } catch (e) {
      try { fs.unlinkSync(part); } catch { /* not created */ }
      throw failed || (stalled ? new Error('Download stalled; check your connection and try again') : e);
    } finally {
      clearTimeout(idle);
    }
  }

  async sevenZip() {
    const exe = path.join(this.dirs().tools, '7zr.exe');
    if (fs.existsSync(exe)) return exe;
    return this.once('7zr', async () => { if (!fs.existsSync(exe)) await this.download(SEVENZR, exe); return exe; });
  }

  // One in-flight promise per task key: concurrent callers wait for the same work.
  once(key, fn) {
    if (!this.inflight) this.inflight = new Map();
    if (!this.inflight.has(key)) this.inflight.set(key, Promise.resolve().then(fn).finally(() => this.inflight.delete(key)));
    return this.inflight.get(key);
  }

  async extract(archive, dest, kind) {
    fs.mkdirSync(dest, { recursive: true });
    if (kind === '7z') {
      const r = await run(await this.sevenZip(), ['x', archive, `-o${dest}`, '-y']);
      if (r.err) throw new Error('Could not extract the 7z archive');
    } else {
      const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath ${psq(archive)} -DestinationPath ${psq(dest)} -Force`]);
      if (r.err) throw new Error('Could not extract the archive');
    }
  }

  // ------------------------------------------------------------------ install
  install(id) {
    if (!EMULATORS.some((e) => e.id === id)) return Promise.reject(new Error('Unknown emulator'));
    return this.once(`install:${id}`, () => this.installNow(id));
  }

  async installNow(id) {
    const emu = EMULATORS.find((e) => e.id === id);
    this.notMoving();
    try {
      this.setProgress(id, { phase: 'resolving', received: 0, total: 0, error: null });
      const src = await emu.source();
      const d = this.dirs();
      const archive = path.join(d.downloads, `${id}.${src.kind}`);
      await this.download(src.url, archive, id);
      this.setProgress(id, { phase: 'extracting' });
      const dest = path.join(d.emulators, id);
      await this.extract(archive, dest, src.kind);
      try { fs.unlinkSync(archive); } catch { /* ignore */ }
      const exe = findFile(dest, emu.exe);
      if (!exe) throw new Error('Installed, but the program file wasn’t found');
      this.state.data.emulators[id] = { exe, version: src.version || '', installedAt: Date.now() };
      this.state.save();
      await this.configure(id);
      if (id === 'retroarch') {
        try { await this.installAsset('info'); } catch { /* optional */ }
        this.installCoresForGames().catch(() => { /* each game still fetches its core when played */ });
      }
      this.setProgress(id, null);
      this.emit('installed', { id, name: emu.name });
      if (id === 'rpcs3') this.installPs3Firmware().then(() => this.emit('firmware', { name: 'PS3 system software' })).catch((e) => this.emit('firmwareFailed', { error: e.message }));
      return exe;
    } catch (e) {
      this.setProgress(id, { phase: 'failed', error: e.message });
      throw e;
    }
  }

  installCore(core) { return this.once(`core:${core}`, () => this.installCoreNow(core)); }

  async installCoreNow(core) {
    this.notMoving();
    const ra = this.exeOf('retroarch');
    if (!ra) throw new Error('Install RetroArch first');
    const key = `core:${core}`;
    this.setProgress(key, { phase: 'downloading', received: 0, total: 0 });
    try {
      const zip = path.join(this.dirs().downloads, `${core}.zip`);
      await this.download(`${RA_CORES}/${core}_libretro.dll.zip`, zip, key);
      await this.extract(zip, path.join(path.dirname(ra), 'cores'), 'zip');
      try { fs.unlinkSync(zip); } catch { /* ignore */ }
      this.state.data.cores[core] = Date.now();
      this.state.save();
      if (SYSTEM_ASSETS[core]) await this.installAsset(core);
      this.setProgress(key, null);
      return this.coreDll(core);
    } catch (e) {
      this.setProgress(key, { phase: 'failed', error: e.message });
      throw e;
    }
  }

  // Controller-ready, full-screen, no first-run wizards, BIOS folder wired up.
  async configure(id) {
    const exe = this.exeOf(id);
    if (!exe) return;
    const dir = path.dirname(exe);
    const d = this.dirs();
    const fwd = (p) => p.replace(/\\/g, '/');
    if (id === 'retroarch') {
      const cfg = path.join(dir, 'retroarch.cfg');
      const want = {
        video_fullscreen: 'true', video_windowed_fullscreen: 'true', pause_nonactive: 'false',
        confirm_on_exit: 'false', quit_press_twice: 'false', config_save_on_exit: 'false',
        network_cmd_enable: 'true', network_cmd_port: '55355',
        system_directory: fwd(d.bios), savefile_directory: fwd(path.join(d.saves, 'retroarch')), savestate_directory: fwd(path.join(d.states, 'retroarch')),
        menu_driver: 'xmb', input_autoconfig_enable: 'true', input_menu_toggle_gamepad_combo: '2', // L3+R3; the Guide button belongs to Project 360
        notification_show_autoconfig: 'false', video_font_enable: 'true', savestate_thumbnail_enable: 'true', auto_screenshot_filename: 'true',
        // Quick Resume: the state is saved on the way out and loaded on the next start.
        savestate_auto_save: this.quickResume() ? 'true' : 'false', savestate_auto_load: this.quickResume() ? 'true' : 'false',
      };
      let text = '';
      try { text = fs.readFileSync(cfg, 'utf8'); } catch { /* new */ }
      for (const [k, v] of Object.entries(want)) {
        const line = `${k} = "${v}"`;
        const re = new RegExp(`^${k}\\s*=.*$`, 'm');
        text = re.test(text) ? text.replace(re, line) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
      }
      fs.mkdirSync(path.join(d.saves, 'retroarch'), { recursive: true });
      fs.mkdirSync(path.join(d.states, 'retroarch'), { recursive: true });
      fs.writeFileSync(cfg, text);
      // The shipped controller profiles open RetroArch's menu with the Guide button, on top of
      // Project 360's Guide. Its menu stays on L3+R3 and in the Guide's Emulator section.
      for (const sub of ['xinput', 'sdl2', 'dinput', 'hid']) {
        const ad = path.join(dir, 'autoconfig', sub);
        let files = [];
        try { files = fs.readdirSync(ad).filter((f) => f.toLowerCase().endsWith('.cfg')); } catch { continue; }
        for (const f of files) {
          const p = path.join(ad, f);
          try {
            const t = fs.readFileSync(p, 'utf8');
            const lines = t.split('\n');
            const kept = lines.filter((l) => !/^[ \t]*input_menu_toggle_btn/.test(l));
            if (kept.length !== lines.length) fs.writeFileSync(p, kept.join('\n'));
          } catch { /* leave that profile as it is */ }
        }
      }
    } else if (id === 'duckstation') {
      fs.writeFileSync(path.join(dir, 'portable.txt'), '');
      const ini = path.join(dir, 'settings.ini');
      const pad = padFree(ini, ['AnalogController', 'DigitalController']);
      writeIni(ini, {
        Main: { SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmPowerOff: 'false', SaveStateOnExit: 'true' },
        BIOS: { SearchDirectory: d.bios },
        AutoUpdater: { CheckAtStartup: 'false' },
        ...(pad ? { InputSources: { SDL: 'true' }, Pad1: DUCK_PAD } : {}),
      });
    } else if (id === 'pcsx2') {
      fs.writeFileSync(path.join(dir, 'portable.ini'), '');
      const ini = path.join(dir, 'inis', 'PCSX2.ini');
      const pad = padFree(ini, ['DualShock2']);
      writeIni(ini, {
        // Without a SettingsVersion PCSX2 offers to reset every setting on start.
        UI: { ...(iniGet(ini, 'UI', 'SettingsVersion') === undefined ? { SettingsVersion: '1' } : {}), SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmShutdown: 'false', HideMouseCursor: 'true' },
        Folders: { Bios: d.bios },
        AutoUpdater: { CheckAtStartup: 'false' },
        ...(pad ? { InputSources: { SDL: 'true' }, Pad1: PCSX2_PAD } : {}),
      });
    } else if (id === 'cemu') {
      const p = path.join(dir, 'portable');
      fs.mkdirSync(path.join(p, 'controllerProfiles'), { recursive: true });
      writeOnce(path.join(p, 'settings.xml'), CEMU_SETTINGS); // no settings.xml = the Getting Started window
      writeOnce(path.join(p, 'controllerProfiles', 'controller0.xml'), CEMU_PAD);
    } else if (id === 'rpcs3') {
      const base = fs.existsSync(path.join(dir, 'portable')) ? path.join(dir, 'portable') : dir;
      writeOnce(path.join(base, 'config', 'input_configs', 'global', 'Default.yml'), RPCS3_PAD);
      writeOnce(path.join(base, 'config', 'config.yml'), 'Miscellaneous:\n  Start games in fullscreen mode: true\n');
      // No welcome box, and closing the game window doesn't ask "Exit Game?" (it would block closing).
      writeIni(path.join(base, 'GuiConfigs', 'CurrentSettings.ini'), { main_window: { infoBoxEnabledWelcome: 'false', confirmationBoxExitGame: 'false' } }, '\n', '=');
    } else if (id === 'xenia') {
      fs.writeFileSync(path.join(dir, 'portable.txt'), '');
      // Full screen, and the Guide button isn't passed to the game (it opens Project 360's Guide).
      writeIni(path.join(dir, 'xenia-canary.config.toml'), { Display: { fullscreen: 'true' }, HID: { guide_button: 'false' } }, '\n');
    } else if (id === 'xemu') {
      const b = (n) => { const f = findFile(d.bios, new RegExp(`^${n}$`, 'i'), 0); return f ? fwd(f) : ''; };
      const files = {};
      for (const [key, name] of [['bootrom_path', 'mcpx_1.0.bin'], ['flashrom_path', 'complex_4627.bin'], ['hdd_path', 'xbox_hdd.qcow2']]) {
        const f = b(name);
        if (f) files[key] = tomlStr(f); // found in the BIOS folder; otherwise leave the user's setting
      }
      writeIni(path.join(dir, 'xemu.toml'), {
        general: { show_welcome: 'false' },
        'display.window': { fullscreen_on_startup: 'true' },
        'sys.files': files,
      }, '\n');
    }
  }

  // ------------------------------------------------------------------ ROM scan → library entries
  scanSystem(sys) {
    const dir = this.romDir(sys);
    const extra = (this.settings.get(`emulation.extraFolders.${sys.id}`) || []);
    const exts = new Set(sys.exts);
    const out = [];
    // Files that belong to another entry: discs listed by an .m3u playlist, tracks listed by a
    // .cue or .gdi sheet. Only those are hidden (a loose ISO or a single-disc game next to a
    // playlist still shows up).
    const listed = new Set();
    const key = (p) => path.resolve(p).toLowerCase();
    const readLines = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/); } catch { return []; } };
    const noteMembers = (d, f, ext) => {
      if (ext === 'm3u' && exts.has('m3u')) {
        for (const line of readLines(f)) { const t = line.trim(); if (t && !t.startsWith('#')) listed.add(key(path.resolve(d, t))); }
      } else if (ext === 'cue') {
        for (const line of readLines(f)) { const m = /^\s*FILE\s+"?([^"]+?)"?\s+\w+\s*$/i.exec(line); if (m) listed.add(key(path.resolve(d, m[1]))); }
      } else if (ext === 'gdi') {
        for (const line of readLines(f).slice(1)) { const parts = line.trim().split(/\s+/); if (parts.length >= 5) listed.add(key(path.resolve(d, parts[4].replace(/"/g, '')))); }
      }
    };
    const has = (d, name) => { try { return fs.readdirSync(d).find((x) => x.toLowerCase() === name.toLowerCase()) || null; } catch { return null; } };
    const walk = (d, depth) => {
      if (depth > 3) return;
      let entries = [];
      try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const f = path.join(d, e.name);
        let isDir = e.isDirectory();
        if (e.isSymbolicLink()) { try { isDir = fs.statSync(f).isDirectory(); } catch { continue; } } // junction / symlink
        if (isDir) {
          // Folder-based games
          if (sys.folders === 'ps3') {
            const eboot = [path.join(f, 'PS3_GAME', 'USRDIR', 'EBOOT.BIN'), path.join(f, 'USRDIR', 'EBOOT.BIN')].find((x) => fs.existsSync(x));
            if (eboot) { out.push({ file: eboot, title: cleanTitle(e.name), disc: discOf(e.name), gk: discKey(e.name) }); continue; }
          }
          if (sys.folders === 'wiiu') {
            const rpx = findFile(path.join(f, 'code'), /\.rpx$/i, 0);
            if (rpx) { out.push({ file: rpx, title: cleanTitle(e.name) }); continue; }
            // NUS format (title.tmd + title.tik + .app/.h3 contents, as downloaded): boots from the .tmd.
            const tmd = has(f, 'title.tmd');
            if (tmd) {
              if (!wiiuGame(path.join(f, tmd), e.name)) continue; // an update or DLC: Cemu installs those, they don't boot
              out.push({ file: path.join(f, tmd), title: cleanTitle(e.name) });
              continue;
            }
          }
          if (sys.folders === 'x360') {
            const xex = has(f, 'default.xex'); // an extracted disc
            if (xex) { out.push({ file: path.join(f, xex), title: cleanTitle(e.name), disc: discOf(e.name), gk: discKey(e.name) }); continue; }
          }
          walk(f, depth + 1);
          continue;
        }
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (ext === 'm3u' || ext === 'cue' || ext === 'gdi') noteMembers(d, f, ext);
        if (!exts.has(ext)) continue;
        // A disc inside a folder of its own ("Skate 3 (USA)/Skate 3 (USA).iso") is still one game.
        const base = path.basename(e.name, path.extname(e.name));
        const disc = discOf(base) || discOf(path.basename(d));
        out.push({ file: f, title: titleFrom(f, path.basename(d)), disc, gk: discKey(discOf(base) ? base : path.basename(d)) });
      }
    };
    for (const d of [dir, ...extra]) walk(d, 0);
    return this.groupDiscs(sys, out.filter((r) => !listed.has(key(r.file))));
  }

  // "Game (Disc 1)", "Game (Disc 2)" → one entry that starts disc 1. Systems that understand
  // .m3u playlists get one (in <Emulation>/playlists) so the emulator can swap discs.
  groupDiscs(sys, list) {
    const groups = new Map();
    const out = [];
    for (const r of list) {
      if (!r.disc) { out.push(r); continue; }
      const k = r.gk || r.title.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const discs of groups.values()) {
      discs.sort((a, b) => a.disc - b.disc || a.file.localeCompare(b.file));
      if (discs.length === 1) { out.push({ ...discs[0], discs: 1 }); continue; }
      // The playlist is named after disc 1's file, so RetroArch keeps using the battery save,
      // memory card and states it already made for that disc (and regions never share one).
      let m3u = null;
      if (sys.exts.includes('m3u')) {
        const f = path.join(this.dirs().root, 'playlists', sys.id, `${path.basename(discs[0].file, path.extname(discs[0].file))}.m3u`);
        const body = discs.map((x) => x.file).join('\r\n') + '\r\n';
        try {
          let cur = null;
          try { cur = fs.readFileSync(f, 'utf8'); } catch { /* new */ }
          if (cur !== body) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
          m3u = f;
        } catch { /* read-only drive: list the discs one by one instead */ }
      }
      if (m3u) out.push({ ...discs[0], discs: discs.length, launchFile: m3u });
      else for (const d of discs) out.push({ ...d, title: `${d.title} (Disc ${d.disc})`, discs: 1 }); // no disc swapping here: one entry per disc
    }
    return out;
  }
  // The emulator/core a system actually uses: a BIOS-free fallback when its BIOS is missing.
  effective(sys) {
    if (sys.fallback && sys.bios && !this.biosStatus(sys).ok) return { ...sys, emulator: sys.fallback.emulator, core: sys.fallback.core, usingFallback: true };
    return sys;
  }

  // opts.fresh: start from the beginning instead of the Quick Resume state.
  launchFor(sysIn, file, opts = {}) {
    const sys = this.effective(sysIn);
    const emuId = sys.emulator;
    const exe = this.exeOf(emuId);
    if (!exe) return { type: 'emulator-missing', target: emuId };
    const cwd = path.dirname(exe);
    switch (emuId) {
      case 'retroarch': {
        const core = this.coreDll(sys.core);
        if (!core || !this.assetsReady(sys.core)) return { type: 'core-missing', target: sys.core }; // support files come with the core
        const args = ['-L', core, file, '-f'];
        const extra = this.raAppend(sys, opts);
        if (extra.length) args.push('--appendconfig', extra.join('|'));
        const shader = this.screenShader(sys, exe);
        if (shader) args.push('--set-shader', shader);
        return { type: 'exe', target: exe, args, cwd };
      }
      case 'duckstation': return { type: 'exe', target: exe, args: ['-batch', '-fullscreen', '--', file], cwd };
      case 'pcsx2': return { type: 'exe', target: exe, args: ['-batch', '-fullscreen', '-nogui', '--', file], cwd };
      case 'cemu': return { type: 'exe', target: exe, args: ['-f', '-g', file], cwd };
      case 'xemu': return { type: 'exe', target: exe, args: ['-full-screen', '-dvd_path', file], cwd };
      case 'xenia': return { type: 'exe', target: exe, args: ['--fullscreen', file], cwd };
      case 'rpcs3': return { type: 'exe', target: exe, args: ['--no-gui', '--fullscreen', file], cwd };
      default: return { type: 'emulator-missing', target: emuId };
    }
  }

  romId(file) { return `rom:${hash(file)}`; }

  // Library scanner interface: { ok, games }. While the folder is being moved, or its drive is
  // unplugged, the scan "fails" so the library keeps the games it has instead of dropping them.
  async scan() {
    if (this.moving) return { ok: false, games: [] };
    if (!this.driveReady()) return { ok: false, games: [], note: `the ${path.parse(path.resolve(this.root())).root.slice(0, 2)} drive with your Emulation folder isn’t connected` };
    const games = [];
    const counts = {};
    for (const sys of SYSTEMS) {
      const roms = this.scanSystem(sys);
      counts[sys.id] = roms.length;
      const eff = this.effective(sys);
      for (const r of roms) {
        const launch = this.launchFor(sys, r.launchFile || r.file);
        const exe = launch.type === 'exe' ? path.basename(launch.target) : null;
        games.push({
          id: this.romId(r.file),
          source: 'rom',
          title: r.title,
          sortTitle: sortTitle(r.title),
          platform: sys.short,
          systemId: sys.id,
          emulator: eff.emulator,
          installDir: path.dirname(r.file),
          romPath: r.file,
          launchPath: r.launchFile || r.file, // a disc playlist for multi-disc games
          discs: r.discs || 1,
          romName: path.basename(r.file, path.extname(r.file)),
          libretroSystem: sys.libretro,
          launch,
          watch: { dirs: [], exes: exe ? [exe] : [] },
        });
      }
    }
    this.lastCounts = counts;
    return { ok: true, games };
  }

  // Rebuild a game's launch command (after installing its emulator/core).
  relaunchInfo(game, opts = {}) {
    const sys = SYSTEMS.find((s) => s.id === game.systemId);
    if (!sys || !game.romPath) return game.launch;
    return this.launchFor(sys, game.launchPath && fs.existsSync(game.launchPath) ? game.launchPath : game.romPath, opts);
  }

  system(id) { return SYSTEMS.find((s) => s.id === id); }

  // ------------------------------------------------------------------ moving to another drive
  notMoving() { if (this.moving) throw new Error('Your emulation files are being moved. Try again when that finishes.'); }

  // Downloads, installs or extractions in flight (they write into the folder being moved).
  busy() {
    return Object.entries(this.progress).some(([k, p]) => k !== 'move' && p && p.phase !== 'failed') || !!(this.inflight && this.inflight.size);
  }

  // How big the Emulation folder is.
  async measure() {
    if (!this.driveReady() || !fs.existsSync(this.root())) return null;
    const inv = await mv.inventory(this.root());
    return { bytes: inv.bytes, files: inv.files.length };
  }

  // Where the folder goes on a drive: X:\Emulation, or X:\Project 360\Emulation if something else
  // already has that name. Back on the drive with the user's home folder, it's the default spot.
  // A folder holding a half-finished earlier move (the app was closed mid-copy) is reused.
  async targetOn(drive) {
    const m = /^([A-Za-z]):?\\?$/.exec(String(drive || ''));
    if (!m) throw new Error('Pick a drive');
    const letter = m[1].toUpperCase();
    const top = `${letter}:\\`;
    if (!fs.existsSync(top)) throw new Error(`${letter}: isn’t connected`);
    const home = path.join(app.getPath('home'), 'Emulation');
    const testDir = process.env.P360_SCRIPT && process.env.P360_MOVE_DIR; // scripted runs stay out of drive roots
    const list = testDir ? [path.join(top, testDir, 'Emulation')]
      : mv.driveOf(home) === top.toLowerCase() ? [home, path.join(top, 'Emulation')] : [path.join(top, 'Emulation'), path.join(top, 'Project 360', 'Emulation')];
    const cur = path.resolve(this.root());
    for (const c of list) {
      if (mv.inside(c, cur) || mv.inside(cur, c)) continue; // never the folder in use
      if (fs.existsSync(path.join(c, MOVE_MARKER))) { await fs.promises.rm(c, { recursive: true, force: true }); return c; }
      if (await mv.isEmptyDir(c) === true) return c;
    }
    throw new Error(`${letter}: already has an Emulation folder with files in it`);
  }

  cancelMove() {
    const m = this.moving;
    if (!m || m.committed) return false;
    m.ctrl.abort();
    return true;
  }

  // Copy -> verify -> switch -> delete the old copy. hooks.beforeSwitch() is awaited first (the
  // library waits out any scan); hooks.onSwitch(from, to) runs synchronously right after the
  // switch so game ids can be remapped before anything else looks at them.
  async move(drive, hooks = {}) {
    if (this.moving) throw new Error('A move is already running');
    if (this.busy()) throw new Error('Wait for downloads and installs to finish first');
    const from = path.resolve(this.root());
    if (!this.driveReady() || !fs.existsSync(from)) throw new Error('The Emulation folder can’t be found');
    if (path.parse(from).root.toLowerCase() === from.toLowerCase()) throw new Error('Your Emulation folder is a whole drive, so it can’t be moved from here');
    const ctrl = new AbortController();
    this.moving = { ctrl, from, committed: false };
    this.setProgress('move', { phase: 'checking', received: 0, total: 0, files: 0, fileCount: 0, from, to: '', error: null });
    let to = null;
    let made = false; // the target folder was created by this move
    try {
      const letter = (/^([A-Za-z])/.exec(String(drive || '')) || [])[1];
      if (letter && `${letter}:\\`.toLowerCase() === path.parse(from).root.toLowerCase()) throw new Error('It’s already on that drive');
      to = await this.targetOn(drive);
      if (mv.driveOf(to) === mv.driveOf(from)) throw new Error('It’s already on that drive');
      if (mv.inside(to, from) || mv.inside(from, to)) throw new Error('Pick a different drive');
      this.moving.to = to;
      this.setProgress('move', { to });
      try { fs.unlinkSync(path.join(from, MOVE_MARKER)); } catch { /* none (normal) */ }
      const inv = await mv.inventory(from, ctrl.signal);
      if (inv.linkPaths.length) {
        const names = inv.linkPaths.slice(0, 3).join(', ') + (inv.linkPaths.length > 3 ? ` and ${inv.linkPaths.length - 3} more` : '');
        throw new Error(`Some folders are links to other places (${names}). Move or replace them yourself first, so nothing gets left behind.`);
      }
      if (hooks.maxFile && inv.largest && inv.largest.size > hooks.maxFile) {
        throw new Error(`${to.slice(0, 2)} is formatted FAT32, which can’t hold files over 4 GB like ${path.basename(inv.largest.rel)}`);
      }
      const free = await mv.freeSpace(to);
      const need = inv.bytes + 256 * 1024 * 1024;
      if (free != null && free < need) throw new Error(`Not enough space on ${to.slice(0, 2)} (needs ${gb(need)}, ${gb(free)} free)`);
      made = !fs.existsSync(to);
      const parentMade = !fs.existsSync(path.dirname(to)); // e.g. X:\Project 360
      await fs.promises.mkdir(to, { recursive: true });
      await fs.promises.writeFile(path.join(to, MOVE_MARKER), `Unfinished move from ${from}. Safe to delete.\r\n`);
      try {
        await mv.copyTree(from, to, inv, { signal: ctrl.signal, progress: (p) => this.setProgress('move', { phase: 'copying', ...p }) });
        if (ctrl.signal.aborted) throw mv.abortError();
      } catch (e) {
        this.setProgress('move', { phase: 'undoing' });
        await fs.promises.rm(to, { recursive: true, force: true }).catch(() => {});
        if (!made) await fs.promises.mkdir(to, { recursive: true }).catch(() => {});
        else if (parentMade && await mv.isEmptyDir(path.dirname(to)) === true) await fs.promises.rmdir(path.dirname(to)).catch(() => {});
        throw e;
      }

      // Everything arrived. Point at the new folder (nothing can be cancelled from here on).
      this.moving.committed = true;
      this.setProgress('move', { phase: 'finishing' });
      if (hooks.beforeSwitch) await hooks.beforeSwitch();
      this.switchRoot(from, to);
      if (hooks.onSwitch) { try { hooks.onSwitch(from, to); } catch (e) { console.error('[emulation] remap:', e); } }
      let saved = false;
      try { saved = this.settings.flush() !== false && this.state.flush() !== false; } catch { saved = false; }
      try { fs.unlinkSync(path.join(to, MOVE_MARKER)); } catch { /* ignore */ }
      for (const e of EMULATORS) { if (this.exeOf(e.id)) { try { await this.configure(e.id); } catch (err) { console.error('[emulation] configure', e.id, err.message); } } }

      // Only delete the old copy once the new location is safely recorded and still there.
      if (!saved || !fs.existsSync(path.join(to, 'roms'))) {
        console.error('[emulation] move: new location not confirmed on disk; keeping the old copy');
        return { from, to, bytes: inv.bytes, files: inv.files.length, kept: inv.files.length, links: 0 };
      }
      this.setProgress('move', { phase: 'cleaning' });
      const kept = await mv.removeCopied(from, inv);
      return { from, to, bytes: inv.bytes, files: inv.files.length, kept, links: 0 };
    } finally {
      this.moving = null;
      this.setProgress('move', null);
    }
  }

  // Re-point everything that stores an absolute path inside the old folder.
  switchRoot(from, to) {
    const rebase = (p) => (p && mv.inside(p, from) ? path.join(to, path.relative(from, p)) : p);
    for (const info of Object.values(this.state.data.emulators || {})) if (info && info.exe) info.exe = rebase(info.exe);
    this.state.save();
    this.settings.set('emulation.root', mv.same(to, path.join(app.getPath('home'), 'Emulation')) ? '' : to);
    const extra = this.settings.get('emulation.extraFolders') || {};
    let changed = false;
    const next = {};
    for (const [k, list] of Object.entries(extra)) next[k] = (Array.isArray(list) ? list : []).map((d) => { const r = rebase(d); if (r !== d) changed = true; return r; });
    if (changed) this.settings.set('emulation.extraFolders', next);
  }

  // Old game id -> new id (and paths) for every emulated game whose file was in the old folder.
  remapFor(games, from, to) {
    const map = {};
    for (const g of games) {
      if (!g || !g.systemId || !g.romPath || !mv.inside(g.romPath, from)) continue;
      const romPath = path.join(to, path.relative(from, g.romPath));
      map[g.id] = { id: this.romId(romPath), patch: { romPath, installDir: path.dirname(romPath) } };
    }
    return map;
  }

  // ------------------------------------------------------------------ Quick Resume
  quickResume() { return this.settings.get('emulation.quickResume') !== false; }

  setQuickResume(on) {
    if (!this.settings.data.emulation) this.settings.data.emulation = {};
    this.settings.data.emulation.quickResume = !!on;
    this.settings.save();
    for (const e of EMULATORS) if (this.exeOf(e.id)) { try { this.configure(e.id); } catch (err) { console.error('[emulation] configure', e.id, err.message); } }
    return this.quickResume();
  }

  // Extra RetroArch config files for one launch (joined with "|" for --appendconfig).
  raAppend(sys, opts = {}) {
    const files = [];
    const write = (name, body) => {
      const f = path.join(this.dirs().tools, name);
      try {
        let cur = null;
        try { cur = fs.readFileSync(f, 'utf8'); } catch { /* new */ }
        if (cur !== body) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
        files.push(f);
      } catch (e) { console.error('[emulation] appendconfig', e.message); }
    };
    if (opts.fresh && this.quickResume()) write('p360-start-over.cfg', 'savestate_auto_load = "false"\n');
    const sc = SCREENS[this.screen()];
    if (sc && sc.cfg && (!sc.tv || this.screenShader(sys))) write(`p360-screen-${this.screen()}.cfg`, sc.cfg);
    return files;
  }

  screen() { const s = this.settings.get('emulation.screen'); return SCREENS[s] ? s : 'standard'; }
  setScreen(s) {
    if (!SCREENS[s]) throw new Error('Unknown screen style');
    if (!this.settings.data.emulation) this.settings.data.emulation = {};
    this.settings.data.emulation.screen = s;
    this.settings.save();
    return s;
  }
  // CRT for TV consoles, an LCD grid for handhelds; null when the shader files aren't there.
  screenShader(sys, exe = this.exeOf('retroarch')) {
    const sc = SCREENS[this.screen()];
    if (!sc || !sc.tv || !exe) return null;
    const f = path.join(path.dirname(exe), 'shaders', 'shaders_slang', ...(HANDHELDS.has(sys.id) ? sc.handheld : sc.tv).split('/'));
    return fs.existsSync(f) ? f : null;
  }

  // Where a game's Quick Resume state is, if it has one: { at, file, thumb }.
  resumeInfo(game) {
    if (!game || !game.systemId || !this.quickResume()) return null;
    const sys = this.system(game.systemId);
    if (!sys) return null;
    const eff = this.effective(sys);
    if (eff.emulator === 'retroarch') {
      const content = game.launchPath || game.romPath || '';
      const base = path.basename(content, path.extname(content));
      const root = path.join(this.dirs().states, 'retroarch');
      // RetroArch sorts states into a folder named after the core (its default) or keeps them flat.
      // Only the core this game runs on now counts: a state from another core won't be loaded.
      const cands = [path.join(root, `${base}.state.auto`)];
      const coreName = this.coreName(eff.core);
      if (coreName) cands.push(path.join(root, coreName, `${base}.state.auto`));
      else { try { for (const d of fs.readdirSync(root, { withFileTypes: true })) if (d.isDirectory()) cands.push(path.join(root, d.name, `${base}.state.auto`)); } catch { /* none yet */ } }
      let best = null;
      for (const f of cands) {
        try { const st = fs.statSync(f); if (st.size > 0 && (!best || st.mtimeMs > best.at)) best = { at: st.mtimeMs, file: f }; } catch { /* missing */ }
      }
      if (best) { const png = `${best.file}.png`; best.thumb = fs.existsSync(png) ? png : null; }
      return best;
    }
    return null; // standalone emulators name their resume saves by disc serial; not offered there
  }

  // Closing this game keeps its place (Quick Resume on, and it runs in RetroArch).
  canResume(game) {
    const sys = game && this.system(game.systemId);
    return !!sys && this.quickResume() && this.effective(sys).emulator === 'retroarch';
  }

  // The name a core reports (RetroArch's per-core folder name), from its .info file.
  coreName(core) {
    const ra = this.exeOf('retroarch');
    if (!ra || !core) return null;
    if (!this.coreNames) this.coreNames = new Map();
    if (!this.coreNames.has(core)) {
      let name = null;
      try { const m = /^\s*corename\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(path.dirname(ra), 'info', `${core}_libretro.info`), 'utf8')); if (m) name = m[1]; } catch { /* no info files yet */ }
      if (name) this.coreNames.set(core, name); else return null; // try again once the info files arrive
    }
    return this.coreNames.get(core);
  }

  // ------------------------------------------------------------------ one-press setup
  // What playing every game you have still needs: emulators, cores, free support files.
  setupPlan() {
    const counts = this.lastCounts || {};
    const emulators = new Set();
    const cores = new Set();
    for (const s of SYSTEMS) {
      if (!counts[s.id]) continue;
      const eff = this.effective(s);
      if (!this.exeOf(eff.emulator)) emulators.add(eff.emulator);
      if (eff.emulator === 'retroarch' && eff.core && (!this.coreDll(eff.core) || !this.assetsReady(eff.core))) cores.add(eff.core);
    }
    const name = (id) => (EMULATORS.find((e) => e.id === id) || {}).name || id;
    return { emulators: [...emulators].map((id) => ({ id, name: name(id) })), cores: [...cores], ready: !emulators.size && !cores.size };
  }

  async installCoresForGames() {
    const counts = this.lastCounts || {};
    const failed = [];
    for (const s of SYSTEMS) {
      if (!counts[s.id]) continue;
      const eff = this.effective(s);
      if (eff.emulator !== 'retroarch' || !eff.core) continue;
      try {
        if (!this.coreDll(eff.core)) await this.installCore(eff.core);
        else if (!this.assetsReady(eff.core)) await this.installAsset(eff.core);
      } catch (e) { failed.push(`${s.short}: ${e.message}`); }
    }
    return failed;
  }

  async setupAll() {
    this.notMoving();
    const plan = this.setupPlan();
    const done = [];
    const failed = [];
    for (const e of plan.emulators) {
      try { await this.install(e.id); done.push(e.name); } catch (err) { failed.push(`${e.name}: ${err.message}`); }
    }
    if (this.exeOf('retroarch')) failed.push(...await this.installCoresForGames());
    return { done, failed, plan: this.setupPlan() };
  }

  // ------------------------------------------------------------------ RetroArch control
  retroarch(cmd) {
    const allowed = ['SAVE_STATE', 'LOAD_STATE', 'RESET', 'MENU_TOGGLE', 'PAUSE_TOGGLE', 'STATE_SLOT_PLUS', 'STATE_SLOT_MINUS', 'FAST_FORWARD', 'SCREENSHOT', 'FULLSCREEN_TOGGLE', 'QUIT'];
    if (!allowed.includes(cmd)) throw new Error('Unknown command');
    return new Promise((resolve) => {
      const sock = dgram.createSocket('udp4');
      sock.send(Buffer.from(cmd), 55355, '127.0.0.1', () => { sock.close(); resolve(true); });
    });
  }

  // ---------------------------------------------------------------- free support files
  assetDest(id) {
    const a = SYSTEM_ASSETS[id];
    if (a.to === 'retroarch-info') { const ra = this.exeOf('retroarch'); return ra ? path.join(path.dirname(ra), 'info') : null; }
    return this.dirs().bios;
  }

  assetsReady(core) { return !SYSTEM_ASSETS[core] || !!(this.state.data.assets || {})[core]; }

  async installAsset(id) {
    const a = SYSTEM_ASSETS[id];
    this.notMoving();
    const dest = a && this.assetDest(id);
    if (!dest) return false;
    const key = `asset:${id}`;
    this.setProgress(key, { phase: 'downloading', received: 0, total: 0, label: a.label });
    try {
      const zip = path.join(this.dirs().downloads, `asset-${id}.zip`);
      await this.download(a.url, zip, key);
      await this.extract(zip, dest, 'zip');
      try { fs.unlinkSync(zip); } catch { /* ignore */ }
      this.state.data.assets = { ...(this.state.data.assets || {}), [id]: Date.now() };
      this.state.save();
      this.setProgress(key, null);
      return true;
    } catch (e) {
      this.setProgress(key, { phase: 'failed', error: e.message });
      throw e;
    }
  }

  // Everything that can legitimately be downloaded, in one go.
  async installFreeFiles() {
    const done = [];
    if (this.exeOf('retroarch')) { await this.installAsset('info'); done.push(SYSTEM_ASSETS.info.label); }
    for (const id of ['dolphin', 'ppsspp']) { await this.installAsset(id); done.push(SYSTEM_ASSETS[id].label); }
    if (this.exeOf('rpcs3') && !this.state.data.ps3fw) { await this.installPs3Firmware(); done.push('PS3 system software'); }
    return done;
  }

  // ---------------------------------------------------------------- PS3 firmware
  // Sony's official PS3 system software, a free download from playstation.net.
  async downloadPs3Firmware() {
    const existing = findFile(this.dirs().bios, /^PS3UPDAT\.PUP$/i, 1);
    if (existing) return existing;
    const list = await (await fetch(PS3_UPDATE_LIST, { headers: { 'User-Agent': 'Project360' } })).text();
    const url = (list.match(/CDN=(http[^;]*PS3UPDAT\.PUP)/) || [])[1];
    if (!url) throw new Error('Could not find the PS3 system software on Sony’s server');
    return this.download(url, path.join(this.dirs().bios, 'PS3UPDAT.PUP'), 'ps3fw');
  }

  installPs3Firmware() { return this.once('ps3fw', () => this.installPs3FirmwareNow()); }

  async installPs3FirmwareNow() {
    this.notMoving();
    const exe = this.exeOf('rpcs3');
    if (!exe) throw new Error('Install RPCS3 first');
    try {
      const pup = await this.downloadPs3Firmware();
      this.setProgress('ps3fw', { phase: 'extracting' });
      const r = await run(exe, ['--installfw', pup], { cwd: path.dirname(exe), timeout: 15 * 60 * 1000 });
      if (r.err && typeof r.err.code !== 'number') throw new Error('Firmware install failed');
      this.state.data.ps3fw = Date.now();
      this.state.save();
      return true;
    } finally {
      this.setProgress('ps3fw', null);
    }
  }
}

module.exports = { Emulation, SYSTEMS, EMULATORS };
