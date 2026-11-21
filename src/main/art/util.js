// Shared helpers for the artwork pipeline: HTTP, image sniffing/validation, title matching.
const UA = 'Project360/0.2';

function sniffMime(buf) {
  if (!buf || buf.length < 12) return 'application/octet-stream';
  if (buf[0] === 0x89 && buf[1] === 0x50) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return 'application/octet-stream';
}

// Width / height / alpha from the image header (PNG, JPEG, WebP, GIF). Missing fields = unknown.
function imageInfo(b) {
  try {
    const mime = sniffMime(b);
    if (mime === 'image/png') {
      const ct = b[25];
      let alpha = ct === 4 || ct === 6;
      if (!alpha) {
        let o = 8;
        while (o < b.length - 8) {
          const len = b.readUInt32BE(o);
          const t = b.toString('ascii', o + 4, o + 8);
          if (t === 'tRNS') { alpha = true; break; }
          if (t === 'IDAT') break;
          o += 12 + len;
        }
      }
      return { mime, w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha };
    }
    if (mime === 'image/jpeg') {
      let o = 2;
      while (o < b.length - 9) {
        if (b[o] !== 0xff) { o++; continue; }
        const m = b[o + 1];
        if (m === 0xff) { o++; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
          return { mime, h: b.readUInt16BE(o + 5), w: b.readUInt16BE(o + 7), alpha: false };
        }
        o += 2 + b.readUInt16BE(o + 2);
      }
      return { mime, alpha: false };
    }
    if (mime === 'image/webp') {
      const f = b.toString('ascii', 12, 16);
      if (f === 'VP8X') return { mime, w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), alpha: !!(b[20] & 16) };
      if (f === 'VP8 ') return { mime, w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, alpha: false };
      if (f === 'VP8L') { const n = b.readUInt32LE(21); return { mime, w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1, alpha: !!((n >> 28) & 1) }; }
      return { mime };
    }
    if (mime === 'image/gif') return { mime, w: b.readUInt16LE(6), h: b.readUInt16LE(8), alpha: true };
    return { mime };
  } catch { return { mime: sniffMime(b) }; }
}

// Real box art / heroes / banners are tens of KB; tiny files are blank placeholders.
function tooSmall(kind, bytes) { return kind === 'logo' ? bytes < 800 : bytes < 12000; }

// Returns null when the image is usable for `kind`, otherwise a short reason.
// loose: skip the shape checks (used for user-picked art and legacy cached files).
function checkImage(kind, buf, opts = {}) {
  if (!buf) return 'empty';
  const info = imageInfo(buf);
  if (info.mime === 'application/octet-stream') return 'not an image';
  const { w, h } = info;
  // Loose items with known dimensions (ROM screenshots, user picks) rely on the bytes-per-pixel check instead.
  if (tooSmall(kind, buf.length) && !(opts.loose && w && h && buf.length >= 800)) return 'too small';
  if (w && h) {
    // Solid-colour stand-ins (Steam's grey 600x900 capsule / 640x360 logo) compress to <0.01 bytes per pixel.
    if (buf.length / (w * h) < 0.01) return 'placeholder';
    if (opts.minAspect && w / h < opts.minAspect) return 'aspect';
    if (opts.minWidth && w < opts.minWidth) return 'low resolution';
    if (!opts.loose) {
      if (kind === 'cover' && h / w < 1.15) return 'not portrait';
      if (kind === 'hero' && w / h < 1.5) return 'not wide';
      if (kind === 'banner' && w / h < 1.3) return 'not wide';
      if (kind === 'logo' && !info.alpha) return 'logo not transparent';
      if (kind === 'logo' && w < 120) return 'logo too small';
    }
  }
  return null;
}

async function fetchBuf(url, headers = {}, timeout = 20000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

async function fetchImage(url, headers = {}) {
  const buf = await fetchBuf(url, headers);
  if (!buf || buf.length < 512 || sniffMime(buf) === 'application/octet-stream') return null;
  return buf;
}

async function fetchJson(url, opts = {}) {
  try {
    const res = await fetch(url, {
      ...opts,
      headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) },
      signal: AbortSignal.timeout(opts.timeout || 20000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// ---- Title matching ------------------------------------------------------
// Only strip qualifiers that are followed by "edition" (so "Pokemon Gold" stays intact), plus GOTY / director's cut.
const EDITION = [
  /\s(game of the year|goty|definitive|deluxe|digital deluxe|standard|complete|ultimate|gold|premium|enhanced|anniversary|legendary|collectors|launch|special|steam|windows|pc)\s+edition$/,
  /\s(goty|game of the year|directors cut|for windows( 10)?)$/,
];

function normTitle(t) {
  let s = String(t || '')
    .replace(/[™®©℠]/g, '') // TM (R) (C) SM, before NFKD turns the TM sign into letters
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/,\s*the\b/g, ' ') // No-Intro style "Legend of Zelda, The - ..."
    .replace(/\s*[([][^)\]]*[)\]]\s*$/g, ' ') // trailing "(2019)", "[PC]"
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  for (let i = 0; i < 3; i++) {
    const next = EDITION.reduce((acc, re) => acc.replace(re, ''), s).trim();
    if (next === s) break;
    s = next;
  }
  return s.replace(/^the\s+/, '').replace(/\s+/g, ' ').trim();
}

// Strict: equal after normalisation (or equal with all spaces removed, e.g. "Rocket League" vs "RocketLeague").
function sameTitle(a, b) {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return false;
  return x === y || x.replace(/ /g, '') === y.replace(/ /g, '');
}

function bigrams(s) {
  const out = new Map();
  const t = s.replace(/ /g, '');
  for (let i = 0; i < t.length - 1; i++) { const k = t.slice(i, i + 2); out.set(k, (out.get(k) || 0) + 1); }
  return out;
}

// Sørensen–Dice similarity on character bigrams (0..1).
function similarity(a, b) {
  const x = bigrams(normTitle(a));
  const y = bigrams(normTitle(b));
  let total = 0; let hit = 0;
  for (const v of x.values()) total += v;
  for (const v of y.values()) total += v;
  for (const [k, v] of x) hit += Math.min(v, y.get(k) || 0);
  return total ? (2 * hit) / total : 0;
}

function tokens(s) { return new Set(normTitle(s).split(' ').filter(Boolean)); }

// Every word of `a` appears in `b`, and `b` adds at most `maxExtra` words, none of them a sequel number.
// Returns the number of extra words, or -1 when it does not qualify.
function containedIn(a, b, maxExtra = 2) {
  const x = tokens(a); const y = tokens(b);
  if (!x.size) return -1;
  for (const t of x) if (!y.has(t)) return -1;
  const extra = [...y].filter((t) => !x.has(t));
  if (extra.length > maxExtra || extra.some((t) => /^(\d+|[ivx]+)$/.test(t))) return -1;
  return extra.length;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

function shortText(s, max = 600) {
  const t = stripHtml(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('.\n'));
  return (end > max * 0.4 ? cut.slice(0, end + 1) : cut.trimEnd() + '…').trim();
}

function fmtDate(d) {
  const iso = typeof d === 'string' && d.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const x = iso ? new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])) : d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime()) || x.getFullYear() < 1971) return '';
  return x.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

module.exports = {
  UA, sniffMime, imageInfo, tooSmall, checkImage, fetchBuf, fetchImage, fetchJson,
  normTitle, sameTitle, similarity, containedIn, stripHtml, shortText, fmtDate,
};
