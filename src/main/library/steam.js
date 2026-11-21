// Steam: registry -> libraryfolders.vdf -> appmanifest_*.acf
const fs = require('fs');
const path = require('path');
const { parseVdf, getCI } = require('../vdf');
const { regValue, exists, sortTitle } = require('./util');

const TOOL_APPIDS = new Set(['228980', '250820', '1070560', '1391110', '1628350', '1493710', '1826330', '1887720', '2180100', '961940', '858280', '1054830', '1113280', '1245040', '1420170', '1580130', '2230260', '2348590']);
const TOOL_NAME = /redistributable|steamworks|dedicated server|soundtrack|^proton\b|steam linux runtime|steamvr|\bsdk\b|benchmark tool|wallpaper engine editor/i;

async function findSteamRoot() {
  const candidates = [
    await regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath'),
    await regValue('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'),
    await regValue('HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'),
    'C:\\Program Files (x86)\\Steam',
  ];
  for (const c of candidates) if (c && exists(path.join(c, 'steamapps'))) return path.normalize(c);
  return null;
}

async function scan() {
  const root = await findSteamRoot();
  if (!root) return { ok: true, games: [], note: 'Steam not installed' };

  const libs = new Set([path.join(root, 'steamapps')]);
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    const lf = getCI(vdf, 'libraryfolders') || {};
    for (const entry of Object.values(lf)) {
      const p = typeof entry === 'string' ? entry : getCI(entry, 'path');
      if (p && exists(path.join(p, 'steamapps'))) libs.add(path.join(path.normalize(p), 'steamapps'));
    }
  } catch { /* single library */ }

  const games = [];
  const seen = new Set();
  for (const lib of libs) {
    let files = [];
    try { files = fs.readdirSync(lib).filter((f) => /^appmanifest_\d+\.acf$/i.test(f)); } catch { continue; }
    for (const f of files) {
      try {
        const acf = getCI(parseVdf(fs.readFileSync(path.join(lib, f), 'utf8')), 'AppState');
        if (!acf) continue;
        const appid = String(getCI(acf, 'appid'));
        const name = getCI(acf, 'name') || `Steam App ${appid}`;
        const flags = parseInt(getCI(acf, 'StateFlags') || '0', 10);
        if (seen.has(appid) || TOOL_APPIDS.has(appid) || TOOL_NAME.test(name)) continue;
        if (!(flags & 4)) continue; // not fully installed
        seen.add(appid);
        const installDir = path.join(lib, 'common', getCI(acf, 'installdir') || '');
        games.push({
          id: `steam:${appid}`,
          source: 'steam',
          title: name,
          sortTitle: sortTitle(name),
          installDir,
          steamAppId: appid,
          launch: { type: 'url', target: `steam://rungameid/${appid}` },
          watch: { dirs: [installDir], exes: [] },
          sizeOnDisk: Number(getCI(acf, 'SizeOnDisk') || 0),
        });
      } catch { /* bad manifest */ }
    }
  }
  return { ok: true, games };
}

module.exports = { scan, findSteamRoot };
