// Artwork / metadata sources. Each source turns a game (or a search query) into a "candidate":
//   { source, id, title, cover: [item], hero: [item], banner: [item], logo: [item], meta, moreMeta? }
// item = 'https://…' | { url | file | lazy, low?, loose?, minAspect? }
//   lazy: async () => url | [urls]   (only resolved when that kind is still missing)
//   low:  only used after every other source failed for that kind
//   loose: skip shape checks (portrait cover / wide hero / transparent logo)
// No API keys and no personal data are sent; locale is fixed to US / English.
const fs = require('fs');
const path = require('path');
const U = require('./util');

const STEAM_ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const STEAM_LEGACY = (a) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${a}`;
const STEAM_CTX = { language: 'english', country_code: 'US' };

const list = (...xs) => xs.flat().filter(Boolean);

// ---------------------------------------------------------------- Steam
async function steamItems(appids) {
  const ids = [...new Set(appids.map((a) => Number(a)).filter(Boolean))];
  if (!ids.length) return new Map();
  const input = {
    ids: ids.map((appid) => ({ appid })),
    context: STEAM_CTX,
    data_request: { include_assets: true, include_basic_info: true, include_release: true },
  };
  const j = await U.fetchJson(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`);
  const out = new Map();
  for (const it of (j && j.response && j.response.store_items) || []) if (it && it.success === 1) out.set(String(it.appid || it.id), it);
  return out;
}

// Hashed library logo path from the public PICS mirror (Steam's own store APIs don't expose it).
async function steamLogoUrls(appid) {
  const j = await U.fetchJson(`https://api.steamcmd.net/v1/info/${appid}`, { timeout: 12000 });
  const common = j && j.data && j.data[appid] && j.data[appid].common;
  const logo = common && common.library_assets_full && common.library_assets_full.library_logo;
  if (!logo) return [];
  const pick = (o) => (o && (o.english || Object.values(o)[0])) || null;
  return list(pick(logo.image), pick(logo.image2x)).map((f) => `${STEAM_ASSETS}steam/apps/${appid}/${f}`);
}

async function steamAppDetailsMeta(appid) {
  const d = await U.fetchJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=english&cc=US`);
  const data = d && d[appid] && d[appid].success ? d[appid].data : null;
  if (!data) return null;
  return {
    description: U.shortText(data.short_description || ''),
    genres: (data.genres || []).map((x) => x.description),
    developer: (data.developers || [])[0] || '',
    publisher: (data.publishers || [])[0] || '',
    released: data.release_date ? data.release_date.date : '',
  };
}

function steamCandidate(appid, item) {
  const a = (item && item.assets) || {};
  const fmt = a.asset_url_format;
  const u = (f) => (fmt && f ? STEAM_ASSETS + fmt.replace('${FILENAME}', f) : null);
  const legacy = STEAM_LEGACY(appid);
  const bi = (item && item.basic_info) || {};
  const rel = item && item.release && (item.release.steam_release_date || item.release.original_release_date);
  return {
    source: 'steam',
    id: String(appid),
    title: (item && item.name) || '',
    cover: list(u(a.library_capsule_2x), u(a.library_capsule), `${legacy}/library_600x900_2x.jpg`, `${legacy}/library_600x900.jpg`),
    hero: list(u(a.library_hero), u(a.library_hero_2x), `${legacy}/library_hero.jpg`, a.raw_page_background ? { url: u(a.raw_page_background), low: true } : null),
    banner: list(u(a.header_2x), u(a.header), `${legacy}/header.jpg`),
    logo: [{ lazy: () => steamLogoUrls(appid) }, `${legacy}/logo.png`, `${legacy}/logo_2x.png`],
    meta: item ? {
      description: U.shortText(bi.short_description || ''),
      genres: [],
      developer: ((bi.developers || [])[0] || {}).name || '',
      publisher: ((bi.publishers || [])[0] || {}).name || '',
      released: rel ? U.fmtDate(rel * 1000) : '',
    } : null,
    moreMeta: () => steamAppDetailsMeta(appid),
  };
}

async function steamApp(appid) {
  const items = await steamItems([appid]);
  return steamCandidate(appid, items.get(String(appid)) || null);
}

async function steamSearchRaw(term) {
  const j = await U.fetchJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&l=english&cc=US`);
  return ((j && j.items) || []).filter((x) => x && x.type === 'app' && x.id);
}

