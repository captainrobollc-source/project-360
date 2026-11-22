// Marketplace feed: Steam featured categories + Epic free-game promotions, cached to disk.
//
// getMarket({ cacheFile, country, maxAgeMs }) -> { updatedAt, offline, sections: [{ id, title, items }] }
// Item: { id, store, title, image, cover, price: { final, original, discountPct, currency, formatted, free },
//         url, steamAppId?, endsAt?, startsAt?, kind?, releaseDate?, header? }
const fs = require('fs');
const path = require('path');

const STEAM_ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const TIMEOUT_MS = 10000;
const ADULT_DESCRIPTORS = new Set([3, 4]); // 3 = adult-only sexual content, 4 = frequent nudity/sexual content
const STEAM_KIND = { 0: 'game', 1: 'software', 4: 'dlc', 10: 'hardware' };

const SECTION_DEFS = [
  { id: 'specials', title: 'Deals', src: 'steam' },
  { id: 'top', title: 'Top sellers', src: 'steam' },
  { id: 'new', title: 'New releases', src: 'steam' },
  { id: 'free', title: 'Free on Epic', src: 'epic' },
  { id: 'upcoming', title: 'Coming soon', src: 'both' },
];

let inflight = null;

async function fetchJson(url, timeout = TIMEOUT_MS) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${new URL(url).host}`);
  return res.json();
}

function fmtMoney(cents, currency) {
  if (cents == null) return '';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency || ''}`.trim();
  }
}

function makePrice(final, original, currency, opts = {}) {
  final = final == null ? null : Number(final);
  original = original == null ? final : Number(original);
  const discountPct = original && final != null && original > final ? Math.round((1 - final / original) * 100) : 0;
  const free = !!opts.free || (final === 0 && !opts.unpriced);
  let formatted;
  if (opts.unpriced) formatted = opts.label || 'Coming soon';
  else if (free) formatted = 'Free';
  else formatted = fmtMoney(final, currency);
  return { final, original, discountPct: opts.discountPct != null ? opts.discountPct : discountPct, currency: currency || 'USD', formatted, free };
}

// ---------- Steam ----------

async function steamDetails(appids, country) {
  // Keyless store-browse API: gives hashed asset paths (portrait library capsule), item type and content descriptors.
  const out = new Map();
  const ids = [...new Set(appids)];
  for (let i = 0; i < ids.length; i += 50) {
    const input = {
      ids: ids.slice(i, i + 50).map((appid) => ({ appid: Number(appid) })),
      context: { language: 'english', country_code: country },
      data_request: { include_assets: true, include_release: true },
    };
    const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1?input_json=${encodeURIComponent(JSON.stringify(input))}`;
    try {
      const j = await fetchJson(url);
      for (const it of (j.response && j.response.store_items) || []) if (it && it.id) out.set(String(it.id), it);
    } catch { /* details are optional */ }
  }
  return out;
}

function steamAsset(details, key) {
  const a = details && details.assets;
  if (!a || !a[key] || !a.asset_url_format) return null;
  return STEAM_ASSET_BASE + a.asset_url_format.replace('${FILENAME}', a[key]);
}

function steamItem(raw, details, section) {
  const id = String(raw.id);
  const isApp = raw.type === 0 || raw.type == null;
  const d = isApp ? details.get(id) : null;
  if (d && Array.isArray(d.content_descriptorids) && d.content_descriptorids.some((c) => ADULT_DESCRIPTORS.has(c))) return null;

  const comingSoon = section === 'upcoming' || !!(d && d.release && d.release.is_coming_soon);
  const unpriced = comingSoon && !raw.final_price && raw.original_price == null;
  const item = {
    id: isApp ? `steam:${id}` : `steam:${raw.type === 1 ? 'sub' : 'bundle'}:${id}`,
    store: 'steam',
    title: raw.name || (d && d.name) || `Steam ${id}`,
    image: steamAsset(d, 'main_capsule') || raw.large_capsule_image || raw.header_image || null,
    header: raw.header_image || steamAsset(d, 'header') || null,
    cover: steamAsset(d, 'library_capsule'),
    price: makePrice(raw.final_price, raw.original_price, raw.currency, {
      unpriced,
      discountPct: raw.discounted ? raw.discount_percent : undefined,
    }),
    url: isApp ? `https://store.steampowered.com/app/${id}/` : `https://store.steampowered.com/${raw.type === 1 ? 'sub' : 'bundle'}/${id}/`,
    kind: d ? (STEAM_KIND[d.type] || 'other') : (isApp ? 'game' : 'package'),
  };
  if (isApp) item.steamAppId = id;
  if (raw.discount_expiration) item.endsAt = raw.discount_expiration * 1000;
  if (d && d.release && d.release.steam_release_date) item.releaseDate = d.release.steam_release_date * 1000;
  if (d && d.related_items && d.related_items.parent_appid) item.parentAppId = String(d.related_items.parent_appid);
  return item;
}

