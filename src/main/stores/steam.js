// Steam connector: every game on your Steam account, installed or not. Installs go through the
// Steam client (the only way Steam allows). Owned list, best source first:
//   1. Steam Web API key (Social › Friends) → GetOwnedGames (complete, with playtime)
//   2. Signed in to the Steam store in Project 360 → dynamicstore/userdata (complete)
//   3. Local Steam data → games you've launched on this PC (partial)
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { findSteamRoot } = require('../library/steam');
const { parseVdf, getCI } = require('../vdf');

const ASSETS = 'https://shared.akamai.steamstatic.com/store_item_assets/';
const ID64_BASE = 76561197960265728n;

function detectSteamId() {
  try { return require('../social').detectSteamId(); } catch { return null; }
}

async function get(ses, url) {
  try { return await ses.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch (e) { if (/redirect/i.test(e.message)) return { status: 302, ok: false, json: async () => ({}) }; throw e; }
}

async function cookieOwned(ses) {
  const r = await get(ses, 'https://store.steampowered.com/dynamicstore/userdata/');
  if (r.status !== 200) return null;
  const j = await r.json();
  return Array.isArray(j.rgOwnedApps) && j.rgOwnedApps.length ? j.rgOwnedApps.map(String) : null;
}

async function apiOwned(key, steamId) {
  if (!key || !steamId) return null;
  const r = await fetch(`https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(key)}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) return null;
  const games = ((await r.json()).response || {}).games;
  return Array.isArray(games) && games.length ? games : null;
}

async function localPlayed(steamId) {
  const root = await findSteamRoot();
  if (!root || !steamId) return null;
  const account = String(BigInt(steamId) - ID64_BASE);
  try {
    const v = parseVdf(fs.readFileSync(path.join(root, 'userdata', account, 'config', 'localconfig.vdf'), 'utf8'));
    let node = getCI(v, 'UserLocalConfigStore');
    for (const k of ['Software', 'Valve', 'Steam', 'apps']) node = getCI(node, k);
    return node ? Object.keys(node) : null;
  } catch { return null; }
}

// Names + art for many appids in one request (keyless store API).
async function storeItems(appids) {
  const out = new Map();
  for (let i = 0; i < appids.length; i += 100) {
    const ids = appids.slice(i, i + 100).map((a) => ({ appid: Number(a) }));
    const input = { ids, context: { language: 'english', country_code: 'US' }, data_request: { include_assets: true } };
    try {
      const r = await fetch(`https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`, { signal: AbortSignal.timeout(15000) });
      if (!r.ok) continue;
      for (const it of ((await r.json()).response || {}).store_items || []) if (it.appid) out.set(String(it.appid), it);
    } catch { /* partial */ }
  }
  return out;
}

function assetUrl(item, field) {
  const a = item && item.assets;
  if (!a || !a[field] || !a.asset_url_format) return null;
  return ASSETS + a.asset_url_format.replace('${FILENAME}', a[field]);
}

async function manifestFor(appid) {
  const root = await findSteamRoot();
  if (!root) return null;
  const libs = new Set([path.join(root, 'steamapps')]);
  try {
    const lf = getCI(parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8')), 'libraryfolders') || {};
    for (const e of Object.values(lf)) { const p = typeof e === 'string' ? e : getCI(e, 'path'); if (p) libs.add(path.join(p, 'steamapps')); }
  } catch { /* single library */ }
  for (const lib of libs) {
    const f = path.join(lib, `appmanifest_${appid}.acf`);
    if (!fs.existsSync(f)) continue;
    try { return getCI(parseVdf(fs.readFileSync(f, 'utf8')), 'AppState'); } catch { return null; }
  }
  return null;
}

module.exports = {
  id: 'steam',
  name: 'Steam',
  color: '#1b2838',
  client: 'Steam',
  signInUrl: 'https://store.steampowered.com/login/',
  about: 'Every game on your Steam account, including ones that aren’t installed. Installs run through Steam.',

  async status(ses, ctx) {
    const steamId = ctx.settings.get('social.steamId') || detectSteamId();
    if (await cookieOwned(ses).catch(() => null)) return { signedIn: true, mode: 'store', user: '' };
    if (ctx.settings.get('social.steamApiKey') && steamId) return { signedIn: true, mode: 'apikey', user: '' };
    if (await localPlayed(steamId)) return { signedIn: true, mode: 'local', partial: true, note: 'Showing games you’ve played on this PC. Sign in to the Steam store to see every game you own.' };
    return { signedIn: false, error: (await findSteamRoot()) ? 'Sign in to the Steam store to see your games' : 'Steam isn’t installed' };
  },

  async library(ses, ctx) {
    const steamId = ctx.settings.get('social.steamId') || detectSteamId();
    let appids = null;
    let names = new Map();
    let playtime = new Map();
    const api = await apiOwned(ctx.settings.get('social.steamApiKey'), steamId).catch(() => null);
    if (api) {
      appids = api.map((g) => String(g.appid));
      for (const g of api) { names.set(String(g.appid), g.name); playtime.set(String(g.appid), g.playtime_forever || 0); }
    }
    if (!appids) appids = await cookieOwned(ses).catch(() => null);
    if (!appids) appids = await localPlayed(steamId);
    if (!appids) throw new Error('Sign in to the Steam store to see your games');
    const items = await storeItems(appids);
    const out = [];
    for (const id of appids) {
      const it = items.get(id);
      if (it && it.type !== 0) continue;                // DLC, soundtracks, tools, videos
      if (!it && !names.has(id)) continue;              // unknown (delisted tools etc.)
      const title = (it && it.name) || names.get(id);
      if (!title || /redistributable|dedicated server|soundtrack|\bsdk\b|steamvr|spacewar/i.test(title)) continue;
      out.push({
        id,
        title,
        image: assetUrl(it, 'header') || `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
        cover: assetUrl(it, 'library_capsule'),
        hero: assetUrl(it, 'library_hero'),
        windows: true,
        url: `https://store.steampowered.com/app/${id}/`,
        localId: `steam:${id}`,
        playtimeMin: playtime.get(id) || 0,
      });
    }
    return out;
  },

  async downloads(ses, game) {
    return { title: game.title, hero: game.hero, options: [{ id: 'client', label: 'Install with Steam', client: true, size: 0, files: [] }] };
  },

  // Opens Steam's own install dialog (Steam stays in the tray thanks to -silent).
  async installClient(game) {
    const root = await findSteamRoot();
    const exe = root && path.join(root, 'steam.exe');
    if (exe && fs.existsSync(exe)) spawn(exe, ['-silent', `steam://install/${game.id}`], { detached: true, stdio: 'ignore' }).unref();
    else await shell.openExternal(`steam://install/${game.id}`);
  },

  // { state: 'installed'|'downloading'|null, received, total }
  async progress(game) {
    const m = await manifestFor(game.id);
    if (!m) return null;
    const flags = Number(getCI(m, 'StateFlags') || 0);
    const total = Number(getCI(m, 'BytesToDownload') || 0);
    const received = Number(getCI(m, 'BytesDownloaded') || 0);
    // Bit 4 = fully installed (stays set while a later update is pending).
    if (flags & 4) return { state: 'installed', received: total, total };
    return { state: 'downloading', received, total };
  },
};
