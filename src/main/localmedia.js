// Local Music, Pictures (incl. game captures) and Videos for the console's media blades.
//
// scanAll({ extraFolders, steamRoot, gameNameForAppId }) -> { music, pictures, videos, roots }
// isAllowedPath(p) -> true only for media files inside a root from the last scan.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { regQuery } = require('./library/util');

const EXT = {
  music: new Set(['.mp3', '.m4a', '.flac', '.ogg', '.opus', '.wav']),
  pictures: new Set(['.jpg', '.jpeg', '.png', '.webp']),
  videos: new Set(['.mp4', '.webm', '.mkv', '.mov', '.m4v']),
};
const ALL_EXT = new Set([...EXT.music, ...EXT.pictures, ...EXT.videos]);
const MAX_DEPTH = 4;
const LIMIT = 5000;
const SKIP_DIR = /^(?:[.$~].*|node_modules|system volume information|thumbnails|__macosx|appdata|\$recycle\.bin|windowsapps)$/i;
const IS_WIN = process.platform === 'win32';

// Known-folder GUIDs under "User Shell Folders".
const KF_CAPTURES = '{EDC0FE71-98D8-4F4A-B920-C8DC133CB165}';
const KF_SCREENSHOTS = '{B7BEDE81-DF94-4682-A7D8-57A52620B86F}';

let lastRoots = [];      // normalised (lower-cased on Windows) root paths
let lastRealRoots = [];  // realpath() of the roots, same normalisation
const tagCache = new Map(); // path -> { mtimeMs, size, tags }

// ---------- helpers ----------

function normKey(p) {
  let r = path.resolve(String(p));
  if (r.length > 3) r = r.replace(/[\\/]+$/, '');
  return IS_WIN ? r.toLowerCase() : r;
}

function expandEnv(s) {
  return String(s || '').replace(/%([^%]+)%/g, (m, k) => {
    const hit = Object.keys(process.env).find((e) => e.toLowerCase() === k.toLowerCase());
    return hit ? process.env[hit] : m;
  });
}

async function mapLimit(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = undefined; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

async function isDir(p) {
  try { return (await fsp.stat(p)).isDirectory(); } catch { return false; }
}

// Breadth-first walk, depth-limited, no symlink/junction following, permission errors ignored.
async function walk(root, { maxDepth = MAX_DEPTH, skip, onFile, shouldStop }) {
  let level = [root];
  for (let depth = 0; depth <= maxDepth && level.length; depth++) {
    const next = [];
    await mapLimit(level, 12, async (dir) => {
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (depth < maxDepth && !SKIP_DIR.test(e.name) && !(skip && skip.has(normKey(full)))) next.push(full);
        } else if (e.isFile() && e.name[0] !== '.') {
          onFile(full, e.name, depth);
        }
      }
    });
    if (shouldStop && shouldStop()) break;
    level = next;
  }
}

async function knownFolders() {
  const home = os.homedir();
  const f = {
    music: path.join(home, 'Music'),
    pictures: path.join(home, 'Pictures'),
    videos: path.join(home, 'Videos'),
    captures: null,
    screenshots: null,
  };
  if (IS_WIN) {
    try {
      const res = await regQuery('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders');
      const vals = res[Object.keys(res)[0]] || {};
      const get = (name) => {
        const k = Object.keys(vals).find((x) => x.toLowerCase() === name.toLowerCase());
        return k && vals[k] ? path.normalize(expandEnv(vals[k])) : null;
      };
      f.music = get('My Music') || f.music;
      f.pictures = get('My Pictures') || f.pictures;
      f.videos = get('My Video') || f.videos;
      f.captures = get(KF_CAPTURES);
      f.screenshots = get(KF_SCREENSHOTS);
    } catch { /* defaults */ }
  }
  f.captures = f.captures || path.join(f.videos, 'Captures');
  f.screenshots = f.screenshots || path.join(f.pictures, 'Screenshots');
  return f;
}

// "Halo Infinite 2024-03-05 21-14-31.png" / "Halo  Infinite 3_5_2024 9_14_31 PM.mp4" -> "Halo Infinite"
function gameFromCaptureName(name) {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^(.*?)[\s_]+(?:\d{4}-\d{2}-\d{2}[\s_]+\d{2}-\d{2}-\d{2}|\d{1,2}_\d{1,2}_\d{4}[\s_]+\d{1,2}_\d{2}_\d{2}(?:[\s_]*[AP]M)?)/i);
  const g = (m ? m[1] : '').replace(/\s+/g, ' ').replace(/[\s\-_]+$/, '').trim();
  return g || null;
}

