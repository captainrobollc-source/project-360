const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 30000, encoding: 'utf8', ...opts },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

// Parses `reg query <key> /s` output into { 'HKEY_...\\sub': { valueName: value } }.
async function regQuery(key, recursive = false) {
  const args = ['query', key];
  if (recursive) args.push('/s');
  const { err, stdout } = await run('reg.exe', args);
  if (err && !stdout) return {};
  const out = {};
  let cur = null;
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    if (/^HKEY_/i.test(raw)) { cur = raw.trim(); out[cur] = out[cur] || {}; continue; }
    const m = raw.match(/^\s{4}(.*?)\s{4}(REG_\w+)\s{4}?(.*)$/);
    if (m && cur) out[cur][m[1] === '(Default)' ? '' : m[1]] = m[3] || '';
  }
  return out;
}

async function regValue(key, name) {
  const res = await regQuery(key);
  const k = Object.keys(res)[0];
  return k ? res[k][name] : undefined;
}

function powershell(script, timeout = 60000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { timeout });
}

function hash(s) { return crypto.createHash('sha1').update(String(s).toLowerCase()).digest('hex').slice(0, 12); }

function exists(p) { try { return !!p && fs.existsSync(p); } catch { return false; } }

function sortTitle(t) { return String(t || '').replace(/^(the|a|an)\s+/i, '').toLowerCase(); }

// Directories too broad to use for process tracking (would match unrelated processes).
function isTrackableDir(dir) {
  if (!dir) return false;
  const norm = path.resolve(dir).toLowerCase();
  const win = (process.env.WINDIR || 'C:\\Windows').toLowerCase();
  const broad = [
    win,
    (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase(),
    (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase(),
    (process.env.ProgramData || 'C:\\ProgramData').toLowerCase(),
    (process.env.USERPROFILE || '').toLowerCase(),
    (process.env.APPDATA || '').toLowerCase(),
    (process.env.LOCALAPPDATA || '').toLowerCase(),
  ].filter(Boolean);
  if (norm.startsWith(win)) return false;
  if (broad.includes(norm)) return false;
  return norm.split(/[\\/]/).filter(Boolean).length >= 2;
}

module.exports = { run, regQuery, regValue, powershell, hash, exists, sortTitle, isTrackableDir };
