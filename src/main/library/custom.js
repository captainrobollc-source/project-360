// User-defined sources: shortcut folders, emulator ROM folders, and manually added programs.
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { hash, exists, sortTitle, isTrackableDir } = require('./util');

function titleFromFile(file) {
  return path.basename(file, path.extname(file))
    .replace(/[_.]+/g, ' ')
    .replace(/\s*[([].*?[)\]]\s*/g, ' ') // strip "(USA)", "[!]" ROM tags
    .replace(/\s+/g, ' ')
    .trim();
}

function exeEntry(id, source, title, exe, args, cwd) {
  const dir = path.dirname(exe);
  return {
    id, source, title, sortTitle: sortTitle(title),
    installDir: dir,
    launch: { type: 'exe', target: exe, args: args || [], cwd: cwd || dir },
    watch: { dirs: isTrackableDir(dir) ? [dir] : [], exes: [] },
  };
}

function fromShortcut(file) {
  const ext = path.extname(file).toLowerCase();
  const title = titleFromFile(file);
  const id = `local:${hash(file)}`;
  if (ext === '.exe') return exeEntry(id, 'local', title, file);
  if (ext === '.lnk') {
    try {
      const l = shell.readShortcutLink(file);
      if (l.target && /\.exe$/i.test(l.target) && exists(l.target)) {
        const args = l.args ? l.args.match(/(?:[^\s"]+|"[^"]*")+/g).map((a) => a.replace(/^"|"$/g, '')) : [];
        return exeEntry(id, 'local', title, l.target, args, l.cwd || undefined);
      }
    } catch { /* fall through to shell open */ }
    return { id, source: 'local', title, sortTitle: sortTitle(title), installDir: path.dirname(file), launch: { type: 'open', target: file }, watch: { dirs: [], exes: [] } };
  }
  if (ext === '.url') {
    try {
      const m = fs.readFileSync(file, 'utf8').match(/^URL=(.+)$/m);
      if (!m) return null;
      const url = m[1].trim();
      const steam = url.match(/^steam:\/\/rungameid\/(\d+)/i);
      return {
        id: steam ? `steam:${steam[1]}` : id,
        source: steam ? 'steam' : 'local',
        title, sortTitle: sortTitle(title),
        steamAppId: steam ? steam[1] : undefined,
        launch: { type: 'url', target: url },
        watch: { dirs: [], exes: [] },
      };
    } catch { return null; }
  }
  return null;
}

function scanFolder(folder) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(folder, e.name);
    if (e.isFile() && /\.(lnk|url|exe)$/i.test(e.name) && !/^(unins|setup|install|vc_?redist|dxsetup)/i.test(e.name)) {
      const g = fromShortcut(full);
      if (g) out.push(g);
    }
  }
  return out;
}

function walkRoms(dir, exts, depth = 0, out = []) {
  if (depth > 3) return out;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkRoms(full, exts, depth + 1, out);
    else if (exts.has(path.extname(e.name).slice(1).toLowerCase())) out.push(full);
  }
  return out;
}

// Emulator profile: { name, emulator, args: '-L core.dll "{rom}"', romsPath, extensions: ['sfc','smc'],
//   libretroSystem: 'Nintendo - Super Nintendo Entertainment System' }  (optional, enables libretro box art)
function scanEmulator(profile) {
  if (!profile || !profile.emulator || !profile.romsPath || !exists(profile.emulator)) return [];
  const exts = new Set((profile.extensions || []).map((e) => String(e).replace(/^\./, '').toLowerCase()));
  return walkRoms(profile.romsPath, exts).map((rom) => {
    const title = titleFromFile(rom);
    const argTemplate = profile.args || '"{rom}"';
    const args = (argTemplate.match(/(?:[^\s"]+|"[^"]*")+/g) || [])
      .map((a) => a.replace(/^"|"$/g, '').replace(/\{rom\}/g, rom).replace(/\{romdir\}/g, path.dirname(rom)));
    return {
      ...exeEntry(`rom:${hash(rom)}`, 'rom', title, profile.emulator, args, path.dirname(profile.emulator)),
      platform: profile.name || 'Emulator',
      libretroSystem: profile.libretroSystem || undefined,
      romName: path.basename(rom, path.extname(rom)), // No-Intro style file name, matches libretro thumbnail names
      watch: { dirs: [], exes: [] }, // tracked by spawned pid only
    };
  });
}

async function scan(settings) {
  const games = [];
  for (const folder of settings.customFolders || []) games.push(...scanFolder(folder));
  for (const emu of settings.emulators || []) games.push(...scanEmulator(emu));
  for (const m of settings.manualGames || []) {
    if (!m || !m.target) continue;
    const g = fromShortcut(m.target);
    if (g) {
      if (m.title) { g.title = m.title; g.sortTitle = sortTitle(m.title); }
      games.push(g);
    }
  }
  return { ok: true, games };
}

module.exports = { scan, fromShortcut };
