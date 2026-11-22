// Retro blade: every emulated system, its games, emulator installs and BIOS status.
import { h } from '../util.js';
import { icon } from '../icons.js';
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
  let lastSig = '';
  window.p360.on('emu:updated', (s) => {
    const wasMoving = !!(st && st.move);
    const sig = sigOf(s);
    const changed = sig !== lastSig;
    lastSig = sig;
    st = s;
    const cur = split.current();
    if (cur === 'bios' && (wasMoving !== !!s.move)) split.rerender();
    else if (cur === 'bios' && s.move && moveVal && moveVal.isConnected) moveVal.textContent = moveText(s.move);
    else if (!changed) return;
    else if (cur === 'emulators' || (cur && cur.startsWith('sys:'))) split.rerender();
    else split.renderList();
  });

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
  const emuOf = (id) => st && st.emulators.find((e) => e.id === id);

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

  function emuButton(emuId) {
    const e = emuOf(emuId);
    if (!e) return null;
    const p = e.progress;
    if (p && p.phase !== 'failed') return button(`${PHASE[p.phase] || 'Working…'}${p.phase === 'downloading' ? ` ${pct(p)}%` : ''}`, { icon: 'clock', onActivate: () => {} });
    if (e.installed) return button(`${e.name} ready${e.version ? ` · ${e.version}` : ''}`, { icon: 'controller', right: 'Reinstall', onActivate: () => install(emuId) });
    return button(`Install ${e.name}`, { icon: 'folder', right: p && p.phase === 'failed' ? 'Retry' : '', onActivate: () => install(emuId) });
  }

  function systemTile(s) {
    const status = !s.emulatorInstalled ? `Needs ${s.emulatorName}` : !s.bios.ok && !s.usingFallback ? 'BIOS missing' : s.games ? 'Ready' : 'Add games';
    const t = h('div.tile.sys-tile', { 'data-focus': '' },
      h('div.frame', { style: { '--s1': s.color } },
        h('div.sys-short', {}, s.short),
        h('div.sys-foot', {},
          h('div.sys-meta', {}, h('div.sys-name', {}, s.name), h('div.sys-sub', {}, `${s.games ? `${s.games} game${s.games === 1 ? '' : 's'}` : 'No games yet'} · ${s.maker} ${s.year}`)),
          h(`div.sys-status${status === 'Ready' ? '.ok' : ''}`, {}, status))));
    t._activate = () => split.select(`sys:${s.id}`).then(() => { const f = split.pane.querySelector('[data-focus]'); if (f) split.focus.set(f); });
    return t;
  }

  const RENDER = {
    systems(pane) {
      pane.append(h('h2', {}, 'systems'), h('div.lead', {}, `Drop games into ${st.dirs.roms}\\<system> and they appear here with box art. Emulators install with one press and are set up for your controller.`));
      const grid = h('div.tilegrid.four');
      const sorted = [...st.systems].sort((a, b) => (b.games - a.games) || a.year - b.year);
      sorted.forEach((s) => grid.append(systemTile(s)));
      pane.append(grid);
    },
    system(pane, id) {
      const s = st.systems.find((x) => x.id === id);
      if (!s) return;
      pane.append(h('h2', {}, s.short.toLowerCase()), h('div.lead', {}, `${s.name} · ${s.maker} ${s.year} · ${s.exts.map((e) => '.' + e).join(' ')}`));
      const row = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '14px' } },
        emuButton(s.emulator),
        button('Open games folder', { icon: 'folder', onActivate: async () => { await window.p360.emu.openFolder('roms', s.id); ctx.toast({ title: 'Folder opened', text: 'Press the Xbox button to come back', duration: 4000 }); } }),
        button('Rescan games', { icon: 'restart', onActivate: async () => { await window.p360.library.rescan(); await load(); split.rerender(); ctx.toast({ title: 'Games rescanned', sound: 'select' }); } }));
      pane.append(row);
      if (s.usingFallback) {
        pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, 'Runs without a BIOS'), h('div.d', {}, `Using ${s.fallbackNote}. For the best compatibility, add ${s.bios.missing.join(' or ')} from your own console to the BIOS folder.`)), h('div.check.ok', {}, '✓')));
      } else if (s.bios.missing && s.bios.missing.length) {
        pane.append(h('div.row.info', {}, h('div.txt', {}, h('div.k', {}, 'BIOS needed'), h('div.d', {}, `Put ${s.bios.missing.join(' + ')} in the BIOS folder (dumped from your own console). This system has no BIOS-free option.`)), h('div.check.bad', {}, '!')));
      }
      if (s.core && !s.coreInstalled && s.emulatorInstalled) pane.append(h('div.lead', {}, 'The emulator core downloads automatically the first time you play.'));
      const games = gamesFor(s.id);
      if (!games.length) {
        pane.append(h('div.empty-note', { html: `No ${s.short} games yet.<br>Put them in <b>${s.romDir}</b> and choose Rescan.` }));
        return;
      }
      const grid = h('div.games-grid-small');
      games.forEach((g) => {
        const t = coverTile(g);
        t._activate = () => launchGame(g.id);
        grid.append(t);
      });
      pane.append(grid);
    },
    emulators(pane) {
      pane.append(h('h2', {}, 'emulators'), h('div.lead', {}, 'Official open-source builds, downloaded from each project and kept up to date when you reinstall. Everything lives in your Emulation folder.'));
      for (const e of st.emulators) {
        const p = e.progress;
        const status = p ? (p.phase === 'failed' ? `Failed · ${p.error}` : `${PHASE[p.phase] || ''}${p.phase === 'downloading' ? ` ${pct(p)}%` : ''}`) : e.installed ? `Installed${e.version ? ` · ${e.version}` : ''}` : 'Not installed';
        const systems = st.systems.filter((s) => s.emulator === e.id).map((s) => s.short).join(', ');
        const r = h('div.row', { 'data-focus': '' },
          h('div.txt', {}, h('div.k', {}, e.name), h('div.d', {}, `${e.about} · ${systems} · ${e.license}`)),
          h(`div.check.${e.installed ? 'ok' : p && p.phase !== 'failed' ? 'wait' : 'bad'}`, { html: e.installed ? '✓' : p && p.phase !== 'failed' ? '…' : '+' }),
          h('div.val', {}, status));
        r._activate = () => install(e.id);
        pane.append(r);
      }
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

  const split = createSplit({
    sections: () => {
      const secs = [
        { id: 'systems', label: 'All systems', icon: 'grid', count: st ? st.systems.filter((s) => s.games).length || undefined : undefined },
        { id: 'emulators', label: 'Emulators', icon: 'controller', count: st ? `${st.emulators.filter((e) => e.installed).length}/${st.emulators.length}` : undefined },
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
      if (id.startsWith('sys:')) RENDER.system(pane, id.slice(4));
      else RENDER[id](pane);
    },
  });

  return {
    id: 'retro',
    label: 'retro',
    accent: '#a65ae8',
    focus: split.focus,
    mount(content) { content.append(split.root); split.select('systems'); },
    async activate() {
      split.activate();
      await load();
      if (!split.inPane()) split.rerender(); else split.renderList(); // counts may have changed since the last scan
      ctx.setSub(st ? `${st.systems.reduce((n, s) => n + s.games, 0)} games` : '');
    },
    refresh(what) {
      if (what !== 'library') return;
      load().then(() => { const cur = split.current(); if (cur && cur.startsWith('sys:') && !split.inPane()) split.rerender(); else split.renderList(); });
    },
    prompts() {
      const el = split.focus.current;
      if (!split.inPane()) return [{ btn: 'a', label: 'Select' }];
      return el && el.dataset.id ? [{ btn: 'a', label: 'Play' }, { btn: 'x', label: 'Details' }, { btn: 'b', label: 'Back' }] : [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }];
    },
    handle(a) {
      const el = split.focus.current;
      if (a === 'x' && el && el.dataset.id) { openDetails(el.dataset.id, { toast: ctx.toast }); return true; }
      return split.handle(a);
    },
  };
}

export { icon };
