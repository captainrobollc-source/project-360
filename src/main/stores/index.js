// Store accounts + download manager.
// Each connector signs in through its own persistent browser session (your cookies stay there),
// lists the games you own, and hands back download options; this module downloads them through
// that same session and installs them.
const { app, session, shell } = require('electron');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { JsonStore } = require('../store');

// Client stores (Steam, Epic) list everything you own and install through their own app.
const CONNECTORS = [require('./steam'), require('./epic'), require('./gog'), require('./itch'), require('./humble')];
const CHROME_UA = () => app.userAgentFallback.replace(/\s(Electron|project-360|Project 360)\/\S+/gi, '');

// A folder name from a (remote) game title: never "." / ".." / empty, no trailing dots or spaces
// (Windows drops them), no reserved device names.
const safeName = (s) => {
  let n = String(s || 'Game').replace(/[<>:"/\\|?*\x00-\x1f™®©]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
  n = n.replace(/^[.\s]+|[.\s]+$/g, '');
  if (!n) return 'Game';
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n)) n = `${n}_`;
  return n;
};
// Deletes a job folder only if it really is inside the downloads folder.
const isInside = (p, base) => { const r = path.relative(path.resolve(base), path.resolve(p)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
// File names keep their extension (installers are found by it): only the stem is shortened.
const safeFileName = (s) => {
  const clean = String(s || 'download.bin').replace(/[<>:"/\\|?*\x00-\x1f™®©]/g, '').replace(/\s+/g, ' ').trim() || 'download.bin';
  const ext = path.extname(clean).slice(0, 12);
  const stem = clean.slice(0, clean.length - ext.length).slice(0, 120 - ext.length) || 'download';
  return stem + ext;
};

function ps(script) {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: 4 * 3600 * 1000 }, (err, stdout, stderr) => resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') }));
  });
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

// Runs a program and waits; ShellExecute shows the UAC prompt when an installer needs admin.
async function runWait(file, args) {
  const r = await ps(`$p = Start-Process -FilePath ${psq(file)}${args ? ` -ArgumentList ${psq(args)}` : ''} -Wait -PassThru; exit $p.ExitCode`);
  if (/cancel+ed by the user/i.test(r.stderr)) throw new Error('Installation cancelled (admin permission was declined)');
  if (r.err && typeof r.err.code !== 'number') throw new Error(r.stderr.trim() || r.err.message);
  return r.err ? r.err.code : 0;
}

function findExe(dir, title) {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f, depth + 1);
      else if (/\.exe$/i.test(e.name) && !/unins|setup|install|crash|redist|vc_?redist|dxsetup|dotnet|ue4prereq|helper|update|launcherpatch/i.test(e.name)) {
        let size = 0;
        try { size = fs.statSync(f).size; } catch { /* ignore */ }
        found.push({ f, depth, size, name: e.name });
      }
    }
  };
  walk(dir, 0);
  const t = String(title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  found.sort((a, b) => {
    const am = t && a.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(t.slice(0, 6)) ? 1 : 0;
    const bm = t && b.name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(t.slice(0, 6)) ? 1 : 0;
    return bm - am || a.depth - b.depth || b.size - a.size;
  });
  return found[0] ? found[0].f : null;
}

class StoreManager extends EventEmitter {
  constructor({ userDir, settings, onInstalled }) {
    super();
    this.settings = settings;
    this.onInstalled = onInstalled;
    this.cacheDir = path.join(userDir, 'stores');
    fs.mkdirSync(this.cacheDir, { recursive: true });
    this.state = new JsonStore(path.join(this.cacheDir, 'downloads.json'), { jobs: [] });
    this.items = new Map();     // jobId → active Electron DownloadItem
    this.pending = new Map();   // original URL → { resolve, reject, job, file }
    this.hooked = new Set();
    this.libraries = {};
    this.statusCache = {};
    this.running = false;
    // Downloads interrupted by a restart go back to the queue.
    for (const j of this.state.data.jobs) if (['downloading', 'installing'].includes(j.state)) j.state = 'queued';
    this.updateTimer = null;
  }