const NV_NAME = /\d{4}\.\d{2}\.\d{2} - \d{2}\.\d{2}\.\d{2}\.\d{2,}/;

// ---------- tag readers (ID3v2/ID3v1, MP4 ilst, FLAC/Ogg Vorbis comments) ----------

function syncsafe(b, o) { return ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f); }

function cleanStr(s) {
  s = String(s || '').replace(/\0[\s\S]*$/, '').trim();
  return s || null;
}

function decodeId3Text(buf) {
  if (!buf.length) return null;
  const enc = buf[0];
  let d = buf.subarray(1);
  let s;
  if (enc === 1 || enc === 2) {
    let le = enc === 1;
    if (d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) { le = true; d = d.subarray(2); }
    else if (d.length >= 2 && d[0] === 0xfe && d[1] === 0xff) { le = false; d = d.subarray(2); }
    d = Buffer.from(d.subarray(0, d.length - (d.length % 2)));
    if (!le) d.swap16();
    s = d.toString('utf16le');
  } else if (enc === 3) s = d.toString('utf8');
  else s = d.toString('latin1');
  return cleanStr(s);
}

const ID3_FRAMES = { TIT2: 'title', TT2: 'title', TPE1: 'artist', TP1: 'artist', TALB: 'album', TAL: 'album', TPE2: 'albumArtist', TP2: 'albumArtist', TRCK: 'track', TRK: 'track' };

async function readAt(fh, pos, len) {
  const b = Buffer.alloc(len);
  const { bytesRead } = await fh.read(b, 0, len, pos);
  return b.subarray(0, bytesRead);
}

async function readId3v2(fh, fileSize) {
  const head = await readAt(fh, 0, 10);
  if (head.length < 10 || head.toString('latin1', 0, 3) !== 'ID3') return null;
  const ver = head[3];
  const flags = head[5];
  const tagEnd = 10 + syncsafe(head, 6);
  if (ver < 2 || ver > 4) return { tags: null, end: tagEnd };

  // Source: either a cached window of the file, or (if unsynchronised) a de-unsynced copy of the whole tag.
  let src = await readAt(fh, 10, Math.min(tagEnd - 10, 65536));
  let srcBase = 10;
  let whole = src.length >= tagEnd - 10;
  if ((flags & 0x80) && ver < 4) {
    const all = await readAt(fh, 10, Math.min(tagEnd - 10, 4 * 1024 * 1024));
    const out = [];
    for (let i = 0; i < all.length; i++) { out.push(all[i]); if (all[i] === 0xff && all[i + 1] === 0x00) i++; }
    src = Buffer.from(out); whole = true;
  }
  const get = async (absPos, len) => {
    const rel = absPos - srcBase;
    if (rel >= 0 && rel + len <= src.length) return src.subarray(rel, rel + len);
    if (whole) return src.subarray(Math.max(0, rel), Math.max(0, rel + len));
    return readAt(fh, absPos, len);
  };
  const limit = whole ? srcBase + src.length : Math.min(tagEnd, fileSize);

  let pos = 10;
  if (flags & 0x40) {
    const eh = await get(pos, 4);
    if (eh.length === 4) pos += ver === 4 ? syncsafe(eh, 0) : eh.readUInt32BE(0) + 4;
  }
  const idLen = ver === 2 ? 3 : 4;
  const hdrLen = ver === 2 ? 6 : 10;
  const tags = {};
  for (let n = 0; n < 200 && pos + hdrLen <= limit; n++) {
    const h = await get(pos, hdrLen);
    if (h.length < hdrLen) break;
    const id = h.toString('latin1', 0, idLen);
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    const size = ver === 2 ? h.readUIntBE(3, 3) : ver === 4 ? syncsafe(h, 4) : h.readUInt32BE(4);
    if (size <= 0 || pos + hdrLen + size > limit + 16) break;
    const fflags = ver === 2 ? 0 : h.readUInt16BE(8);
    const unreadable = ver === 4 ? (fflags & 0x000e) : ver === 3 ? (fflags & 0x00c0) : 0;
    const key = ID3_FRAMES[id];
    if (key && !tags[key] && !unreadable && size < 4096) tags[key] = decodeId3Text(await get(pos + hdrLen, size));
    pos += hdrLen + size;
    if (tags.title && tags.artist && tags.album && tags.albumArtist && tags.track) break;
  }
  return { tags, end: tagEnd };
}

