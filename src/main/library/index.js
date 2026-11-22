// Unified library: merges scanner output, persists it, and joins per-game user data.
const { EventEmitter } = require('events');
const path = require('path');
const { JsonStore } = require('../store');

const SCANNERS = {
  steam: require('./steam'),
  epic: require('./epic'),
  gog: require('./gog'),
  xbox: require('./xbox'),
  custom: require('./custom'),
};

class Library extends EventEmitter {
  constructor(userDataDir, settings) {
    super();
    this.settings = settings;
    this.lib = new JsonStore(path.join(userDataDir, 'library.json'), { games: {}, lastScan: 0 });
    this.user = new JsonStore(path.join(userDataDir, 'userdata.json'), { profiles: {} });
    // Migrate the pre-profiles layout ({ games, sessions }) into the first profile.
    if (this.user.data.games || this.user.data.sessions) {
      this.user.data.profiles.p1 = { games: this.user.data.games || {}, sessions: this.user.data.sessions || [], ...(this.user.data.profiles.p1 || {}) };
      delete this.user.data.games;
      delete this.user.data.sessions;
      this.user.save();
    }
    this.profileId = 'p1';
    this.scanning = null;
    this.extra = {}; // additional scanners registered at runtime (e.g. emulation)
  }

  registerScanner(name, scanner) { this.extra[name] = scanner; }

  setProfile(id) { this.profileId = id; this.emit('changed'); }

  // Per-profile user data: favorites, playtime, sessions, achievements, stats.
  profileData(id = this.profileId) {
    const all = this.user.data.profiles;
    const d = all[id] || (all[id] = {});
    d.games = d.games || {};
    d.sessions = d.sessions || [];
    return d;
  }

  deleteProfileData(id) { delete this.user.data.profiles[id]; this.user.save(); }

  sessions() { return this.profileData().sessions; }

  games() { return this.lib.get('games'); }
  game(id) { return this.games()[id]; }
  userOf(id) { return this.profileData().games[id] || {}; }

  patchUser(id, patch) {
    const all = this.profileData().games;
    all[id] = { ...(all[id] || {}), ...patch };
    this.user.save();
    this.emit('changed');
    return all[id];
  }

  // Games whose id changes (emulated games after their folder moved): carry over the library
  // entry and every profile's playtime, favorites and session history.
  // map: { oldId: { id: newId, patch: { ...fields to update } } }
  remapIds(map) {
    const moves = Object.entries(map || {}).filter(([a, m]) => m && m.id && m.id !== a);
    if (!moves.length) return 0;
    const games = this.lib.data.games;
    for (const [a, m] of moves) {
      const g = games[a];
      if (!g) continue;
      delete games[a];
      games[m.id] = { ...g, ...(m.patch || {}), id: m.id };
    }
    const ren = new Map(moves.map(([a, m]) => [a, m.id]));
    for (const p of Object.values(this.user.data.profiles || {})) {
      if (p.games) {
        for (const [a, b] of ren) {
          if (!p.games[a]) continue;
          p.games[b] = { ...(p.games[b] || {}), ...p.games[a] };
          delete p.games[a];
        }
      }
      if (Array.isArray(p.sessions)) for (const s of p.sessions) if (s && ren.has(s.id)) s.id = ren.get(s.id);
    }
    this.lib.save();
    this.user.save();
    this.emit('changed');
    return moves.length;
  }

  patchGame(id, patch) {
    const g = this.game(id);
    if (!g) return;
    Object.assign(g, patch);
    this.lib.save();
    this.emit('changed');
  }

