// Artwork + metadata cache. Everything ends up on disk so the console works offline.
// Keyless sources first, key-based ones last:
//   manual pick -> local files (Steam librarycache, Xbox package art)
//   -> platform source (Steam store assets | Epic launcher catalog + store page | GOG api | Microsoft Store by PFN | libretro thumbnails)
//   -> Steam store title match -> Microsoft Store title match -> SteamGridDB (key) -> IGDB (key)
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
let electronNet = null;
try { ({ net: electronNet } = require('electron')); } catch { /* unit tests / plain node */ }
const online = () => { try { return !electronNet || electronNet.isOnline(); } catch { return true; } };
const U = require('./art/util');
const S = require('./art/sources');
const R = require('./art/retro');

const KINDS = ['cover', 'hero', 'banner', 'logo'];
const RETRY_MS = 3 * 24 * 3600 * 1000;
// Bump when sources change so games that came up empty under an older pipeline get one more try.
const ART_VERSION = 3; // 3: retro metadata (libretro-database + Wikipedia)

const { sniffMime, tooSmall, checkImage } = U;

function safeId(id) { return String(id).replace(/[^\w.-]/g, '_'); }

function metaComplete(m) { return !!(m && m.description && m.developer && m.genres && m.genres.length); }

function fillMeta(meta, m) {
  if (!m) return meta;
  const base = meta || { description: '', genres: [], developer: '', publisher: '', released: '' };
  const out = { ...base };
  for (const k of ['description', 'developer', 'publisher', 'released']) if (!out[k] && m[k]) out[k] = String(m[k]);
  if ((!out.genres || !out.genres.length) && m.genres && m.genres.length) out.genres = [...new Set(m.genres.map(String))].slice(0, 6);
  if (!out.genres) out.genres = [];
  // Don't turn a null meta into an all-empty object.
  const hasAny = Object.values(out).some((v) => (Array.isArray(v) ? v.length : v));
  return meta || hasAny ? out : meta;
}

function readFileSafe(f) { try { return f && fs.existsSync(f) ? fs.readFileSync(f) : null; } catch { return null; } }

const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

class ArtManager extends EventEmitter {
  constructor(dir, library, settings, steamRootFn) {
    super();
    this.dir = dir;
    this.library = library;
    this.settings = settings;
    this.steamRootFn = steamRootFn;
    this.queue = [];
    this.active = 0;
    this.changedTimer = null;
    this.manualAt = new Map();
    fs.mkdirSync(dir, { recursive: true });
  }

  file(id, kind) { return path.join(this.dir, safeId(id), kind); }

  read(id, kind) {
    const f = this.file(id, kind);
    const buf = fs.readFileSync(f);
    return { buf, mime: sniffMime(buf) };
  }

  // Version stamp lives on the record and in a sidecar file, because library rescans rebuild records.
  artVersionOf(g) {
    let v = Number(g.artVersion) || 0;
    try { v = Math.max(v, Number(fs.readFileSync(path.join(this.dir, safeId(g.id), '.artversion'), 'utf8')) || 0); } catch { /* none */ }
    return v;
  }

  stampVersion(g) {
    g.artVersion = ART_VERSION;
    try {
      fs.mkdirSync(path.join(this.dir, safeId(g.id)), { recursive: true });
      fs.writeFileSync(path.join(this.dir, safeId(g.id), '.artversion'), String(ART_VERSION));
    } catch { /* ignore */ }
  }

  fetchMissing() {
    const now = Date.now();
    let dirty = false;
    for (const g of Object.values(this.library.games())) {
      if (g.source === 'arcade') continue; // built-in games draw their own art
      const old = this.artVersionOf(g) < ART_VERSION;
      // Drop cached placeholders (e.g. Steam's grey stand-ins) so they get re-fetched.
      for (const k of KINDS) {
        if (!g.art || !g.art[k]) continue;
        try {
          const f = this.file(g.id, k);
          // Current-version art already passed checkImage when it was saved (small ROM snaps and
          // user picks pass loosely), so only catch truncated files here, or it re-fetches forever.
          const bad = old ? !!checkImage(k, fs.readFileSync(f), { loose: true }) : fs.statSync(f).size < 800;
          if (bad) { delete g.art[k]; g.artTried = 0; dirty = true; }
        } catch { delete g.art[k]; g.artTried = 0; dirty = true; }
      }
      const missing = KINDS.filter((k) => !(g.art && g.art[k]));
      if ((missing.length || (old && !g.meta)) && (old || !g.artTried || now - g.artTried > RETRY_MS)) this.enqueue(g.id);
      else if (old) { this.stampVersion(g); dirty = true; }
    }
    if (dirty) this.library.lib.save();
  }

  refresh(id) { this.enqueue(id, true); }