async function readId3v1(fh, fileSize) {
  if (fileSize < 128) return null;
  const b = await readAt(fh, fileSize - 128, 128);
  if (b.toString('latin1', 0, 3) !== 'TAG') return null;
  const s = (a, z) => cleanStr(b.toString('latin1', a, z));
  return { title: s(3, 33), artist: s(33, 63), album: s(63, 93), track: b[125] === 0 && b[126] ? String(b[126]) : null };
}

function parseVorbisComments(b, o) {
  const tags = {};
  if (o + 4 > b.length) return tags;
  const vlen = b.readUInt32LE(o); o += 4 + vlen;
  if (o + 4 > b.length) return tags;
  const count = Math.min(b.readUInt32LE(o), 1000); o += 4;
  const map = { title: 'title', artist: 'artist', album: 'album', albumartist: 'albumArtist', 'album artist': 'albumArtist', tracknumber: 'track' };
  for (let i = 0; i < count && o + 4 <= b.length; i++) {
    const len = b.readUInt32LE(o); o += 4;
    if (o + len > b.length) break;
    if (len < 4096) {
      const s = b.toString('utf8', o, o + len);
      const eq = s.indexOf('=');
      const k = map[s.slice(0, eq).toLowerCase()];
      if (eq > 0 && k && !tags[k]) tags[k] = cleanStr(s.slice(eq + 1));
    }
    o += len;
  }
  return tags;
}

async function readFlac(fh, fileSize, start) {
  if ((await readAt(fh, start, 4)).toString('latin1') !== 'fLaC') return null;
  let pos = start + 4;
  for (let n = 0; n < 64 && pos + 4 <= fileSize; n++) {
    const h = await readAt(fh, pos, 4);
    if (h.length < 4) break;
    const last = h[0] & 0x80;
    const type = h[0] & 0x7f;
    const len = h.readUIntBE(1, 3);
    if (type === 4) return parseVorbisComments(await readAt(fh, pos + 4, Math.min(len, 1024 * 1024)), 0);
    pos += 4 + len;
    if (last) break;
  }
  return null;
}

async function readOgg(fh) {
  const b = await readAt(fh, 0, 131072);
  if (b.toString('latin1', 0, 4) !== 'OggS') return null;
  let i = b.indexOf('OpusTags', 0, 'latin1');
  if (i >= 0) return parseVorbisComments(b, i + 8);
  i = b.indexOf('\x03vorbis', 0, 'latin1');
  if (i >= 0) return parseVorbisComments(b, i + 7);
  return null;
}

function mp4Children(b, start, end, cb) {
  let p = start;
  while (p + 8 <= end) {
    let size = b.readUInt32BE(p);
    const type = b.toString('latin1', p + 4, p + 8);
    let hdr = 8;
    if (size === 1) { if (p + 16 > end) break; size = Number(b.readBigUInt64BE(p + 8)); hdr = 16; }
    else if (size === 0) size = end - p;
    if (size < hdr || p + size > end) break;
    if (cb(type, p + hdr, p + size) === false) break;
    p += size;
  }
}

async function readMp4(fh, fileSize) {
  // Find moov among top-level atoms (it may sit after mdat).
  let pos = 0;
  let moov = null;
  for (let n = 0; n < 64 && pos + 8 <= fileSize; n++) {
    const h = await readAt(fh, pos, 16);
    if (h.length < 8) break;
    let size = h.readUInt32BE(0);
    const type = h.toString('latin1', 4, 8);
    if (size === 1 && h.length >= 16) size = Number(h.readBigUInt64BE(8));
    else if (size === 0) size = fileSize - pos;
    if (n === 0 && type !== 'ftyp') return null;
    if (size < 8) break;
    if (type === 'moov') { if (size <= 16 * 1024 * 1024) moov = await readAt(fh, pos, size); break; }
    pos += size;
  }
  if (!moov) return null;
  const tags = {};
  const map = { '\xa9nam': 'title', '\xa9ART': 'artist', '\xa9alb': 'album', aART: 'albumArtist', trkn: 'track' };
  const ilst = (s, e) => mp4Children(moov, s, e, (type, cs, ce) => {
    const key = map[type];
    if (!key) return;
    mp4Children(moov, cs, ce, (t2, ds, de) => {
      if (t2 !== 'data' || de - ds < 8) return;
      const kind = moov.readUInt32BE(ds) & 0xffffff;
      const val = moov.subarray(ds + 8, de);
      if (key === 'track') { if (val.length >= 4) { const n = val.readUInt16BE(2); if (n) tags.track = String(n); } }
      else if (kind === 1 && !tags[key]) tags[key] = cleanStr(val.toString('utf8'));
      return false;
    });
  });
  const meta = (s, e) => mp4Children(moov, s + 4, e, (type, cs, ce) => { if (type === 'ilst') ilst(cs, ce); });
  mp4Children(moov, 8, moov.length, (type, s, e) => {
    if (type === 'udta') mp4Children(moov, s, e, (t, cs, ce) => { if (t === 'meta') meta(cs, ce); });
    else if (type === 'meta') meta(s, e);
  });
  return tags;
}

