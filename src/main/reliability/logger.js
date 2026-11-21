// File logging for the main process (and errors reported by the renderers).
// Logs live in <userData>/logs/main-YYYY-MM-DD.log; the newest 10 days are kept.
const fs = require('fs');
const path = require('path');
const util = require('util');

let stream = null;
let logDir = null;

function stamp() { return new Date().toISOString(); }

function write(level, args) {
  if (!stream) return;
  try { stream.write(`${stamp()} [${level}] ${util.format(...args)}\n`); } catch { /* disk full etc. */ }
}

function init(dir) {
  logDir = dir;
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  stream = fs.createWriteStream(path.join(dir, `main-${day}.log`), { flags: 'a' });
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
    const text = fs.readFileSync(path.join(logDir, files[files.length - 1]), 'utf8');
    return text.split('\n').slice(-lines).join('\n');
  } catch { return ''; }
}

module.exports = { init, write, dir, tail };
