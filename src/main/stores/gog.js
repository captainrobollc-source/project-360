// GOG connector: uses the gog.com session cookies from the in-app sign-in window.
const BASE = 'https://www.gog.com';
// Electron's session fetch throws on a refused redirect (signed-out pages redirect to login).
async function get(ses, url) {
  try { return await ses.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch (e) { if (/redirect/i.test(e.message)) return { status: 302, ok: false, json: async () => ({}) }; throw e; }
}


function parseSize(s) {
  const m = String(s || '').match(/([\d.]+)\s*(KB|MB|GB|TB)/i);
  if (!m) return 0;
  return Math.round(parseFloat(m[1]) * { KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()]);
}

module.exports = {
  id: 'gog',
  name: 'GOG',
  color: '#86328a',
  signInUrl: `${BASE}/en##openlogin`,
  about: 'DRM-free games you own on GOG.com. Installers download and install silently.',

  async status(ses) {
    const j = await (await ses.fetch(`${BASE}/userData.json`, { signal: AbortSignal.timeout(15000) })).json();
    return { signedIn: !!j.isLoggedIn, user: j.username || '' };
  },

  async library(ses) {
    const out = [];
    let page = 1, total = 1;
    do {
      const r = await get(ses, `${BASE}/account/getFilteredProducts?mediaType=1&sortBy=title&page=${page}`);
      if (r.status !== 200) throw new Error('Not signed in to GOG');
      const j = await r.json();
      total = j.totalPages || 1;
      for (const p of j.products || []) {
        out.push({
          id: String(p.id),
          title: p.title,
          image: p.image ? `https:${p.image}_392.jpg` : null,
          hero: p.image ? `https:${p.image}_bg_crop_1366x655.jpg` : null,
          windows: !!(p.worksOn && p.worksOn.Windows),
          url: `${BASE}${p.url || ''}`,
          localId: `gog:${p.id}`,
        });
      }
      page++;
    } while (page <= total && page <= 60);
    return out;
  },

  async downloads(ses, game) {
    const r = await get(ses, `${BASE}/account/gameDetails/${game.id}.json`);
    if (r.status !== 200) throw new Error('Not signed in to GOG');
    const j = await r.json();
    const options = [];
    for (const [lang, oses] of j.downloads || []) {
      const win = (oses && oses.windows) || [];
      if (!win.length) continue;
      const files = win.map((f) => ({ url: `${BASE}${f.manualUrl}`, name: f.name, size: parseSize(f.size) }));
      options.push({
        id: `win-${lang}`,
        label: `Windows installer · ${lang}${win[0].version ? ` · v${win[0].version}` : ''}${win.length > 1 ? ` · ${win.length} parts` : ''}`,
        size: files.reduce((s, f) => s + f.size, 0),
        files,
        install: 'inno',
      });
    }
    return { title: j.title || game.title, hero: j.backgroundImage ? `https:${j.backgroundImage}` : game.hero, options };
  },
};