// Strict title match only: a wrong game's art is worse than none.
async function steamSearch(title) {
  const hits = await steamSearchRaw(String(title).replace(/[™®©]/g, ''));
  const hit = hits.find((h) => U.sameTitle(h.name, title));
  return hit ? steamApp(hit.id) : null;
}

// ---------------------------------------------------------------- Epic (local launcher catalog cache)
let catCache = { file: null, mtime: 0, items: [] };

function epicCatalogItems() {
  const files = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin'),
    path.join(process.env.LOCALAPPDATA || '', 'EpicGamesLauncher', 'Saved', 'Data', 'Catalog', 'catcache.bin'),
  ];
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      if (catCache.file === f && catCache.mtime === st.mtimeMs) return catCache.items;
      const raw = fs.readFileSync(f, 'utf8').trim();
      const json = raw.startsWith('[') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const items = JSON.parse(json);
      if (Array.isArray(items)) { catCache = { file: f, mtime: st.mtimeMs, items }; return items; }
    } catch { /* try next */ }
  }
  return [];
}

// Base games have mainGameItem = { id: '' }; DLC/add-ons point at their parent.
const isEpicGame = (it) => !(it.mainGameItem && it.mainGameItem.id) &&(it.categories || []).some((c) => c && c.path === 'games');

function epicFind(g) {
  const items = epicCatalogItems();
  if (!items.length) return null;
  if (g.epicCatalogItemId) {
    const hit = items.find((i) => i.id === g.epicCatalogItemId);
    if (hit) return hit;
  }
  if (g.epicNamespace) {
    const ns = items.filter((i) => i.namespace === g.epicNamespace && isEpicGame(i));
    if (ns.length === 1) return ns[0];
    const t = ns.find((i) => U.sameTitle(i.title, g.title));
    if (t) return t;
  }
  return items.find((i) => isEpicGame(i) && U.sameTitle(i.title, g.title)) || null;
}

function epicCandidate(it) {
  const img = (type) => ((it.keyImages || []).find((k) => k.type === type) || {}).url || null;
  const desc = U.shortText(it.description || '');
  const title = String(it.title || '');
  return {
    source: 'epic',
    id: it.id,
    namespace: it.namespace,
    title: it.title,
    cover: list(img('DieselGameBoxTall'), img('OfferImageTall'), img('Thumbnail')),
    hero: list(img('DieselGameBox'), img('OfferImageWide')),
    banner: list(img('DieselGameBox'), img('OfferImageWide')),
    logo: list(img('DieselGameBoxLogo')),
    // Some catalog entries carry only the title as description (with lossy "?" for the (R) sign).
    meta: {
      description: desc.length > title.length + 12 && !U.sameTitle(desc, title) ? desc : '',
      genres: [], developer: it.developer || '', publisher: '', released: '',
    },
  };
}

function epicCatalog(g) {
  const it = epicFind(g);
  return it ? epicCandidate(it) : null;
}

function epicSearchLocal(query, max = 3) {
  return epicCatalogItems().filter(isEpicGame)
    .map((it) => ({ it, s: U.similarity(it.title, query) }))
    .filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, max)
    .map((x) => epicCandidate(x.it));
}