async function fetchSteam(country) {
  const j = await fetchJson(`https://store.steampowered.com/api/featuredcategories?cc=${encodeURIComponent(country)}&l=english`);
  const map = { specials: 'specials', top_sellers: 'top', new_releases: 'new', coming_soon: 'upcoming' };
  const raws = {};
  const appids = [];
  for (const [key, sid] of Object.entries(map)) {
    raws[sid] = ((j[key] && j[key].items) || []).filter((r) => r && r.id);
    for (const r of raws[sid]) if (r.type === 0 || r.type == null) appids.push(String(r.id));
  }
  const details = await steamDetails(appids, country);
  const sections = {};
  for (const sid of Object.keys(raws)) sections[sid] = raws[sid].map((r) => steamItem(r, details, sid)).filter(Boolean);
  return sections;
}

// ---------- Epic ----------

function epicImage(el, types) {
  for (const t of types) {
    const k = (el.keyImages || []).find((x) => x.type === t && x.url);
    if (k) return k.url;
  }
  return null;
}

function epicSlug(el) {
  const pick = (arr) => (arr || []).find((m) => m && m.pageSlug && m.pageType === 'productHome') || (arr || []).find((m) => m && m.pageSlug);
  const m = pick(el.catalogNs && el.catalogNs.mappings) || pick(el.offerMappings);
  if (m) return m.pageSlug;
  if (el.productSlug) return String(el.productSlug).replace(/\/home$/, '');
  if (el.urlSlug && !/^[0-9a-f]{32}$/i.test(el.urlSlug)) return el.urlSlug;
  return null;
}

function freeWindows(groups) {
  const out = [];
  for (const g of groups || []) for (const o of (g && g.promotionalOffers) || []) {
    const ds = o.discountSetting || {};
    if (ds.discountType === 'PERCENTAGE' && Number(ds.discountPercentage) === 0) {
      out.push({ start: Date.parse(o.startDate), end: Date.parse(o.endDate) });
    }
  }
  return out;
}

function epicItem(el, win, current) {
  const tp = (el.price && el.price.totalPrice) || {};
  const slug = epicSlug(el);
  const base = el.offerType === 'BUNDLE' ? 'bundles' : 'p';
  const original = tp.originalPrice != null ? tp.originalPrice : null;
  const item = {
    id: `epic:${el.namespace}:${el.id}`,
    store: 'epic',
    title: el.title,
    image: epicImage(el, ['OfferImageWide', 'DieselStoreFrontWide', 'featuredMedia', 'Thumbnail', 'OfferImageTall']),
    cover: epicImage(el, ['OfferImageTall', 'DieselGameBoxTall', 'DieselStoreFrontTall']),
    price: current
      ? { ...makePrice(0, original, tp.currencyCode, { free: true }), discountPct: original ? 100 : 0 }
      : makePrice(tp.discountPrice != null ? tp.discountPrice : original, original, tp.currencyCode),
    url: slug ? `https://store.epicgames.com/en-US/${base}/${slug}` : 'https://store.epicgames.com/en-US/free-games',
    kind: el.offerType === 'ADD_ON' || el.offerType === 'DLC' ? 'dlc' : el.offerType === 'BUNDLE' ? 'bundle' : 'game',
  };
  if (Number.isFinite(win.end)) item.endsAt = win.end;
  if (Number.isFinite(win.start)) item.startsAt = win.start;
  if (!current) item.freeSoon = true;
  return item;
}

