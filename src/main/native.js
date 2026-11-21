// Manages the native helper process (XInput, Core Audio, process tracking, focus).
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function helperPath(name) {
  const packaged = path.join(process.resourcesPath || '', 'native', `${name}.exe`);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  const dev = path.join(__dirname, '..', '..', 'native', 'bin', `${name}.exe`);
  if (!fs.existsSync(dev)) {
    try { require('../../scripts/build-native').build({ quiet: true }); } catch (e) { console.error(e.message); }
  }
  return dev;
}

class NativeHelper extends EventEmitter {
  constructor({ name = 'p360-native', label = 'native' } = {}) {
    super();
    this.name = name;
    this.label = label;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.buffer = '';
    this.ready = false;
    this.restarts = 0;
    this.stopping = false;
  }

  start() {
    this.stopping = false;
    const exe = helperPath(this.name);
    if (!fs.existsSync(exe)) {
      console.warn(`[${this.label}] helper missing (${this.name}.exe)`);
      return;
    }
    this.proc = spawn(exe, [], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.setEncoding('utf8');
    this.proc.stdout.on('data', (chunk) => this.onData(chunk));
    this.proc.stderr.on('data', (d) => console.error(`[${this.label}]`, d.toString().trim()));
    const proc = this.proc;
    this.proc.on('error', (e) => console.error(`[${this.label}] helper failed to start`, e.message));
    this.proc.on('exit', (code) => {
      if (this.proc === proc) this.proc = null;
      this.ready = false;
      this.buffer = '';
      for (const { reject, timer } of this.pending.values()) { clearTimeout(timer); reject(new Error('helper exited')); }
      this.pending.clear();
      if (this.stopping) return;
      console.warn(`[${this.label}] helper exited`, code);
      this.emit('exit', code); // lets main re-apply state the helper owned (taskbar, controller mouse)
      if (this.restarts++ < 5) setTimeout(() => this.start(), 1000 * this.restarts);
    });
  }

  stop() {
    this.stopping = true;
    // Closing stdin makes the helper restore the taskbar, release keys and exit by itself.
    if (this.proc) { try { this.proc.stdin.end(); } catch { /* ignore */ } }
  }

  onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (p) {
          this.pending.delete(msg.id);
          clearTimeout(p.timer);
          msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error));
        }
      } else if (msg.ev) {
        if (msg.ev === 'ready') { this.ready = true; this.info = msg; this.restarts = 0; }
        this.emit(msg.ev, msg);
      }
    }
  }

  call(cmd, ...args) { return this.callT(8000, cmd, ...args); }

  callT(timeoutMs, cmd, ...args) {
    if (!this.proc || !this.proc.stdin.writable) return Promise.reject(new Error('helper not running'));
    const id = ++this.seq;
    const line = [id, cmd, ...args.map((a) => String(a).replace(/[\t\n\r]/g, ' '))].join('\t') + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('helper timeout: ' + cmd)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(line);
    });
  }
}

module.exports = new NativeHelper();
module.exports.NativeHelper = NativeHelper;