  connector(id) { const c = CONNECTORS.find((x) => x.id === id); if (!c) throw new Error('Unknown store'); return c; }

  session(id) {
    const ses = session.fromPartition(`persist:store-${id}`);
    if (!this.hooked.has(id)) {
      this.hooked.add(id);
      ses.setUserAgent(CHROME_UA());
      ses.on('will-download', (e, item) => this.onWillDownload(item));
    }
    return ses;
  }

  ctx(id) {
    return {
      getKey: () => this.settings.get(`stores.keys.${id}`) || '',
      setKey: (k) => this.settings.set(`stores.keys.${id}`, k),
      settings: this.settings,
    };
  }

  installDir() { return this.settings.get('stores.installDir') || path.join(app.getPath('home'), 'Games'); }
  downloadDir() { return this.settings.get('stores.downloadDir') || path.join(this.installDir(), '_downloads'); }

  // ------------------------------------------------------------------ accounts
  async list() {
    return Promise.all(CONNECTORS.map(async (c) => {
      let st = { signedIn: false };
      try { st = await c.status(this.session(c.id), this.ctx(c.id)); } catch (e) { st = { signedIn: false, error: e.message }; }
      this.statusCache[c.id] = st;
      const lib = this.libraries[c.id] || this.readCache(c.id);
      return { id: c.id, name: c.name, color: c.color, about: c.about, signInUrl: c.signInUrl, client: c.client || null, ...st, count: lib ? lib.games.length : 0, updatedAt: lib ? lib.updatedAt : 0 };
    }));
  }

  async signOut(id) {
    await this.session(id).clearStorageData();
    this.settings.set(`stores.keys.${id}`, '');
    delete this.libraries[id];
    try { fs.unlinkSync(path.join(this.cacheDir, `${id}-library.json`)); } catch { /* ignore */ }
    this.emit('accounts');
  }

