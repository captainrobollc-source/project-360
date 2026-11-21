// Retro game metadata: libretro-database (developer, publisher, year, genre — matched by
// No-Intro name or CRC) + a short Wikipedia summary and infobox cover as a fallback image.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const U = require('./util');

const RDB = 'https://raw.githubusercontent.com/libretro/libretro-database/master/rdb';
const WIKI_UA = 'Project360/0.2 (console game launcher)';
const mem = new Map();

const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s*[([].*?[)\]]/g, '').replace(/^the\s+|,\s*the$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const regionRank = (n) => (/\(USA/.test(n) ? 0 : /\(World/.test(n) ? 1 : /\(Europe/.test(n) ? 2 : /\(Japan/.test(n) ? 3 : 4);

// Minimal MessagePack reader for libretro .rdb files ("RARCHDB\0" + offset, then one map per game).
function readRdb(buf) {
  let i = 16;
  const u8 = () => buf[i++];
  const str = (n) => { const s = buf.toString('utf8', i, i + n); i += n; return s; };
  const bin = (n) => { const b = buf.subarray(i, i + n); i += n; return b; };
  function val() {
    const t = u8();
    if (t <= 0x7f) return t;
    if (t >= 0x80 && t <= 0x8f) return map(t & 0x0f);
    if (t >= 0x90 && t <= 0x9f) return arr(t & 0x0f);
    if (t >= 0xa0 && t <= 0xbf) return str(t & 0x1f);
    if (t >= 0xe0) return t - 256;
    switch (t) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return bin(u8());
      case 0xc5: { const n = buf.readUInt16BE(i); i += 2; return bin(n); }
      case 0xc6: { const n = buf.readUInt32BE(i); i += 4; return bin(n); }
      case 0xcc: return u8();
      case 0xcd: { const v = buf.readUInt16BE(i); i += 2; return v; }
      case 0xce: { const v = buf.readUInt32BE(i); i += 4; return v; }
      case 0xcf: { const v = Number(buf.readBigUInt64BE(i)); i += 8; return v; }
      case 0xd0: { const v = buf.readInt8(i); i += 1; return v; }
      case 0xd1: { const v = buf.readInt16BE(i); i += 2; return v; }
      case 0xd2: { const v = buf.readInt32BE(i); i += 4; return v; }
      case 0xd3: { const v = Number(buf.readBigInt64BE(i)); i += 8; return v; }
      case 0xd9: return str(u8());
      case 0xda: { const n = buf.readUInt16BE(i); i += 2; return str(n); }
      case 0xdb: { const n = buf.readUInt32BE(i); i += 4; return str(n); }
      case 0xdc: { const n = buf.readUInt16BE(i); i += 2; return arr(n); }
      case 0xdd: { const n = buf.readUInt32BE(i); i += 4; return arr(n); }
      case 0xde: { const n = buf.readUInt16BE(i); i += 2; return map(n); }
      case 0xdf: { const n = buf.readUInt32BE(i); i += 4; return map(n); }
      default: throw new Error(`rdb: unsupported type 0x${t.toString(16)}`);
    }
  }
  function map(n) { const o = {}; for (let k = 0; k < n; k++) { const kk = val(); o[kk] = val(); } return o; }
  function arr(n) { const a = []; for (let k = 0; k < n; k++) a.push(val()); return a; }
  const out = [];
  while (i < buf.length) {
    const t = buf[i];
    if (t === 0xc0) break; // end of entries
    const e = val();
    if (!e || typeof e !== 'object' || !e.name) continue;
    out.push({
      name: e.name,
      developer: e.developer || '',
      publisher: e.publisher || '',
      genre: e.genre || '',
      year: e.releaseyear || '',
      desc: typeof e.description === 'string' && e.description !== e.name && e.description.length > 40 ? e.description : '',
      crc: Buffer.isBuffer(e.crc) ? e.crc.toString('hex').toUpperCase() : '',
      rom: e.rom_name || '',
    });
  }
  return out;
}

async function systemDb(system, cacheDir) {
  if (mem.has(system)) return mem.get(system);
  const file = path.join(cacheDir, `retrodb7-${system.replace(/[^\w.-]/g, '_')}.json`);
  let recs = null;
  try {
    const st = fs.statSync(file);
    if (Date.now() - st.mtimeMs < 30 * 86400000) recs = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch { /* not cached */ }
  if (!recs) {
    const buf = await U.fetchBuf(`${RDB}/${encodeURIComponent(system)}.rdb`, {}, 60000);
    recs = buf && buf.slice(0, 7).toString() === 'RARCHDB' ? readRdb(buf) : [];
    if (recs.length) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(recs)); }
  }
  // Regional/revision variants of one game share a key; merge their fields (some entries are
  // sparse, e.g. the US release has no developer while the EU one does).
  const groups = new Map();
  for (const r of recs) {
    const k = key(r.name);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const merged = new Map();
  const side = /\([^)]*\b(demo|beta|proto|prototype|sample|sampler|trial|bonus|kiosk|preview|previews|promo|taikenban|not for resale)\b[^)]*\)/i;
  for (const [k, all] of groups) {
    const main = all.filter((r) => !side.test(r.name));
    const list = main.length ? main : all;
    list.sort((a, b) => regionRank(a.name) - regionRank(b.name) || /demo|beta|proto/i.test(a.name) - /demo|beta|proto/i.test(b.name));
    const m = { name: list[0].name };
    for (const f of ['developer', 'publisher', 'genre', 'year', 'desc']) m[f] = (list.find((r) => r[f]) || {})[f] || '';
    merged.set(k, m);
  }
  const db = { byName: new Map(), byCrc: new Map(), byKey: merged };
  for (const r of recs) {
    const m = merged.get(key(r.name));
    db.byName.set(r.name.toLowerCase(), m);
    if (r.rom) db.byName.set(r.rom.replace(/\.[^.]+$/, '').toLowerCase(), m);
    if (r.crc) db.byCrc.set(r.crc, m);
  }
  // A failed download (offline at boot) mustn't stick for the whole session: cache only real data.
  if (recs.length) mem.set(system, db);
  return db;
}

// CRC32 of a cartridge ROM (raw file ≤ 64 MB, or the first file inside a .zip).
function romCrc(file) {
  try {
    const st = fs.statSync(file);
    if (/\.zip$/i.test(file)) {
      const fd = fs.openSync(file, 'r');
      const head = Buffer.alloc(30);
      fs.readSync(fd, head, 0, 30, 0);
      fs.closeSync(fd);
      if (head.readUInt32LE(0) !== 0x04034b50) return null;
      return head.readUInt32LE(14).toString(16).toUpperCase().padStart(8, '0');
    }
    if (st.size > 64 * 1024 * 1024 || typeof zlib.crc32 !== 'function') return null;
    return (zlib.crc32(fs.readFileSync(file)) >>> 0).toString(16).toUpperCase().padStart(8, '0');
  } catch { return null; }
}

const words = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\(.*?\)/g, ' ').toLowerCase().replace(/\b(the|a|an|of|and|version|edition)\b/g, ' ').split(/[^a-z0-9]+/).filter(Boolean);
const notGame = /franchise|series|character|media|list of|soundtrack|film|television|anime|manga/i;

async function wikiSummary(pageTitle, expect, { loose = false } = {}) {
  const sum = await U.fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`, { headers: { 'Api-User-Agent': WIKI_UA } });
  if (!sum || sum.type === 'disambiguation' || !sum.extract) return null;
  if (notGame.test(sum.description || '') || /\bupcoming\b/i.test(sum.extract) || !/game/i.test(`${sum.description || ''} ${sum.extract}`)) return null;
  // Wikipedia follows redirects; make sure we landed on the game we asked for.
  const title = String(sum.title || '').replace(/\(.*?\)/g, '');
  if (key(title) !== key(expect)) {
    if (!loose) return null;
    const want = words(expect), got = words(title);
    const extra = got.filter((w) => !want.includes(w));
    if (!want.every((w) => got.includes(w)) || extra.length > 1) return null;
  }
  return { description: sum.extract, image: (sum.originalimage && sum.originalimage.source) || (sum.thumbnail && sum.thumbnail.source) || null };
}

async function wikipedia(title, systemName, year) {
  const clean = String(title).replace(/\s+-\s+/g, ': ');
  // Most games live at "Title", "Title (video game)" or "Title (YEAR video game)".
  for (const page of [clean, `${clean} (video game)`, year ? `${clean} (${year} video game)` : null].filter(Boolean)) {
    const r = await wikiSummary(page, clean);
    if (r) return r;
  }
  const q = encodeURIComponent(`${clean} ${systemName} video game`);
  const s = await U.fetchJson(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=6&format=json`, { headers: { 'Api-User-Agent': WIKI_UA } });
  for (const h of (s && s.query && s.query.search) || []) {
    if (notGame.test(h.title)) continue;
    const r = await wikiSummary(h.title, clean, { loose: true });
    if (r) return r;
  }
  return null;
}

