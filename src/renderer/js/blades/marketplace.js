// Marketplace blade: your store accounts (GOG, itch.io, Humble) with downloads + installs,
// plus Steam deals / top sellers / new releases and Epic's free games.
import { h, fallbackColors } from '../util.js';
import { orb, icon } from '../icons.js';
import { state, track, setting } from '../store.js';
import { createSplit } from './split.js';
import { modal, button, confirm, menu } from '../components/modal.js';
import { openWeb } from '../components/launch.js';

const ICONS = { specials: 'star', top: 'trophy', new: 'bolt', free: 'heart', upcoming: 'clock' };
const norm = (s) => String(s || '').toLowerCase().replace(/[™®©]/g, '').replace(/[^a-z0-9]/g, '');
const gb = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);

export function marketBlade(ctx) {
  let data = null;
  let loading = null;
  let accounts = [];
  const libs = {};
  let downloads = [];

  const loadMarket = (force = false) => {
    if (loading) return loading;
    loading = window.p360.market.get(force).then((d) => { data = d; }).catch(() => { data = { sections: [], offline: true }; }).finally(() => { loading = null; });
    return loading;
  };
  // After deals load (or fail): the list changes; if the "Loading deals…" page is showing, move
  // to the first deals page (or show the failure) instead of leaving a spinner and a removed item.
  const afterMarket = () => {
    split.renderList();
    if (split.current() !== 'loading') return;
    const first = data && data.sections && data.sections[0];
    if (first) split.select(first.id, { keepFocus: split.inPane() });
    else split.rerender();
  };
  const loadAccounts = async () => {
    try { accounts = await window.p360.stores.list(); } catch { accounts = []; }
    split.renderList();
    return accounts;
  };
  const loadLib = async (id, force = false) => {
    try { libs[id] = await window.p360.stores.library(id, force); } catch (e) { libs[id] = { games: [], error: e.message }; }
    return libs[id];
  };
  window.p360.downloads.list().then((d) => { downloads = d; split.renderList(); }).catch(() => {});
  window.p360.on('downloads:updated', (d) => {
    const before = downloads;
    downloads = d;
    const cur = split.current();
    if (cur === 'downloads') updateDownloadRows();
    else if (cur && cur.startsWith('lib:')) refreshBadges();
    if (d.filter((x) => x.state === 'downloading').length !== before.filter((x) => x.state === 'downloading').length) split.renderList();
  });
  window.p360.on('stores:updated', async () => {
    await loadAccounts();
    const cur = split.current();
    if (cur === 'accounts' || (cur && cur.startsWith('lib:'))) { if (cur.startsWith('lib:')) await loadLib(cur.slice(4)); split.rerender(); }
  });

  // ---------------------------------------------------------------- Steam / Epic market tiles
  const ownedLocal = (title) => state.library.some((g) => norm(g.title) === norm(title));
  const owned = (item) => (item.steamAppId && state.library.some((g) => g.steamAppId === item.steamAppId)) || ownedLocal(item.title);

  function fmtMoney(cents, cur = 'USD') {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(cents / 100); } catch { return `$${(cents / 100).toFixed(2)}`; }
  }

  function imageFrame(url, title) {
    const frame = h('div.frame');
    const [a, b] = fallbackColors(title);
    frame.style.background = `linear-gradient(160deg, ${a}, ${b})`;
    if (url) { const img = h('img', { src: url, alt: '', loading: 'lazy' }); img.onerror = () => img.remove(); frame.append(img); }
    return frame;
  }

  function marketTile(item) {
    const p = item.price || {};
    const price = h('div.price');
    if (owned(item)) price.append(h('span.amt', {}, 'Installed'));
    else {
      if (p.discountPct > 0 && !p.free) price.append(h('span.pct', {}, `-${p.discountPct}%`));
      price.append(h('span.amt', {}, p.discountPct > 0 && p.original && !p.free ? h('span.was', {}, fmtMoney(p.original, p.currency)) : null, p.formatted || (p.free ? 'Free' : '')));
    }
    const t = h('div.tile.market-tile', { 'data-focus': '' }, imageFrame(item.image, item.title), h('div.label', {}, h('div.t', {}, item.title), h('div.s', {}, item.store === 'epic' ? 'Epic Games Store' : 'Steam')), price);
    t._activate = () => marketDetails(item);
    return t;
  }

  function marketDetails(item) {
    track('market');
    modal({
      panelClass: 'dialog',
      sound: 'select',
      build(panel, close, focus) {
        const img = item.image ? h('img', { src: item.image, alt: '', style: { width: '100%', borderRadius: '16px', marginBottom: '20px', boxShadow: '0 10px 30px rgba(0,0,0,.4)' } }) : null;
        const p = item.price || {};
        const priceLine = p.free ? (item.endsAt ? `Free until ${new Date(item.endsAt).toLocaleDateString()}` : 'Free')
          : [p.formatted, p.discountPct ? `${p.discountPct}% off` : null, item.endsAt ? `ends ${new Date(item.endsAt).toLocaleDateString()}` : null].filter(Boolean).join(' · ');
        const view = button(item.store === 'epic' ? 'View on Epic Games Store' : 'View on Steam', { icon: 'globe', onActivate: () => { close(); openWeb({ id: item.id, title: item.title, url: item.url }); } });
        panel.append(...[img, h('h3', {}, item.title), h('p', {}, `${priceLine}${owned(item) ? '\nYou already have this game installed.' : ''}`), h('div.btns', {}, view, button('Back', { onActivate: () => close() }))].filter(Boolean));
        focus.set(view);
      },
    });
  }

  // ---------------------------------------------------------------- store accounts
  function accountCard(a) {
    const status = a.signedIn ? `${a.client ? 'Connected' : 'Signed in'}${a.user ? ` as ${a.user}` : ''} · ${a.count} game${a.count === 1 ? '' : 's'}` : (a.error || 'Not signed in');
    const openLib = () => split.select(`lib:${a.id}`).then(() => { const f = split.pane.querySelector('[data-focus]'); if (f) split.focus.set(f); });
    const rescan = async () => { ctx.toast({ title: `Scanning your ${a.name} library…`, duration: 2000 }); await loadLib(a.id, true); await loadAccounts(); split.rerender(); };
    const btns = a.client
      ? [
        ...(a.signedIn ? [button('Open library', { icon: 'grid', onActivate: openLib }), button('Rescan library', { icon: 'restart', onActivate: rescan })] : []),
        ...(a.signInUrl && a.mode !== 'store' ? [button(a.signedIn ? 'Sign in for full library' : `Sign in to ${a.name}`, { icon: 'user', onActivate: () => signIn(a) })] : []),
        ...(a.signInUrl && a.mode === 'store' ? [button('Sign out', { icon: 'close', onActivate: () => window.p360.stores.signOut(a.id) })] : []),
      ]
      : a.signedIn
      ? [button('Open library', { icon: 'grid', onActivate: () => split.select(`lib:${a.id}`).then(() => { const f = split.pane.querySelector('[data-focus]'); if (f) split.focus.set(f); }) }),
        button('Rescan library', { icon: 'restart', onActivate: async () => { ctx.toast({ title: `Scanning your ${a.name} library…`, duration: 2000 }); await loadLib(a.id, true); await loadAccounts(); split.rerender(); } }),
        button('Sign out', { icon: 'close', onActivate: async () => { if (await confirm({ title: `Sign out of ${a.name}?`, text: 'Your sign-in cookies for this store are removed from Project 360.', buttons: [{ label: 'Sign out', value: true, danger: true }, { label: 'Cancel', value: false }] })) await window.p360.stores.signOut(a.id); } })]
      : [button(`Sign in to ${a.name}`, { icon: 'user', onActivate: () => signIn(a) })];
    return h('div.card', { style: { marginBottom: '18px', borderLeft: `8px solid ${a.color}` } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, h('div', { style: { fontSize: '30px', fontWeight: 600 } }, a.name), h('div', { style: { fontSize: '19px', color: 'var(--ink-dim)' } }, status)),
      h('div', { style: { fontSize: '19px', color: 'var(--ink-dim)', margin: '6px 0 16px' } }, a.about, a.note ? h('div', { style: { marginTop: '6px', color: 'var(--ink)' } }, a.note) : null),
      h('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${btns.length}, 1fr)`, gap: '12px' } }, ...btns));
  }

  async function signIn(a) {
    ctx.toast({ title: `Sign in to ${a.name}`, text: 'Left stick moves the pointer · A clicks · Xbox button cancels', duration: 6000 });
    await window.p360.stores.signIn(a.id);
  }

  // ---------------------------------------------------------------- store libraries
  function dlFor(store, gameId) { return downloads.find((d) => d.store === store && d.gameId === gameId && d.state !== 'cancelled'); }
  function installedLocal(store, g) {
    if (g.localId && state.library.some((x) => x.id === g.localId)) return true;
    return ownedLocal(g.title);
  }
  function badgeText(store, g) {
    if (installedLocal(store, g)) return 'Installed';
    const d = dlFor(store, g.id);
    if (!d) return g.windows === false ? 'No Windows version' : '';
    if (d.state === 'downloading') return `${d.total ? Math.floor((d.received / d.total) * 100) : 0}%`;
    if (d.state === 'client') return d.total ? `${Math.floor((d.received / d.total) * 100)}% in ${d.client}` : `Installing in ${d.client}`;
    return { queued: 'Queued', paused: 'Paused', installing: 'Installing…', done: 'Installed', downloaded: 'Downloaded', failed: 'Failed' }[d.state] || '';
  }
  function libTile(store, g) {
    const badge = h('span.amt', {}, badgeText(store, g));
    const price = h('div.price', {}, badge);
    if (!badge.textContent) price.style.display = 'none';
    const t = h('div.tile.market-tile', { 'data-focus': '', 'data-gid': g.id }, imageFrame(g.image, g.title), h('div.label', {}, h('div.t', {}, g.title), h('div.s', {}, accounts.find((a) => a.id === store)?.name || store)), price);
    t._badge = badge;
    t._g = g;
    t._activate = () => gameOptions(store, g);
    return t;
  }
  function refreshBadges() {
    const store = split.current().slice(4);
    split.pane.querySelectorAll('[data-gid]').forEach((t) => {
      const txt = badgeText(store, t._g);
      t._badge.textContent = txt;
      t._badge.parentNode.style.display = txt ? '' : 'none';
    });
  }

  // One options request / menu at a time (a second A while it loads would stack two menus).
  let optionsBusy = false;
  async function gameOptions(store, g) {
    if (optionsBusy) return;
    optionsBusy = true;
    try { await gameOptionsInner(store, g); } finally { optionsBusy = false; }
  }
  async function gameOptionsInner(store, g) {
    if (installedLocal(store, g)) {
      const local = state.library.find((x) => x.id === g.localId) || state.library.find((x) => norm(x.title) === norm(g.title));
      if (local) { ctx.goto('games'); return; }
    }
    const existing = dlFor(store, g.id);
    if (existing && ['queued', 'downloading', 'installing', 'paused', 'client'].includes(existing.state)) { split.select('downloads'); return; }
    ctx.toast({ title: 'Checking downloads…', text: g.title, duration: 1500 });
    let d;
    try { d = await window.p360.stores.options(store, g.id); } catch (e) { ctx.toast({ title: 'Could not get downloads', text: e.message, sound: 'error' }); return; }
    if (!d.options.length) { ctx.toast({ title: 'No Windows download', text: `${g.title} has no Windows version to download`, sound: 'error' }); return; }
    const items = [];
    const client = d.options[0] && d.options[0].client;
    for (const o of d.options.slice(0, 8)) {
      items.push({ label: client ? o.label : `Download & install · ${o.label}`, value: { o, install: true }, icon: 'play', right: client ? '' : gb(o.size) });
    }
    if (!client) items.push({ label: 'Download only (install later)', value: { o: d.options[0], install: false }, icon: 'folder', right: gb(d.options[0].size) });
    if (g.url) items.push({ label: 'View store page', value: 'web', icon: 'globe' });
    const pick = await menu({ title: d.title || g.title, items });
    if (!pick) return;
    if (pick === 'web') { if (g.url) openWeb({ id: `store-${store}-${g.id}`, title: g.title, url: g.url }); return; }
    try {
      await window.p360.downloads.start(store, g.id, pick.o.id, { install: pick.install });
      if (!pick.o.client) ctx.toast({ kind: 'orb', icon: 'folder', title: 'Download started', text: g.title, sound: 'select' });
      refreshBadges();
    } catch (e) { ctx.toast({ title: 'Could not start download', text: e.message, sound: 'error' }); }
  }

  // ---------------------------------------------------------------- downloads
  const STATE_TEXT = { queued: 'Queued', downloading: 'Downloading', paused: 'Paused', installing: 'Installing…', done: 'Installed', downloaded: 'Downloaded', failed: 'Failed', cancelled: 'Cancelled' };
  function dlText(d) {
    if (d.state === 'client') return d.total ? `Downloading in ${d.client} · ${gb(d.received)} of ${gb(d.total)}` : (d.error || `Installing in ${d.client}`);
    if (d.state === 'downloading') return `${gb(d.received)} of ${gb(d.total)}${d.speed ? ` · ${(d.speed / 1e6).toFixed(1)} MB/s` : ''}${d.parts > 1 ? ` · part ${Math.min(d.part + 1, d.parts)}/${d.parts}` : ''}`;
    if (d.error) return `${STATE_TEXT[d.state] || d.state} · ${d.error}`;
    return `${STATE_TEXT[d.state] || d.state}${d.total ? ` · ${gb(d.total)}` : ''}`;
  }
  function dlRow(d) {
    const fill = h('div.fill', { style: { width: `${d.total ? (d.received / d.total) * 100 : d.state === 'done' ? 100 : 0}%` } });
    const txt = h('div.d', {}, dlText(d));
    const r = h('div.row', { 'data-focus': '', 'data-dl': d.id },
      h('div', { style: { width: '120px', height: '68px', borderRadius: '10px', overflow: 'hidden', flex: 'none', background: 'var(--tile-bg)' } }, d.image ? h('img', { src: d.image, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover' } }) : null),
      h('div.txt', {}, h('div.k', {}, d.title), txt, h('div.slider', { style: { width: '100%', height: '8px', marginTop: '10px' } }, fill)));
    r._txt = txt;
    r._fill = fill;
    r._activate = () => dlMenu(d.id);
    return r;
  }
  function updateDownloadRows() {
    const rows = split.pane.querySelectorAll('[data-dl]');
    if (rows.length !== downloads.filter((d) => d.state !== 'cancelled').length) return split.rerender();
    rows.forEach((r) => {
      const d = downloads.find((x) => x.id === r.dataset.dl);
      if (!d) return;
      r._txt.textContent = dlText(d);
      r._fill.style.width = `${d.total ? (d.received / d.total) * 100 : d.state === 'done' ? 100 : 0}%`;
    });
  }
  async function dlMenu(id) {
    const d = downloads.find((x) => x.id === id);
    if (!d) return;
    const items = [];
    if (d.state === 'downloading') items.push({ label: 'Pause', value: 'pause', icon: 'sleep' });
    if (['paused', 'failed'].includes(d.state) && d.part < d.parts) items.push({ label: 'Resume', value: 'resume', icon: 'play' });
    if (d.state === 'downloaded' || (d.state === 'failed' && d.part === d.parts)) items.push({ label: 'Install now', value: 'install', icon: 'play' });
    if (d.state === 'done') items.push({ label: 'Go to My games', value: 'games', icon: 'grid' });
    if (['queued', 'downloading', 'paused', 'failed', 'downloaded'].includes(d.state)) items.push({ label: 'Cancel download', value: 'cancel', icon: 'close' });
    if (d.state === 'client') items.push({ label: `Stop tracking (${d.client} keeps installing)`, value: 'cancel', icon: 'close' });
    if (!d.client) items.push({ label: 'Open folder', value: 'folder', icon: 'folder' });
    if (!['downloading', 'installing'].includes(d.state)) items.push({ label: 'Remove from list', value: 'remove', icon: 'eyeoff' });
    const v = await menu({ title: d.title, items });
    try {
      if (v === 'pause') await window.p360.downloads.pause(id);
      if (v === 'resume') await window.p360.downloads.resume(id);
      if (v === 'install') { ctx.toast({ title: 'Installing…', text: d.title }); await window.p360.downloads.install(id); }
      if (v === 'cancel') await window.p360.downloads.cancel(id);
      if (v === 'remove') await window.p360.downloads.remove(id);
      if (v === 'folder') await window.p360.downloads.folder(id);
      if (v === 'games') ctx.goto('games');
    } catch (e) { ctx.toast({ title: 'Something went wrong', text: e.message, sound: 'error' }); }
  }

  // ---------------------------------------------------------------- split view
  const split = createSplit({
    sections: () => {
      const active = downloads.filter((d) => ['queued', 'downloading', 'installing', 'paused'].includes(d.state)).length;
      const secs = [
        { id: 'downloads', label: 'Downloads', icon: 'folder', count: active || undefined },
        { id: 'accounts', label: 'Store accounts', icon: 'user', count: accounts.filter((a) => a.signedIn).length || undefined },
        ...accounts.filter((a) => a.signedIn).map((a) => ({ id: `lib:${a.id}`, label: `${a.name} library`, icon: 'grid', count: a.count })),
      ];
      const ms = (data && data.sections) || [];
      if (!ms.length) secs.push({ id: 'loading', label: data ? 'Deals unavailable' : 'Loading deals…', icon: 'globe' });
      for (const s of ms) secs.push({ id: s.id, label: s.title, icon: ICONS[s.id] || 'star', count: s.items.length });
      secs.push({ id: 'refresh', label: 'Refresh deals', icon: 'restart' });
      return secs;
    },
    async render(id, pane, { isCurrent }) {
      if (id === 'downloads') {
        const list = downloads.filter((d) => d.state !== 'cancelled');
        pane.append(h('h2', {}, 'downloads'));
        let paths = {};
        try { paths = await window.p360.stores.paths(); } catch { /* ignore */ }
        pane.append(h('div.lead', {}, `Games install to ${paths.install || 'your Games folder'}.`));
        if (!list.length) pane.append(h('div.empty-note', { html: 'Nothing downloading. Sign in to a store in <b>Store accounts</b>, then pick a game from its library.' }));
        list.forEach((d) => pane.append(dlRow(d)));
        const pickInstall = button('Change install folder…', { icon: 'folder', onActivate: async () => { await window.p360.stores.pickFolder('install'); split.rerender(); } });
        pane.append(h('div', { style: { maxWidth: '420px', marginTop: '18px' } }, pickInstall));
        return;
      }
      if (id === 'accounts') {
        pane.append(h('h2', {}, 'store accounts'), h('div.lead', {}, 'Sign in once with your own account. Project 360 keeps the sign-in (cookies) for that store only, lists the games you own, and downloads and installs them for you.'));
        if (!accounts.length) await loadAccounts();
        if (!isCurrent()) return;
        accounts.forEach((a) => pane.append(accountCard(a)));
        return;
      }
      if (id.startsWith('lib:')) {
        const store = id.slice(4);
        const a = accounts.find((x) => x.id === store);
        pane.append(h('h2', {}, `${a ? a.name : store} library`));
        const lib = libs[store] || await loadLib(store);
        if (!isCurrent()) return;
        if (lib.error) { pane.append(h('div.empty-note', {}, lib.error)); return; }
        if (!lib.games.length) { pane.append(h('div.empty-note', {}, 'No games found in this account.')); return; }
        const inst = lib.games.filter((g) => installedLocal(store, g)).length;
        lib.games = [...lib.games].sort((x, y) => installedLocal(store, x) - installedLocal(store, y) || x.title.localeCompare(y.title));
        pane.append(h('div.lead', {}, `${lib.games.length} games you own · ${lib.games.length - inst} not installed · ${inst} installed. Press A on a game to install it.`));
        const grid = h('div.tilegrid');
        lib.games.forEach((g) => grid.append(libTile(store, g)));
        pane.append(grid);
        return;
      }
      if (id === 'refresh') {
        pane.append(h('h2', {}, 'refresh'), h('div.lead', {}, 'Get the latest deals and free games.'));
        pane.append(button('Refresh now', { icon: 'restart', onActivate: async () => { await loadMarket(true); afterMarket(); ctx.toast({ title: 'Marketplace updated', sound: 'select' }); } }));
        return;
      }
      const sec = data && data.sections.find((s) => s.id === id);
      if (!sec) {
        pane.append(h('div.empty-note', { html: data ? 'Deals couldn’t be loaded. <b>Check your network</b> and try again.' : 'Loading the Marketplace…' }), data ? null : orb('fast'));
        return;
      }
      pane.append(h('h2', {}, sec.title.toLowerCase()), data.offline ? h('div.lead', {}, 'Offline — showing the last saved Marketplace.') : null);
      const grid = h('div.tilegrid');
      sec.items.forEach((it) => grid.append(marketTile(it)));
      pane.append(grid);
    },
  });

  return {
    id: 'marketplace',
    label: 'marketplace',
    accent: '#f28c1c',
    focus: split.focus,
    mount(content) {
      content.append(split.root);
      split.select('accounts');
      loadAccounts();
      loadMarket().then(afterMarket);
    },
    activate() { split.activate(); loadAccounts(); ctx.setSub(data && data.updatedAt ? `Deals updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''); },
    refresh(what) {
      if (what !== 'library') return;
      const cur = split.current();
      if (!cur) return;
      if (cur.startsWith('lib:')) refreshBadges();
      else if (!['downloads', 'accounts', 'refresh', 'loading'].includes(cur)) split.rerender();
    },
    prompts() { return split.inPane() ? [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }] : [{ btn: 'a', label: 'Select' }]; },
    handle: (a) => split.handle(a),
  };
}

export { icon, setting };
