// Tiny JSON persistence with debounced atomic writes.
const fs = require('fs');
const path = require('path');

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) {
    const b = base[k];
    const o = over[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)
      ? deepMerge(b, o)
      : o;
  }
  return out;
}

class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.defaults = defaults;
    this.timer = null;
    this.lastBak = 0;
    this.data = deepMerge(defaults, JsonStore.load(file));
  }

  // Reads the file; if it's corrupt, keeps it aside and falls back to the last good copy (.bak).
  static load(file) {
    if (!fs.existsSync(file)) return {};
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) {
      const aside = `${file}.corrupt-${Date.now()}`;
      try { fs.copyFileSync(file, aside); } catch { /* ignore */ }
      try {
        const data = JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'));
        console.warn('[store] recovered', path.basename(file), 'from its backup copy (corrupt file kept as', path.basename(aside) + ')');
        return data;
      } catch {
        console.error('[store]', path.basename(file), 'is corrupt and has no backup copy; starting fresh (kept as', path.basename(aside) + ')');
        return {};
      }
    }
  }

  get(keyPath) {
    if (!keyPath) return this.data;
    return keyPath.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.data);
  }

  set(keyPath, value) {
    const keys = keyPath.split('.');
    let o = this.data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (typeof o[keys[i]] !== 'object' || o[keys[i]] === null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
    this.save();
    return value;
  }

  replace(data) { this.data = data; this.save(); }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      // Keep the previous good version as .bak (at most once a minute).
      if (Date.now() - this.lastBak > 60000 && fs.existsSync(this.file)) {
        try { fs.copyFileSync(this.file, `${this.file}.bak`); this.lastBak = Date.now(); } catch { /* ignore */ }
      }
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[store] write failed', this.file, e.message);
    }
  }
}

module.exports = { JsonStore, deepMerge };