async function fetchEpic(country) {
  const c = encodeURIComponent(country);
  const j = await fetchJson(`https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=${c}&allowCountries=${c}`);
  const els = (j && j.data && j.data.Catalog && j.data.Catalog.searchStore && j.data.Catalog.searchStore.elements) || [];
  const now = Date.now();
  const free = [];
  const upcoming = [];
  for (const el of els) {
    if (!el || !el.title || !el.promotions) continue;
    const cur = freeWindows(el.promotions.promotionalOffers).find((w) => w.start <= now && now < w.end);
    const tp = (el.price && el.price.totalPrice) || {};
    if (cur && Number(tp.discountPrice) === 0) { free.push(epicItem(el, cur, true)); continue; }
    const next = freeWindows(el.promotions.upcomingPromotionalOffers).filter((w) => w.start > now).sort((a, b) => a.start - b.start)[0];
    if (next) upcoming.push(epicItem(el, next, false));
  }
  free.sort((a, b) => (a.endsAt || Infinity) - (b.endsAt || Infinity));
  upcoming.sort((a, b) => (a.startsAt || Infinity) - (b.startsAt || Infinity));
  return { free, upcoming };
}

// ---------- assembly / cache ----------

function normTitle(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); }

function dedupe(items) {
  const ids = new Set();
  const titles = new Set();
  const out = [];
  for (const it of items) {
    const tk = `${it.store}:${normTitle(it.title)}`;
    if (ids.has(it.id) || titles.has(tk)) continue;
    ids.add(it.id); titles.add(tk);
    out.push(it);
  }
  return out;
}

function assemble(steam, epic) {
  const sections = [];
  for (const def of SECTION_DEFS) {
    let items;
    if (def.id === 'upcoming') items = [...((epic && epic.upcoming) || []), ...((steam && steam.upcoming) || [])];
    else if (def.src === 'epic') items = (epic && epic[def.id]) || [];
    else items = (steam && steam[def.id]) || [];
    items = dedupe(items);
    if (def.id === 'upcoming' && !items.length) continue;
    sections.push({ id: def.id, title: def.title, items });
  }
  return sections;
}

function readCache(cacheFile) {
  if (!cacheFile) return null;
  try {
    const j = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    return j && Array.isArray(j.sections) ? j : null;
  } catch { return null; }
}

function writeCache(cacheFile, data) {
  if (!cacheFile) return;
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    const tmp = `${cacheFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, cacheFile);
  } catch { /* cache is best-effort */ }
}

// Pull a source's sections back out of a cached payload (used when only one source fails).
function fromCache(cache, src) {
  if (!cache || !cache.raw) return null;
  return cache.raw[src] || null;
}

async function refresh({ cacheFile, country }) {
  const cache = readCache(cacheFile);
  const [s, e] = await Promise.allSettled([fetchSteam(country), fetchEpic(country)]);
  const steamOk = s.status === 'fulfilled';
  const epicOk = e.status === 'fulfilled';
  if (!steamOk && !epicOk) {
    if (cache) return { updatedAt: cache.updatedAt || null, offline: true, sections: cache.sections, errors: [String(s.reason && s.reason.message), String(e.reason && e.reason.message)] };
    return { updatedAt: null, offline: true, sections: assemble(null, null), errors: [String(s.reason && s.reason.message), String(e.reason && e.reason.message)] };
  }
  const steam = steamOk ? s.value : fromCache(cache, 'steam');
  const epic = epicOk ? e.value : fromCache(cache, 'epic');
  const data = { updatedAt: Date.now(), country, sections: assemble(steam, epic), raw: { steam, epic } };
  if (!steamOk || !epicOk) data.retryAt = Date.now() + 5 * 60000; // half the deals are missing: try again soon
  writeCache(cacheFile, data);
  const out = { updatedAt: data.updatedAt, offline: false, sections: data.sections };
  if (!steamOk || !epicOk) {
    out.partial = true;
    out.errors = [!steamOk && `Steam: ${s.reason && s.reason.message}`, !epicOk && `Epic: ${e.reason && e.reason.message}`].filter(Boolean);
  }
  return out;
}

async function getMarket({ cacheFile, country = 'US', maxAgeMs = 3600000, force = false } = {}) {
  country = String(country || 'US').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'US';
  if (!force) {
    const cache = readCache(cacheFile);
    if (cache && cache.updatedAt && (cache.country || 'US') === country && Date.now() - cache.updatedAt < maxAgeMs && !(cache.retryAt && Date.now() > cache.retryAt)) {
      return { updatedAt: cache.updatedAt, offline: false, cached: true, sections: cache.sections };
    }
  }
  if (!inflight) {
    inflight = refresh({ cacheFile, country }).catch((err) => {
      const cache = readCache(cacheFile);
      return { updatedAt: cache ? cache.updatedAt : null, offline: true, sections: cache ? cache.sections : assemble(null, null), errors: [String(err && err.message)] };
    }).finally(() => { inflight = null; });
  }
  return inflight;
}

module.exports = { getMarket };