async function readTags(file, ext, size) {
  let fh;
  try {
    fh = await fsp.open(file, 'r');
    if (ext === '.mp3') {
      const v2 = await readId3v2(fh, size);
      const t = (v2 && v2.tags) || {};
      if (!t.title || !t.artist) {
        const v1 = await readId3v1(fh, size);
        if (v1) for (const k of Object.keys(v1)) if (!t[k] && v1[k]) t[k] = v1[k];
      }
      return t;
    }
    if (ext === '.flac') {
      const v2 = await readId3v2(fh, size); // some FLACs carry an ID3 prefix
      return (await readFlac(fh, size, v2 ? v2.end : 0)) || (v2 && v2.tags) || {};
    }
    if (ext === '.m4a') return (await readMp4(fh, size)) || {};
    if (ext === '.ogg' || ext === '.opus') return (await readOgg(fh)) || {};
    return {};
  } catch {
    return {};
  } finally {
    if (fh) await fh.close().catch(() => {});
  }
}

// ---------- music naming fallback ----------

function inferFromPath(file, root) {
  const rel = path.relative(root, file);
  const parts = rel.split(/[\\/]/);
  const fileName = parts.pop();
  let base = fileName.replace(/\.[^.]+$/, '');
  if (parts.length && /^(?:cd|dis[ck])\s*\d+$/i.test(parts[parts.length - 1])) parts.pop();

  let track = null;
  const tm = base.match(/^(?:\d-)?(\d{1,3})(?:\s*[-._)]\s*|\s+)(?=\S)/);
  // "01 - x", "1. x", "1-01 x" always; bare "NN x" only with a leading zero or inside an Artist/Album folder ("99 Luftballons").
  if (tm && (/[-._)]/.test(tm[0]) || tm[1][0] === '0' || parts.length >= 2)) { track = String(Number(tm[1])); base = base.slice(tm[0].length); }

  let artist = null;
  let album = null;
  if (parts.length >= 2) { artist = parts[parts.length - 2]; album = parts[parts.length - 1]; }
  else if (parts.length === 1) artist = parts[0];

  const dash = base.split(/\s+[-–—]\s+/);
  let title = base;
  if (dash.length >= 2) {
    const left = dash[0].trim();
    const right = dash.slice(1).join(' - ').trim();
    const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();
    if (parts.length === 1 && !same(left, parts[0])) { album = parts[0]; artist = left; title = right; }
    else if (!artist) { artist = left; title = right; }
    else if (same(left, artist) || same(left, album)) title = right;
  }
  return { title: title.trim() || base, artist, album, track };
}

// ---------- scan ----------

