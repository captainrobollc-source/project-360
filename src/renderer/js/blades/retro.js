// Retro blade: every emulated system, its games, emulator installs and BIOS status.
import { h, artUrl, fmtAgo } from '../util.js';
import { icon, iconEl } from '../icons.js';
import { state } from '../store.js';
import { createSplit } from './split.js';
import { coverTile } from '../components/tiles.js';
import { launchGame } from '../components/launch.js';
import { openDetails } from '../components/details.js';
import { button, confirm, menu } from '../components/modal.js';

const pct = (p) => (p && p.total ? Math.floor((p.received / p.total) * 100) : 0);
const gb = (n) => (n == null ? '—' : n >= 1e12 ? `${(n / 1e12).toFixed(2)} TB` : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
const MOVE_PHASE = { checking: 'Getting ready…', undoing: 'Cancelling…', finishing: 'Switching over…', cleaning: 'Removing the old copy…' };
const moveText = (p) => (p.phase === 'copying' ? `${pct(p)}% · ${gb(p.received)} of ${gb(p.total)}` : MOVE_PHASE[p.phase] || 'Working…');
const PHASE = { resolving: 'Finding the latest version…', downloading: 'Downloading', extracting: 'Installing…', failed: 'Failed' };

export function retroBlade(ctx) {
  let st = null;
  const load = async () => { try { st = await window.p360.emu.status(); } catch { st = null; } return st; };
  let moveVal = null; // the progress text of the "Moving to…" row, updated in place
  // Everything a page shows except move progress: progress ticks every 250 ms during a move and
  // must not rebuild a cover grid each time.
  const sigOf = (s) => JSON.stringify({ ...s, move: s && s.move ? 1 : 0 });
  // The same without download percentages: those only update the setup row's text.
  const baseOf = (s) => JSON.stringify({ ...s, move: s && s.move ? 1 : 0, emulators: s && s.emulators ? s.emulators.map((e) => ({ ...e, progress: e.progress ? e.progress.phase : null })) : null });
  let lastSig = '';
  let lastBase = '';
  window.p360.on('emu:updated', (s) => {
    const wasMoving = !!(st && st.move);
    const sig = sigOf(s);
    const base = baseOf(s);
    const changed = sig !== lastSig;
    const structural = base !== lastBase;
    lastSig = sig;
    lastBase = base;
    st = s;
    const cur = split.current();
    if (cur === 'bios' && (wasMoving !== !!s.move)) split.rerender();
    else if (cur === 'bios' && s.move && moveVal && moveVal.isConnected) moveVal.textContent = moveText(s.move);
    else if (!changed) return;
    else if (!structural && cur === 'home') { const row = split.pane.querySelector('.row.emu-setup'); if (row) row.replaceWith(setupRow(s.systems.reduce((n, x) => n + x.games, 0))); fixSetupFocus(); }
    else if (['home', 'emulators', 'options'].includes(cur) || (cur && cur.startsWith('sys:'))) split.rerender();
    else split.renderList();
  });
  // A setup row swapped in place keeps the focus if it had it.
  function fixSetupFocus() {
    const row = split.pane.querySelector('.row.emu-setup');
    if (row && split.focus.current && !split.focus.current.isConnected && split.focus.current.dataset.key === 'setup') split.focus.set(row);
  }

  // ---- moving the Emulation folder to another drive
  let planning = false;
  let moveStarting = false; // confirmed, waiting for the move to report in
  async function moveDrive(row) {
    if (planning || moveStarting || (st && st.move)) return;
    planning = true;
    const val = row && row.querySelector('.val');
    const was = val ? val.textContent : '';
    if (val) val.textContent = 'Checking drives…';
    let plan;
    try { plan = await window.p360.emu.movePlan(); }
    catch (e) { ctx.toast({ title: 'Couldn’t check your drives', text: e.message, sound: 'error' }); return; }
    finally { planning = false; if (val && val.isConnected) val.textContent = was; }
    const others = plan.drives.filter((d) => !d.current);
    if (!others.length) { ctx.toast({ title: 'No other drives found', text: 'Connect a drive and try again', sound: 'error' }); return; }
    const size = plan.size ? gb(plan.size.bytes) : '';
    const pick = await menu({
      title: `Move emulation${size ? ` (${size})` : ''} to…`,
      items: others.map((d) => ({ label: `${d.drive} ${d.label || (d.type === 'removable' ? 'Removable drive' : 'Local Disk')}`, right: d.fits ? `${gb(d.free)} free` : 'Not enough space', icon: 'drive', value: d.drive })),
    });
    if (!pick) return;
    const d = others.find((x) => x.drive === pick);
    if (!d.fits) { ctx.toast({ title: `Not enough space on ${d.drive}`, text: `Needs ${size}, ${gb(d.free)} free`, sound: 'error' }); return; }
    const ok = await confirm({
      title: `Move to ${d.drive}?`,
      text: `Your games, BIOS files, emulators, saves and save states${size ? ` (${size})` : ''} move from ${plan.root} to ${d.drive}. Playtime, favorites and box art come with them.\n\nThe old copy is deleted only after everything has copied and checked out. Emulated games can’t be played while this runs.${d.type === 'removable' ? '\n\nKeep this drive plugged in to play your emulated games.' : ''}`,
      buttons: [{ label: `Move to ${d.drive}`, value: true, icon: 'drive' }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    // Progress shows on this page; main reports how it ended.
    moveStarting = true;
    const v = row && row.querySelector('.val');
    if (v) v.textContent = 'Starting…';
    window.p360.emu.move(pick).catch(() => {}).finally(() => { moveStarting = false; load().then(() => { if (split.current() === 'bios') split.rerender(); }); });
  }

  async function cancelMove() {
    const p = st && st.move;
    if (!p || !['checking', 'copying'].includes(p.phase)) return;
    const ok = await confirm({
      title: 'Stop moving?',
      text: 'Everything stays where it is now, and the partial copy is removed.',
      buttons: [{ label: 'Keep moving', value: false }, { label: 'Stop the move', value: true, danger: true }],
    });
    if (ok) window.p360.emu.moveCancel().catch(() => {});
  }

  function locationRow() {
    const p = st.move;
    if (p) {
      moveVal = h('div.val', {}, moveText(p));
      const r = h('div.row', { 'data-focus': '', 'data-key': 'move' },
        h('div.txt', {}, h('div.k', {}, `Moving to ${p.to || 'another drive'}`), h('div.d', {}, 'Emulated games can’t be played until this finishes. Keep both drives connected. Press A to stop.')),
        h('div.check.wait', {}, '…'), moveVal);
      r._activate = cancelMove;
      return r;
    }
    moveVal = null;
    const r = h('div.row', { 'data-focus': '', 'data-key': 'location' },
      h('div.txt', {}, h('div.k', {}, 'Emulation folder'), h('div.d', {}, st.driveReady ? st.root : `${st.root} · this drive isn’t connected`)),
      h('div.val', {}, 'Move to another drive'));
    r._activate = () => moveDrive(r);
    return r;
  }

  const gamesFor = (sysId) => state.library.filter((g) => g.systemId === sysId && !g.hidden).sort((a, b) => a.sortTitle.localeCompare(b.sortTitle));
  const recentRetro = (n) => state.library.filter((g) => g.systemId && g.lastPlayed && !g.hidden).sort((a, b) => b.lastPlayed - a.lastPlayed).slice(0, n);
  const emuOf = (id) => st && st.emulators.find((e) => e.id === id);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const listText = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

  // ---- Quick Resume: which games have a saved place (fetched per page, cleared when games end)
  let resumes = {};
  async function loadResumes(games) {
    const ids = games.map((g) => g.id).filter((id) => !(id in resumes));
    if (!ids.length) return;
    let got = {};
    try { got = await window.p360.emu.resumes(ids); } catch { /* none */ }
    for (const id of ids) resumes[id] = got[id] || null;
  }

  function gameTile(g) {
    const t = coverTile(g);
    const r = resumes[g.id];
    if (r) t.append(h('div.qr-badge', {}, iconEl('restart'), 'Quick Resume'));
    t._activate = () => launchGame(g.id);
    t._game = g;
    return t;
  }

  async function gameMenu(g) {
    const r = resumes[g.id];
    const pick = await menu({
      title: g.title,
      items: [
        { label: r ? 'Resume' : 'Play', value: 'play', icon: 'play', right: r ? `Saved ${fmtAgo(r.at).toLowerCase()}` : '' },
        ...(r ? [{ label: 'Start over', value: 'fresh', icon: 'restart', right: 'Ignores the Quick Resume save' }] : []),
        { label: 'Details', value: 'details', icon: 'grid' },
      ],
    });
    if (pick === 'play') launchGame(g.id);
    else if (pick === 'fresh') launchGame(g.id, { fresh: true });
    else if (pick === 'details') openDetails(g.id, { toast: ctx.toast });
  }

  async function install(emuId) {
    const e = emuOf(emuId);
    if (!e) return;
    const ok = await confirm({
      title: `Install ${e.name}?`,
      text: `${e.about}\n\nDownloads the official ${e.name} build (${e.license}) from ${e.site} and sets it up for your controller and full screen.`,
      buttons: [{ label: `Install ${e.name}`, value: true, icon: 'folder' }, { label: 'Cancel', value: false }],
    });
    if (!ok) return;
    ctx.toast({ kind: 'orb', icon: 'folder', title: `Installing ${e.name}`, text: 'Downloading from the official site…', duration: 3000 });
    try { await window.p360.emu.install(emuId); }
    catch (err) { ctx.toast({ title: `Couldn't install ${e.name}`, text: err.message, sound: 'error' }); }
  }

  // ---- one press: every emulator and core your games need
  let settingUp = false;
  async function setupAll() {
    if (settingUp || (st && st.move)) return;
    const s = st && st.setup;
    if (!s || s.ready) { ctx.toast({ title: 'Everything’s ready', text: 'Every game you have can play', sound: 'select' }); return; }
    settingUp = true;
    split.rerender();
    ctx.toast({ kind: 'orb', icon: 'folder', title: 'Getting everything ready', text: 'Official builds, set up for your controller', duration: 3500 });
    try {
      const r = await window.p360.emu.setupAll();
      if (r.failed && r.failed.length) ctx.toast({ title: 'Some parts didn’t install', text: r.failed.join(' · '), sound: 'error', duration: 8000 });
      else ctx.toast({ kind: 'orb', icon: 'controller', title: 'Everything’s ready', text: r.done.length ? `Installed ${listText(r.done)}` : 'Every game you have can play', sound: 'achievement' });
    } catch (e) { ctx.toast({ title: 'Setup stopped', text: e.message, sound: 'error' }); }
    finally { settingUp = false; await load(); split.rerender(); }
  }

  function setupNeeds() {
    const s = st.setup;
    return [...s.emulators.map((e) => e.name), s.cores.length ? plural(s.cores.length, 'RetroArch core') : null].filter(Boolean);
  }

  function setupRow(total) {
    const busy = st.emulators.find((e) => e.progress && e.progress.phase !== 'failed');
    const val = settingUp || busy ? (busy ? `${busy.name} · ${PHASE[busy.progress.phase] || 'Working…'}${busy.progress.phase === 'downloading' ? ` ${pct(busy.progress)}%` : ''}` : 'Installing…') : 'Press A';
    const r = h('div.row.emu-setup', { 'data-focus': '', 'data-key': 'setup' },
      h('div.check.wait', {}, '!'),
      h('div.txt', {}, h('div.k', {}, 'Get everything ready'),
        h('div.d', {}, `Installs ${listText(setupNeeds())} so ${total === 1 ? 'your game' : `all ${total} of your games`} can play. Official open-source builds, set up for your controller and full screen.`)),
      h('div.val', {}, val));
    r._activate = setupAll;
    return r;
  }

  function emuButton(emuId) {
    const e = emuOf(emuId);
    if (!e) return null;
    const p = e.progress;
    if (p && p.phase !== 'failed') return button(`${PHASE[p.phase] || 'Working…'}${p.phase === 'downloading' ? ` ${pct(p)}%` : ''}`, { icon: 'clock', onActivate: () => {} });
    if (e.installed) return button(`${e.name} ready${e.version ? ` · ${e.version}` : ''}`, { icon: 'controller', right: 'Reinstall', onActivate: () => install(emuId) });
    return button(`Install ${e.name}`, { icon: 'folder', right: p && p.phase === 'failed' ? 'Retry' : '', onActivate: () => install(emuId) });
  }

  const statusOf = (s) => (!s.emulatorInstalled ? `Needs ${s.emulatorName}` : !s.bios.ok && !s.usingFallback ? 'BIOS missing' : s.games ? 'Ready' : 'Add games');
  const openSystem = (id) => split.select(`sys:${id}`).then(() => { const f = split.pane.querySelector('.games-grid-small [data-focus]') || split.pane.querySelector('[data-focus]'); if (f) split.focus.set(f); });

  function systemTile(s) {
    const status = statusOf(s);
    // Up to three of the system's box covers fanned out on the tile.
    const covers = gamesFor(s.id).map((g) => artUrl(g, 'cover')).filter(Boolean).slice(0, 3);
    const t = h('div.tile.sys-tile', { 'data-focus': '', 'data-key': `sys:${s.id}` },
      h('div.frame', { style: { '--s1': s.color } },
        covers.length ? h('div.sys-art', {}, ...covers.map((u, i) => h('img', { src: u, alt: '', style: { '--i': String(i) } }))) : null,
        h('div.sys-short', {}, s.short),
        h('div.sys-foot', {},
          h('div.sys-meta', {}, h('div.sys-name', {}, s.name), h('div.sys-sub', {}, `${s.games ? plural(s.games, 'game') : 'No games yet'} · ${s.maker} ${s.year}`)),
          h(`div.sys-status${status === 'Ready' ? '.ok' : ''}`, {}, status))));
    t._activate = () => openSystem(s.id);
    return t;
  }

  function miniTile(s) {
    const t = h('div.sys-mini', { 'data-focus': '', 'data-key': `mini:${s.id}`, style: { '--s1': s.color } },
      h('div.n', {}, s.short), h('div.m', {}, `${s.maker} · ${s.year}`));
    t._activate = () => openSystem(s.id);
    return t;
  }

  const RENDER = {
    async home(pane) {
      const withGames = st.systems.filter((s) => s.games).sort((a, b) => (b.games - a.games) || a.year - b.year);
      const total = withGames.reduce((n, s) => n + s.games, 0);
      pane.append(h('h2', {}, 'home'));
      if (!total) {
        pane.append(h('div.lead', {}, `Put your games in ${st.dirs.roms}\\<system> (one folder per system is already there) and they show up here with box art. Emulators install with one press and are set up for your controller.`));
        const r = h('div.row', { 'data-focus': '', 'data-key': 'addgames' },
          h('div.txt', {}, h('div.k', {}, 'Add your games'), h('div.d', {}, 'Opens the games folder on the desktop. Press the Xbox button to come back, then choose Rescan games.')),
          h('div.val', {}, 'Open folder'));
        r._activate = async () => { await window.p360.emu.openFolder('roms'); ctx.toast({ title: 'Folder opened', text: 'Press the Xbox button to come back', duration: 4000 }); };
        pane.append(r);
      } else if (!st.setup.ready) pane.append(setupRow(total));

      const recent = recentRetro(6);
      if (recent.length) {
        await loadResumes(recent);
        pane.append(h('div.sec-k', {}, 'Continue playing'));
        const row = h('div.games-grid-small.recent-row');
        recent.forEach((g) => row.append(gameTile(g)));
        pane.append(row);
      }
      if (withGames.length) {
        pane.append(h('div.sec-k', {}, `Your systems · ${plural(total, 'game')}`));
        const grid = h('div.tilegrid.four');
        withGames.forEach((s) => grid.append(systemTile(s)));
        pane.append(grid);
      }
      const rest = st.systems.filter((s) => !s.games).sort((a, b) => a.maker.localeCompare(b.maker) || a.year - b.year);
      if (rest.length) {
        pane.append(h('div.sec-k', {}, withGames.length ? 'More systems' : 'Systems'));
        const grid = h('div.sys-minis');
        rest.forEach((s) => grid.append(miniTile(s)));
        pane.append(grid);
      }
    },
    async system(pane, id) {
      const s = st.systems.find((x) => x.id === id);
      if (!s) return;
      pane.append(h('h2', {}, s.short.toLowerCase()), h('div.lead', {}, `${s.name} · ${s.maker} ${s.year} · ${s.exts.map((e) => '.' + e).join(' ')}${s.folders ? ' · or game folders' : ''}`));
      const row = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '14px' } },
        emuButton(s.emulator),
        button('Open games folder', { icon: 'folder', onActivate: async () => { await window.p360.emu.openFolder('roms', s.id); ctx.toast({ title: 'Folder opened', text: 'Press the Xbox button to come back', duration: 4000 }); } }),
        button('Rescan games', { icon: 'restart', onActivate: rescan }));
      pane.append(row);
      if (s.usingFallback) {
        pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, 'Runs without a BIOS'), h('div.d', {}, `Using ${s.fallbackNote}. For the best compatibility, add ${s.bios.missing.join(' or ')} from your own console to the BIOS folder.`)), h('div.check.ok', {}, '✓')));
      } else if (s.bios.missing && s.bios.missing.length) {
        pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, 'BIOS needed'), h('div.d', {}, `Put ${s.bios.missing.join(' + ')} in the BIOS folder (dumped from your own console). This system has no BIOS-free option.`)), h('div.check.bad', {}, '!')));
      }
      for (const n of s.notes || []) pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, n.title), h('div.d', {}, n.text)), h(`div.check.${n.ok ? 'ok' : 'bad'}`, {}, n.ok ? '✓' : '!')));
      if (s.core && !s.coreInstalled && s.emulatorInstalled) pane.append(h('div.lead', {}, 'The emulator core downloads automatically the first time you play.'));
      const games = gamesFor(s.id);
      if (!games.length) {
        pane.append(h('div.empty-note', { html: `No ${s.short} games yet.<br>Put them in <b>${s.romDir}</b> and choose Rescan.` }));
        return;
      }
      await loadResumes(games);
      pane.append(h('div.sec-k', {}, plural(games.length, 'game')));
      const grid = h('div.games-grid-small');
      games.forEach((g) => grid.append(gameTile(g)));
      pane.append(grid);
    },
    emulators(pane) {
      pane.append(h('h2', {}, 'emulators'), h('div.lead', {}, 'Official open-source builds, downloaded from each project and kept up to date when you reinstall. Everything lives in your Emulation folder.'));
      const total = st.systems.reduce((n, s) => n + s.games, 0);
      if (total && !st.setup.ready) pane.append(setupRow(total));
      for (const e of st.emulators) {
        const p = e.progress;
        const status = p ? (p.phase === 'failed' ? `Failed · ${p.error}` : `${PHASE[p.phase] || ''}${p.phase === 'downloading' ? ` ${pct(p)}%` : ''}`) : e.installed ? `Installed${e.version ? ` · ${e.version}` : ''}` : 'Not installed';
        const systems = st.systems.filter((s) => s.emulator === e.id).map((s) => s.short).join(', ');
        const r = h('div.row', { 'data-focus': '', 'data-key': `emu:${e.id}` },
          h('div.txt', {}, h('div.k', {}, e.name), h('div.d', {}, `${e.about} · ${systems} · ${e.license}`)),
          h(`div.check.${e.installed ? 'ok' : p && p.phase !== 'failed' ? 'wait' : 'bad'}`, { html: e.installed ? '✓' : p && p.phase !== 'failed' ? '…' : '+' }),
          h('div.val', {}, status));
        r._activate = () => install(e.id);
        pane.append(r);
      }
    },
    options(pane) {
      pane.append(h('h2', {}, 'options'), h('div.lead', {}, 'How emulated games start, save and look.'));
      const qr = h('div.row', { 'data-focus': '', 'data-key': 'qr' },
        h('div.txt', {}, h('div.k', {}, 'Quick Resume'), h('div.d', {}, 'Closing a game saves your exact place, and the next start picks up right there (games that run in RetroArch). Press Y on a game to start over instead.')),
        h(`div.toggle${st.quickResume ? '.on' : ''}`));
      qr._activate = async () => {
        try { st.quickResume = await window.p360.emu.quickResume(!st.quickResume); } catch (e) { ctx.toast({ title: 'Couldn’t change Quick Resume', text: e.message, sound: 'error' }); }
        resumes = {};
        split.rerender();
      };
      pane.append(qr);
      // Screen style for RetroArch games: left/right (or A) steps through the choices.
      const screens = st.screens || [];
      const at = Math.max(0, screens.findIndex((x) => x.id === st.screen));
      const sc = h('div.row', { 'data-focus': '', 'data-key': 'screen' },
        h('div.txt', {}, h('div.k', {}, 'Screen style'), h('div.d', {}, 'How RetroArch games look: Standard, Pixel perfect (sharp, whole-pixel scaling), Smooth, or CRT / LCD (scanlines on TV consoles, a pixel grid on handhelds).')),
        h('div.arrows', {}, h('span.ar', {}, '‹'), h('div.val', {}, (screens[at] || {}).label || 'Standard'), h('span.ar', {}, '›')));
      const step = async (dir) => {
        if (!screens.length) return;
        const next = screens[(at + dir + screens.length) % screens.length];
        try { st.screen = await window.p360.emu.screen(next.id); } catch (e) { ctx.toast({ title: 'Couldn’t change the screen style', text: e.message, sound: 'error' }); }
        split.rerender();
      };
      sc._adjust = step;
      sc._activate = () => step(1);
      pane.append(sc);
      const total = st.systems.reduce((n, s) => n + s.games, 0);
      const ready = h('div.row', { 'data-focus': '', 'data-key': 'ready' },
        h('div.txt', {}, h('div.k', {}, 'Get everything ready'), h('div.d', {}, st.setup.ready ? 'Every emulator and core your games need is installed.' : `Still needed: ${listText(setupNeeds())}.`)),
        h('div.val', {}, st.setup.ready ? 'All set' : total ? 'Install' : 'No games yet'));
      ready._activate = setupAll;
      pane.append(ready);
      const rs = h('div.row', { 'data-focus': '', 'data-key': 'rescan' },
        h('div.txt', {}, h('div.k', {}, 'Rescan games'), h('div.d', {}, 'Looks through your games folders again (it also happens on its own after installs and moves).')),
        h('div.val', {}, `${plural(total, 'game')}`));
      rs._activate = rescan;
      pane.append(rs);
    },
    bios(pane) {
      pane.append(h('h2', {}, 'bios & folders'), h('div.lead', {}, 'Free system files (Dolphin and PPSSPP data, RetroArch core info) and Sony’s official PS3 system software download automatically. Console BIOS dumps are copyrighted and can’t be downloaded — PS1, Saturn, DS, GBA and Dreamcast run without one; PS2, Sega CD and Xbox need yours.'));
      pane.append(h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '18px' } },
        button('Open BIOS folder', { icon: 'folder', onActivate: () => window.p360.emu.openFolder('bios') }),
        button('Open Emulation folder', { icon: 'folder', onActivate: () => window.p360.emu.openFolder('root') }),
        button('Get free system files', { icon: 'restart', onActivate: async () => {
          ctx.toast({ kind: 'orb', icon: 'folder', title: 'Downloading free system files…', text: 'Dolphin · PPSSPP · RetroArch info · PS3 (if RPCS3 is installed)', duration: 4000 });
          try { const done = await window.p360.emu.freeFiles(); ctx.toast({ title: 'System files ready', text: done.join(' · '), sound: 'select' }); split.rerender(); }
          catch (e) { ctx.toast({ title: 'Some files failed', text: e.message, sound: 'error' }); }
        } })));
      pane.append(locationRow());
      pane.append(h('div', { style: { maxWidth: '520px', margin: '14px 0 18px' } }, button('Download & install PS3 system software', { icon: 'power', right: 'from Sony', onActivate: async () => {
        try { ctx.toast({ title: 'Downloading PS3 system software from Sony…', duration: 4000 }); await window.p360.emu.ps3Firmware(); ctx.toast({ title: 'PS3 system software installed', sound: 'select' }); }
        catch (e) { ctx.toast({ title: 'Not installed', text: e.message, sound: 'error' }); }
      } })));
      // Only systems that actually have BIOS requirements report a `missing` list.
      for (const s of st.systems.filter((x) => x.bios && Array.isArray(x.bios.missing))) {
        const ok = s.bios.ok;
        const opt = (s.bios.optionalMissing || []).length;
        const text = s.usingFallback ? `Runs without BIOS (${s.fallbackNote}). Optional: ${s.bios.missing.join(' or ')}`
          : !ok ? `Needs your own: ${s.bios.missing.join(' + ')}` : opt ? `Optional, not found: ${s.bios.optionalMissing.join(' + ')} (games still run)` : 'BIOS found';
        const cls = s.usingFallback ? 'ok' : ok ? (opt ? 'wait' : 'ok') : 'bad';
        pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, s.name), h('div.d', {}, text)), h(`div.check.${cls}`, {}, cls === 'bad' ? '!' : cls === 'wait' ? '–' : '✓')));
      }
      pane.append(h('div.lead', { style: { marginTop: '16px' } }, `Folders: games ${st.dirs.roms} · BIOS ${st.dirs.bios} · saves ${st.dirs.saves}`));
    },
  };

  async function rescan() {
    ctx.toast({ title: 'Rescanning games…', duration: 2000 });
    try { await window.p360.library.rescan(); } catch { /* the toast below still reports the count */ }
    await load();
    resumes = {};
    split.rerender();
    ctx.toast({ title: 'Games rescanned', text: plural(st ? st.systems.reduce((n, s) => n + s.games, 0) : 0, 'game'), sound: 'select' });
  }

  const split = createSplit({
    sections: () => {
      const secs = [
        { id: 'home', label: 'Home', icon: 'home', count: st && st.systems.reduce((n, s) => n + s.games, 0) || undefined },
        { id: 'emulators', label: 'Emulators', icon: 'controller', count: st ? `${st.emulators.filter((e) => e.installed).length}/${st.emulators.length}` : undefined },
        { id: 'options', label: 'Options', icon: 'gear' },
        { id: 'bios', label: 'BIOS & folders', icon: 'shield' },
      ];
      if (st) {
        const cur = split && split.current();
        for (const s of st.systems) {
          if (s.games || cur === `sys:${s.id}`) secs.push({ id: `sys:${s.id}`, label: s.short, icon: 'ghost', count: s.games || undefined });
        }
      }
      return secs;
    },
    async render(id, pane, { isCurrent }) {
      if (!st) await load();
      if (!isCurrent()) return;
      if (!st) { pane.append(h('div.empty-note', {}, 'Emulation is unavailable.')); return; }
      if (id.startsWith('sys:')) await RENDER.system(pane, id.slice(4));
      else await RENDER[id](pane);
    },
  });

  return {
    id: 'retro',
    label: 'retro',
    accent: '#a65ae8',
    focus: split.focus,
    mount(content) { content.append(split.root); split.select('home'); },
    async activate() {
      split.activate();
      resumes = {}; // a game may have just ended with a new Quick Resume save
      await load();
      if (!split.inPane()) split.rerender(); else split.renderList(); // counts may have changed since the last scan
      ctx.setSub(st ? `${st.systems.reduce((n, s) => n + s.games, 0)} games` : '');
    },
    refresh(what) {
      if (what !== 'library') return;
      resumes = {};
      load().then(() => { const cur = split.current(); if (cur && (cur.startsWith('sys:') || cur === 'home') && !split.inPane()) split.rerender(); else split.renderList(); });
    },
    prompts() {
      const el = split.focus.current;
      if (!split.inPane()) return [{ btn: 'a', label: 'Select' }];
      if (el && el._game) return [{ btn: 'a', label: resumes[el._game.id] ? 'Resume' : 'Play' }, { btn: 'x', label: 'Details' }, { btn: 'y', label: 'More' }, { btn: 'b', label: 'Back' }];
      return [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }];
    },
    handle(a) {
      const el = split.focus.current;
      if (a === 'x' && el && el._game) { openDetails(el._game.id, { toast: ctx.toast }); return true; }
      if (a === 'y' && el && el._game) { gameMenu(el._game); return true; }
      return split.handle(a);
    },
  };
}

export { icon };