  readCache(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.cacheDir, `${id}-library.json`), 'utf8')); } catch { return null; }
  }

  async library(id, force = false) {
    if (!force) {
      const cached = this.libraries[id] || this.readCache(id);
      if (cached && Date.now() - cached.updatedAt < 6 * 3600 * 1000) return (this.libraries[id] = cached);
    }
    const c = this.connector(id);
    const games = (await c.library(this.session(id), this.ctx(id))).sort((a, b) => a.title.localeCompare(b.title));
    const lib = { updatedAt: Date.now(), games };
    this.libraries[id] = lib;
    fs.writeFileSync(path.join(this.cacheDir, `${id}-library.json`), JSON.stringify(lib));
    return lib;
  }

  async downloads(id, gameId) {
    const lib = await this.library(id);
    const game = lib.games.find((g) => g.id === gameId);
    if (!game) throw new Error('Game not found in your library');
    return this.connector(id).downloads(this.session(id), game, this.ctx(id));
  }

  // ------------------------------------------------------------------ downloads
  jobs() { return this.state.data.jobs; }
  view() {
    return this.jobs().map((j) => ({
      id: j.id, store: j.store, gameId: j.gameId, title: j.title, image: j.image, state: j.state, error: j.error, install: j.install, installAfter: j.installAfter,
      received: j.client ? (j.received || 0) : j.files.reduce((s, f) => s + (f.received || 0), 0),
      total: j.client ? (j.total || 0) : j.files.reduce((s, f) => s + (f.size || 0), 0) || j.total || 0, client: j.client || null,
      speed: j.speed || 0, part: j.files.filter((f) => f.done).length, parts: j.files.length, installedExe: j.installedExe, createdAt: j.createdAt,
    }));
  }

  persist() {
    // Timer handles aren't serialisable; store a clean copy.
    const clean = this.jobs().map(({ timer, ...rest }) => rest);
    const live = this.state.data.jobs;
    this.state.data.jobs = clean;
    this.state.flush();
    this.state.data.jobs = live;
  }

  changed(now = false) {
    clearTimeout(this.updateTimer);
    const fire = () => { this.persist(); this.emit('downloads', this.view()); };
    if (now) fire(); else this.updateTimer = setTimeout(fire, 400);
  }

  async start(storeId, gameId, optionId, { install = true } = {}) {
    const lib = await this.library(storeId);
    const game = lib.games.find((g) => g.id === gameId);
    const d = await this.downloads(storeId, gameId);
    const opt = d.options.find((o) => o.id === optionId) || d.options[0];
    if (!opt) throw new Error('No Windows download available');
    if (this.jobs().some((j) => j.store === storeId && j.gameId === gameId && ['queued', 'downloading', 'installing', 'paused', 'client'].includes(j.state))) throw new Error('Already in your downloads');
    if (opt.client) return this.startClient(storeId, game, d);
    const job = {
      id: `${storeId}-${gameId}-${Date.now().toString(36)}`,
      store: storeId, gameId, optionId: opt.id,
      title: d.title || (game && game.title) || 'Game',
      image: game && game.image, install: opt.install, installAfter: install,
      dir: path.join(this.downloadDir(), `${safeName(d.title || (game && game.title))} ${Date.now().toString(36)}`), // one folder per job
      files: opt.files.map((f) => ({ url: f.url, headers: f.headers, name: f.name, size: f.size || 0, received: 0, done: false, path: null })),
      state: 'queued', createdAt: Date.now(),
    };
    this.jobs().unshift(job);
    this.changed(true);
    this.pump();
    return job.id;
  }

  // ------------------------------------------------------------------ client installs (Steam / Epic)
  // The store's own app does the download; we open its install dialog and follow its progress.
  async startClient(storeId, game, d) {
    const c = this.connector(storeId);
    const job = {
      id: `${storeId}-${game.id}-${Date.now().toString(36)}`,
      store: storeId, gameId: game.id, title: d.title || game.title, image: game.image,
      client: c.client, files: [], state: 'client', received: 0, total: 0, createdAt: Date.now(),
      error: `Confirm the install in ${c.client}`,
    };
    this.jobs().unshift(job);
    this.changed(true);
    try { await c.installClient(game); } catch (e) {
      const i = this.jobs().indexOf(job);
      if (i >= 0) this.jobs().splice(i, 1);
      this.changed(true);
      throw e;
    }
    this.emit('client', { store: storeId, client: c.client, title: job.title });
    this.watchClient(job, c, game);
    return job.id;
  }

  watchClient(job, c, game) {
    const started = Date.now();
    const tick = async () => {
      if (!this.jobs().includes(job) || job.state === 'cancelled') return;
      let p = null;
      try { p = await c.progress(game); } catch { /* ignore */ }
      if (p && p.state === 'installed') {
        job.state = 'done';
        job.error = null;
        job.received = job.total = p.total || job.total;
        this.changed(true);
        if (this.onInstalled) await this.onInstalled({ store: job.store, title: job.title, exe: null, dir: null, viaClient: true });
        return;
      }
      if (p && p.state === 'downloading') {
        job.received = p.received || 0;
        job.total = p.total || 0;
        job.error = null;
      } else if (Date.now() - started > 10 * 60 * 1000 && !job.total) {
        job.error = `Waiting for ${c.client} — finish the install there`;
      }
      this.changed();
      job.timer = setTimeout(tick, 3000);
    };
    job.timer = setTimeout(tick, 3000);
  }

  resumeClientWatches() {
    for (const j of this.jobs()) {
      if (j.state !== 'client') continue;
      const c = this.connector(j.store);
      const lib = this.libraries[j.store] || this.readCache(j.store);
      const game = lib && lib.games.find((g) => g.id === j.gameId);
      if (game) this.watchClient(j, c, game);
    }
  }

  async pump() {
    if (this.running) return;
    const job = [...this.jobs()].reverse().find((j) => j.state === 'queued');
    if (!job) return;
    this.running = true;
    try { await this.runJob(job); }
    catch (e) { if (job.state !== 'cancelled' && job.state !== 'paused') { job.state = 'failed'; job.error = e.message; } }
    finally { this.running = false; this.changed(true); setTimeout(() => this.pump(), 200); }
  }

  async runJob(job) {
    job.state = 'downloading';
    job.error = null;
    this.changed(true);
    fs.mkdirSync(job.dir, { recursive: true });
    // Store links can expire (Humble, GOG CDN): refresh them before starting.
    try {
      const d = await this.downloads(job.store, job.gameId);
      const opt = d.options.find((o) => o.id === job.optionId);
      if (opt) opt.files.forEach((f, i) => { if (job.files[i] && !job.files[i].done) { job.files[i].url = f.url; job.files[i].headers = f.headers; } });
    } catch { /* use the links we have */ }
    if (job.state !== 'downloading') return; // paused or cancelled while refreshing links
    for (const file of job.files) {
      if (job.state !== 'downloading') return;
      if (file.done && file.path && fs.existsSync(file.path)) continue;
      await this.downloadFile(job, file);
      if (job.state !== 'downloading') return;
    }
    if (job.installAfter) await this.installJob(job);
    else job.state = 'downloaded';
  }

  downloadFile(job, file) {
    return new Promise((resolve, reject) => {
      this.pending.set(file.url, { resolve, reject, job, file });
      const ses = this.session(job.store);
      ses.downloadURL(file.url, file.headers ? { headers: file.headers } : undefined);
      // The download never started (the request failed before Chromium created it): don't hold the queue.
      setTimeout(() => {
        const p = this.pending.get(file.url);
        if (p && p.file === file) { this.pending.delete(file.url); reject(new Error('The download didn’t start')); }
      }, 90000);
    });
  }

  removeJobDir(j) {
    if (!j || !j.dir || !isInside(j.dir, this.downloadDir())) return;
    try { fs.rmSync(j.dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  onWillDownload(item) {
    const chain = item.getURLChain();
    const p = this.pending.get(chain[0]);
    if (!p) return; // a download the user started inside a sign-in window: default behaviour
    this.pending.delete(chain[0]);
    const { job, file, resolve, reject } = p;
    if (job.state !== 'downloading') { item.cancel(); resolve(); return; }
    const name = safeFileName(item.getFilename() || file.name || 'download.bin');
    file.path = path.join(job.dir, name);
    item.setSavePath(file.path);
    this.items.set(job.id, item);
    let last = { t: Date.now(), b: 0 };
    let retries = 0;
    let retryTimer = null;
    item.on('updated', (e, state) => {
      file.received = item.getReceivedBytes();
      if (item.getTotalBytes()) file.size = item.getTotalBytes();
      const now = Date.now();
      if (now - last.t > 1000) { job.speed = Math.round((file.received - last.b) / ((now - last.t) / 1000)); last = { t: now, b: file.received }; }
      if (state === 'progressing' && job.error && !retryTimer) job.error = null; // back on track
      if (state === 'interrupted' && job.state === 'downloading' && !retryTimer) {
        // Chromium doesn't resume by itself once it gives up: retry with a growing wait, then fail.
        if (item.canResume() && retries < 6) {
          retries++;
          job.error = `Connection interrupted — retrying (${retries}/6)…`;
          retryTimer = setTimeout(() => { retryTimer = null; if (job.state === 'downloading') { try { item.resume(); } catch { /* finished meanwhile */ } } }, 5000 * 2 ** (retries - 1));
        } else {
          job.error = 'Connection lost';
          try { item.cancel(); } catch { /* ignore */ }
        }
      }
      this.changed();
    });
    item.once('done', (e, state) => {
      clearTimeout(retryTimer);
      this.items.delete(job.id);
      job.speed = 0;
      if (state === 'completed') { file.done = true; file.received = file.size = item.getTotalBytes() || file.received; this.changed(); resolve(); }
      else if (job.state === 'paused' || job.state === 'cancelled') resolve();
      else reject(new Error(job.error === 'Connection lost' ? 'The connection was lost. Retry when you’re back online.' : state === 'cancelled' ? 'Cancelled' : 'Download failed'));
    });
  }

  pause(id) {
    const j = this.jobs().find((x) => x.id === id);
    if (!j || j.state !== 'downloading') return;
    j.state = 'paused';
    const it = this.items.get(id);
    if (it) it.cancel(); // resumed later from the start of the current part
    this.changed(true);
  }

  resume(id) {
    const j = this.jobs().find((x) => x.id === id);
    if (!j || !['paused', 'failed'].includes(j.state)) return;
    j.state = 'queued';
    j.files.forEach((f) => { if (!f.done) f.received = 0; });
    this.changed(true);
    this.pump();
  }

  cancel(id) {
    const j = this.jobs().find((x) => x.id === id);
    if (!j) return;
    if (j.client) { clearTimeout(j.timer); j.state = 'cancelled'; this.changed(true); return; }
    const wasActive = j.state === 'downloading';
    j.state = 'cancelled';
    const it = this.items.get(id);
    if (it) it.cancel();
    if (!wasActive) this.changed(true);
    this.removeJobDir(j);
  }

  remove(id) {
    const list = this.jobs();
    const i = list.findIndex((x) => x.id === id);
    if (i < 0) return;
    if (['downloading', 'installing'].includes(list[i].state)) throw new Error('Still in progress');
    clearTimeout(list[i].timer);
    list.splice(i, 1);
    this.changed(true);
  }

  async installNow(id) {
    const j = this.jobs().find((x) => x.id === id);
    if (!j || !['downloaded', 'failed'].includes(j.state) || !j.files.every((f) => f.done)) throw new Error('Nothing to install yet');
    try { await this.installJob(j); } catch (e) {
      // Like pump(): a declined UAC prompt or a failed installer leaves the job retryable,
      // never stuck in "installing" (which would also re-run the installer at the next start).
      j.state = 'failed';
      j.error = e.message;
      this.changed(true);
      throw e;
    }
    this.changed(true);
  }

  openFolder(id) {
    const j = this.jobs().find((x) => x.id === id);
    if (j) shell.openPath(j.installedDir || j.dir);
  }

  // ------------------------------------------------------------------ install
  async installJob(job) {
    job.state = 'installing';
    job.error = null;
    this.changed(true);
    const files = job.files.map((f) => f.path).filter(Boolean);
    const dest = path.join(this.installDir(), safeName(job.title));
    const exe = files.find((f) => /\.exe$/i.test(f));
    const zip = files.find((f) => /\.zip$/i.test(f));
    const msi = files.find((f) => /\.msi$/i.test(f));
    let installedExe = null;
    if (job.install === 'inno' && exe) {
      // GOG installers (Inno Setup) install silently; Windows may ask for admin permission.
      const code = await runWait(exe, `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="${dest}"`);
      if (code !== 0) throw new Error(`Installer exited with code ${code}`);
    } else if (zip) {
      fs.mkdirSync(dest, { recursive: true });
      const r = await ps(`Expand-Archive -LiteralPath ${psq(zip)} -DestinationPath ${psq(dest)} -Force`);
      if (r.err) throw new Error(r.stderr.trim().split('\n')[0] || 'Could not extract the archive');
      installedExe = findExe(dest, job.title);
      if (!installedExe) throw new Error('Extracted, but no game .exe was found');
    } else if (msi) {
      const code = await runWait('msiexec.exe', `/i "${msi}" /passive INSTALLDIR="${dest}" TARGETDIR="${dest}"`);
      if (code !== 0 && code !== 3010) throw new Error(`Installer exited with code ${code}`);
    } else if (exe) {
      // Unknown installer type: run it normally.
      const code = await runWait(exe, '');
      if (code !== 0) throw new Error(`Installer exited with code ${code}`);
      if (fs.existsSync(dest)) installedExe = findExe(dest, job.title);
    } else {
      job.state = 'downloaded';
      job.error = 'Downloaded — this file type can’t be installed automatically.';
      return;
    }
    job.state = 'done';
    job.installedDir = dest;
    job.installedExe = installedExe;
    this.changed(true); // saved now: a crash during the library rescan mustn't re-download it
    // Clean up the installer files once installed.
    if (this.settings.get('stores.deleteInstallers') !== false) this.removeJobDir(job);
    if (this.onInstalled) Promise.resolve(this.onInstalled({ store: job.store, title: job.title, exe: installedExe, dir: dest })).catch((e) => console.error('[stores] after install', e.message));
  }
}

module.exports = { StoreManager, CONNECTORS };
