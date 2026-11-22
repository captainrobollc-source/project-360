// Games blade: NXE-style 3D cover carousel (or grid), shelves, search and sorting.
import { h, artUrl, fmtAgo, fmtPlaytime, SOURCE_LABEL } from '../util.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { state, setting, saveSetting, track, isMainGame } from '../store.js';
import { coverTile } from '../components/tiles.js';
import { launchGame } from '../components/launch.js';
import { openDetails } from '../components/details.js';
import { menu, osk } from '../components/modal.js';

const SORTS = [['az', 'A–Z'], ['recent', 'Recently played'], ['playtime', 'Most played'], ['added', 'Recently added']];
const COLS = 7;
const WINDOW_BEFORE = 2;
const WINDOW_AFTER = 9;

export function gamesBlade(ctx) {
  const root = h('div.games');
  const shelves = h('div.shelves');
  const body = h('div', { style: { flex: '1', position: 'relative', minHeight: '0', display: 'flex', flexDirection: 'column' } });
  root.append(shelves, body);

  let filter = 'all';
  let sort = 'az';
  let search = '';
  let games = [];
  let idx = 0;
  const shelfIdx = {};
  const view = () => setting('games.view') || 'carousel';

  // Carousel parts
  const car = h('div.carousel');
  const carFocus = h('div', { 'data-focus': '', 'data-car': '', style: { position: 'absolute', left: '30px', top: '34px', width: '300px', height: '450px' } });
  const info = h('div.info');
  car.append(carFocus, info);
  const pool = new Map();
  // Grid parts
  const gridInfo = h('div.gridinfo');
  const grid = h('div.grid');
  const gridWrap = h('div.grid-wrap', { 'data-scroll': '' }, grid);

  const focus = new nav.Focus(root, {
    onChange: (el) => {
      if (el.dataset.id) { const g = games.find((x) => x.id === el.dataset.id); if (g) { idx = games.indexOf(g); showGridInfo(g); } }
      nav.refreshPrompts();
    },
  });

  function list() {
    const showHidden = setting('library.showHidden');
    let out = state.library.filter((g) => (showHidden || !g.hidden) && isMainGame(g));
    if (filter === 'fav') out = out.filter((g) => g.favorite);
    else if (filter === 'recent') out = out.filter((g) => g.lastPlayed);
    else if (filter !== 'all') out = out.filter((g) => g.source === filter);
    if (search) { const q = search.toLowerCase(); out = out.filter((g) => g.title.toLowerCase().includes(q)); }
    const s = filter === 'recent' ? 'recent' : sort;
    const by = {
      az: (a, b) => a.sortTitle.localeCompare(b.sortTitle),
      recent: (a, b) => (b.lastPlayed - a.lastPlayed) || a.sortTitle.localeCompare(b.sortTitle),
      playtime: (a, b) => (b.playtime - a.playtime) || a.sortTitle.localeCompare(b.sortTitle),
      added: (a, b) => (b.addedAt - a.addedAt) || a.sortTitle.localeCompare(b.sortTitle),
    }[s];
    return out.sort(by);
  }

  function shelfChips() {
    const sources = [...new Set(state.library.filter(isMainGame).map((g) => g.source))];
    return [['all', 'All games'], ['recent', 'Recently played'], ['fav', 'Favorites'], ...['steam', 'epic', 'gog', 'xbox', 'local', 'rom'].filter((s) => sources.includes(s)).map((s) => [s, SOURCE_LABEL[s]])];
  }

  function renderShelves() {
    const chips = shelfChips();
    if (!chips.some(([k]) => k === filter)) filter = 'all';
    const focusedChip = focus.current && focus.current.dataset.chip;
    shelves.replaceChildren();
    for (const [key, label] of chips) {
      const c = h(`div.chip${key === filter ? '.selected' : ''}`, { 'data-focus': '', 'data-chip': key }, label);
      c._activate = () => setShelf(key, true);
      shelves.append(c);
      if (focusedChip === key) { c.classList.add('focused'); focus.current = c; }
    }
    if (search) {
      const c = h('div.chip.selected', { 'data-focus': '', 'data-chip': 'search' }, `“${search}”  ✕`);
      c._activate = () => { search = ''; rebuild({ toItems: true }); };
      shelves.append(c);
    }
    shelves.append(h('div.spacer'), h('div.meta', {}, `${games.length} games · ${SORTS.find(([k]) => k === (filter === 'recent' ? 'recent' : sort))[1]}`));
  }

  function setShelf(key, toItems = false) {
    shelfIdx[filter] = idx;
    filter = key;
    idx = shelfIdx[key] || 0;
    rebuild({ toItems });
    sound.play('tick');
  }

  // ---------------- carousel
  function transformFor(d) {
    if (d === 0) return { t: 'translate3d(0,0,0) rotateY(0deg)', o: 1 };
    if (d > 0) return { t: `translate3d(${370 + (d - 1) * 190}px, ${-d * 6}px, ${-130 * d}px) rotateY(-14deg)`, o: d > 8 ? 0 : 1 - (d - 1) * 0.08 };
    return { t: `translate3d(${-420 * -d}px, 0, 80px) rotateY(12deg)`, o: 0 };
  }

  function layoutCarousel() {
    const keep = new Set();
    for (let d = -WINDOW_BEFORE; d <= WINDOW_AFTER; d++) {
      const g = games[idx + d];
      if (!g) continue;
      keep.add(g.id);
      let el = pool.get(g.id);
      // What the cover shows; when art arrives or the game is (un)favorited the tile is rebuilt.
      const look = `${g.title}|${g.favorite ? 1 : 0}|${JSON.stringify(g.art || {})}|${JSON.stringify(g.artSources || {})}`;
      if (el && el._look !== look) {
        const tile = coverTile(g);
        tile.removeAttribute('data-focus');
        el.replaceChildren(tile);
        el._look = look;
      }
      if (!el) {
        const tile = coverTile(g);
        tile.removeAttribute('data-focus'); // the carousel keeps one focus target (carFocus); mouse hover mustn't steal it
        el = h('div.ci.reflect', {}, tile);
        el._look = look;
        const id = g.id;
        // Look the game up by id: after a library update `games` holds new objects.
        el.addEventListener('click', () => { const i = games.findIndex((x) => x.id === id); if (i < 0) return; if (i === idx) launchGame(id); else { idx = i; layoutCarousel(); } });
        const t0 = transformFor(d > 0 ? d + 1 : d - 1);
        el.style.transform = t0.t;
        el.style.opacity = '0';
        car.insertBefore(el, carFocus);
        pool.set(g.id, el);
        void el.offsetWidth; // commit start position so it animates in
      }
      const t = transformFor(d);
      el.style.transform = t.t;
      el.style.opacity = String(t.o);
      el.style.zIndex = String(100 - Math.abs(d));
      el.classList.toggle('cur', d === 0);
    }
    for (const [id, el] of pool) {
      if (keep.has(id)) continue;
      pool.delete(id);
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 450);
    }
    const g = games[idx];
    info.replaceChildren();
    if (g) {
      const bits = [SOURCE_LABEL[g.source], g.platform, g.meta && g.meta.genres && g.meta.genres[0], g.playtime ? fmtPlaytime(g.playtime) : null, g.lastPlayed ? `Last played ${fmtAgo(g.lastPlayed).toLowerCase()}` : 'Not played yet'].filter(Boolean);
      info.append(h('div.t', {}, g.title), h('div.s', {}, bits.join('  ·  ')), h('div.pos', {}, `${idx + 1} of ${games.length}${g.favorite ? '  ·  ★ Favorite' : ''}`));
      ctx.setAmbient(artUrl(g, 'hero'));
    } else {
      ctx.setAmbient(null);
      info.append(h('div.empty', { style: { position: 'static' }, html: state.library.length ? 'No games on this shelf.' : 'No games found yet. Steam, Epic, GOG and Xbox games appear automatically.<br>Add folders or emulators in <b>System › Library</b>.' }));
    }
  }

  function moveCarousel(step) {
    const n = Math.max(0, Math.min(games.length - 1, idx + step));
    if (n === idx) return;
    idx = n;
    layoutCarousel();
    sound.play('tick');
    nav.refreshPrompts();
  }

  // ---------------- grid
  function showGridInfo(g) {
    if (view() !== 'grid') return;
    gridInfo.replaceChildren();
    if (!g) return;
    const bits = [SOURCE_LABEL[g.source], g.playtime ? fmtPlaytime(g.playtime) : null, g.lastPlayed ? `Last played ${fmtAgo(g.lastPlayed).toLowerCase()}` : 'Not played yet'].filter(Boolean);
    gridInfo.append(h('div.t', {}, g.title), h('div.s', {}, bits.join('  ·  ')));
    ctx.setAmbient(artUrl(g, 'hero'));
  }

  function renderGrid() {
    grid.replaceChildren();
    for (const g of games) {
      const t = coverTile(g);
      t._activate = () => launchGame(g.id);
      grid.append(t);
    }
    if (!games.length) grid.append(h('div.empty-note', { style: { gridColumn: `1 / span ${COLS}` } }, 'No games on this shelf.'));
  }

  function rebuild({ toItems = false } = {}) {
    const prevId = games[idx] && games[idx].id;
    if (!shelfChips().some(([k]) => k === filter)) filter = 'all'; // that store's games are gone
    games = list();
    const keep = prevId ? games.findIndex((g) => g.id === prevId) : -1;
    idx = keep >= 0 && !toItems ? keep : Math.min(idx, Math.max(0, games.length - 1));
    if (toItems && !(shelfIdx[filter] >= 0)) idx = 0;
    renderShelves();
    if (view() === 'carousel') {
      if (body.firstChild !== car) { body.replaceChildren(car); for (const el of pool.values()) el.remove(); pool.clear(); }
      layoutCarousel();
      if (toItems || !focus.current || !focus.current.isConnected) focus.set(carFocus);
    } else {
      if (body.firstChild !== gridInfo) body.replaceChildren(gridInfo, gridWrap);
      renderGrid();
      const t = grid.children[idx];
      if ((toItems || !focus.current || !focus.current.isConnected) && t && t.dataset.id) focus.set(t);
      showGridInfo(games[idx]);
    }
    ctx.setSub(`${games.length} game${games.length === 1 ? '' : 's'}`);
    nav.refreshPrompts();
  }

  async function openMenu() {
    const choice = await menu({
      title: 'Find & sort',
      items: [
        { label: 'Search', value: 'search', icon: 'search' },
        { label: 'Sort by', value: 'sort', icon: 'grid', right: SORTS.find(([k]) => k === sort)[1] },
        { label: 'View', value: 'view', icon: 'image', right: view() === 'carousel' ? 'Carousel' : 'Grid' },
        { label: 'Show hidden games', value: 'hidden', icon: 'eye', right: setting('library.showHidden') ? 'On' : 'Off' },
        search ? { label: 'Clear search', value: 'clear', icon: 'close' } : null,
        { label: 'Rescan library', value: 'rescan', icon: 'restart' },
      ].filter(Boolean),
    });
    if (choice === 'search') return doSearch();
    if (choice === 'sort') { sort = SORTS[(SORTS.findIndex(([k]) => k === sort) + 1) % SORTS.length][0]; rebuild({ toItems: true }); idx = 0; rebuild({ toItems: true }); }
    if (choice === 'view') { await saveSetting('games.view', view() === 'carousel' ? 'grid' : 'carousel'); rebuild({ toItems: true }); }
    if (choice === 'hidden') await saveSetting('library.showHidden', !setting('library.showHidden'));
    if (choice === 'clear') { search = ''; rebuild({ toItems: true }); }
    if (choice === 'rescan') { ctx.toast({ title: 'Scanning library…', text: 'Steam · Epic · GOG · Xbox · Local', duration: 2500 }); window.p360.library.rescan(); }
  }

  async function doSearch() {
    const q = await osk({ title: 'Search games', value: search, placeholder: 'Game title' });
    if (q === null) return;
    search = q.trim();
    filter = 'all';
    idx = 0;
    track('search');
    rebuild({ toItems: true });
  }

  const curId = () => (focus.current === carFocus ? games[idx] && games[idx].id : focus.current && focus.current.dataset.id);

  return {
    id: 'games',
    label: 'games',
    accent: '#9bc848',
    focus,
    mount(content) { content.append(root); rebuild({ toItems: true }); },
    activate() {
      if (focus.current && focus.current.isConnected) { focus.ensure(); if (view() === 'carousel') layoutCarousel(); return; }
      rebuild({ toItems: true });
    },
    open(opts) {
      if (opts.filter) { filter = opts.filter; idx = 0; rebuild({ toItems: true }); }
      if (opts.search) doSearch();
    },
    refresh(what) { if (what === 'library' || what === 'settings') rebuild(); },
    prompts() {
      return curId()
        ? [{ btn: 'a', label: 'Play' }, { btn: 'x', label: 'Details' }, { btn: 'y', label: 'Find & sort' }, { btn: 'dpad', label: 'Shelves' }]
        : [...(games.length ? [{ btn: 'a', label: 'Open shelf' }] : []), { btn: 'y', label: 'Find & sort' }];
    },
    handle(action) {
      const onCar = focus.current === carFocus;
      if (onCar && (action === 'left' || action === 'right')) { moveCarousel(action === 'left' ? -1 : 1); return true; }
      if (onCar && (action === 'lt' || action === 'rt')) { moveCarousel(action === 'lt' ? -5 : 5); return true; }
      if (onCar && action === 'a') { const g = games[idx]; if (g) { sound.play('select'); launchGame(g.id); } return true; }
      if (onCar && action === 'down') {
        // Down cycles to the next shelf, like NXE channels.
        const chips = [...shelves.querySelectorAll('[data-chip]')].map((c) => c.dataset.chip).filter((c) => c !== 'search');
        const i = chips.indexOf(filter);
        if (i < chips.length - 1) setShelf(chips[i + 1], true);
        return true;
      }
      if (onCar && action === 'up') {
        const c = shelves.querySelector('.chip.selected') || shelves.querySelector('.chip');
        if (c) focus.set(c, { silent: false });
        return true;
      }
      if (focus.current && focus.current.dataset.chip && action === 'down') {
        if (view() === 'carousel') focus.set(carFocus, { silent: false });
        else { const t = grid.children[idx] && grid.children[idx].dataset.id ? grid.children[idx] : grid.querySelector('.tile'); if (t) focus.set(t, { silent: false }); }
        return true;
      }
      if (['up', 'down', 'left', 'right'].includes(action)) { focus.handleDir(action); return true; }
      if (action === 'a') { if (focus.activate()) sound.play('select'); return true; }
      if (action === 'x' && curId()) { openDetails(curId(), { toast: ctx.toast }); return true; }
      if (action === 'y') { openMenu(); return true; }
      if (!onCar && (action === 'lt' || action === 'rt')) {
        if (view() !== 'grid' || !grid.contains(focus.current)) return true;
        const tiles = [...grid.querySelectorAll('.tile')];
        const i = tiles.indexOf(focus.current);
        const t = tiles[Math.max(0, Math.min(tiles.length - 1, i + (action === 'lt' ? -1 : 1) * COLS * 3))];
        if (t) focus.set(t, { silent: false });
        return true;
      }
      return false;
    },
  };
}
