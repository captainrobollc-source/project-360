// Backups of everything that can't be rebuilt by a rescan: settings (profiles, keys, preferences),
// per-profile user data (playtime, favorites, achievements), emulation state and the library
// (art choices, metadata). Automatic once a day and before updates; manual backup/restore,
// plus export/import to a single .p360backup file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hash } = require('../library/util');

const FILES = ['settings.json', 'userdata.json', 'emulation.json', 'library.json'];
const KEEP = 15;

class Backups {
  constructor({ userDir, version, flush }) {
    this.userDir = userDir;
    this.version = version;
    this.flush = flush || (() => {});
    this.dir = path.join(userDir, 'backups');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  list() {
    let dirs = [];
    try { dirs = fs.readdirSync(this.dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* none */ }
    return dirs.map((id) => {
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(this.dir, id, 'backup.json'), 'utf8')); } catch { /* old */ }
      return { id, at: meta.at || 0, reason: meta.reason || 'manual', version: meta.version || '', size: meta.size || 0 };
    }).sort((a, b) => b.at - a.at);
  }

  create(reason = 'manual', keep = null) {
    this.flush();
    const at = Date.now();
    const id = `${new Date(at).toISOString().replace(/[:.]/g, '-')}_${reason}`;
    const dest = path.join(this.dir, id);
    fs.mkdirSync(dest, { recursive: true });
    let size = 0;
    for (const f of FILES) {
      const src = path.join(this.userDir, f);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, path.join(dest, f));
      size += fs.statSync(src).size;
    }
    fs.writeFileSync(path.join(dest, 'backup.json'), JSON.stringify({ at, reason, version: this.version, size, files: FILES }));
    this.prune(keep);
    return { id, at, reason, size };
  }

  prune(keep = null) {
    for (const b of this.list().filter((x) => x.id !== keep).slice(KEEP)) {
      try { fs.rmSync(path.join(this.dir, b.id), { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  // Daily automatic backup (called at startup).
  autoDaily() {
    const last = this.list().find((b) => b.reason === 'daily');
    if (!last || Date.now() - last.at > 20 * 3600 * 1000) return this.create('daily');
    return null;
  }

  restore(id) {
    const src = path.join(this.dir, path.basename(id));
    if (!fs.existsSync(src)) throw new Error('Backup not found');
    // Read it first: the safety backup below prunes the oldest one, which may be this one.
    const files = {};
    for (const f of FILES) {
      try { files[f] = fs.readFileSync(path.join(src, f)); } catch { /* not in this backup */ }
    }
    if (!Object.keys(files).length) throw new Error('That backup is empty');
    this.create('before-restore', path.basename(id)); // and keep the one being restored
    this.keepEmulationLocation(files);
    for (const [f, buf] of Object.entries(files)) fs.writeFileSync(path.join(this.userDir, f), buf);
  }

  // The Emulation folder belongs to this PC as it is now: a backup from before a move (or from
  // another PC) mustn't point back at an old, emptied location. Keep the current folder and its
  // emulator setup, and carry emulated games' playtime and favorites over to their current ids.
  keepEmulationLocation(files) {
    const read = (name) => { try { return JSON.parse(fs.readFileSync(path.join(this.userDir, name), 'utf8')); } catch { return null; } };
    const parse = (v) => { try { return JSON.parse(Buffer.isBuffer(v) ? v.toString('utf8') : v); } catch { return null; } };
    const cur = read('settings.json');
    const next = files['settings.json'] && parse(files['settings.json']);
    if (!cur || !next) return;
    const home = path.join(os.homedir(), 'Emulation');
    const curRoot = (cur.emulation && cur.emulation.root) || home;
    const oldRoot = (next.emulation && next.emulation.root) || home;
    if (!fs.existsSync(curRoot)) return; // nothing here to keep
    next.emulation = { ...(next.emulation || {}), root: (cur.emulation && cur.emulation.root) || '', extraFolders: (cur.emulation && cur.emulation.extraFolders) || {} };
    files['settings.json'] = JSON.stringify(next, null, 2);
    try { files['emulation.json'] = fs.readFileSync(path.join(this.userDir, 'emulation.json')); } catch { delete files['emulation.json']; }
    if (path.resolve(curRoot).toLowerCase() === path.resolve(oldRoot).toLowerCase()) return;
    // Emulated game ids are made from their file paths: map the backup's ids to today's.
    const lib = files['library.json'] && parse(files['library.json']);
    if (!lib || !lib.games) return;
    const ren = new Map();
    const inside = (p, dir) => { const r = path.relative(path.resolve(dir), path.resolve(p)); return r && !r.startsWith('..') && !path.isAbsolute(r); };
    for (const [id, g] of Object.entries(lib.games)) {
      if (!g || !g.systemId || !g.romPath || !inside(g.romPath, oldRoot)) continue;
      const romPath = path.join(curRoot, path.relative(oldRoot, g.romPath));
      const nid = `rom:${hash(romPath)}`;
      delete lib.games[id];
      lib.games[nid] = { ...g, id: nid, romPath, installDir: path.dirname(romPath) };
      ren.set(id, nid);
    }
    if (!ren.size) return;
    files['library.json'] = JSON.stringify(lib, null, 2);
    const ud = files['userdata.json'] && parse(files['userdata.json']);
    if (!ud || !ud.profiles) return;
    for (const p of Object.values(ud.profiles)) {
      if (p && p.games) for (const [a, b] of ren) if (p.games[a]) { p.games[b] = { ...(p.games[b] || {}), ...p.games[a] }; delete p.games[a]; }
      if (p && Array.isArray(p.sessions)) for (const s of p.sessions) if (s && ren.has(s.id)) s.id = ren.get(s.id);
    }
    files['userdata.json'] = JSON.stringify(ud, null, 2);
  }

  exportTo(file) {
    this.flush();
    const files = {};
    for (const f of FILES) {
      try { files[f] = fs.readFileSync(path.join(this.userDir, f), 'utf8'); } catch { /* missing */ }
    }
    fs.writeFileSync(file, JSON.stringify({ app: 'Project 360', kind: 'backup', version: this.version, at: Date.now(), files }));
    return file;
  }

  importFrom(file) {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!data || data.app !== 'Project 360' || !data.files) throw new Error('That isn’t a Project 360 backup');
    for (const [name, text] of Object.entries(data.files)) {
      if (!FILES.includes(name)) continue;
      JSON.parse(text); // refuse broken files
    }
    this.create('before-import');
    const files = {};
    for (const [name, text] of Object.entries(data.files)) if (FILES.includes(name)) files[name] = text;
    this.keepEmulationLocation(files);
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(this.userDir, name), text);
  }
}

module.exports = { Backups };