async function scanAll({ extraFolders = {}, steamRoot, gameNameForAppId = () => null } = {}) {
  const extras = {
    music: (extraFolders && extraFolders.music) || [],
    pictures: (extraFolders && extraFolders.pictures) || [],
    videos: (extraFolders && extraFolders.videos) || [],
  };
  const kf = await knownFolders();
  const seen = new Set();
  const found = { music: [], pictures: [], videos: [] };
  const roots = [];
  const addRoot = (p) => { if (p && !roots.some((r) => normKey(r) === normKey(p))) roots.push(path.resolve(p)); };

  const add = (type, file, extra) => {
    const list = found[type];
    if (list.length >= LIMIT * 2) return;
    const k = normKey(file);
    if (seen.has(k)) return;
    seen.add(k);
    list.push({ path: file, ...extra });
  };
  const typeOf = (name) => {
    const ext = path.extname(name).toLowerCase();
    for (const t of Object.keys(EXT)) if (EXT[t].has(ext)) return t;
    return null;
  };
  const gameName = (appid) => { try { return gameNameForAppId(String(appid)) || null; } catch { return null; } };

  // Directories walked by a specific pass are skipped by the broader passes.
  const specific = new Set();

  // 1. Steam screenshots: <steam>/userdata/<uid>/760/remote/<appid>/screenshots/*.jpg
  if (steamRoot) {
    const ud = path.join(steamRoot, 'userdata');
    let users = [];
    try { users = (await fsp.readdir(ud, { withFileTypes: true })).filter((d) => d.isDirectory() && /^\d+$/.test(d.name)); } catch { /* none */ }
    for (const u of users) {
      const remote = path.join(ud, u.name, '760', 'remote');
      let apps = [];
      try { apps = (await fsp.readdir(remote, { withFileTypes: true })).filter((d) => d.isDirectory()); } catch { continue; }
      addRoot(remote);
      await mapLimit(apps, 8, async (a) => {
        const dir = path.join(remote, a.name, 'screenshots');
        let files = [];
        try { files = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
        const game = gameName(a.name);
        for (const f of files) {
          if (f.isFile() && EXT.pictures.has(path.extname(f.name).toLowerCase())) {
            add('pictures', path.join(dir, f.name), { source: 'steam', game, steamAppId: a.name });
          }
        }
      });
    }
  }

  // 2. Game Bar captures (pictures + videos).
  if (await isDir(kf.captures)) {
    addRoot(kf.captures);
    specific.add(normKey(kf.captures));
    await walk(kf.captures, {
      maxDepth: 2,
      onFile: (full, name) => {
        const t = typeOf(name);
        if (t === 'pictures' || t === 'videos') add(t, full, { source: 'gamebar', game: gameFromCaptureName(name) });
      },
    });
  }

  // 3. Pictures\Screenshots (Win+PrtScn).
  if (await isDir(kf.screenshots)) {
    addRoot(kf.screenshots);
    specific.add(normKey(kf.screenshots));
    await walk(kf.screenshots, {
      maxDepth: 2,
      onFile: (full, name) => { if (typeOf(name) === 'pictures') add('pictures', full, { source: 'screenshots', game: null }); },
    });
  }

  // 4. Videos (NVIDIA ShadowPlay / NVIDIA App folders are Videos\<Game> or Videos\NVIDIA\<Game>).
  const full = () => found.videos.length >= LIMIT * 2 && found.pictures.length >= LIMIT * 2;
  if (await isDir(kf.videos)) {
    addRoot(kf.videos);
    await walk(kf.videos, {
      skip: specific,
      shouldStop: full,
      onFile: (file, name) => {
        const t = typeOf(name);
        if (t !== 'videos' && t !== 'pictures') return;
        const parts = path.relative(kf.videos, file).split(/[\\/]/);
        let game = null;
        let nvidia = false;
        if (parts.length >= 3 && parts[0].toLowerCase() === 'nvidia') { nvidia = true; game = parts[1]; }
        else if (parts.length >= 2 && (NV_NAME.test(name) || /\.dvr\.mp4$/i.test(name))) { nvidia = true; game = parts[0]; }
        if (nvidia) add(t, file, { source: 'nvidia', game });
        else if (t === 'videos') add(t, file, { source: 'videos', game: null });
      },
    });
    specific.add(normKey(kf.videos));
  }

  // 5. Pictures (general).
  if (await isDir(kf.pictures)) {
    addRoot(kf.pictures);
    await walk(kf.pictures, {
      skip: specific,
      shouldStop: () => found.pictures.length >= LIMIT * 2,
      onFile: (file, name) => { if (typeOf(name) === 'pictures') add('pictures', file, { source: 'pictures', game: null }); },
    });
  }

  // 6. Music (default + extras), remembering which root each track came from for name inference.
  const musicRoots = [kf.music, ...extras.music].filter(Boolean);
  for (const r of musicRoots) {
    if (!(await isDir(r))) continue;
    addRoot(r);
    await walk(r, {
      shouldStop: () => found.music.length >= LIMIT,
      onFile: (file, name) => { if (found.music.length < LIMIT && typeOf(name) === 'music') add('music', file, { root: r }); },
    });
  }

  // 7. Extra picture / video folders.
  for (const type of ['pictures', 'videos']) {
    for (const r of extras[type]) {
      if (!(await isDir(r))) continue;
      addRoot(r);
      await walk(r, {
        shouldStop: () => found[type].length >= LIMIT * 2,
        onFile: (file, name) => { if (typeOf(name) === type) add(type, file, { source: 'custom', game: null }); },
      });
    }
  }

  // Stat pictures/videos, sort newest first, trim.
  const statAll = async (list) => {
    const stats = await mapLimit(list, 32, (it) => fsp.stat(it.path));
    return list.map((it, i) => (stats[i] ? { ...it, mtime: stats[i].mtimeMs, size: stats[i].size } : null)).filter(Boolean);
  };
  const pictures = (await statAll(found.pictures)).sort((a, b) => b.mtime - a.mtime).slice(0, LIMIT)
    .map(({ path: p, mtime, source, game, steamAppId, size }) => ({ path: p, mtime, source, game, size, ...(steamAppId ? { steamAppId } : {}) }));
  const videos = (await statAll(found.videos)).sort((a, b) => b.mtime - a.mtime).slice(0, LIMIT)
    .map(({ path: p, mtime, size, source, game }) => ({ path: p, mtime, size, source, game }));

  // Music: tags (cached by mtime+size), falling back to folder/filename conventions.
  const musicStats = await statAll(found.music);
  const music = await mapLimit(musicStats, 16, async (it) => {
    const ext = path.extname(it.path).toLowerCase();
    let cached = tagCache.get(it.path);
    if (!cached || cached.mtimeMs !== it.mtime || cached.size !== it.size) {
      cached = { mtimeMs: it.mtime, size: it.size, tags: await readTags(it.path, ext, it.size) };
      tagCache.set(it.path, cached);
    }
    const t = cached.tags || {};
    const g = inferFromPath(it.path, it.root);
    const track = parseInt(String(t.track || g.track || ''), 10);
    return {
      path: it.path,
      title: t.title || g.title,
      artist: t.artist || t.albumArtist || g.artist || 'Unknown Artist',
      album: t.album || g.album || 'Unknown Album',
      ext: ext.slice(1),
      albumArtist: t.albumArtist || null,
      track: Number.isFinite(track) && track > 0 ? track : null,
      tagged: !!(t.title || t.artist || t.album),
      size: it.size,
      mtime: it.mtime,
    };
  });
  const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  const unk = (s, u) => (s === u ? '￿' : s);
  const tracks = music.filter(Boolean).sort((a, b) =>
    coll.compare(unk(a.artist, 'Unknown Artist'), unk(b.artist, 'Unknown Artist'))
    || coll.compare(unk(a.album, 'Unknown Album'), unk(b.album, 'Unknown Album'))
    || coll.compare(path.basename(a.path), path.basename(b.path))
    || coll.compare(a.path, b.path));

  lastRoots = roots.map(normKey);
  lastRealRoots = [];
  for (const r of roots) { try { lastRealRoots.push(normKey(fs.realpathSync.native(r))); } catch { /* gone */ } }

  return { music: tracks, pictures, videos, roots };
}

function within(p, list) {
  for (const r of list) {
    if (p === r) return true;
    const pre = r.endsWith(path.sep) ? r : r + path.sep;
    if (p.startsWith(pre)) return true;
  }
  return false;
}

// Security gate for the file-serving protocol: media files inside a scanned root only.
function isAllowedPath(p) {
  if (typeof p !== 'string' || !p || p.includes('\0') || !lastRoots.length) return false;
  if (IS_WIN && /^\\\\[?.]\\/.test(p)) return false; // device / long-path namespaces
  let key;
  try { key = normKey(p); } catch { return false; }
  if (!path.isAbsolute(p)) return false;
  if (!ALL_EXT.has(path.extname(key).toLowerCase())) return false;
  if (!within(key, lastRoots)) return false;
  // Resolve links/junctions: the real target must also live inside a (real or lexical) root.
  try {
    const real = normKey(fs.realpathSync.native(p));
    if (!within(real, lastRealRoots) && !within(real, lastRoots)) return false;
  } catch { /* missing file: lexical check already passed; the server will 404 */ }
  return true;
}

function getRoots() { return lastRoots.slice(); }

module.exports = { scanAll, isAllowedPath, getRoots, readTags, gameFromCaptureName };
