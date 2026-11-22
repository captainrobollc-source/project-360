// Console info, storage and a 360-style network connection test.
const fs = require('fs');
const os = require('os');
const path = require('path');
const dns = require('dns');
const { run, regQuery, powershell } = require('./library/util');

const IS_WIN = process.platform === 'win32';
const NET_TIMEOUT_MS = 5000;

let gpuCache;    // string | null once resolved
let osCache;     // { os, osBuild }
let drivesCache; // { at, drives: [{ drive, label }] }

// ---------- info ----------

async function detectOs() {
  if (osCache) return osCache;
  let name = os.version() || os.type();
  const rel = os.release(); // 10.0.19045
  const build = Number(rel.split('.')[2] || 0);
  let osBuild = rel;
  if (IS_WIN) {
    if (build >= 22000) name = name.replace(/Windows 10/i, 'Windows 11');
    try {
      const res = await regQuery('HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion');
      const v = res[Object.keys(res)[0]] || {};
      const ubr = v.UBR ? parseInt(v.UBR, 16) : NaN; // REG_DWORD prints as 0x...
      if (build) osBuild = Number.isFinite(ubr) ? `${build}.${ubr}` : String(build);
      if (v.DisplayVersion) osBuild += ` (${v.DisplayVersion})`;
    } catch { /* keep os.release() */ }
  }
  osCache = { os: name, osBuild };
  return osCache;
}

async function detectGpu() {
  if (gpuCache !== undefined) return gpuCache;
  gpuCache = null;
  if (!IS_WIN) return gpuCache;
  try {
    // `/v DriverDesc` keeps this ~30 ms; a full `/s` dump of the display class key takes 10+ s.
    const { stdout } = await run('reg.exe', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}', '/s', '/v', 'DriverDesc'], { timeout: 8000 });
    const names = [];
    let inAdapterKey = false;
    for (const line of stdout.split(/\r?\n/)) {
      if (/^HKEY_/i.test(line)) { inAdapterKey = /\\\d{4}$/.test(line.trim()); continue; }
      const m = line.match(/^\s+DriverDesc\s+REG_\w+\s+(.*)$/);
      if (m && inAdapterKey && m[1].trim()) names.push(m[1].trim());
    }
    const real = names.filter((n) => !/basic display|basic render|remote|virtual|parsec|mirage|dameware|citrix|vmware|virtualbox|hyper-v|indirect/i.test(n));
    const pick = real.find((n) => /nvidia|geforce|rtx|gtx|radeon|amd|arc\b/i.test(n)) || real[0] || names[0];
    gpuCache = pick || null;
  } catch { /* unknown */ }
  return gpuCache;
}

async function getInfo({ gpuName } = {}) {
  const [o, gpu] = await Promise.all([detectOs(), gpuName ? Promise.resolve(gpuName) : detectGpu()]);
  const cpus = os.cpus();
  return {
    os: o.os,
    osBuild: o.osBuild,
    cpu: cpus.length ? cpus[0].model.replace(/\s+/g, ' ').trim() : 'Unknown CPU',
    cores: cpus.length,
    ramTotal: os.totalmem(),
    ramFree: os.freemem(),
    uptimeSec: Math.round(os.uptime()),
    hostname: os.hostname(),
    gpu: gpu || null,
    arch: os.arch(),
  };
}

// ---------- storage ----------

async function fixedDrives() {
  if (drivesCache && Date.now() - drivesCache.at < 5 * 60 * 1000) return drivesCache.drives;
  let drives = [];
  if (IS_WIN) {
    const { stdout } = await powershell("[IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { $_.Name + '|' + $_.VolumeLabel }", 8000);
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^([A-Z]):\\?\|(.*)$/i);
      if (m) drives.push({ drive: `${m[1].toUpperCase()}:`, label: m[2].trim() });
    }
    if (!drives.length) {
      // PowerShell unavailable: probe letters (skips A/B floppies). Labels unknown.
      for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        try { await fs.promises.access(`${L}:\\`); drives.push({ drive: `${L}:`, label: '' }); } catch { /* absent */ }
      }
    }
  } else {
    drives.push({ drive: '/', label: '' });
  }
  drivesCache = { at: Date.now(), drives };
  return drives;
}

