// Steam friends as the console's friends list (Steam Web API; needs a user-supplied API key).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseVdf, getCI } = require('./vdf');

const API = 'https://api.steampowered.com';
const TIMEOUT_MS = 10000;
const STATE = { 0: 'offline', 1: 'online', 2: 'busy', 3: 'away', 4: 'snooze', 5: 'online', 6: 'online' };
const STATE_RANK = { ingame: 0, online: 1, busy: 1, away: 1, snooze: 1, offline: 2 };

let steamRootCache;

// Synchronous Steam root lookup (detectSteamId is sync so the UI can call it either way).
function steamRootSync() {
  if (steamRootCache !== undefined) return steamRootCache;
  const ok = (p) => { try { return !!p && fs.existsSync(path.join(p, 'config')); } catch { return false; } };
  const reg = (key, name) => {
    try {
      const out = execFileSync('reg.exe', ['query', key, '/v', name], { encoding: 'utf8', windowsHide: true, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = out.match(new RegExp(`^\\s+${name}\\s+REG_\\w+\\s+(.*)$`, 'mi'));
      return m ? m[1].trim() : null;
    } catch { return null; }
  };
  const candidates = [
    reg('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    reg('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
  ];
  steamRootCache = null;
  for (const c of candidates) if (ok(c)) { steamRootCache = path.normalize(c); break; }
  return steamRootCache;
}

function detectSteamId(steamRoot) {
  const root = steamRoot || steamRootSync();
  if (!root) return null;
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8'));
    const users = getCI(vdf, 'users') || {};
    const ids = Object.keys(users).filter((k) => /^\d{17}$/.test(k));
    if (!ids.length) return null;
    const recent = ids.find((id) => String(getCI(users[id], 'MostRecent')) === '1');
    if (recent) return recent;
    // No MostRecent flag: newest Timestamp, else first entry.
    let best = ids[0];
    let bestTs = Number(getCI(users[best], 'Timestamp') || 0);
    for (const id of ids) {
      const ts = Number(getCI(users[id], 'Timestamp') || 0);
      if (ts > bestTs) { best = id; bestTs = ts; }
    }
    return best;
  } catch { return null; }
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(pathname, params) {
  const qs = new URLSearchParams({ format: 'json', ...params });
  let res;
  try {
    res = await fetch(`${API}${pathname}?${qs}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ApiError(0, err && err.name === 'TimeoutError' ? 'Steam did not respond in time.' : "Couldn't reach Steam. Check your network connection.");
  }
  if (!res.ok) throw new ApiError(res.status, `Steam returned HTTP ${res.status}`);
  try { return await res.json(); } catch { throw new ApiError(res.status, 'Steam returned an unreadable response.'); }
}

function person(p) {
  const inGame = !!(p.gameid || p.gameextrainfo);
  const state = inGame ? 'ingame' : (STATE[p.personastate] || 'offline');
  return {
    steamId: String(p.steamid),
    name: p.personaname || 'Unknown',
    avatarUrl: p.avatarfull || p.avatarmedium || p.avatar || null,
    state,
    game: inGame ? { appid: p.gameid ? String(p.gameid) : null, name: p.gameextrainfo || null } : null,
    lastOnline: p.lastlogoff ? p.lastlogoff * 1000 : null,
    profileUrl: p.profileurl || `https://steamcommunity.com/profiles/${p.steamid}/`,
    visibility: p.communityvisibilitystate === 3 ? 'public' : 'private',
  };
}

async function summaries(apiKey, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const j = await api('/ISteamUser/GetPlayerSummaries/v2/', { key: apiKey, steamids: ids.slice(i, i + 100).join(',') });
    for (const p of (j.response && j.response.players) || []) out.push(person(p));
  }
  return out;
}

function sortFriends(list) {
  return list.sort((a, b) => {
    const r = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (r) return r;
    if (a.state === 'offline') {
      const d = (b.lastOnline || 0) - (a.lastOnline || 0);
      if (d) return d;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

function keyError(err) {
  if (err.status === 401 || err.status === 403) return 'Your Steam Web API key was rejected. Check the key in Settings.';
  if (err.status === 429) return 'Steam is rate-limiting requests. Try again in a minute.';
  return err.message || 'Something went wrong talking to Steam.';
}

async function getFriends({ apiKey, steamId } = {}) {
  apiKey = String(apiKey || '').trim();
  if (!apiKey) return { needsKey: true };
  steamId = String(steamId || detectSteamId() || '').trim();
  if (!/^\d{17}$/.test(steamId)) return { friends: [], error: "Couldn't find your Steam account. Sign in to Steam on this PC or enter your SteamID64." };

  let self;
  try {
    [self] = await summaries(apiKey, [steamId]);
    if (!self) return { friends: [], error: "Steam doesn't know that account. Check your SteamID64." };
  } catch (err) {
    return { friends: [], error: keyError(err) };
  }

  let ids;
  try {
    const j = await api('/ISteamUser/GetFriendList/v1/', { key: apiKey, steamid: steamId, relationship: 'friend' });
    ids = ((j.friendslist && j.friendslist.friends) || []).map((f) => String(f.steamid));
  } catch (err) {
    // Key already proved valid above, so 401/403 here means the friends list is hidden.
    const msg = err.status === 401 || err.status === 403
      ? 'Your Steam friends list is private. Set "Friends List" to Public in your Steam profile privacy settings.'
      : keyError(err);
    return { self, friends: [], error: msg };
  }
  if (!ids.length) return { self, friends: [] };

  try {
    return { self, friends: sortFriends(await summaries(apiKey, ids)) };
  } catch (err) {
    return { self, friends: [], error: keyError(err) };
  }
}

async function getRecentGames({ apiKey, steamId } = {}) {
  apiKey = String(apiKey || '').trim();
  steamId = String(steamId || detectSteamId() || '').trim();
  if (!apiKey || !/^\d{17}$/.test(steamId)) return [];
  try {
    const j = await api('/IPlayerService/GetRecentlyPlayedGames/v1/', { key: apiKey, steamid: steamId });
    return ((j.response && j.response.games) || []).map((g) => ({
      appid: String(g.appid),
      name: g.name || `Steam App ${g.appid}`,
      playtime2weeksMin: g.playtime_2weeks || 0,
      playtimeForeverMin: g.playtime_forever || 0,
      iconUrl: g.img_icon_url ? `https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg` : null,
    }));
  } catch { return []; }
}

module.exports = { detectSteamId, getFriends, getRecentGames };
