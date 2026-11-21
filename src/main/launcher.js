// Launches games/apps and tracks them so the dashboard can cover store launchers while a
// game boots, step aside once the real game window is up, and return as soon as it exits.
//
// Phases: idle → launching (cover up, waiting for the game's process)
//               → running (process found; cover stays up until a big, stable game window → 'revealed')
//               → untracked (never detected) → exited
const { spawn, execFile } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const native = require('./native');

const DETECT_TIMEOUT_MS = 150000;
const REVEAL_FALLBACK_MS = 45000;   // process found but no big window yet: reveal anyway
const ATTENTION_AFTER_MS = 14000;   // look for launcher windows that need the user
const EXIT_GRACE_MS = 6000;         // fallback when we never saw the game's window
const MAINPID_GRACE_MS = 2000;      // game window's process gone → exit quickly
const DUPLICATE_WINDOW_MS = 8000;   // ignore repeat launches of the same item

// Store launchers: covered while a game boots, hidden while it runs and right after it exits.
const LAUNCHER_EXES = ['steam.exe', 'steamwebhelper.exe', 'EpicGamesLauncher.exe', 'EpicWebHelper.exe', 'GalaxyClient.exe', 'EADesktop.exe', 'Origin.exe', 'UbisoftConnect.exe', 'upc.exe', 'Battle.net.exe', 'XboxPcApp.exe', 'GamingServicesUI.exe'];
const SOURCE_LAUNCHERS = {
  steam: ['steam.exe', 'steamwebhelper.exe'],
  epic: ['EpicGamesLauncher.exe', 'EpicWebHelper.exe'],
  gog: ['GalaxyClient.exe'],
  xbox: ['XboxPcApp.exe', 'GamingServicesUI.exe'],
};
const LAUNCHER_MAIN_TITLE = /^(steam|friends list|epic games launcher|gog galaxy|ea|ea app|ubisoft connect|battle\.net|xbox)$/i;
const SPLASH_TITLE = /crash|error report|anti-?cheat|easyanticheat|battleye|launcher|loading|splash|updating|patch/i;

class Launcher extends EventEmitter {
  constructor() {
    super();
    this.current = null;
    this.timer = null;
    this.steamRoot = null;
    this.internal = null; // (item) => { close(), focus(), onClosed(cb), pad(mask) } for built-in apps
    this.screen = { width: 1920, height: 1080 };
    this.last = { id: null, at: 0 };
    this.sweepUntil = 0;
    this.sweepTimer = null;
  }

  state() {
    if (!this.current) return { phase: 'idle' };
    const c = this.current;
    return {
      phase: c.phase, id: c.item.id, title: c.item.title, kind: c.kind,
      startedAt: c.startedAt, runningSince: c.runningSince, revealed: c.revealed,
      tracked: c.tracked, attention: c.attention, controllerMouse: !!c.item.controllerMouse,
      emulator: c.item.emulator || null, systemId: c.item.systemId || null,
    };
  }

  emitState() { this.emit('state', this.state()); }

