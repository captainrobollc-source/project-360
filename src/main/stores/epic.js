// Epic Games connector: every game you own on Epic, read from the Epic Games Launcher's local
// catalog cache (no sign-in needed here). Installs go through the Epic Games Launcher.
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

function catalog() {
  const files = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin'),
    path.join(process.env.LOCALAPPDATA || '', 'EpicGamesLauncher', 'Saved', 'Data', 'Catalog', 'catcache.bin'),
  ];
  for (const f of files) {
    try {
      const raw = fs.readFileSync(f, 'utf8').trim();
      const items = JSON.parse(raw.startsWith('[') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
      if (Array.isArray(items)) return items;
    } catch { /* next */ }
  }
  return null;
}

const MANIFESTS = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
const isGame = (it) => !(it.mainGameItem && it.mainGameItem.id) && (it.categories || []).some((c) => c && c.path === 'games');
const img = (it, ...types) => { for (const t of types) { const k = (it.keyImages || []).find((x) => x.type === t); if (k) return k.url; } return null; };

module.exports = {
  id: 'epic',
  name: 'Epic Games',
  color: '#313131',
  client: 'Epic Games Launcher',
  signInUrl: null, // uses the Epic Games Launcher's account
  about: 'Every game you own on Epic, including free giveaways you claimed. Installs run through the Epic Games Launcher.',

  async status() {
    const items = catalog();
    if (!items) return { signedIn: false, error: 'Install the Epic Games Launcher and sign in there' };
    return { signedIn: true, user: '', mode: 'launcher', note: 'From the Epic Games Launcher on this PC' };
  },

  async library() {
    const items = catalog() || [];
    const out = [];
    const seen = new Set();
    for (const it of items) {
      if (!isGame(it)) continue;
      const appName = ((it.releaseInfo || []).find((r) => (r.platform || []).includes('Windows')) || (it.releaseInfo || [])[0] || {}).appId;
      if (!appName || seen.has(appName)) continue;
      seen.add(appName);
      out.push({
        id: appName,
        itemId: it.id,
        namespace: it.namespace,
        title: String(it.title || appName).replace(/\?+$/, '').trim(),
        image: img(it, 'DieselGameBox', 'OfferImageWide', 'DieselStoreFrontWide', 'Thumbnail'),
        cover: img(it, 'DieselGameBoxTall', 'OfferImageTall'),
        hero: img(it, 'DieselGameBox', 'OfferImageWide'),
        windows: (it.releaseInfo || []).some((r) => (r.platform || []).includes('Windows')),
        url: null,
        localId: `epic:${appName}`,
      });
    }
    return out;
  },

  async downloads(ses, game) {
    return { title: game.title, hero: game.hero, options: [{ id: 'client', label: 'Install with the Epic Games Launcher', client: true, size: 0, files: [] }] };
  },

  async installClient(game) {
    const ref = [game.namespace, game.itemId, game.id].map(encodeURIComponent).join('%3A');
    await shell.openExternal(`com.epicgames.launcher://apps/${ref}?action=install`);
  },

  async progress(game) {
    try {
      for (const f of fs.readdirSync(MANIFESTS).filter((x) => x.endsWith('.item'))) {
        const m = JSON.parse(fs.readFileSync(path.join(MANIFESTS, f), 'utf8'));
        if (m.AppName !== game.id) continue;
        return m.bIsIncompleteInstall ? { state: 'downloading', received: 0, total: Number(m.InstallSize || 0) } : { state: 'installed' };
      }
    } catch { /* launcher not installed */ }
    return null;
  },
};
