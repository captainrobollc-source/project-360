// Project 360 watchdog. Runs as a separate, detached Node process (Electron with
// ELECTRON_RUN_AS_NODE=1) and keeps the dashboard alive:
//   • crash  (process gone without a clean-exit marker) → relaunch it
//   • hang   (heartbeat file not updated for 45 s)      → kill it, then treat as a crash
//   • 3 crashes within 10 minutes                        → stop retrying (shell mode: start Explorer)
// In shell mode the shell launcher relaunches crashed instances itself, so the watchdog only
// handles hangs there.
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = JSON.parse(Buffer.from(process.argv[2] || '', 'base64').toString('utf8'));
const { pid, heartbeat, exe, appArgs, shell, logDir, crashFile } = args;
const HANG_MS = 45000;
const POLL_MS = 3000;

function log(msg) {
  try { fs.appendFileSync(path.join(logDir, 'watchdog.log'), `${new Date().toISOString()} ${msg}\n`); } catch { /* ignore */ }
}

function alive(p) { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

function readBeat() {
  try { return JSON.parse(fs.readFileSync(heartbeat, 'utf8')); } catch { return null; }
}

function recentCrashes() {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(crashFile, 'utf8')); } catch { /* none */ }
  list = list.filter((t) => Date.now() - t < 10 * 60 * 1000);
  list.push(Date.now());
  try { fs.writeFileSync(crashFile, JSON.stringify(list)); } catch { /* ignore */ }
  return list.length;
}

function relaunch(reason) {
  const n = recentCrashes();
  log(`${reason}; crash ${n} in the last 10 minutes`);
  if (shell) { log('shell mode: the shell launcher handles restarts'); return process.exit(0); }
  if (n > 3) {
    log('too many crashes, giving up');
    return process.exit(0);
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE; // the watchdog runs Electron as Node; the dashboard must not
  const child = spawn(exe, [...appArgs.filter((a) => a !== '--recovered'), '--recovered'], { detached: true, stdio: 'ignore', windowsHide: false, env });
  child.unref();
  log(`relaunched (pid ${child.pid})`);
  process.exit(0);
}

log(`watching pid ${pid}${shell ? ' (shell mode)' : ''}`);
const started = Date.now();
setInterval(() => {
  const beat = readBeat();
  if (beat && beat.state === 'exit') { log('clean exit'); process.exit(0); }
  if (!alive(pid)) {
    // Give a just-written exit marker a moment to land.
    setTimeout(() => {
      const b = readBeat();
      if (b && b.state === 'exit') { log('clean exit'); process.exit(0); }
      relaunch('dashboard process ended unexpectedly');
    }, 1500);
    return;
  }
  const age = beat ? Date.now() - beat.t : Date.now() - started;
  if (age > HANG_MS && Date.now() - started > HANG_MS) {
    log(`no heartbeat for ${Math.round(age / 1000)} s — killing hung dashboard`);
    // Not /T: the watchdog itself is in the dashboard's process tree. Renderers and the native
    // helper exit on their own once the main process is gone.
    try { execFileSync('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* already gone */ }
    if (shell) process.exit(0); // the shell launcher sees the exit and restarts
    setTimeout(() => relaunch('dashboard hung'), 1500);
  }
}, POLL_MS);