  async launch(item, kind = 'game') {
    if (this.current) throw new Error(`${this.current.item.title} is already running`);
    if (this.last.id === item.id && Date.now() - this.last.at < DUPLICATE_WINDOW_MS) throw new Error(`${item.title} is already starting`);
    this.last = { id: item.id, at: Date.now() };
    const c = {
      item, kind, phase: 'launching', startedAt: Date.now(), runningSince: 0, revealed: false,
      pids: new Set(), childPid: null, childAlive: false, lastSeen: 0, tracked: true,
      attention: null, handle: null, candidate: null, mainPid: null, mainGoneAt: 0,
    };
    this.current = c;
    this.emitState();

    const L = item.launch;
    try {
      if (L.type === 'internal') {
        if (!this.internal) throw new Error('Built-in apps unavailable');
        c.handle = this.internal(item);
        c.handle.onClosed(() => { if (this.current === c) this.finish('exited'); });
        c.phase = 'running';
        c.runningSince = Date.now();
        c.revealed = true;
        this.emitState();
        this.emit('reveal', { internal: true });
        return this.state();
      }
      if (L.type === 'url' && /^steam:\/\//i.test(L.target) && this.steamRoot) {
        // Through steam.exe with -silent so a cold Steam start never shows its main window.
        const exe = path.join(this.steamRoot, 'steam.exe');
        if (fs.existsSync(exe)) spawn(exe, ['-silent', L.target], { detached: true, stdio: 'ignore' }).unref();
        else await shell.openExternal(L.target);
      } else if (L.type === 'url') {
        await shell.openExternal(L.target);
      } else if (L.type === 'shell') {
        spawn('explorer.exe', [L.target], { detached: true, stdio: 'ignore' }).unref();
      } else if (L.type === 'open') {
        const err = await shell.openPath(L.target);
        if (err) throw new Error(err);
      } else {
        if (path.isAbsolute(L.target) && !fs.existsSync(L.target)) throw new Error(`Can't find ${path.basename(L.target)}. The game may have been moved or uninstalled.`);
        const cwd = L.cwd && fs.existsSync(L.cwd) ? L.cwd : undefined;
        const child = spawn(L.target, L.args || [], { cwd, detached: true, stdio: 'ignore' });
        child.on('error', (e) => {
          c.childAlive = false;
          console.error('[launcher] spawn failed', e.message);
          if (this.current === c) { this.current = null; this.last = { id: null, at: 0 }; this.emitState(); this.emit('failed', { item: c.item, error: e.message }); }
        });
        c.childPid = child.pid;
        c.childAlive = true;
        child.on('exit', () => { c.childAlive = false; });
        child.unref();
      }
    } catch (e) {
      this.current = null;
      this.last = { id: null, at: 0 };
      this.emitState();
      throw e;
    }

    const w = item.watch || { dirs: [], exes: [] };
    c.tracked = !!(c.childPid || (w.dirs && w.dirs.length) || (w.exes && w.exes.length));
    this.poll();
    return this.state();
  }

  watchArgs() {
    const w = this.current.item.watch || {};
    return [(w.dirs || []).join('|'), (w.exes || []).join('|')];
  }

  // Returns null when the process lookup itself failed (helper restarting), so callers can skip
  // a tick instead of treating "couldn't look" as "the game exited".
  async findPids(c = this.current) {
    const pids = new Set();
    if (!c) return pids;
    if (c.childAlive && c.childPid) pids.add(c.childPid);
    const w = c.item.watch || {};
    const dirs = (w.dirs || []).join('|');
    const exes = (w.exes || []).join('|');
    if (dirs || exes) {
      try { for (const p of await native.call('procs.find', dirs, exes)) pids.add(p.pid); } catch { if (!pids.size) return null; }
    }
    return pids;
  }

  // A real game window: visible, not minimized, big (most of the screen or ≥1280×720),
  // not a launcher/anti-cheat splash.
  async findGameWindow() {
    const c = this.current;
    try {
      const [dirs, exes] = this.watchArgs();
      let wins = dirs || exes ? await native.call('wins.find', dirs, exes) : [];
      if (!wins.length && c.pids.size) wins = await native.call('wins.bypid', [...c.pids].join('|'));
      const lower = new Set(LAUNCHER_EXES.map((e) => e.toLowerCase()));
      const sw = this.screen.width, sh = this.screen.height;
      // Games must show a big window; apps (Spotify, browsers…) just need a normal one.
      const big = c.kind === 'game'
        ? (w) => (w.w >= sw * 0.6 && w.h >= sh * 0.6) || (w.w >= 1280 && w.h >= 720)
        : (w) => w.w >= 640 && w.h >= 400;
      const ok = wins.filter((w) => !w.iconic && big(w) && !lower.has(w.exe.toLowerCase()) && !SPLASH_TITLE.test(w.title) && !/^(unrealcef|cefsubprocess|crashreport)/i.test(w.exe));
      ok.sort((a, b) => b.w * b.h - a.w * a.h);
      return ok[0] || null;
    } catch { return null; }
  }

  async launcherWindows() {
    try { return await native.call('wins.find', '', LAUNCHER_EXES.join('|')); } catch { return []; }
  }

