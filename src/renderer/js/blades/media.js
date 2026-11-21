// Media blade: apps (Firefox/Edge web apps, YouTube TV mode, desktop apps), music, pictures, videos.
import { h, fmtAgo } from '../util.js';
import { iconEl, icon, orb } from '../icons.js';
import * as sound from '../sound.js';
import { state, setting, saveSetting } from '../store.js';
import { createSplit } from './split.js';
import { launchMedia } from '../components/launch.js';
import { osk, confirm, button } from '../components/modal.js';
import * as music from '../components/music.js';
import { openPictures, openVideo } from '../components/viewer.js';

function shade(hex, f) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0x3a6ea5;
  const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), g = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}

export function mediaBlade(ctx) {
  let lib = null;
  let scanning = null;
  const scan = (force = false) => {
    if (scanning) return scanning;
    scanning = window.p360.media.scan(force).then((r) => { lib = r; }).catch(() => { lib = { music: [], pictures: [], videos: [] }; }).finally(() => { scanning = null; split.renderList(); });
    return scanning;
  };

  async function addWeb() {
    const title = await osk({ title: 'Name this web app', placeholder: 'e.g. Crunchyroll', maxLength: 30 });
    if (!title) return;
    let url = await osk({ title: `Web address for ${title}`, value: 'https://', maxLength: 300 });
    if (!url || url === 'https://') return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    await saveSetting('media.custom', [...(setting('media.custom') || []), { title, url }]);
    ctx.toast({ title: 'Web app added', text: title, sound: 'select' });
  }

  async function removeCustom(m) {
    const list = setting('media.custom') || [];
    const i = list.findIndex((c) => (c.title || c.url) === m.title);
    if (i < 0) return ctx.toast({ title: 'Built-in app', text: 'Detected apps can’t be removed', sound: 'error', duration: 2400 });
    if (!(await confirm({ title: `Remove ${m.title}?`, buttons: [{ label: 'Remove', value: true, danger: true }, { label: 'Cancel', value: false }] }))) return;
    list.splice(i, 1);
    await saveSetting('media.custom', list);
  }

  const RENDER = {
    apps(pane) {
      const b = state.browsers || {};
      const engine = setting('media.browser') || 'auto';
      pane.append(h('h2', {}, 'apps'), h('div.lead', {}, b.firefox && engine !== 'edge'
        ? 'Web apps open full screen in Firefox with your profile — your sign-ins and ad blocker come along. The left stick moves the pointer, A clicks, B goes back.'
        : 'Web apps open full screen. The left stick moves the pointer, A clicks, B goes back.'));
      const grid = h('div.tilegrid');
      for (const m of state.media) {
        const color = m.color || '#3a6ea5';
        const t = h('div.tile.media-tile', { 'data-focus': '' },
          h('div.frame', { style: { '--m1': shade(color, 1.3), '--m2': shade(color, 0.38) } }, iconEl(m.glyph || 'app'),
            h('div', {}, h('div.t', {}, m.title), h('div.s', {}, m.subtitle || ''))));
        t._activate = () => launchMedia(m);
        t._item = m;
        grid.append(t);
      }
      const add = h('div.tile.media-tile', { 'data-focus': '' }, h('div.frame', { style: { '--m1': '#5b636b', '--m2': '#1a1d21' } }, iconEl('plus'), h('div', {}, h('div.t', {}, 'Add web app'), h('div.s', {}, 'Any site, full screen'))));
      add._activate = addWeb;
      grid.append(add);
      pane.append(grid);
    },
    music(pane) {
      pane.append(h('h2', {}, 'music'));
      if (!lib) { pane.append(h('div.empty-note', {}, 'Looking for music…'), orb('fast')); return; }
      const np = state.nowPlaying;
      if (np && np.track) {
        const fill = h('i', { style: { width: `${np.dur ? (np.pos / np.dur) * 100 : 0}%` } });
        const bar = h('div.nowbar', { 'data-focus': '' }, h('div.art', { html: icon('music') }), h('div.tx', {}, h('div.t', {}, `${np.playing ? 'Now playing' : 'Paused'}: ${np.track.title}`), h('div.s', {}, `${np.track.artist} · ${np.track.album}`), h('div.prog', {}, fill)));
        bar._activate = () => music.toggle();
        bar._adjust = (d) => { if (d > 0) music.next(); else music.prev(); };
        pane.append(bar);
      }
      const tracks = lib.music || [];
      if (!tracks.length) {
        pane.append(h('div.empty-note', { html: 'No music found in your Music folder.<br>Add more folders in <b>System › Media folders</b>.' }));
        return;
      }
      const shuffle = button(`Shuffle all · ${tracks.length} songs`, { icon: 'music', onActivate: () => { music.playList(tracks, 0, { shuffle: true }); ctx.toast({ title: 'Shuffling your music', text: `${tracks.length} songs`, sound: 'select' }); } });
      pane.append(h('div', { style: { maxWidth: '520px', marginBottom: '16px' } }, shuffle));
      const list = h('div.tracklist');
      const cur = music.current();
      tracks.slice(0, 600).forEach((t, i) => {
        const row = h(`div.track${cur && cur.path === t.path ? '.playing' : ''}`, { 'data-focus': '', 'data-key': `track:${t.path}` }, h('span.n', {}, String(i + 1)), h('span.tt', {}, t.title), h('span.ar', {}, `${t.artist} · ${t.album}`));
        row._activate = () => { music.playList(tracks, i); };
        list.append(row);
      });
      pane.append(list);
    },
    pictures(pane) {
      pane.append(h('h2', {}, 'pictures'));
      if (!lib) { pane.append(h('div.empty-note', {}, 'Looking for screenshots and captures…'), orb('fast')); return; }
      const pics = lib.pictures || [];
      if (!pics.length) { pane.append(h('div.empty-note', { html: 'No screenshots or pictures yet.<br>Steam screenshots, Game Bar captures and your Pictures folder show up here.' })); return; }
      pane.append(h('div.lead', {}, `${pics.length} pictures · Steam screenshots, Game Bar and NVIDIA captures, Pictures`));
      const grid = h('div.tilegrid.four');
      pics.slice(0, 400).forEach((p, i) => {
        const frame = h('div.frame', {}, h('img', { src: p.thumb, alt: '', loading: 'lazy' }));
        const t = h('div.tile.pic-tile', { 'data-focus': '' }, frame, h('div.label', {}, h('div.t', {}, p.game || 'Picture'), h('div.s', {}, fmtAgo(p.mtime))));
        t._activate = () => openPictures(pics, i);
        grid.append(t);
      });
      pane.append(grid);
    },
    videos(pane) {
      pane.append(h('h2', {}, 'videos'));
      if (!lib) { pane.append(h('div.empty-note', {}, 'Looking for videos…'), orb('fast')); return; }
      const vids = lib.videos || [];
      if (!vids.length) { pane.append(h('div.empty-note', { html: 'No videos found.<br>Game clips and your Videos folder show up here.' })); return; }
      const grid = h('div.tilegrid.four');
      vids.slice(0, 300).forEach((v) => {
        const frame = h('div.frame', {}, h('img', { src: v.thumb, alt: '', loading: 'lazy' }));
        const t = h('div.tile.pic-tile', { 'data-focus': '' }, frame, h('div.playmark', { html: icon('play') }), h('div.label', {}, h('div.t', {}, v.game || v.path.split('\\').pop()), h('div.s', {}, fmtAgo(v.mtime))));
        t._activate = () => openVideo(v);
        grid.append(t);
      });
      pane.append(grid);
    },
  };

  const split = createSplit({
    sections: () => [
      { id: 'apps', label: 'Apps', icon: 'tv', count: state.media.length },
      { id: 'music', label: 'Music', icon: 'music', count: lib ? lib.music.length : undefined },
      { id: 'pictures', label: 'Pictures', icon: 'image', count: lib ? lib.pictures.length : undefined },
      { id: 'videos', label: 'Videos', icon: 'film', count: lib ? lib.videos.length : undefined },
    ],
    async render(id, pane) {
      if (id !== 'apps' && !lib) scan().then(() => { if (split.current() === id) split.rerender(); });
      RENDER[id](pane);
    },
  });

  return {
    id: 'media',
    label: 'media',
    accent: '#3aa0e8',
    focus: split.focus,
    mount(content) { content.append(split.root); split.select('apps'); },
    activate() { split.activate(); ctx.setSub(''); if (!lib) scan(); },
    refresh(what) {
      const cur = split.current();
      if (what === 'media' && cur === 'apps') split.rerender();
      if (what === 'settings' && setting('media.folders') && lib && !split.inPane()) { /* folders may have changed */ }
      if (what === 'nowPlaying' && cur === 'music' && split.pane.querySelector('.nowbar') === null && state.nowPlaying) split.rerender();
      if (what === 'nowPlaying' && cur === 'music') {
        const np = state.nowPlaying;
        const fill = split.pane.querySelector('.nowbar .prog i');
        if (fill && np && np.dur) fill.style.width = `${(np.pos / np.dur) * 100}%`;
        split.pane.querySelectorAll('.track').forEach((r, i) => r.classList.toggle('playing', !!(np && lib && lib.music[i] && lib.music[i].path === np.track.path)));
      }
    },
    prompts() {
      const el = split.focus.current;
      if (!split.inPane()) return [{ btn: 'a', label: 'Select' }];
      const p = [{ btn: 'a', label: 'Open' }];
      if (el && el._item && (setting('media.custom') || []).some((c) => (c.title || c.url) === el._item.title)) p.push({ btn: 'x', label: 'Remove' });
      if (split.current() === 'music') p.push({ btn: 'y', label: 'Play / pause' });
      p.push({ btn: 'b', label: 'Back' });
      return p;
    },
    handle(a) {
      const el = split.focus.current;
      if (a === 'x' && el && el._item) { removeCustom(el._item); return true; }
      if (a === 'y' && split.current() === 'music') { music.toggle(); return true; }
      if (a === 'y' && split.current() !== 'apps') { scan(true).then(() => split.rerender()); ctx.toast({ title: 'Rescanning media…', duration: 1800 }); return true; }
      return split.handle(a);
    },
  };
}