// Drives the Emulation folder can move to: fixed disks plus removable/external ones, with space.
async function moveDrives() {
  let drives = [];
  if (IS_WIN) {
    const { stdout } = await powershell("[IO.DriveInfo]::GetDrives() | Where-Object { ($_.DriveType -eq 'Fixed' -or $_.DriveType -eq 'Removable') -and $_.IsReady } | ForEach-Object { $_.Name + '|' + $_.DriveType + '|' + $_.DriveFormat + '|' + $_.VolumeLabel }", 8000);
    for (const line of stdout.split(/\r?\n/)) {
      const m = line.match(/^([A-Z]):\\?\|(\w+)\|([^|]*)\|(.*)$/i);
      if (m) drives.push({ drive: `${m[1].toUpperCase()}:`, type: m[2].toLowerCase(), format: m[3].trim(), label: m[4].trim() });
    }
    if (!drives.length) drives = (await fixedDrives()).map((d) => ({ ...d, type: 'fixed', format: '' }));
  }
  return Promise.all(drives.map(async (d) => {
    let total = null;
    let free = null;
    try {
      const s = await fs.promises.statfs(`${d.drive}\\`);
      total = s.blocks * s.bsize;
      free = s.bavail * s.bsize;
    } catch { /* not ready */ }
    return { ...d, total, free };
  }));
}

function driveOf(p) {
  if (!p) return null;
  const m = String(p).match(/^([A-Za-z]):/);
  if (m) return `${m[1].toUpperCase()}:`;
  return IS_WIN ? null : '/';
}

async function getStorage(games = []) {
  const drives = await fixedDrives();
  const out = await Promise.all(drives.map(async ({ drive, label }) => {
    let total = null;
    let free = null;
    try {
      const s = await fs.promises.statfs(IS_WIN ? `${drive}\\` : drive);
      total = s.blocks * s.bsize;
      free = s.bavail * s.bsize;
    } catch { /* not ready */ }
    return { drive, label: label || '', total, free, used: total != null && free != null ? total - free : null, games: [] };
  }));
  const byDrive = new Map(out.map((d) => [d.drive, d]));
  for (const g of games || []) {
    if (!g) continue;
    const d = byDrive.get(driveOf(g.installDir && path.resolve(g.installDir)));
    if (!d) continue;
    d.games.push({ id: g.id, title: g.title, size: Number(g.sizeOnDisk) > 0 ? Number(g.sizeOnDisk) : null, source: g.source });
  }
  for (const d of out) {
    d.games.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || String(a.title).localeCompare(String(b.title)));
    d.gamesSize = d.games.reduce((n, g) => n + (g.size || 0), 0);
  }
  return out.sort((a, b) => a.drive.localeCompare(b.drive));
}

// ---------- network test ----------

