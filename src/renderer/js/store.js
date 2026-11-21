// Shared renderer state with simple key-based subscriptions.
export const state = {
  mode: 'dashboard',
  settings: {},
  library: [],
  pads: [],
  launcher: { phase: 'idle' },
  media: [],
  sessions: [],
  soundPacks: [],
  native: null,
  suspended: false,
  achievements: { list: [], totals: { score: 0, max: 0, unlocked: 0, count: 0 } },
  notifications: [],
  nowPlaying: null,
  signedIn: false,
  browsers: {},
  slots: [],       // [{ slot, connected, profileId, gamertag, avatar, score, active }]
  activeSlot: -1,  // controller slot of the active player
};

export function track(event, data) { window.p360.achievements.track(event, data).catch(() => {}); }

const subs = {};

export function on(key, fn) {
  (subs[key] = subs[key] || new Set()).add(fn);
  return () => subs[key].delete(fn);
}

export function set(key, value) {
  state[key] = value;
  for (const fn of subs[key] || []) {
    try { fn(value); } catch (e) { console.error(e); }
  }
}

export function setting(path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), state.settings);
}

export async function saveSetting(path, value) {
  const s = await window.p360.settings.set(path, value);
  set('settings', s);
  return s;
}

export function gameById(id) { return state.library.find((g) => g.id === id); }

export function visibleGames() {
  const showHidden = setting('library.showHidden');
  return state.library.filter((g) => showHidden || !g.hidden);
}

export function recentGames(n = 5) {
  return visibleGames().filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n);
}