// Epic store page content (public, keyless). Accepted only when its namespace matches the game's.
async function epicStore(g, namespace) {
  if (!namespace) return null;
  const slug = U.normTitle(g.title).replace(/ /g, '-');
  if (!slug) return null;
  const j = await U.fetchJson(`https://store-content-ipv4.ak.epicgames.com/api/en-US/content/products/${encodeURIComponent(slug)}`, { timeout: 12000 });
  if (!j || j.namespace !== namespace) return null;
  const home = (j.pages || []).find((p) => p.type === 'productHome' || p._slug === 'home');
  const hero = (home && home.data && home.data.hero) || {};
  const about = (home && home.data && home.data.about) || {};
  return {
    source: 'epic-store',
    id: slug,
    title: j.productName || g.title,
    cover: list(hero.portraitBackgroundImageUrl),
    hero: list(hero.backgroundImageUrl),
    banner: list(hero.backgroundImageUrl),
    logo: hero.logoImage && hero.logoImage.src ? [{ url: hero.logoImage.src, minAspect: 1.3 }] : [],
    meta: {
      description: U.shortText(about.shortDescription || about.description || ''),
      genres: [],
      developer: about.developerAttribution || '',
      publisher: about.publisherAttribution || '',
      released: '',
    },
  };
}

// ---------------------------------------------------------------- GOG (public api.gog.com)
async function gogProduct(gogId) {
  const j = await U.fetchJson(`https://api.gog.com/v2/games/${encodeURIComponent(gogId)}?locale=en-US`);
  if (!j || !j._links) return null;
  const L = j._links;
  const E = j._embedded || {};
  const href = (k) => (L[k] && L[k].href) || null;
  const prodImg = E.product && E.product._links && E.product._links.image && E.product._links.image.href;
  const fmt = (f) => (prodImg ? prodImg.replace('_{formatter}', `_${f}`).replace(/\.png$/, '.jpg') : null);
  const tags = (E.tags || []).filter((t) => t.level === 1).map((t) => t.name);
  return {
    source: 'gog',
    id: String(gogId),
    title: (E.product && E.product.title) || '',
    // GOG box art is only 342x482: keep it as a last resort so a 600x900 capsule wins when one exists.
    cover: href('boxArtImage') ? [{ url: href('boxArtImage'), low: true }] : [],
    hero: list(href('galaxyBackgroundImage'), href('backgroundImage')),
    banner: list(fmt('product_630_2x'), fmt('800')),
    logo: list(href('logo')),
    meta: {
      description: U.shortText(j.description || j.overview || ''),
      genres: tags.length ? tags : (E.tags || []).slice(0, 3).map((t) => t.name),
      developer: ((E.developers || [])[0] || {}).name || '',
      publisher: (E.publisher && E.publisher.name) || '',
      released: E.product ? U.fmtDate(E.product.globalReleaseDate || E.product.gogReleaseDate || '') : '',
    },
  };
}

// ---------------------------------------------------------------- Microsoft Store (displaycatalog)
const MS = 'https://displaycatalog.mp.microsoft.com/v7.0';

function msCandidate(p) {
  const l = (p.LocalizedProperties || [])[0] || {};
  const imgs = l.Images || [];
  const by = (purpose) => imgs.filter((i) => i.ImagePurpose === purpose && i.Uri);
  const url = (i, q = '') => `${i.Uri.startsWith('//') ? 'https:' : ''}${i.Uri}${q}`;
  const first = (purpose, q) => { const i = by(purpose)[0]; return i ? url(i, q) : null; };
  const square = by('BoxArt')[0];
  const logo = by('Logo').find((i) => i.Width && i.Height && i.Width / i.Height >= 1.3);
  const mp = (p.MarketProperties || [])[0] || {};
  const props = p.Properties || {};
  return {
    source: 'microsoft',
    id: p.ProductId,
    title: l.ProductTitle || '',
    cover: list(first('Poster', '?w=600'), square ? { url: url(square, '?w=600'), low: true, loose: true } : null),
    hero: list(first('SuperHeroArt', '?w=1920'), first('TitledHeroArt', '?w=1920')),
    banner: list(first('TitledHeroArt', '?w=920'), first('SuperHeroArt', '?w=920')),
    logo: logo ? [{ url: url(logo), minAspect: 1.3 }] : [],
    meta: {
      description: U.shortText(l.ShortDescription || l.ProductDescription || ''),
      genres: props.Categories || (props.Category ? [props.Category] : []),
      developer: l.DeveloperName || '',
      publisher: l.PublisherName || '',
      released: mp.OriginalReleaseDate ? U.fmtDate(mp.OriginalReleaseDate) : '',
    },
  };
}

