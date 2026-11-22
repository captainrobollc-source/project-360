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
  if (!helper.proc) return Promise.reject(new Error('Bluetooth/Wi-Fi helper unavailable'));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Bluetooth/Wi-Fi helper unavailable')), 5000);
    helper.once('ready', () => { clearTimeout(t); resolve(); });
  });
}

// A device that's already paired often also advertises a second, unpaired endpoint (e.g. the
// BLE side of AirPods or a controller). Hide those from "Add a device".
const macOf = (id) => { const m = /([0-9a-f]{2}(?::[0-9a-f]{2}){5})$/i.exec(String(id || '')); return m ? m[1].toLowerCase() : null; };
const nameKey = (n) => String(n || '').trim().toLowerCase().replace(/[‘’']/g, "'");
let pairedKeys = { classicNames: new Set(), macs: new Set() };
function rememberPaired(list) {
  pairedKeys = {
    classicNames: new Set(list.filter((d) => !d.ble).map((d) => nameKey(d.name))),
    macs: new Set(list.map((d) => macOf(d.id)).filter(Boolean)),
  };
}
// Same address = the same device. A name match only counts for the BLE side of a paired classic
// device (AirPods etc.), so a second identical controller or headset still shows up.
const isPairedTwin = (dev) => pairedKeys.macs.has(macOf(dev.id)) || (dev.ble && pairedKeys.classicNames.has(nameKey(dev.name)));

// Devices re-report signal strength several times a second; forward only real changes.
const seen = new Map();
function onFound({ dev }) {
  if (isPairedTwin(dev)) return;
  const prev = seen.get(dev.id);
  const now = Date.now();
  if (prev && prev.name === dev.name && prev.connected === dev.connected && Math.abs((prev.rssi || 0) - (dev.rssi || 0)) < 8 && now - prev.at < 5000) return;
  seen.set(dev.id, { name: dev.name, connected: dev.connected, rssi: dev.rssi, at: now });
  events.emit('event', { type: 'bt.found', dev: { ...dev, kind: kindOf(dev) } });
}

// Bluetooth audio devices Windows knows (headphones, speakers), matched to paired devices by
// address, or by name when the driver doesn't carry the address.
async function audioList() {
  try { return await helper.callT(8000, 'bt.audio.list'); } catch { return []; }
}
function audioFor(d, audio) {
  const mac = macOf(d.id);
  return audio.find((a) => mac && a.mac === mac) || audio.find((a) => a.name && nameKey(a.name) === nameKey(d.name)) || null;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Battery levels: AirPods/Beats broadcasts (left, right, case) or what Windows reads from a
// connected headset. Refreshed while System › Bluetooth asks for the list.
const batteryByKey = new Map(); // address or name → { left, right, case, charging…, level }
let batteryAt = 0;
let batteryInflight = null;
const batteryFor = (d) => batteryByKey.get(macOf(d.id)) || batteryByKey.get(nameKey(d.name)) || null;
function refreshBattery() {
  if (batteryInflight || Date.now() - batteryAt < 8000) return;
  batteryInflight = (async () => {
    await ensure();
    const list = await helper.callT(12000, 'bt.battery');
    batteryByKey.clear();
    for (const b of list || []) {
      const a = b.apple;
      if (b.level == null && !a) continue;
      const v = a
        ? { left: a.left, right: a.right, case: a.case, chargingLeft: a.chargingLeft, chargingRight: a.chargingRight, chargingCase: a.chargingCase, level: b.level }
        : { level: b.level };
      if (b.mac) batteryByKey.set(b.mac, v);
      if (b.name) batteryByKey.set(nameKey(b.name), v);
    }
    batteryAt = Date.now();
    if (cache.paired) {
      const next = cache.paired.map((d) => ({ ...d, battery: batteryFor(d) }));
      if (JSON.stringify(next) !== JSON.stringify(cache.paired)) {
        cache.paired = next;
        events.emit('event', { type: 'bt.paired', list: next });
      }
    }
  })().catch(() => {}).finally(() => { batteryInflight = null; });
}

// Cached answers so System › Bluetooth / Network open instantly; a background refresh follows.
const cache = { radios: null, radiosAt: 0, paired: null, pairedAt: 0 };
let pairedInflight = null;
async function fetchPaired() {
  if (pairedInflight) return pairedInflight;
  pairedInflight = (async () => {
    await ensure();
    const [raw, audio] = await Promise.all([helper.callT(10000, 'bt.paired'), audioList()]);
    const list = raw
      .map((d) => {
        const a = audioFor(d, audio);
        // Headphones and speakers can be connected by hand (like Windows' Connect button).
        return { ...d, kind: kindOf(d), audio: !!a, connected: d.connected || !!(a && a.connected), battery: batteryFor(d) };
      })
      .sort((a, b) => (b.connected - a.connected) || a.name.localeCompare(b.name));
    const changed = JSON.stringify(list) !== JSON.stringify(cache.paired);
    cache.paired = list;
    cache.pairedAt = Date.now();
    rememberPaired(list);
    if (changed) events.emit('event', { type: 'bt.paired', list });
    return list;
  })().finally(() => { pairedInflight = null; });
  return pairedInflight;
}
async function fetchRadios() {
  await ensure();
  const list = await helper.call('radios');
  cache.radios = list;
  cache.radiosAt = Date.now();
  return list;
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
  // Starts the helper and fills the caches in the background (called a little after boot).
  prewarm() { fetchRadios().then(() => fetchPaired()).catch(() => {}); },

  async radios({ fresh = false } = {}) {
    if (!fresh && cache.radios && Date.now() - cache.radiosAt < 15000) return cache.radios;
    return fetchRadios();
  },
  async setRadio(kind, on) {
    await ensure();
    const list = await helper.callT(15000, 'radio.set', kind, on ? 'on' : 'off');
    cache.radios = list;
    cache.radiosAt = Date.now();
    if (kind === 'bluetooth' && on) fetchPaired().catch(() => {});
    return list;
  },

  // Cached list right away (refreshing behind it when older than 10 s); waits only the first time.
  async paired({ fresh = false } = {}) {
    refreshBattery();
    if (cache.paired && !fresh) {
      if (Date.now() - cache.pairedAt > 10000) fetchPaired().catch(() => {});
      return cache.paired;
    }
    return fetchPaired();
  },
  async scan(on) {
    await ensure();
    seen.clear();
    if (on) { try { await api.paired(); } catch { /* filter with what we have */ } }
    return helper.call(on ? 'bt.scan.start' : 'bt.scan.stop');
  },
  async pair(id) {
    await ensure();
    const res = await helper.callT(120000, 'bt.pair', id);
    if (res && res.paired) fetchPaired().catch(() => {});
    return res;
  },
  // Connect (or disconnect) paired headphones/speakers now, e.g. AirPods that are busy with a
  // phone. Resolves once Windows reports the new state, or after ~15 s.
  async audioConnect(id, on = true) {
    await ensure();
    let d = (cache.paired || []).find((x) => x.id === id);
    if (!d) d = (await fetchPaired()).find((x) => x.id === id);
    if (!d) throw new Error('That device isn’t paired any more');
    const res = await helper.callT(20000, 'bt.audio.connect', macOf(d.id) || '', d.name, on ? '1' : '0');
    if (!res.found) throw new Error('Only headphones and speakers can be connected from here. Other devices connect when you turn them on.');
    if (!res.sent) throw new Error(`Windows didn’t accept the request${res.errors && res.errors.length ? ` (${res.errors[0]})` : ''}`);
    let state = null;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      const a = audioFor(d, await audioList());
      state = a ? a.connected : null;
      if (state === on) break;
    }
    fetchPaired().catch(() => {});
    return { ok: state === on, connected: !!state };
  },
  async reply(id, accept, pin = '') { await ensure(); return helper.call('bt.reply', id, accept ? '1' : '0', pin); },
  async unpair(id) {
    await ensure();
    const res = await helper.callT(30000, 'bt.unpair', id);
    if (res && res.ok && cache.paired) { cache.paired = cache.paired.filter((d) => d.id !== id); rememberPaired(cache.paired); }
    fetchPaired().catch(() => {});
    return res;
  },

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