  // Hide the stores' main windows (they reopen themselves around launches and exits).
  async hideLauncherWindows() {
    for (const w of await this.launcherWindows()) {
      if (!w.iconic && LAUNCHER_MAIN_TITLE.test(w.title.trim())) native.call('wins.hide', w.hwnd).catch(() => {});
    }
  }

  // After a game exits, keep sweeping launcher windows for a while (Steam/Epic pop their library).
  sweepAfterExit(ms = 20000) {
    this.sweepUntil = Date.now() + ms;
    clearInterval(this.sweepTimer);
    this.sweepTimer = setInterval(() => {
      if (Date.now() > this.sweepUntil || this.current) { clearInterval(this.sweepTimer); return; }
      this.hideLauncherWindows();
    }, 1000);
  }

  async findAttention() {
    // Only the store that is actually starting this game can need attention.
    const src = this.current && this.current.item.source;
    const own = SOURCE_LAUNCHERS[src] || (this.current && this.current.item.launch && /^steam:/i.test(this.current.item.launch.target || '') ? SOURCE_LAUNCHERS.steam : null);
    if (!own) return null;
    const mine = new Set(own.map((e) => e.toLowerCase()));
    const wins = (await this.launcherWindows()).filter((w) => mine.has(w.exe.toLowerCase()) && !w.iconic && w.w >= 250 && w.h >= 120 && w.title);
    // Prompts (EULA, cloud conflict, "Play?") first; then a main launcher window (often updating the game).
    const prompt = wins.find((w) => !LAUNCHER_MAIN_TITLE.test(w.title.trim()));
    const mainWin = wins.find((w) => LAUNCHER_MAIN_TITLE.test(w.title.trim()));
    const w = prompt || mainWin;
    return w ? { title: w.title, exe: w.exe, hwnd: w.hwnd, updating: !prompt } : null;
  }

  poll() {
    clearTimeout(this.timer);
    const c = this.current;
    if (!c || c.phase === 'exited') return;
    this.timer = setTimeout(async () => {
      if (this.current !== c) return;
      const pids = await this.findPids(c);
      if (this.current !== c) return;
      if (pids === null) { this.poll(); return; } // helper unavailable: try again next tick
      const now = Date.now();
      if (pids.size) {
        c.pids = pids;
        c.lastSeen = now;
        if (c.phase === 'launching' || c.phase === 'untracked') {
          c.phase = 'running';
          c.runningSince = now;
          this.emitState();
        }
        if (!c.revealed) {
          const win = await this.findGameWindow();
          if (this.current !== c) return;
          // Require the same window on two polls in a row (~1 s) so transient splashes don't count.
          const stable = win && c.candidate === win.hwnd;
          c.candidate = win ? win.hwnd : null;
          if (stable || now - c.runningSince > REVEAL_FALLBACK_MS) {
            c.revealed = true;
            c.attention = null;
            c.window = win;
            c.mainPid = win ? win.pid : null;
            this.emitState();
            this.emit('reveal', { hwnd: win && win.hwnd });
            this.startWindowWatch(c);
          } else if (now - c.startedAt > ATTENTION_AFTER_MS) {
            await this.updateAttention(c);
          }
        } else {
          this.hideLauncherWindows();
          // Revealed by timeout without a window: keep looking so the fast exit check can work.
          if (!c.window) {
            const win = await this.findGameWindow();
            if (this.current !== c) return;
            if (win) { c.window = win; c.mainPid = win.pid; this.startWindowWatch(c); }
          }
          // Exit as soon as the game's own process is gone (helper processes may linger).
          if (c.mainPid && !pids.has(c.mainPid)) {
            if (!c.mainGoneAt) c.mainGoneAt = now;
            else if (now - c.mainGoneAt > MAINPID_GRACE_MS) {
              const again = await this.findGameWindow();
              if (this.current !== c) return;
              if (again) { c.mainPid = again.pid; c.mainGoneAt = 0; } // game restarted itself
              else return this.finish('exited');
            }
          } else c.mainGoneAt = 0;
        }
      } else if (c.phase === 'running' && now - c.lastSeen > (c.mainPid ? MAINPID_GRACE_MS : EXIT_GRACE_MS)) {
        return this.finish('exited');
      } else if (c.phase === 'launching' || c.phase === 'untracked') {
        if (now - c.startedAt > ATTENTION_AFTER_MS) await this.updateAttention(c);
        if (c.phase === 'launching' && now - c.startedAt > DETECT_TIMEOUT_MS) {
          c.phase = 'untracked';
          c.tracked = false;
          this.emitState();
        }
      }
      this.poll();
    }, c.revealed ? 1500 : 900);
  }

