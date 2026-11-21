// Humble Bundle connector: uses your humblebundle.com session cookies to list DRM-free
// Windows downloads from your purchases and bundles.
const BASE = 'https://www.humblebundle.com';
// Electron's session fetch throws on a refused redirect (signed-out pages redirect to login).
async function get(ses, url) {
  try { return await ses.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch (e) { if (/redirect/i.test(e.message)) return { status: 302, ok: false, json: async () => ({}) }; throw e; }
}


async function orders(ses) {
  const r = await get(ses, `${BASE}/api/v1/user/order`);
  if (r.status !== 200) throw new Error('Not signed in to Humble Bundle');
  const keys = (await r.json()).map((o) => o.gamekey).filter(Boolean);
  const out = [];
  for (let i = 0; i < keys.length; i += 40) {
    const q = keys.slice(i, i + 40).map((k) => `gamekeys=${encodeURIComponent(k)}`).join('&');
    const rr = await ses.fetch(`${BASE}/api/v1/orders?all_tpkds=true&${q}`, { signal: AbortSignal.timeout(20000) });
    if (!rr.ok) continue;
    const j = await rr.json();
    out.push(...Object.values(j));
  }
  return out;
}

function windowsProducts(orderList) {
  const map = new Map();
  for (const o of orderList) {
    for (const sp of o.subproducts || []) {
      const win = (sp.downloads || []).filter((d) => d.platform === 'windows' && (d.download_struct || []).some((s) => s.url && s.url.web));
      if (!win.length || map.has(sp.machine_name)) continue;
      map.set(sp.machine_name, { sp, win, gamekey: o.gamekey });
    }
  }
  return map;
}

module.exports = {
  id: 'humble',
  name: 'Humble Bundle',
  color: '#cc2929',
  signInUrl: `${BASE}/login`,
  about: 'DRM-free Windows downloads from your Humble purchases and bundles (Steam keys stay on Steam).',

  async status(ses) {
    const r = await get(ses, `${BASE}/api/v1/user/order`);
    return { signedIn: r.status === 200, user: '' };
  },

  async library(ses) {
    const map = windowsProducts(await orders(ses));
    return [...map.entries()].map(([id, { sp }]) => ({
      id,
      title: sp.human_name,
      image: sp.icon || null,
      hero: sp.icon || null,
      windows: true,
      url: sp.url || BASE,
    }));
  },

  async downloads(ses, game) {
    // Download links are signed and expire, so always fetch fresh ones.
    const entry = windowsProducts(await orders(ses)).get(game.id);
    if (!entry) throw new Error('Download not found');
    const options = [];
    for (const d of entry.win) {
      for (const s of d.download_struct || []) {
        if (!s.url || !s.url.web) continue;
        const name = decodeURIComponent(s.url.web.split('?')[0].split('/').pop());
        options.push({ id: `${d.machine_name}-${options.length}`, label: `${s.name || 'Download'} · ${name}`, size: s.file_size || 0, files: [{ url: s.url.web, name, size: s.file_size || 0 }], install: 'auto' });
      }
    }
    return { title: game.title, hero: game.hero, options };
  },
};
