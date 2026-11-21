// Windows integration: power, startup, shell replacement, explorer fail-safe.
const { app } = require('electron');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const native = require('./native');
const { run, regQuery } = require('./library/util');

const WINLOGON = 'HKCU\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Winlogon';

function appLaunchArgs() {
  // Packaged: the exe itself. Dev: electron.exe + app folder.
  return app.isPackaged ? [process.execPath] : [process.execPath, path.resolve(__dirname, '..', '..')];
}

function shellLauncherPath() {
  const packaged = path.join(process.resourcesPath || '', 'shell-launcher.vbs');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.resolve(__dirname, '..', '..', 'scripts', 'shell-launcher.vbs');
}

async function isExplorerRunning() {
  const { stdout } = await run('tasklist.exe', ['/FI', 'IMAGENAME eq explorer.exe', '/NH']);
  return /explorer\.exe/i.test(stdout);
}

async function launchExplorer() {
  const win = process.env.WINDIR || 'C:\\Windows';
  spawn(path.join(win, 'explorer.exe'), [], { detached: true, stdio: 'ignore' }).unref();
}

async function power(action) {
  switch (action) {
    case 'sleep':
      // The helper's call can block until the PC wakes, so give it a long timeout and only fall
      // back when the helper isn't there at all (otherwise we'd sleep again right after waking).
      try { await native.callT(10 * 60 * 1000, 'power.sleep'); }
      catch (e) { if (/not running/.test(e.message)) execFile('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'], { windowsHide: true }); }
      return true;
    case 'restart':
      execFile('shutdown.exe', ['/r', '/t', '0'], { windowsHide: true });
      return true;
    case 'shutdown':
      execFile('shutdown.exe', ['/s', '/t', '0'], { windowsHide: true });
      return true;
    case 'desktop':
      // Guaranteed way back to Windows: start explorer (it becomes the shell if none is
      // running) and quit with code 64 so the shell launcher doesn't relaunch us.
      if (!(await isExplorerRunning())) await launchExplorer();
      setTimeout(() => app.exit(64), 300);
      return true;
    default:
      throw new Error('unknown power action ' + action);
  }
}

// Windows matches the Run entry by path *and* args, so set and get must use the same args.
function startupItem() {
  const [exe, ...args] = appLaunchArgs();
  return { path: exe, args: [...args, '--startup'] };
}

function getStartup() {
  return app.getLoginItemSettings(startupItem()).openAtLogin;
}

function setStartup(enabled) {
  app.setLoginItemSettings({ openAtLogin: !!enabled, ...startupItem() });
  return getStartup();
}

async function getShellMode() {
  const res = await regQuery(WINLOGON);
  const k = Object.keys(res)[0];
  const v = k ? res[k].Shell : undefined;
  return { enabled: !!(v && /shell-launcher\.vbs/i.test(v)), value: v || null };
}

// Per-user shell replacement (HKCU Winlogon\Shell). Reversible; affects only this account.
async function setShellMode(enabled) {
  if (enabled) {
    const parts = [shellLauncherPath(), ...appLaunchArgs()].map((p) => `"${p}"`).join(' ');
    const value = `wscript.exe ${parts}`;
    const { err } = await run('reg.exe', ['add', WINLOGON, '/v', 'Shell', '/t', 'REG_SZ', '/d', value, '/f']);
    if (err) throw new Error('Could not write shell setting: ' + err.message);
  } else {
    await run('reg.exe', ['delete', WINLOGON, '/v', 'Shell', '/f']);
  }
  return getShellMode();
}

// Windows' "Open Xbox Game Bar using this button on a controller" (per user).
// When it's on, Game Bar steals the Guide button from Project 360.
const GAMEBAR = 'HKCU\\Software\\Microsoft\\GameBar';
async function getGameBarButton() {
  const res = await regQuery(GAMEBAR);
  const k = Object.keys(res)[0];
  const v = k ? res[k].UseNexusForGameBarEnabled : undefined;
  return v === undefined ? true : !/^0x0+$/i.test(String(v).trim());
}
async function setGameBarButton(enabled) {
  await run('reg.exe', ['add', GAMEBAR, '/v', 'UseNexusForGameBarEnabled', '/t', 'REG_DWORD', '/d', enabled ? '1' : '0', '/f']);
  return getGameBarButton();
}

module.exports = { getGameBarButton, setGameBarButton, power, getStartup, setStartup, getShellMode, setShellMode, launchExplorer, isExplorerRunning };