  clearCache() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    for (const g of Object.values(this.library.games())) { g.art = {}; g.artTried = 0; g.artVersion = 0; delete g.artManual; }
    this.library.lib.save();
    this.library.emit('changed');
  }

  enqueue(id, force = false) {
    if (this.queue.some((q) => q.id === id)) return;
    this.queue.push({ id, force });
    this.pump();
  }

  pump() {
    while (this.active < 3 && this.queue.length) {
      const job = this.queue.shift();
      this.active++;
      this.process(job).catch((e) => console.warn('[art]', job.id, e.message)).finally(() => {
        this.active--;
        this.pump();
        if (!this.queue.length && !this.active) this.emit('idle');
      });
    }
  }

  async download(url, headers = {}) {
    if (!isHttp(url)) return null;
    const buf = await U.fetchImage(url, headers);
    return buf && buf.length >= 1024 ? buf : null;
  }

  async json(url, opts = {}) { return U.fetchJson(url, opts); }

  notifyChanged() {
    clearTimeout(this.changedTimer);
    this.changedTimer = setTimeout(() => this.library.emit('changed'), 600);
  }

  cacheDir() { return path.join(this.dir, '_cache'); }

  manualFile(id) { return path.join(this.dir, safeId(id), 'manual.json'); }

  // ---- sources ------------------------------------------------------------
  async localCandidate(g) {
    const c = { source: 'local', id: g.id, cover: [], hero: [], banner: [], logo: [], meta: null };
    if (g.localArt) {
      // Xbox package art: use it if it has the right shape, otherwise only as a last resort.
      for (const k of ['cover', 'hero']) {
        const f = g.localArt[k];
        if (f) c[k].push({ file: f }, { file: f, low: true, loose: true });
      }
    }
    if (g.steamAppId) {
      const root = await this.steamRootFn();
      if (root) {
        const lc = path.join(root, 'appcache', 'librarycache');
        const map = { cover: ['library_600x900', 'library_capsule'], hero: ['library_hero'], banner: ['header', 'library_header'], logo: ['logo'] };
        const files = [];
        for (const [kind, bases] of Object.entries(map)) {
          for (const base of bases) for (const ext of ['jpg', 'png']) files.push([kind, path.join(lc, `${g.steamAppId}_${base}.${ext}`)]);
        }
        // Newer Steam clients: librarycache/<appid>/[hash/]<file>
        const sub = path.join(lc, String(g.steamAppId));
        if (fs.existsSync(sub)) {
          const found = [];
          const walk = (d, depth) => {
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
              const f = path.join(d, e.name);
              if (e.isDirectory() && depth < 2) walk(f, depth + 1); else if (e.isFile()) found.push(f);
            }
          };
          try { walk(sub, 0); } catch { /* ignore */ }
          for (const [kind, bases] of Object.entries(map)) {
            for (const base of bases) {
              for (const suffix of ['_2x.', '.']) {
                const hit = found.find((f) => path.basename(f).toLowerCase().startsWith(base + suffix));
                if (hit) files.push([kind, hit]);
              }
            }
          }
        }
        // The client caches 1x capsules (300x450) and headers (460x215): use them right away only if
        // they're big enough, otherwise keep them as offline fallback behind the 2x store assets.
        const minWidth = { cover: 500, banner: 900 };
        for (const [kind, file] of files) {
          if (!fs.existsSync(file)) continue;
          c[kind].push(minWidth[kind] ? { file, minWidth: minWidth[kind] } : { file });
          if (minWidth[kind]) c[kind].push({ file, low: true });
        }
      }
    }
    return c;
  }

  manualCandidate(g) {
    try {
      const m = JSON.parse(fs.readFileSync(this.manualFile(g.id), 'utf8'));
      const c = { source: `manual:${m.source || ''}`, id: m.id, cover: [], hero: [], banner: [], logo: [], meta: null };
      for (const k of KINDS) if (isHttp(m[`${k}Url`])) c[k].push({ url: m[`${k}Url`], loose: true });
      return c;
    } catch { return null; }
  }

  sourcesFor(g) {
    const id = String(g.id);
    const src = id.split(':')[0];
    const key = this.settings.get('art.steamGridDbKey');
    const igdbId = this.settings.get('art.igdbClientId');
    const igdbSecret = this.settings.get('art.igdbClientSecret');
    const list = [];
    list.push(() => this.manualCandidate(g));
    list.push(() => this.localCandidate(g));
    if (g.steamAppId) list.push(() => S.steamApp(g.steamAppId));
    if (src === 'epic') {
      list.push(() => S.epicCatalog(g));
      list.push(() => S.epicStore(g, g.epicNamespace || (S.epicFind(g) || {}).namespace));
    }
    if (src === 'gog') list.push(() => S.gogProduct(g.gogId || id.slice(4)));
    if (src === 'xbox') list.push(() => S.msByPfn(id.slice(5)));
    if (src === 'rom' || g.libretroSystem) {
      list.push(() => S.libretro(g, this.cacheDir()));
      list.push(() => R.retroCandidate(g, this.cacheDir()));
    }
    // Title matching against big stores. Skipped for ROMs: "Doom" on Steam is not the SNES cart.
    if (src !== 'rom') {
      if (!g.steamAppId) list.push(() => S.steamSearch(g.title));
      list.push(() => S.msSearch(g.title));
    }
    // SteamGridDB / IGDB title searches: same rule (a Steam id lookup is still fine for ROMs).
    if (key && (src !== 'rom' || g.steamAppId)) list.push(() => S.steamGridDb(key, g));
    if (igdbId && igdbSecret && src !== 'rom') list.push(() => S.igdbSearch(igdbId, igdbSecret, g.title));
    return list;
  }

  // Tries a candidate's items for one kind until one passes validation.
  async tryItems(kind, items, art, put, dl, deferred) {
    for (const raw of items || []) {
      if (art[kind]) return;
      if (!raw) continue;
      const it = typeof raw === 'string' ? { url: raw } : raw;
      if (it.low && deferred) { deferred.push({ kind, item: { ...it, low: false } }); continue; }
      if (it.lazy) {
        let r = null;
        try { r = await it.lazy(); } catch { r = null; }
        for (const u of [].concat(r || []).filter(Boolean)) {
          if (art[kind]) return;
          put(kind, await dl(u), it);
        }
        continue;
      }
      put(kind, it.file ? readFileSafe(it.file) : await dl(it.url), it);
    }
  }

  async process({ id, force }) {
    const g = this.library.game(id);
    if (!g || g.source === 'arcade') return;
    // Offline (e.g. Wi-Fi not up yet at boot): don't record "tried, nothing found" for 3 days,
    // and never let a forced refresh replace good art with nothing. The next scan retries.
    if (!online()) return;
    const t0 = Date.now();
    const art = force ? {} : { ...(g.art || {}) };
    let meta = force ? null : g.meta;
    const dir = path.join(this.dir, safeId(id));
    fs.mkdirSync(dir, { recursive: true });
    const need = () => KINDS.filter((k) => !art[k]);
    const used = {};
    let current = null;
    const put = (kind, buf, opts = {}) => {
      if (!buf || art[kind] || checkImage(kind, buf, opts)) return false;
      fs.writeFileSync(path.join(dir, kind), buf);
      art[kind] = Date.now();
      if (current) used[kind] = current;
      return true;
    };
    const memo = new Map();
    const dl = (u) => {
      if (!memo.has(u)) memo.set(u, this.download(u));
      return memo.get(u);
    };
    const deferred = [];

    for (const source of this.sourcesFor(g)) {
      if (!need().length && metaComplete(meta)) break;
      let c = null;
      try { c = await source(); } catch (e) { console.warn('[art]', id, e.message); }
      if (!c) continue;
      current = c.source;
      const firstDeferred = deferred.length;
      for (const k of KINDS) await this.tryItems(k, c[k], art, put, dl, deferred);
      for (let i = firstDeferred; i < deferred.length; i++) deferred[i].source = c.source;
      meta = fillMeta(meta, c.meta);
      if (c.moreMeta && !metaComplete(meta)) {
        try { meta = fillMeta(meta, await c.moreMeta()); } catch { /* ignore */ }
      }
    }
    // Low-quality fallbacks (GOG 342px box art, square store tiles, ROM screenshots) only fill gaps.
    for (const d of deferred) {
      if (art[d.kind]) continue;
      current = d.source || 'fallback';
      await this.tryItems(d.kind, [d.item], art, put, dl, null);
    }
    current = null;

    // Banner fallback: reuse the hero so wide tiles never look empty.
    if (!art.banner && art.hero) {
      try { fs.copyFileSync(path.join(dir, 'hero'), path.join(dir, 'banner')); art.banner = Date.now(); used.banner = used.hero; } catch { /* ignore */ }
    }

    const live = this.library.game(id) || g;
    if (force) {
      // A refresh that found nothing better keeps what it had (files are only overwritten by new finds).
      for (const k of KINDS) if (!art[k] && g.art && g.art[k] && fs.existsSync(path.join(dir, k))) art[k] = g.art[k];
      if (!meta && g.meta) meta = g.meta;
    }
    if ((this.manualAt.get(id) || 0) > t0) {
      // A manual pick landed while we were working; keep its kinds.
      for (const k of KINDS) if (live.art && live.art[k] && live.art[k] > t0) art[k] = live.art[k];
    }
    live.art = art;
    live.meta = meta;
    live.artTried = Date.now();
    live.artSources = used;
    this.stampVersion(live);
    this.library.lib.save();
    this.notifyChanged();
  }

  // ---- manual picker --------------------------------------------------------
  // -> [{ source, id, title, coverUrl, heroUrl, logoUrl, bannerUrl }]
  async searchArt(query) {
    const q = String(query || '').replace(/[™®©]/g, '').trim();
    if (!q) return [];
    const key = this.settings.get('art.steamGridDbKey');
    const steam = (async () => {
      const hits = (await S.steamSearchRaw(q)).slice(0, 6);
      const items = await S.steamItems(hits.map((h) => h.id));
      return hits.map((h) => {
        const c = S.steamCandidate(h.id, items.get(String(h.id)) || null);
        if (!c.title) c.title = h.name;
        return c;
      });
    })().catch(() => []);
    const ms = (async () => {
      const hits = (await S.msSuggest(q)).slice(0, 5);
      const prods = await S.msProducts(hits.map((h) => h.ProductId));
      const order = new Map(hits.map((h, i) => [h.ProductId, i]));
      return prods.sort((a, b) => (order.get(a.ProductId) || 0) - (order.get(b.ProductId) || 0)).map(S.msCandidate);
    })().catch(() => []);
    const sgdb = S.sgdbSearch(key, q, 3).catch(() => []);
    let epic = [];
    try { epic = S.epicSearchLocal(q, 3); } catch { epic = []; }
    const all = [...(await steam), ...(await ms), ...epic, ...(await sgdb)];
    const out = await Promise.all(all.map((c) => this.summarize(c)));
    return out.filter((c) => c.coverUrl || c.heroUrl || c.logoUrl || c.bannerUrl);
  }

  async summarize(c) {
    const pick = async (items) => {
      const arr = (items || []).map((x) => (typeof x === 'string' ? { url: x } : x)).filter(Boolean);
      for (const it of [...arr.filter((x) => !x.low), ...arr.filter((x) => x.low)]) {
        if (it.url && isHttp(it.url)) return it.url;
        if (it.lazy) {
          try {
            const r = await Promise.race([it.lazy(), new Promise((res) => setTimeout(() => res(null), 8000))]);
            const u = [].concat(r || []).find(isHttp);
            if (u) return u;
          } catch { /* next */ }
        }
      }
      return null;
    };
    const [coverUrl, heroUrl, logoUrl, bannerUrl] = await Promise.all([pick(c.cover), pick(c.hero), pick(c.logo), pick(c.banner)]);
    return { source: c.source, id: String(c.id || ''), title: c.title || '', coverUrl, heroUrl, logoUrl, bannerUrl };
  }

  // Downloads a searchArt() candidate's images and replaces those kinds for the game.
  // -> { ok, applied: [kinds], failed: [kinds] }
  async applyArt(gameId, candidate) {
    const g = this.library.game(gameId);
    if (!g || !candidate || typeof candidate !== 'object') return { ok: false, applied: [], failed: [], error: 'unknown game or candidate' };
    const urls = { cover: candidate.coverUrl, hero: candidate.heroUrl, banner: candidate.bannerUrl, logo: candidate.logoUrl };
    const dir = path.join(this.dir, safeId(gameId));
    fs.mkdirSync(dir, { recursive: true });
    const bufs = await Promise.all(KINDS.map((k) => (isHttp(urls[k]) ? this.download(urls[k]) : null)));
    const live = this.library.game(gameId) || g;
    const art = { ...(live.art || {}) };
    const applied = [];
    const failed = [];
    const sources = { ...(live.artSources || {}) };
    KINDS.forEach((k, i) => {
      if (!isHttp(urls[k])) return;
      const buf = bufs[i];
      if (buf && !checkImage(k, buf, { loose: true })) {
        fs.writeFileSync(path.join(dir, k), buf);
        art[k] = Date.now();
        sources[k] = `manual:${candidate.source || ''}`;
        applied.push(k);
      } else failed.push(k);
    });
    if (applied.length) {
      // Remember the pick so refreshes / re-fetches reapply it instead of the automatic match.
      let prev = {};
      try { prev = JSON.parse(fs.readFileSync(this.manualFile(gameId), 'utf8')); } catch { /* none */ }
      const pick = { ...prev, source: candidate.source || '', id: String(candidate.id || ''), title: candidate.title || '' };
      for (const k of applied) pick[`${k}Url`] = urls[k];
      try { fs.writeFileSync(this.manualFile(gameId), JSON.stringify(pick, null, 2)); } catch { /* ignore */ }
      this.manualAt.set(gameId, Date.now());
      live.art = art;
      live.artSources = sources;
      live.artManual = { source: pick.source, id: pick.id };
      this.library.lib.save();
      this.notifyChanged();
    }
    return { ok: applied.length > 0, applied, failed };
  }
}

module.exports = { ArtManager, sniffMime, safeId, ART_VERSION, KINDS };