async function msProducts(bigIds) {
  if (!bigIds.length) return [];
  const j = await U.fetchJson(`${MS}/products?bigIds=${bigIds.map(encodeURIComponent).join(',')}&market=US&languages=en-US`);
  return (j && j.Products) || [];
}

async function msByPfn(pfn) {
  if (!pfn) return null;
  const j = await U.fetchJson(`${MS}/products/lookup?market=US&languages=en-US&alternateId=PackageFamilyName&value=${encodeURIComponent(pfn)}&fieldsTemplate=details`);
  const p = j && j.Products && j.Products[0];
  return p ? msCandidate(p) : null;
}

async function msSuggest(query) {
  const j = await U.fetchJson(`${MS}/productFamilies/autosuggest?market=US&languages=en-US&query=${encodeURIComponent(query)}&productFamilyNames=Games`);
  const out = [];
  for (const r of (j && j.Results) || []) for (const p of r.Products || []) if (p.Type === 'Game' && p.ProductId) out.push(p);
  return out;
}

async function msSearch(title) {
  const hits = await msSuggest(String(title).replace(/[™®©]/g, ''));
  const hit = hits.find((h) => U.sameTitle(h.Title, title));
  if (!hit) return null;
  const [p] = await msProducts([hit.ProductId]);
  return p ? msCandidate(p) : null;
}

// ---------------------------------------------------------------- libretro thumbnails (ROMs)
// thumbnails.libretro.com no longer serves directory listings, so the file list comes from the
// libretro-thumbnails GitHub repo tree (one request per system, cached on disk for 30 days).
const LIBRETRO_TTL = 30 * 24 * 3600 * 1000;
const libretroMem = new Map();

function libretroRepo(system) { return String(system).trim().replace(/ /g, '_'); }
function libretroSafe(name) { return String(name).replace(/[&*/:`<>?\\|"]/g, '_'); }

async function libretroList(system, cacheDir) {
  const repo = libretroRepo(system);
  if (libretroMem.has(repo)) return libretroMem.get(repo);
  const file = path.join(cacheDir, `libretro-${repo.replace(/[^\w.-]/g, '_')}.json`);
  let cached = null;
  try { cached = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none */ }
  if (!cached || Date.now() - cached.fetched > LIBRETRO_TTL) {
    const j = await U.fetchJson(`https://api.github.com/repos/libretro-thumbnails/${encodeURIComponent(repo)}/git/trees/HEAD?recursive=1`, {
      headers: { Accept: 'application/vnd.github+json' }, timeout: 45000,
    });
    if (j && Array.isArray(j.tree)) {
      const dirs = { Named_Boxarts: [], Named_Logos: [], Named_Snaps: [], Named_Titles: [] };
      const links = [];
      for (const t of j.tree) {
        if (t.type !== 'blob' || !/\.png$/i.test(t.path)) continue;
        const [d, ...rest] = t.path.split('/');
        if (!dirs[d] || rest.length !== 1) continue;
        const name = rest[0].replace(/\.png$/i, '');
        dirs[d].push(name);
        if (t.mode === '120000') links.push(`${d}/${name}`);
      }
      cached = { fetched: Date.now(), repo, dirs, links };
      try { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(cached)); } catch { /* ignore */ }
    }
  }
  if (cached) { cached.linkSet = new Set(cached.links || []); libretroMem.set(repo, cached); }
  return cached;
}