  // Games often keep their process alive for a while after the window closes (shutdown,
  // telemetry, anti-cheat). Treat the game as finished as soon as its window is gone.
  startWindowWatch(c) {
    clearInterval(this.watchTimer);
    if (!c.window || !c.window.hwnd) return;
    let goneAt = 0;
    let busy = false;
    this.watchTimer = setInterval(async () => {
      if (this.current !== c) { clearInterval(this.watchTimer); return; }
      if (busy) return;
      busy = true;
      try {
        let alive = true;
        try { alive = await native.call('wins.alive', c.window.hwnd); } catch { return; }
        if (alive) { goneAt = 0; return; }
        if (!goneAt) { goneAt = Date.now(); return; }
        if (Date.now() - goneAt < 1200) return;
        const again = await this.findGameWindow(); // game recreated its window (resolution / mode change)?
        if (this.current !== c) return;
        if (again) { c.window = again; c.mainPid = again.pid; goneAt = 0; return; }
        clearInterval(this.watchTimer);
        this.finish('exited');
      } finally { busy = false; }
    }, 500);
  }

  async updateAttention(c) {
    const att = await this.findAttention();
    if (this.current !== c) return;
    if (JSON.stringify(att) !== JSON.stringify(c.attention)) { c.attention = att; this.emitState(); }
  }

  finish(reason) {
    const c = this.current;
    if (!c) return;
    clearTimeout(this.timer);
    clearInterval(this.watchTimer);
    const seconds = c.runningSince ? Math.round((Date.now() - c.runningSince) / 1000) : 0;
    c.phase = 'exited';
    this.current = null;
    this.last = { id: c.item.id, at: Date.now() - DUPLICATE_WINDOW_MS + 1500 }; // allow relaunch after 1.5 s
    if (c.kind === 'game') this.sweepAfterExit();
    this.emit('exited', { id: c.item.id, title: c.item.title, kind: c.kind, item: c.item, seconds, reason, startedAt: c.runningSince || c.startedAt });
    this.emitState();
  }

  detach() { if (this.current) this.finish('detached'); }

  // Ask nicely first (WM_CLOSE, lets games/browsers save), then force-kill what's left.
  async forceClose({ graceMs = 2500 } = {}) {
    const c = this.current;
    if (!c) return false;
    if (c.handle) { c.handle.close(); this.finish('killed'); return true; }
    // Work on this game's own record: its window closing can finish() it mid-way, and the
    // leftover processes still need killing.
    let pids = new Set([...((await this.findPids(c)) || []), ...c.pids]);
    if (pids.size) {
      try { await native.call('wins.close', [...pids].join('|')); } catch { /* ignore */ }
      const until = Date.now() + graceMs;
      while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 300));
        const now = await this.findPids(c);
        if (now === null) continue;
        pids = now;
        if (!pids.size) break;
      }
    }
    await Promise.all([...pids].map((pid) => new Promise((resolve) => {
      execFile('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    })));
    if (this.current === c) this.finish('killed');
    return true;
  }

  async focusGame() {
    const c = this.current;
    if (!c) return false;
    if (c.handle) { c.handle.focus(); return true; }
    if (!c.revealed && c.attention && c.attention.hwnd) {
      try { return await native.call('focus.hwnd', c.attention.hwnd); } catch { /* fall through */ }
    }
    if (c.window && c.window.hwnd) {
      try { if (await native.call('focus.hwnd', c.window.hwnd)) return true; } catch { /* fall through */ }
    }
    if (!c.pids.size) return false;
    try { return await native.call('focus.pids', [...c.pids].join('|')); } catch { return false; }
  }
}

module.exports = new Launcher();
module.exports.LAUNCHER_EXES = LAUNCHER_EXES;
