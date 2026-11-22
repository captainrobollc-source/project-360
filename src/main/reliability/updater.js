// Auto-updates from GitHub releases (electron-updater + the NSIS installer).
// The feed comes from the build (electron-builder writes app-update.yml when it publishes from a
// GitHub repo) or from Settings › Updates ("owner/repo").
const { app } = require('electron');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');

class Updater extends EventEmitter {
  constructor({ settings, shell = false }) {
    super();
    this.settings = settings;
    this.shell = shell;
    this.status = { state: app.isPackaged ? 'idle' : 'dev', version: app.getVersion(), available: null, progress: 0, error: null, checkedAt: 0 };
    this.au = null;
    this.timer = null;
  }

  repo() {
    const r = String(this.settings.get('updates.repo') || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
    return /^[\w.-]+\/[\w.-]+$/.test(r) ? r : null;
  }

  builtInFeed() {
    try { return fs.existsSync(path.join(process.resourcesPath, 'app-update.yml')); } catch { return false; }
  }

  configured() { return app.isPackaged && (this.builtInFeed() || !!this.repo()); }

  set(patch) { this.status = { ...this.status, ...patch }; this.emit('status', this.status); }

  init() {
    if (!app.isPackaged) return;
    if (!this.configured()) this.set({ state: 'unconfigured' });
    try { ({ autoUpdater: this.au } = require('electron-updater')); } catch (e) { this.set({ state: 'error', error: e.message }); return; }
    const au = this.au;
    au.autoInstallOnAppQuit = true;
    au.logger = { info: (m) => console.log('[update]', m), warn: (m) => console.warn('[update]', m), error: (m) => console.error('[update]', m), debug: () => {} };
    this.applyConfig();
    // A downloaded update stays "ready" whatever a later background check says.
    au.on('checking-for-update', () => { if (this.status.state !== 'ready') this.set({ state: 'checking', error: null }); });
    au.on('update-not-available', () => this.set({ state: 'current', checkedAt: Date.now() }));
    au.on('update-available', (i) => this.set({ state: au.autoDownload ? 'downloading' : 'available', available: i.version, checkedAt: Date.now() }));
    au.on('download-progress', (p) => this.set({ state: 'downloading', progress: Math.round(p.percent || 0) }));
    au.on('update-downloaded', (i) => { this.set({ state: 'ready', available: i.version, progress: 100 }); this.emit('ready', i.version); });
    au.on('error', (e) => { if (this.status.state !== 'ready') this.set({ state: 'error', error: String((e && e.message) || e).split('\n')[0] }); });
    // Check shortly after start, then every 6 hours.
    setTimeout(() => this.check(true), 60 * 1000);
    this.timer = setInterval(() => this.check(true), 6 * 3600 * 1000);
  }

  // Settings › Updates changes (repo, auto download, beta) apply on the next check.
  applyConfig() {
    const au = this.au;
    if (!au) return;
    au.autoDownload = this.settings.get('updates.auto') !== false;
    au.allowPrerelease = !!this.settings.get('updates.beta');
    const repo = this.repo();
    if (repo && repo !== this.feedRepo) {
      const [owner, name] = repo.split('/');
      au.setFeedURL({ provider: 'github', owner, repo: name });
      this.feedRepo = repo;
    }
  }

  async check(background = false) {
    if (!app.isPackaged) { this.set({ state: 'dev' }); return this.status; }
    if (!this.configured()) { this.set({ state: 'unconfigured' }); return this.status; }
    if (!this.au) this.init();
    if (!this.au || (background && this.blocked && this.blocked())) return this.status;
    this.applyConfig();
    try { await this.au.checkForUpdates(); } catch (e) { this.set({ state: 'error', error: e.message.split('\n')[0] }); }
    return this.status;
  }

  async download() {
    if (!this.au) return;
    this.set({ state: 'downloading', progress: 0 });
    await this.au.downloadUpdate();
  }

  // Silent install, then relaunch.
  install() {
    if (!this.au || this.status.state !== 'ready') throw new Error('No update ready');
    this.emit('installing');
    this.installing = true;
    // In console shell mode the shell launcher relaunches us (exit code 66) once the installer
    // is done, so don't let the installer start a second, non-shell copy.
    setImmediate(() => this.au.quitAndInstall(true, !this.shell));
  }
}

module.exports = { Updater };