const REGION_ORDER = ['USA', 'World', 'Europe', 'Japan'];
function stripTags(n) { return n.replace(/\s*[([].*?[)\]]/g, '').trim(); }
function regionRank(n) {
  const tags = (n.match(/\(([^)]*)\)/g) || []).join(' ');
  const i = REGION_ORDER.findIndex((r) => tags.includes(r));
  return (i < 0 ? 9 : i) * 10 + (/\((Beta|Proto|Demo|Sample|Unl|Pirate|Hack)/i.test(n) ? 50 : 0) + (n.match(/\(/g) || []).length;
}

function libretroMatch(names, romName, title) {
  if (!names || !names.length) return null;
  const set = new Set(names);
  if (romName && set.has(libretroSafe(romName))) return libretroSafe(romName);
  const want = U.normTitle(title || stripTags(romName || ''));
  if (!want) return null;
  const exact = names.filter((n) => U.normTitle(stripTags(n)) === want);
  if (exact.length) return exact.sort((a, b) => regionRank(a) - regionRank(b))[0];
  let best = null; let bestScore = 0;
  for (const n of names) {
    const s = U.similarity(stripTags(n), want);
    if (s > bestScore || (s === bestScore && best && regionRank(n) < regionRank(best))) { best = n; bestScore = s; }
  }
  if (bestScore >= 0.85) return best;
  // "Zelda - A Link to the Past" vs "Legend of Zelda, The - A Link to the Past": all words present,
  // at most two extra words and no sequel number.
  let contained = null; let fewest = 99;
  for (const n of names) {
    const extra = U.containedIn(want, stripTags(n), 2);
    if (extra < 0) continue;
    if (extra < fewest || (extra === fewest && regionRank(n) < regionRank(contained))) { contained = n; fewest = extra; }
  }
  return contained;
}

async function libretro(g, cacheDir) {
  if (!g.libretroSystem) return null;
  const data = await libretroList(g.libretroSystem, cacheDir);
  if (!data) return null;
  const raw = (d, n) => `https://raw.githubusercontent.com/libretro-thumbnails/${data.repo}/HEAD/${d}/${encodeURIComponent(n)}.png`;
  // Symlinked entries come back as a text file holding the target's name (same folder).
  const item = (d, opts = {}) => {
    const n = libretroMatch(data.dirs[d], g.romName, g.title);
    if (!n) return null;
    if (!data.linkSet.has(`${d}/${n}`)) return { url: raw(d, n), ...opts };
    return {
      ...opts,
      lazy: async () => {
        const buf = await U.fetchBuf(raw(d, n));
        const target = buf && buf.length < 400 ? path.posix.basename(buf.toString('utf8').trim()).replace(/\.png$/i, '') : null;
        return target ? raw(d, target) : null;
      },
    };
  };
  const box = item('Named_Boxarts', { loose: true });
  const snap = item('Named_Snaps', { low: true, loose: true });
  const titleScr = item('Named_Titles', { low: true, loose: true });
  return {
    source: 'libretro',
    id: `${data.repo}`,
    title: g.title,
    cover: list(box),
    hero: list(snap, titleScr),
    banner: list(titleScr, snap),
    logo: list(item('Named_Logos', { loose: true })),
    meta: null,
  };
}

// ---------------------------------------------------------------- SteamGridDB (API key)
const SGDB = 'https://www.steamgriddb.com/api/v2';

async function sgdbGameId(key, g) {
  const H = { Authorization: `Bearer ${key}` };
  if (g.steamAppId) {
    const r = await U.fetchJson(`${SGDB}/games/steam/${g.steamAppId}`, { headers: H });
    if (r && r.success && r.data) return r.data.id;
  }
  const r = await U.fetchJson(`${SGDB}/search/autocomplete/${encodeURIComponent(g.title)}`, { headers: H });
  return r && r.success && r.data && r.data[0] ? r.data[0].id : null;
}

function sgdbCandidate(key, gid, title) {
  const H = { Authorization: `Bearer ${key}` };
  const firstUrl = (p) => async () => {
    const r = await U.fetchJson(`${SGDB}${p}`, { headers: H });
    return r && r.success && r.data ? r.data.slice(0, 2).map((x) => x.url) : null;
  };
  return {
    source: 'steamgriddb',
    id: String(gid),
    title: title || '',
    cover: [{ lazy: firstUrl(`/grids/game/${gid}?dimensions=600x900&types=static`) }],
    hero: [{ lazy: firstUrl(`/heroes/game/${gid}?types=static`) }],
    logo: [{ lazy: firstUrl(`/logos/game/${gid}?types=static`) }],
    banner: [{ lazy: firstUrl(`/grids/game/${gid}?dimensions=920x430,460x215&types=static`) }],
    meta: null,
  };
}

async function steamGridDb(key, g) {
  if (!key) return null;
  const gid = await sgdbGameId(key, g);
  return gid ? sgdbCandidate(key, gid, g.title) : null;
}

async function sgdbSearch(key, query, max = 3) {
  if (!key) return [];
  const r = await U.fetchJson(`${SGDB}/search/autocomplete/${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${key}` } });
  return ((r && r.success && r.data) || []).slice(0, max).map((x) => sgdbCandidate(key, x.id, x.name));
}

