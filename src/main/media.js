// Media blade apps: TV-style web apps (Firefox with your profile, or Edge), the built-in
// YouTube TV mode, and detected desktop media apps.
const fs = require('fs');
const path = require('path');
const { hash } = require('./library/util');
const { TV_UA } = require('./tvbrowser');

function firstExisting(list) { return list.find((p) => p && fs.existsSync(p)); }

function firefoxPath() {
  const PF = process.env.ProgramFiles || 'C:\\Program Files';
  const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  return firstExisting([
    path.join(PF, 'Mozilla Firefox', 'firefox.exe'),
    path.join(PF86, 'Mozilla Firefox', 'firefox.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Mozilla Firefox', 'firefox.exe'),
  ]);
}

function edgePath() {
  return firstExisting([
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ]);
}

function browsers() { return { firefox: firefoxPath() || null, edge: edgePath() || null }; }

function list(settings, userDataDir) {
  const out = [];
  const b = browsers();
  const pref = settings.get('media.browser') || 'auto';
  const engine = pref === 'edge' ? (b.edge ? 'edge' : 'firefox') : pref === 'firefox' ? (b.firefox ? 'firefox' : 'edge') : (b.firefox ? 'firefox' : 'edge');

  const web = (id, title, url, color, glyph, extra = {}) => {
    if (engine === 'firefox' && b.firefox) {
      // Your normal Firefox profile: sign-ins, extensions (e.g. uBlock Origin) all apply.
      out.push({
        id: `media:${id}`, title, color, glyph, subtitle: 'Firefox', engine: 'firefox', controllerMouse: true, url,
        launch: { type: 'exe', target: b.firefox, args: ['--kiosk', url], cwd: path.dirname(b.firefox) },
        watch: { dirs: [], exes: ['firefox.exe'] },
        ...extra,
      });
    } else if (b.edge) {
      const args = ['--kiosk', url, '--edge-kiosk-type=fullscreen', '--no-first-run', `--user-data-dir=${path.join(userDataDir, 'edge-kiosk')}`];
      out.push({
        id: `media:${id}`, title, color, glyph, subtitle: 'Edge', engine: 'edge', controllerMouse: true, url,
        launch: { type: 'exe', target: b.edge, args, cwd: path.dirname(b.edge) },
        watch: { dirs: [], exes: [] },
        ...extra,
      });
    }
  };
  const exe = (id, title, file, color, glyph) => {
    if (!file || !fs.existsSync(file)) return;
    out.push({ id: `media:${id}`, title, color, glyph, subtitle: 'App', controllerMouse: true, launch: { type: 'exe', target: file, args: [], cwd: path.dirname(file) }, watch: { dirs: [path.dirname(file)], exes: [] } });
  };
  const PF = process.env.ProgramFiles || 'C:\\Program Files';
  const PF86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const APPDATA = process.env.APPDATA || '';
  const LOCAL = process.env.LOCALAPPDATA || '';

  out.push({
    id: 'media:youtubetv', title: 'YouTube TV mode', color: '#c4302b', glyph: 'play', subtitle: 'Built-in · controller ready · ad blocking',
    launch: { type: 'internal', target: 'https://www.youtube.com/tv' }, ua: TV_UA, watch: { dirs: [], exes: [] },
  });
  web('youtube', 'YouTube', 'https://www.youtube.com', '#a3231f', 'play');
  web('netflix', 'Netflix', 'https://www.netflix.com/browse', '#8f0d12', 'film');
  web('twitch', 'Twitch', 'https://www.twitch.tv', '#6441a5', 'live');
  web('disney', 'Disney+', 'https://www.disneyplus.com', '#1a3f8f', 'film');
  web('prime', 'Prime Video', 'https://www.primevideo.com', '#1a6c9c', 'film');
  web('spotifyweb', 'Spotify Web', 'https://open.spotify.com', '#1a9d4c', 'music');
  exe('spotify', 'Spotify', path.join(APPDATA, 'Spotify', 'Spotify.exe'), '#1a9d4c', 'music');
  exe('vlc', 'VLC', path.join(PF, 'VideoLAN', 'VLC', 'vlc.exe'), '#d86b00', 'film');
  exe('vlc86', 'VLC', path.join(PF86, 'VideoLAN', 'VLC', 'vlc.exe'), '#d86b00', 'film');
  exe('kodi', 'Kodi', path.join(PF, 'Kodi', 'kodi.exe'), '#1c7aa6', 'tv');
  exe('plexhtpc', 'Plex HTPC', path.join(PF, 'Plex', 'Plex HTPC', 'Plex HTPC.exe'), '#c98f05', 'tv');
  exe('plex', 'Plex', path.join(LOCAL, 'Programs', 'plex', 'Plex.exe'), '#c98f05', 'tv');
  exe('jellyfin', 'Jellyfin', path.join(PF, 'Jellyfin', 'Jellyfin Media Player', 'JellyfinMediaPlayer.exe'), '#6a3fa8', 'tv');

  for (const c of settings.get('media.custom') || []) {
    if (c.url) web(`custom-${hash(c.url)}`, c.title || c.url, c.url, c.color || '#3a6ea5', 'globe', { custom: true });
    else if (c.exe) {
      // exe() skips a missing file; only patch the entry it actually added.
      const before = out.length;
      exe(`custom-${hash(c.exe)}`, c.title || path.basename(c.exe), c.exe, c.color || '#3a6ea5', 'app');
      const added = out.length > before ? out[out.length - 1] : null;
      if (added) { added.custom = true; if (c.args) added.launch.args = c.args; }
    }
  }
  const seen = new Set();
  return out.filter((m) => (seen.has(m.title) ? false : seen.add(m.title)));
}

module.exports = { list, browsers };
