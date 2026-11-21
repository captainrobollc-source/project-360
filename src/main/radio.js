// Bluetooth and Wi-Fi for System › Bluetooth / Network. Talks to p360-radio.exe (WinRT device
// APIs) and uses netsh for saved Wi-Fi profiles. Wi-Fi passwords travel over the helper's stdin
// only: never logged, never on a command line.
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { NativeHelper } = require('./native');

const helper = new NativeHelper({ name: 'p360-radio', label: 'radio' });
const events = new EventEmitter();
let started = false;

function ensure() {
  if (!started) {
    started = true;
    helper.start();
    helper.on('bt.found', onFound);
    helper.on('bt.gone', (m) => { seen.delete(m.id); events.emit('event', { type: 'bt.gone', id: m.id }); });
    helper.on('bt.scanDone', () => events.emit('event', { type: 'bt.scanDone' }));
    helper.on('bt.pairing', (m) => events.emit('event', { type: 'bt.pairing', id: m.id, name: m.name, kind: m.kind, pin: m.pin }));
  }
  if (helper.ready) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Bluetooth/Wi-Fi helper unavailable')), 5000);
    helper.once('ready', () => { clearTimeout(t); resolve(); });
  });
}

// Devices re-report signal strength several times a second; forward only real changes.
const seen = new Map();
function onFound({ dev }) {
  const prev = seen.get(dev.id);
  const now = Date.now();
  if (prev && prev.name === dev.name && prev.connected === dev.connected && Math.abs((prev.rssi || 0) - (dev.rssi || 0)) < 8 && now - prev.at < 5000) return;
  seen.set(dev.id, { name: dev.name, connected: dev.connected, rssi: dev.rssi, at: now });
  events.emit('event', { type: 'bt.found', dev: { ...dev, kind: kindOf(dev) } });
}

// controller · audio · keyboard · mouse · phone · computer · other
function kindOf(d) {
  const n = String(d.name || '').toLowerCase();
  if (/controller|gamepad|xbox|dualsense|dualshock|wireless controller|pro controller|joy-?con|8bitdo|stadia/.test(n)) return 'controller';
  if (/airpods|buds|headphone|headset|earbud|speaker|soundbar|wh-|wf-|jbl|bose|beats|sony|sennheiser|jabra|skullcandy/.test(n)) return 'audio';
  if (/keyboard|keys/.test(n)) return 'keyboard';
  if (/mouse|trackpad|mx /.test(n)) return 'mouse';
  if (d.major === 4) return 'audio';
  if (d.major === 2) return 'phone';
  if (d.major === 1) return 'computer';
  if (d.major === 5) {
    const m = d.minor || 0;
    if ((m & 0x0c) === 0x08 || (m & 0x0c) === 0x04) return 'controller';
    if (m & 0x40) return 'keyboard';
    if (m & 0x80) return 'mouse';
  }
  if (d.le === 15) return 'controller'; // BLE HID
  if (d.le === 6) return 'remote';
  if (d.le === 3) return 'audio';
  return 'other';
}

function netsh(args) {
  return new Promise((resolve) => {
    execFile('netsh.exe', args, { windowsHide: true, timeout: 10000 }, (err, stdout) => resolve(err ? '' : String(stdout || '')));
  });
}

async function savedNetworks() {
  const out = await netsh(['wlan', 'show', 'profiles']);
  const names = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s{2,}[^:]+?\s:\s(.+)$/.exec(line);
    if (m && m[1].trim()) names.push(m[1].trim());
  }
  return names;
}

const api = {
  events,
  async radios() { await ensure(); return helper.call('radios'); },
  async setRadio(kind, on) { await ensure(); return helper.callT(15000, 'radio.set', kind, on ? 'on' : 'off'); },

  async paired() {
    await ensure();
    const list = await helper.callT(10000, 'bt.paired');
    return list.map((d) => ({ ...d, kind: kindOf(d) })).sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
  },
  async scan(on) { await ensure(); seen.clear(); return helper.call(on ? 'bt.scan.start' : 'bt.scan.stop'); },
  async pair(id) { await ensure(); return helper.callT(120000, 'bt.pair', id); },
  async reply(id, accept, pin = '') { await ensure(); return helper.call('bt.reply', id, accept ? '1' : '0', pin); },
  async unpair(id) { await ensure(); return helper.callT(30000, 'bt.unpair', id); },

  async wifi(rescan = true) {
    await ensure();
    const [report, saved] = await Promise.all([helper.callT(20000, rescan ? 'wifi.scan' : 'wifi.status'), savedNetworks()]);
    // netsh output can't show trailing spaces, and some network names end in one.
    const savedSet = new Set(saved.map((x) => x.trim()));
    return { ...report, networks: (report.networks || []).map((n) => ({ ...n, saved: savedSet.has(String(n.ssid).trim()) })) };
  },
  async connect(ssid, password = '', auto = true) { await ensure(); return helper.callT(45000, 'wifi.connect', ssid, password, auto ? '1' : '0'); },
  async disconnect() { await ensure(); return helper.call('wifi.disconnect'); },
  async forget(ssid) {
    const name = String(ssid).trim();
    const out = await netsh(['wlan', 'delete', 'profile', `name=${name}`]);
    return { ok: /deleted/i.test(out) || !(await savedNetworks()).includes(name) };
  },

  stop() { if (started) helper.stop(); },
};

module.exports = api;