// ---------------------------------------------------------------- IGDB (Twitch client id + secret)
let igdbToken = null;
async function igdbSearch(clientId, secret, title) {
  if (!clientId || !secret) return null;
  if (!igdbToken || igdbToken.exp < Date.now()) {
    const t = await U.fetchJson(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(secret)}&grant_type=client_credentials`, { method: 'POST' });
    if (!t || !t.access_token) return null;
    igdbToken = { token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 };
  }
  const body = `search "${String(title).replace(/"/g, '')}"; fields name,summary,first_release_date,genres.name,cover.image_id,artworks.image_id,screenshots.image_id,involved_companies.developer,involved_companies.publisher,involved_companies.company.name; limit 1;`;
  const r = await U.fetchJson('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: { 'Client-ID': clientId, Authorization: `Bearer ${igdbToken.token}`, 'Content-Type': 'text/plain' },
    body,
  });
  const hit = Array.isArray(r) && r[0] ? r[0] : null;
  if (!hit) return null;
  const img = (id, size) => `https://images.igdb.com/igdb/image/upload/${size}/${id}.jpg`;
  const wide = (hit.artworks && hit.artworks[0]) || (hit.screenshots && hit.screenshots[0]);
  const company = (k) => (((hit.involved_companies || []).find((c) => c[k]) || {}).company || {}).name || '';
  return {
    source: 'igdb',
    id: String(hit.id || ''),
    title: hit.name || '',
    cover: hit.cover ? [img(hit.cover.image_id, 't_cover_big_2x')] : [],
    hero: wide ? [img(wide.image_id, 't_1080p')] : [],
    banner: wide ? [img(wide.image_id, 't_screenshot_big')] : [],
    logo: [],
    meta: {
      description: U.shortText(hit.summary || ''),
      genres: (hit.genres || []).map((x) => x.name),
      developer: company('developer'),
      publisher: company('publisher'),
      released: hit.first_release_date ? new Date(hit.first_release_date * 1000).getFullYear().toString() : '',
    },
  };
}

module.exports = {
  steamItems, steamCandidate, steamApp, steamSearch, steamSearchRaw, steamLogoUrls,
  epicCatalog, epicFind, epicStore, epicSearchLocal, epicCatalogItems,
  gogProduct,
  msByPfn, msSearch, msSuggest, msProducts, msCandidate,
  libretro, libretroMatch,
  steamGridDb, sgdbSearch,
  igdbSearch,
};
