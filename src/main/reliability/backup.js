// Backups of everything that can't be rebuilt by a rescan: settings (profiles, keys, preferences),
// per-profile user data (playtime, favorites, achievements), emulation state and the library
// (art choices, metadata). Automatic once a day and before updates; manual backup/restore,
// plus export/import to a single .p360backup file.
const fs = require('fs');
const path = require('path');

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
    for (const [f, buf] of Object.entries(files)) fs.writeFileSync(path.join(this.userDir, f), buf);
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
    for (const [name, text] of Object.entries(data.files)) {
      if (FILES.includes(name)) fs.writeFileSync(path.join(this.userDir, name), text);
    }
  }
}

module.exports = { Backups };