async function retroCandidate(g, cacheDir) {
  if (!g.libretroSystem) return null;
  let rec = null;
  try {
    const db = await systemDb(g.libretroSystem, cacheDir);
    rec = (g.romName && db.byName.get(g.romName.toLowerCase())) || null;
    if (!rec && g.romPath) { const c = romCrc(g.romPath); if (c) rec = db.byCrc.get(c) || null; }
    if (!rec) rec = db.byKey.get(key(g.romName || g.title)) || null;
  } catch { /* offline */ }
  const sysName = g.libretroSystem.split(' - ').slice(1).join(' ') || g.platform || '';
  let wiki = null;
  try { wiki = await wikipedia(g.title, sysName, rec && rec.year); } catch { /* offline */ }
  if (!rec && !wiki) return null;
  return {
    source: 'retrodb',
    title: g.title,
    cover: wiki && wiki.image ? [{ url: wiki.image, loose: true }] : [],
    hero: [], banner: [], logo: [],
    meta: {
      description: (wiki && wiki.description) || (rec && rec.desc) || '',
      genres: rec && rec.genre ? rec.genre.split(/\s*[/,]\s*/).filter(Boolean) : [],
      developer: (rec && rec.developer) || '',
      publisher: (rec && rec.publisher) || '',
      released: rec && rec.year ? String(rec.year) : '',
    },
  };
}

module.exports = { retroCandidate, systemDb, romCrc };
