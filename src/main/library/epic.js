// Epic Games Store: %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests\*.item (JSON)
const fs = require('fs');
const path = require('path');
const { sortTitle } = require('./util');

async function scan() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); }
  catch { return { ok: true, games: [], note: 'Epic Games Launcher not installed' }; }

  const games = [];
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      const cats = (m.AppCategories || []).map((c) => String(c).toLowerCase());
      if (!cats.includes('games')) continue;
      if (m.bIsIncompleteInstall) continue;
      if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue; // DLC
      if (!m.InstallLocation || !fs.existsSync(m.InstallLocation)) continue;
      const exe = m.LaunchExecutable ? path.join(m.InstallLocation, m.LaunchExecutable) : null;
      const appRef = [m.CatalogNamespace, m.CatalogItemId, m.AppName].map(encodeURIComponent).join('%3A');
      games.push({
        id: `epic:${m.AppName}`,
        source: 'epic',
        title: m.DisplayName || m.AppName,
        sortTitle: sortTitle(m.DisplayName || m.AppName),
        installDir: m.InstallLocation,
        launch: { type: 'url', target: `com.epicgames.launcher://apps/${appRef}?action=launch&silent=true` },
        watch: { dirs: [m.InstallLocation], exes: exe ? [path.basename(exe)] : [] },
        sizeOnDisk: Number(m.InstallSize || 0),
        epicCatalogItemId: m.CatalogItemId || undefined,
        epicNamespace: m.CatalogNamespace || undefined,
      });
    } catch { /* skip */ }
  }
  return { ok: true, games };
}

module.exports = { scan };
