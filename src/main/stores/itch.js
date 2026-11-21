// itch.io connector: sign in on itch.io; the app then reads (or creates) an API key from your
// account settings and uses the official API for owned games and uploads.
const { BrowserWindow } = require('electron');

const API = 'https://api.itch.io';
const KEY_RE = /^[A-Za-z0-9]{32,64}$/;
// Electron's session fetch throws on a refused redirect (signed-out pages redirect to login).
async function get(ses, url) {
  try { return await ses.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000) }); }
  catch (e) { if (/redirect/i.test(e.message)) return { status: 302, ok: false, json: async () => ({}) }; throw e; }
}


async function pageKeys(ses) {
  const win = new BrowserWindow({ show: false, webPreferences: { session: ses, contextIsolation: true, sandbox: true } });
  try {
    await win.loadURL('https://itch.io/user/settings/api-keys');
    if (/login/.test(win.webContents.getURL())) return { keys: [], signedIn: false };
    const read = () => win.webContents.executeJavaScript(`(() => {
      const vals = [...document.querySelectorAll('input, code, td, .api_key, span')].map((e) => (e.value || e.textContent || '').trim());
      return [...new Set(vals.filter((s) => /^[A-Za-z0-9]{32,64}$/.test(s)))];
    })()`);
    let keys = await read();
    if (!keys.length) {
      // No key yet: press the page's own "Generate new API key" button.
      const clicked = await win.webContents.executeJavaScript(`(() => {
        const btn = [...document.querySelectorAll('button, input[type=submit]')].find((b) => /generate|new api key/i.test(b.textContent || b.value || ''));
        if (btn) { btn.click(); return true; }
        const f = [...document.forms].find((f) => /api.?keys/i.test(f.action));
        if (f) { f.submit(); return true; }
        return false;
      })()`);
      if (clicked) {
        await new Promise((r) => setTimeout(r, 2500));
        keys = await read();
      }
    }
    return { keys, signedIn: true };
  } finally {
    win.destroy();
  }
}

module.exports = {
  id: 'itch',
  name: 'itch.io',
  color: '#fa5c5c',
  signInUrl: 'https://itch.io/login',
  about: 'Games you bought or claimed on itch.io. ZIP downloads are extracted and added to your library.',

  // ctx: { getKey(), setKey(k) } persisted by the store manager
  async apiKey(ses, ctx, { create = false } = {}) {
    const saved = ctx.getKey();
    if (saved) return saved;
    if (!create) return null;
    const { keys } = await pageKeys(ses);
    if (keys[0]) ctx.setKey(keys[0]);
    return keys[0] || null;
  },

  async status(ses, ctx, retried = false) {
    const key = await this.apiKey(ses, ctx);
    if (key) {
      const r = await fetch(`${API}/profile`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (r.ok) { const j = await r.json(); return { signedIn: true, user: (j.user && (j.user.display_name || j.user.username)) || '' }; }
      // Only a rejected key is thrown away; an outage (5xx / 429) keeps it and reports the error.
      if (r.status !== 401 && r.status !== 403) return { signedIn: false, error: `itch.io is having trouble (HTTP ${r.status}). Try again later.` };
      ctx.setKey('');
    }
    if (retried) return { signedIn: false, error: 'Signed in, but itch.io didn’t accept the API key.' };
    // Signed in on the site but no key yet? Try to read/create one now.
    const r = await get(ses, 'https://itch.io/user/settings/api-keys');
    if (r.status !== 200) return { signedIn: false };
    const k = await this.apiKey(ses, ctx, { create: true });
    return k ? this.status(ses, ctx, true) : { signedIn: false, error: 'Signed in, but no API key could be created. Add one in itch.io › Settings › API keys.' };
  },

  async library(ses, ctx) {
    const key = await this.apiKey(ses, ctx, { create: true });
    if (!key) throw new Error('Not signed in to itch.io');
    const out = [];
    const seen = new Set();
    for (let page = 1; page <= 50; page++) {
      const r = await fetch(`${API}/profile/owned-keys?page=${page}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`itch.io API error ${r.status}`);
      const j = await r.json();
      const list = j.owned_keys || [];
      for (const k of list) {
        const g = k.game || {};
        if (!g.id || seen.has(g.id)) continue;
        seen.add(g.id);
        out.push({
          id: String(g.id),
          keyId: String(k.id),
          title: g.title,
          image: g.cover_url || g.still_cover_url || null,
          hero: g.cover_url || null,
          windows: g.p_windows !== false,
          url: g.url,
        });
      }
      if (list.length < (j.per_page || 50)) break;
    }
    return out;
  },

  async downloads(ses, game, ctx) {
    const key = await this.apiKey(ses, ctx, { create: true });
    if (!key) throw new Error('Not signed in to itch.io');
    const r = await fetch(`${API}/games/${game.id}/uploads?download_key_id=${game.keyId}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`itch.io API error ${r.status}`);
    const j = await r.json();
    const ups = (j.uploads || []).filter((u) => (u.traits || []).includes('p_windows') || /\.(exe|zip|msi)$/i.test(u.filename || ''));
    return {
      title: game.title,
      hero: game.hero,
      options: ups.map((u) => ({
        id: String(u.id),
        label: `${u.display_name || u.filename}${u.build && u.build.user_version ? ` · v${u.build.user_version}` : ''}`,
        size: u.size || 0,
        files: [{ url: `${API}/uploads/${u.id}/download?download_key_id=${game.keyId}`, headers: { Authorization: `Bearer ${key}` }, name: u.filename, size: u.size || 0 }],
        install: 'auto',
      })),
    };
  },
};

module.exports.KEY_RE = KEY_RE;
