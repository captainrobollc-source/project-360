// Crash logging, crash dumps, heartbeat + watchdog, clean-exit tracking.
const { app, crashReporter } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

let heartbeatFile = null;
let beatTimer = null;

function markExit() {
  if (!heartbeatFile) return;
  try { fs.writeFileSync(heartbeatFile, JSON.stringify({ t: Date.now(), state: 'exit' })); } catch { /* ignore */ }
}

function beat() {
  try { fs.writeFileSync(heartbeatFile, JSON.stringify({ t: Date.now(), state: 'ok', pid: process.pid })); } catch { /* ignore */ }
}

function watchdogScript() {
  const p = path.join(__dirname, 'watchdog.js');
  // Packaged builds unpack the watchdog from app.asar (see build.asarUnpack).
  return p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

// Call as early as possible (before app 'ready').
function setup({ userDir, shell, useWatchdog }) {
  const log = logger.init(path.join(userDir, 'logs'));
  try { crashReporter.start({ uploadToServer: false, compress: true }); } catch { /* not fatal */ }

  // Every way of quitting goes through app.exit/quit: mark those as clean so the watchdog stands down.
  const realExit = app.exit.bind(app);
  app.exit = (code) => { markExit(); realExit(code); };
  app.on('will-quit', markExit);

  process.on('uncaughtException', (e) => console.error('[main] uncaught exception:', e && e.stack ? e.stack : e));
  process.on('unhandledRejection', (e) => console.error('[main] unhandled rejection:', e && e.stack ? e.stack : e));
  app.on('child-process-gone', (e, d) => console.warn('[main] child process gone:', d.type, d.reason, d.exitCode));

  heartbeatFile = path.join(userDir, 'heartbeat.json');
  beat();
  beatTimer = setInterval(beat, 5000);

  if (useWatchdog) {
    try {
      const payload = Buffer.from(JSON.stringify({
        pid: process.pid,
        heartbeat: heartbeatFile,
        exe: process.execPath,
        appArgs: process.argv.slice(1),
        shell: !!shell,
        logDir: log.dir,
        crashFile: path.join(userDir, 'crashes.json'),
      })).toString('base64');
      const child = spawn(process.execPath, [watchdogScript(), payload], {
        detached: true, stdio: 'ignore', windowsHide: true, cwd: process.cwd(),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      });
      child.unref();
      console.log('[reliability] watchdog started, pid', child.pid);
    } catch (e) {
      console.warn('[reliability] watchdog failed to start:', e.message);
    }
  }
  return log;
}

// Recover the dashboard/overlay renderers when they crash or freeze.
function guardWindow(win, name, { onRecovered } = {}) {
  let hangTimer = null;
  win.webContents.on('render-process-gone', (e, d) => {
    console.error(`[${name}] renderer gone:`, d.reason, d.exitCode);
    if (d.reason === 'clean-exit') return;
    setTimeout(() => { if (!win.isDestroyed()) { win.webContents.reload(); if (onRecovered) onRecovered(d.reason); } }, 800);
  });
  win.on('unresponsive', () => {
    console.warn(`[${name}] unresponsive`);
    clearTimeout(hangTimer);
    hangTimer = setTimeout(() => {
      if (win.isDestroyed()) return;
      console.error(`[${name}] still unresponsive after 10 s, reloading`);
      try { win.webContents.forcefullyCrashRenderer(); } catch { /* ignore */ }
      win.webContents.reload();
      if (onRecovered) onRecovered('hang');
    }, 10000);
  });
  win.on('responsive', () => clearTimeout(hangTimer));
}

module.exports = { setup, guardWindow, markExit, logger };
