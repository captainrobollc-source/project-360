// File logging for the main process (and errors reported by the renderers).
// Logs live in <userData>/logs/main-YYYY-MM-DD.log; the newest 10 days are kept.
const fs = require('fs');
const path = require('path');
const util = require('util');

let stream = null;
let logDir = null;
let curDay = null;
let dayBytes = 0;
const DAY_LIMIT = 50 * 1024 * 1024; // past this, only warnings and errors are kept (log spam)

function stamp() { return new Date().toISOString(); }
const today = () => new Date().toISOString().slice(0, 10);

function open() {
  curDay = today();
  const file = path.join(logDir, `main-${curDay}.log`);
  try { dayBytes = fs.statSync(file).size; } catch { dayBytes = 0; }
  stream = fs.createWriteStream(file, { flags: 'a' });
}

function write(level, args) {
  if (!stream) return;
  // A console that runs for days starts a new file each day.
  if (today() !== curDay) { try { stream.end(); } catch { /* ignore */ } open(); }
  if (dayBytes > DAY_LIMIT && level !== 'error' && level !== 'warn') return;
  try {
    const line = `${stamp()} [${level}] ${util.format(...args)}\n`;
    dayBytes += line.length;
    stream.write(line);
  } catch { /* disk full etc. */ }
}

function init(dir) {
  logDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  open();
  // Keep the newest 10 log files.
  try {
    const files = fs.readdirSync(dir).filter((f) => /^main-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 10))) fs.unlinkSync(path.join(dir, f));
  } catch { /* ignore */ }
  for (const level of ['log', 'info', 'warn', 'error']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => { orig(...args); write(level === 'log' ? 'info' : level, args); };
  }
  write('info', ['---- Project 360 starting ----', process.argv.slice(1).join(' ')]);
  return { dir, write };
}

function dir() { return logDir; }

// The most recent lines, for the System › Console info screen.
function tail(lines = 200) {
  try {
    const files = fs.readdirSync(logDir).filter((f) => f.startsWith('main-')).sort();
    // Only the end of the file: a long-running session's log can be large.
    const file = path.join(logDir, files[files.length - 1]);
    const size = fs.statSync(file).size;
    const len = Math.min(size, 256 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
    return buf.toString('utf8').split('\n').slice(-lines).join('\n');
  } catch { return ''; }
}

module.exports = { init, write, dir, tail };
