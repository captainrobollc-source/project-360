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

const SEVENZR = 'https://www.7-zip.org/a/7zr.exe';

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

function writeIni(file, sections) {
  // Merge into an existing INI, keeping keys we don't manage.
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { /* new */ }
  const data = {};
  let cur = '';
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\s*\[(.+)\]\s*$/);
    if (sec) { cur = sec[1]; data[cur] = data[cur] || {}; continue; }
    const kv = line.match(/^\s*([^=;#]+?)\s*=\s*(.*)$/);
    if (kv) (data[cur] = data[cur] || {})[kv[1]] = kv[2];
  }
  for (const [s, kv] of Object.entries(sections)) data[s] = { ...(data[s] || {}), ...kv };
  const out = [];
  for (const [s, kv] of Object.entries(data)) {
    if (s) out.push(`[${s}]`);
    for (const [k, v] of Object.entries(kv)) out.push(`${k} = ${v}`);
    out.push('');
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join('\r\n'));
}

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

  ensureFolders() {
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
      const has = b.files.some((f) => lower.has(f.toLowerCase()) || fs.existsSync(path.join(dir, f))) || (b.match && files.some((f) => b.match.test(f)));
      if (!has) (b.optional ? optionalMissing : missing).push(b.files.join(' or '));
    }
    return { ok: !missing.length, missing, optionalMissing, optional: sys.bios.every((b) => b.optional) };
  }

  status() {
    const counts = this.lastCounts || {};
    return {
      root: this.root(),
      dirs: this.dirs(),
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
    clearTimeout(this.progressTimer);
    this.progressTimer = setTimeout(() => this.emit('updated', this.status()), 250);
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
  async install(id) {
    const emu = EMULATORS.find((e) => e.id === id);
    if (!emu) throw new Error('Unknown emulator');
    if (this.progress[id] && ['resolving', 'downloading', 'extracting'].includes(this.progress[id].phase)) return;
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
      fs.writeFileSync(path.join(dir, 'xemu.toml'), [
        '[general]', 'show_welcome = false', '',
        '[display.window]', 'fullscreen_on_startup = true', '',
        '[sys.files]', `bootrom_path = '${b('mcpx_1.0.bin')}'`, `flashrom_path = '${b('complex_4627.bin')}'`, `hdd_path = '${b('xbox_hdd.qcow2')}'`, '',
      ].join('\n'));
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
        if (e.isDirectory()) {
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

  // Library scanner interface: { ok, games }
  async scan() {
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
          id: `rom:${hash(r.file)}`,
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

  async installPs3Firmware() {
    const exe = this.exeOf('rpcs3');
    if (!exe) throw new Error('Install RPCS3 first');
    const pup = await this.downloadPs3Firmware();
    this.setProgress('ps3fw', { phase: 'extracting' });
    const r = await run(exe, ['--installfw', pup], { cwd: path.dirname(exe), timeout: 15 * 60 * 1000 });
    this.setProgress('ps3fw', null);
    if (r.err && typeof r.err.code !== 'number') throw new Error('Firmware install failed');
    this.state.data.ps3fw = Date.now();
    this.state.save();
    return true;
  }
}

module.exports = { Emulation, SYSTEMS, EMULATORS };
