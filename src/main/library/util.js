const { execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function run(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: opts.timeout || 30000, encoding: 'utf8', ...opts },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

// Reads a registry key into { 'HKEY_...\\sub': { valueName: value } } (the key first, then its
// subkeys; with recursive = false only direct subkeys, without their values).
// `reg export` writes UTF-16, so names and paths outside ASCII (D:\Игры, Éditions) come back
// exactly; `reg query` output is in the console's OEM code page and can't be decoded reliably.
async function regQuery(key, recursive = false) {
  const tmp = path.join(os.tmpdir(), `p360-reg-${process.pid}-${crypto.randomBytes(4).toString('hex')}.reg`);
  try {
    const { err } = await run('reg.exe', ['export', key, tmp, '/y']);
    if (err || !fs.existsSync(tmp)) return {};
    const all = parseRegFile(fs.readFileSync(tmp));
    const keys = Object.keys(all);
    if (!keys.length || recursive) return all;
    const root = keys[0];
    const out = { [root]: all[root] };
    for (const k of keys.slice(1)) {
      const rest = k.slice(root.length + 1);
      if (k.toLowerCase().startsWith(root.toLowerCase() + '\\') && rest && !rest.includes('\\')) out[k] = {};
    }
    return out;
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* not created */ }
  }
}

// REGEDIT5 .reg file → { key: { name: value } }. Strings are unescaped; REG_EXPAND_SZ/MULTI_SZ
// hex is decoded; DWORDs become "0x…" like reg query prints them.
function parseRegFile(buf) {
  let text = buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le', 2) : buf.toString('utf8');
  text = text.replace(/\\\r?\n\s*/g, ''); // hex values continue over several lines
  const out = {};
  let cur = null;
  const unq = (s) => s.replace(/\\(.)/g, '$1');
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\[(HKEY_[^\]]+)\]\s*$/);
    if (sec) { cur = sec[1]; out[cur] = out[cur] || {}; continue; }
    if (!cur) continue;
    const m = line.match(/^(@|"((?:[^"\\]|\\.)*)")=(.*)$/);
    if (!m) continue;
    const name = m[1] === '@' ? '' : unq(m[2]);
    const v = m[3];
    let val;
    if (v.startsWith('"')) val = unq(v.slice(1, v.lastIndexOf('"')));
    else if (v.startsWith('dword:')) val = `0x${parseInt(v.slice(6), 16).toString(16)}`;
    else if (/^hex\((2|7)\):/.test(v)) {
      const bytes = Buffer.from(v.slice(v.indexOf(':') + 1).split(',').filter(Boolean).map((x) => parseInt(x, 16)));
      val = bytes.toString('utf16le').replace(/\0+$/, '');
      if (v.startsWith('hex(7)')) val = val.split('\0').join('\\0');
    } else val = v;
    out[cur][name] = val;
  }
  return out;
}

async function regValue(key, name) {
  const res = await regQuery(key);
  const k = Object.keys(res)[0];
  return k ? res[k][name] : undefined;
}

// Output as UTF-8 (by default Windows PowerShell writes the console's OEM code page into a pipe,
// which garbles accents, ™ and non-Latin text).
function powershell(script, timeout = 60000) {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${script}`], { timeout });
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
