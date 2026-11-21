// GOG Galaxy / offline installers: HKLM\SOFTWARE\WOW6432Node\GOG.com\Games\<id>
const path = require('path');
const { regQuery, exists, sortTitle } = require('./util');

async function scan() {
  const keys = {
    ...(await regQuery('HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', true)),
    ...(await regQuery('HKLM\\SOFTWARE\\GOG.com\\Games', true)),
  };
  const games = [];
  const seen = new Set();
  for (const [key, v] of Object.entries(keys)) {
    const gameId = v.gameID || key.split('\\').pop();
    if (!v.gameName || !v.exe || seen.has(gameId)) continue;
    if (v.dependsOn && v.dependsOn.trim()) continue; // DLC
    if (!exists(v.exe)) continue;
    seen.add(gameId);
    const dir = v.path || path.dirname(v.exe);
    games.push({
      id: `gog:${gameId}`,
      source: 'gog',
      title: v.gameName,
      sortTitle: sortTitle(v.gameName),
      installDir: dir,
      launch: {
        type: 'exe',
        target: v.exe,
        args: v.launchParam ? (v.launchParam.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map((a) => a.replace(/^"|"$/g, '')) : [],
        cwd: v.workingDir || path.dirname(v.exe),
      },
      watch: { dirs: [dir], exes: [path.basename(v.exe)] },
    });
  }
  return { ok: true, games };
}

module.exports = { scan };
