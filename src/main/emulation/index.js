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

function titleFrom(file) {
  return path.basename(file, path.extname(file)).replace(/[_.]+/g, ' ').replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

// Sets the keys we manage in an INI (or simple TOML) file, editing lines in place. Everything else
// is kept exactly: other keys, repeated keys (DuckStation/PCSX2 lists), comments, order.
function writeIni(file, sections, eol = '\r\n') {
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
    for (const [k, v] of keys) out.push(`${k} = ${v}`);
    while (blanks-- > 0) out.push('');
  };
  let cur = '';
  for (const line of lines) {
    const sec = line.match(/^\s*\[(.+)\]\s*$/);
    if (sec) { finishSection(cur); cur = sec[1].trim(); out.push(line); continue; }
    const kv = line.match(/^\s*([^=;#]+?)\s*=/);
    if (kv && todo[cur] && Object.prototype.hasOwnProperty.call(todo[cur], kv[1])) {
      out.push(`${kv[1]} = ${todo[cur][kv[1]]}`);
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
const tomlStr = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

class Emulation extends EventEmitter {
  constructor({ userDir, settings }) {
    super();
    this.settings = settings;
    this.state = new JsonStore(path.join(userDir, 'emulation.json'), { emulators: {}, cores: {} });
    this.progress = {}; // id → { phase, received, total, error }
    this.ensureFolders();
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
      root: this.root(),
      dirs: this.dirs(),
      driveReady: this.driveReady(),
      move: this.progress.move || null,
      emulators: EMULATORS.map((e) => ({ id: e.id, name: e.name, about: e.about, license: e.license, site: e.site, installed: !!this.exeOf(e.id), version: (this.emuInfo(e.id) || {}).version || '', progress: this.progress[e.id] || null })),
      systems: SYSTEMS.map((s) => {
        const eff = this.effective(s);
        const emu = EMULATORS.find((e) => e.id === eff.emulator);
        return {
          id: s.id, name: s.name, short: s.short, maker: s.maker, year: s.year, color: s.color, exts: s.exts,
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
          if (!out.write(chunk)) await new Promise((r) => { out.once('drain', r); out.once('error', r); });
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
      if (id === 'retroarch') { try { await this.installAsset('info'); } catch { /* optional */ } }
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
    } else if (id === 'duckstation') {
      fs.writeFileSync(path.join(dir, 'portable.txt'), '');
      writeIni(path.join(dir, 'settings.ini'), {
        Main: { SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmPowerOff: 'false', SaveStateOnExit: 'true' },
        BIOS: { SearchDirectory: d.bios },
        AutoUpdater: { CheckAtStartup: 'false' },
      });
    } else if (id === 'pcsx2') {
      fs.writeFileSync(path.join(dir, 'portable.ini'), '');
      writeIni(path.join(dir, 'inis', 'PCSX2.ini'), {
        UI: { SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmShutdown: 'false', HideMouseCursor: 'true' },
        Folders: { Bios: d.bios },
        AutoUpdater: { CheckAtStartup: 'false' },
      });
    } else if (id === 'cemu') {
      fs.mkdirSync(path.join(dir, 'portable'), { recursive: true });
    } else if (id === 'xenia') {
      fs.writeFileSync(path.join(dir, 'portable.txt'), '');
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
            if (eboot) { out.push({ file: eboot, title: titleFrom(e.name) }); continue; }
          }
          if (sys.folders === 'wiiu') {
            const rpx = findFile(path.join(f, 'code'), /\.rpx$/i, 0);
            if (rpx) { out.push({ file: rpx, title: titleFrom(e.name) }); continue; }
          }
          walk(f, depth + 1);
          continue;
        }
        const ext = path.extname(e.name).slice(1).toLowerCase();
        if (ext === 'm3u' || ext === 'cue' || ext === 'gdi') noteMembers(d, f, ext);
        if (!exts.has(ext)) continue;
        out.push({ file: f, title: titleFrom(e.name) });
      }
    };
    for (const d of [dir, ...extra]) walk(d, 0);
    return out.filter((r) => !listed.has(key(r.file)));
  }
  // The emulator/core a system actually uses: a BIOS-free fallback when its BIOS is missing.
  effective(sys) {
    if (sys.fallback && sys.bios && !this.biosStatus(sys).ok) return { ...sys, emulator: sys.fallback.emulator, core: sys.fallback.core, usingFallback: true };
    return sys;
  }

  launchFor(sysIn, file) {
    const sys = this.effective(sysIn);
    const emuId = sys.emulator;
    const exe = this.exeOf(emuId);
    if (!exe) return { type: 'emulator-missing', target: emuId };
    const cwd = path.dirname(exe);
    switch (emuId) {
      case 'retroarch': {
        const core = this.coreDll(sys.core);
        if (!core || !this.assetsReady(sys.core)) return { type: 'core-missing', target: sys.core }; // support files come with the core
        return { type: 'exe', target: exe, args: ['-L', core, file, '-f'], cwd };
      }
      case 'duckstation': return { type: 'exe', target: exe, args: ['-batch', '-fullscreen', '--', file], cwd };
      case 'pcsx2': return { type: 'exe', target: exe, args: ['-batch', '-fullscreen', '-nogui', '--', file], cwd };
      case 'cemu': return { type: 'exe', target: exe, args: ['-f', '-g', file], cwd };
      case 'xemu': return { type: 'exe', target: exe, args: ['-full-screen', '-dvd_path', file], cwd };
      case 'xenia': return { type: 'exe', target: exe, args: ['--fullscreen', file], cwd };
      case 'rpcs3': return { type: 'exe', target: exe, args: ['--no-gui', file], cwd };
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
        const launch = this.launchFor(sys, r.file);
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
  relaunchInfo(game) {
    const sys = SYSTEMS.find((s) => s.id === game.systemId);
    if (!sys || !game.romPath) return game.launch;
    return this.launchFor(sys, game.romPath);
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

  // ------------------------------------------------------------------ RetroArch control
  retroarch(cmd) {
    const allowed = ['SAVE_STATE', 'LOAD_STATE', 'RESET', 'MENU_TOGGLE', 'PAUSE_TOGGLE', 'STATE_SLOT_PLUS', 'STATE_SLOT_MINUS', 'FAST_FORWARD', 'SCREENSHOT', 'FULLSCREEN_TOGGLE'];
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