function elapsed(t0) { return Math.round(Number(process.hrtime.bigint() - t0) / 1e6); }

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} timed out`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

const VIRTUAL_IF = /vethernet|virtualbox|vmware|hyper-v|loopback|pseudo|tailscale|zerotier|hamachi|wsl|docker|vpn|tap-|npcap/i;

async function testAdapter() {
  const t0 = process.hrtime.bigint();
  const all = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) all.push({ name, ip: a.address });
    }
  }
  const usable = all.filter((a) => !a.ip.startsWith('169.254.'));
  const best = usable.find((a) => !VIRTUAL_IF.test(a.name)) || usable[0] || all[0];
  if (!best) return { ok: false, ms: elapsed(t0), detail: 'No network adapter connected' };
  if (best.ip.startsWith('169.254.')) return { ok: false, ms: elapsed(t0), detail: `${best.name}: ${best.ip} (no DHCP address)` };
  return { ok: true, ms: elapsed(t0), detail: `${best.name} · ${best.ip}` };
}

async function testDns() {
  const host = 'www.msftconnecttest.com';
  const t0 = process.hrtime.bigint();
  // The OS resolver is what games/launchers use; c-ares direct queries are only a fallback
  // (they fail on PCs whose configured DNS server is a local proxy such as 127.0.0.1).
  // Both attempts fit inside the per-test limit (NET_TIMEOUT_MS + 1 s): a hung OS lookup still
  // leaves time for the direct query.
  try {
    const r = await withTimeout(dns.promises.lookup(host, { family: 4 }), Math.round(NET_TIMEOUT_MS * 0.55), 'DNS');
    return { ok: true, ms: elapsed(t0), detail: `${host} → ${r.address}` };
  } catch (err) {
    try {
      const addrs = await withTimeout(dns.promises.resolve4(host), Math.round(NET_TIMEOUT_MS * 0.55), 'DNS');
      return { ok: true, ms: elapsed(t0), detail: `${host} → ${addrs[0]} (direct DNS)` };
    } catch {
      return { ok: false, ms: elapsed(t0), detail: `Couldn't resolve ${host}: ${err.code || err.message}` };
    }
  }
}

async function testHttp(url, name, { expect } = {}) {
  const t0 = process.hrtime.bigint();
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(NET_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Project360' } });
    const ms = elapsed(t0);
    try { if (res.body) await res.body.cancel(); } catch { /* ignore */ }
    const ok = expect ? res.status === expect : res.status < 500;
    const portal = expect && res.status !== expect && res.status < 500;
    return { ok, ms, detail: ok ? `${name} reachable (HTTP ${res.status})` : portal ? `${name}: a sign-in page is in the way (HTTP ${res.status}). Open a browser to sign in to this network.` : `${name} returned HTTP ${res.status}` };
  } catch (err) {
    const ms = elapsed(t0);
    const cause = err && err.cause;
    const why = err && err.name === 'TimeoutError' ? `no response in ${NET_TIMEOUT_MS / 1000}s`
      : cause && cause.code ? cause.code : (err && err.message) || 'failed';
    return { ok: false, ms, detail: `${name} unreachable: ${why}` };
  }
}

const TESTS = [
  { id: 'adapter', label: 'Network adapter', fn: testAdapter },
  { id: 'dns', label: 'DNS', fn: testDns },
  { id: 'internet', label: 'Internet', fn: () => testHttp('https://www.gstatic.com/generate_204', 'Internet', { expect: 204 }) },
  { id: 'steam', label: 'Steam', fn: () => testHttp('https://store.steampowered.com/', 'Steam') },
  // store.epicgames.com answers scripted clients with a Cloudflare 403, so probe the store backend instead.
  { id: 'epic', label: 'Epic Games', fn: () => testHttp('https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US', 'Epic Games Store') },
  { id: 'xbox', label: 'Xbox', fn: () => testHttp('https://www.xbox.com/', 'Xbox.com') },
];

// All tests run in parallel; onResult (optional) fires as each finishes so the UI can tick them off.
async function testNetwork({ onResult } = {}) {
  return Promise.all(TESTS.map(async (t) => {
    let r;
    try {
      r = await withTimeout(Promise.resolve().then(t.fn), NET_TIMEOUT_MS + 1000, t.label);
    } catch (err) {
      r = { ok: false, ms: NET_TIMEOUT_MS, detail: (err && err.message) || 'failed' };
    }
    const out = { id: t.id, label: t.label, ok: !!r.ok, ms: r.ms, detail: r.detail };
    if (typeof onResult === 'function') { try { onResult(out); } catch { /* ignore */ } }
    return out;
  }));
}

module.exports = { getInfo, getStorage, testNetwork, moveDrives };