  async scan() {
    if (this.scanning) {
      if (!this.rescanAfter) {
        const again = () => { this.rescanAfter = null; return this.scan(); };
        this.rescanAfter = this.scanning.then(again, again); // even if the running scan failed
      }
      return this.rescanAfter;
    }
    this.scanning = (async () => {
      const cfg = this.settings.get('library');
      const old = this.games();
      const next = {};
      const okSources = new Set();
      const removed = { ...(this.lib.data.removed || {}) };
      const wasRemoved = new Set(Object.keys(removed));
      const all = { ...SCANNERS, ...this.extra };
      const results = await Promise.all(Object.entries(all).map(async ([name, s]) => {
        if (SCANNERS[name] ? !cfg[name] : cfg[name] === false) return [name, { ok: true, games: [] }];
        try { return [name, await s.scan(cfg)]; } catch (e) { return [name, { ok: false, games: [], note: e.message }]; }
      }));
      for (const [name, res] of results) {
        if (res.ok) okSources.add(name);
        for (const g of res.games || []) {
          if (next[g.id]) continue; // first scanner wins (e.g. Steam over a steam:// .url)
          const prev = old[g.id] || removed[g.id] || {};
          next[g.id] = {
            ...g,
            addedAt: prev.addedAt || Date.now(),
            art: prev.art || {},
            meta: prev.meta || g.meta || null,
            artTried: prev.artTried || 0,
            artVersion: prev.artVersion,
            artSources: prev.artSources,
            artManual: prev.artManual,
          };
        }
      }
      // Keep entries from sources that failed this time so a flaky scan doesn't wipe them.
      for (const [id, g] of Object.entries(old)) {
        const src = g.systemId ? 'emulation' : g.source === 'local' || g.source === 'rom' ? 'custom' : g.source;
        if (!next[id] && !okSources.has(src) && cfg[src] !== false) next[id] = g;
      }
      // Games that vanish (drive not mounted yet, Steam rewriting libraryfolders.vdf) keep their
      // art, metadata and added date for 30 days, so a re-appearance isn't a "new game" re-fetch.
      const now = Date.now();
      for (const [id, g] of Object.entries(old)) {
        if (!next[id]) removed[id] = { addedAt: g.addedAt, art: g.art, meta: g.meta, artTried: g.artTried, artVersion: g.artVersion, artSources: g.artSources, artManual: g.artManual, removedAt: now };
      }
      for (const id of Object.keys(removed)) if (next[id] || now - (removed[id].removedAt || 0) > 30 * 86400000) delete removed[id];
      const added = Object.keys(next).filter((id) => !old[id] && !wasRemoved.has(id));
      this.lib.replace({ games: next, lastScan: now, removed });
      this.emit('changed');
      this.emit('scanned', { added, total: Object.keys(next).length, notes: results.filter(([, r]) => r.note).map(([n, r]) => `${n}: ${r.note}`) });
      return { added: added.length, total: Object.keys(next).length };
    })().finally(() => { this.scanning = null; });
    return this.scanning;
  }

  recordSession(id, seconds) {
    const u = this.userOf(id);
    this.patchUser(id, {
      playtime: (u.playtime || 0) + seconds,
      lastPlayed: Date.now(),
      launches: (u.launches || 0) + 1,
    });
    const sessions = this.profileData().sessions;
    sessions.unshift({ id, end: Date.now(), seconds });
    sessions.length = Math.min(sessions.length, 100);
    this.user.save();
  }

  // View model sent to the renderer.
  view() {
    const out = [];
    for (const g of Object.values(this.games())) {
      const u = this.userOf(g.id);
      out.push({
        id: g.id,
        source: g.source,
        title: g.title,
        sortTitle: g.sortTitle,
        platform: g.platform,
        installDir: g.installDir,
        sizeOnDisk: g.sizeOnDisk || 0,
        systemId: g.systemId,
        emulator: g.emulator,
        needsEmulator: !!(g.launch && g.launch.type === 'emulator-missing'),
        steamAppId: g.steamAppId,
        addedAt: g.addedAt,
        art: g.art || {},
        artSources: g.artSources || {},
        meta: g.meta,
        favorite: !!u.favorite,
        hidden: !!u.hidden,
        playtime: u.playtime || 0,
        lastPlayed: u.lastPlayed || 0,
        launches: u.launches || 0,
      });
    }
    return out;
  }

  flush() { this.lib.flush(); this.user.flush(); }
}

module.exports = { Library };
