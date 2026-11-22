// Arcade blade: the built-in games, each with its leaderboard and achievements.
import { h, artUrl, fmtPlaytime } from '../util.js';
import { iconEl, avatar } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { state } from '../store.js';
import { coverTile } from '../components/tiles.js';
import { openDetails } from '../components/details.js';
import { modal, button } from '../components/modal.js';
import { GAMES, playArcade } from '../arcade/index.js';

const ORDER = ['pulse', 'prism', 'glow'];
const ACH = {
  pulse: ['pulse-50k', 'pulse-wave10', 'pulse-nobomb'],
  prism: ['prism-level5', 'prism-perfect', 'prism-multiball'],
  glow: ['glow-20k', 'glow-cascade', 'glow-nova'],
};

export function arcadeBlade(ctx) {
  const root = h('div.arcadeb');
  const shelf = h('div.arc-shelf');
  const panel = h('div.arc-info');
  root.append(shelf, panel);
  const boards = {};
  const bests = {};
  let current = ORDER[0];

  const gameOf = (key) => state.library.find((g) => g.id === `arcade:${key}`) || { id: `arcade:${key}`, title: GAMES[key].title, art: {} };
  const me = () => state.settings.activeProfile;
  const best = (key) => Math.max(bests[key] || 0, (boards[key] || []).filter((r) => r.pid === me()).reduce((m, r) => Math.max(m, r.score), 0));
  const rank = (key) => { const i = (boards[key] || []).findIndex((r) => r.pid === me()); return i >= 0 ? i + 1 : 0; };

  const focus = new nav.Focus(root, {
    onChange: (el) => {
      if (!el.dataset.key || el.dataset.key === current) return;
      current = el.dataset.key;
      ctx.setAmbient(artUrl(gameOf(current), 'hero'));
      paintPanel();
    },
  });

  async function loadBoards() {
    await Promise.all(ORDER.map(async (k) => {
      try { const r = await window.p360.arcade.board(k); boards[k] = r.rows || []; bests[k] = r.best || 0; } catch { boards[k] = boards[k] || []; }
    }));
    paintShelf();
    paintPanel();
  }

  function play(key) {
    sound.play('launch');
    playArcade(`arcade:${key}`);
  }
  // Scores changed (a run finished, from here, Details or the Guide): refresh.
  window.p360.on('arcade:updated', () => loadBoards());

  function paintShelf() {
    const focusedKey = focus.current && focus.current.dataset.key;
    shelf.replaceChildren();
    for (const key of ORDER) {
      const def = GAMES[key];
      const g = gameOf(key);
      const tile = coverTile(g);
      tile.dataset.key = key;
      tile._activate = () => play(key);
      const b = best(key);
      const item = h('div.arc-item', {}, tile,
        h('div.arc-name', {}, def.title),
        h('div.arc-best', { style: { color: def.accent } }, b ? `Your best ${b.toLocaleString()}` : def.tagline));
      shelf.append(item);
      if (focusedKey === key) focus.set(tile);
    }
  }

  function paintPanel() {
    const key = current;
    const def = GAMES[key];
    const g = gameOf(key);
    const rows = boards[key] || [];
    const b = best(key);
    const r = rank(key);
    const ach = state.achievements.list || [];
    const mine = ACH[key].map((id) => ach.find((a) => a.id === id)).filter(Boolean);
    const got = mine.filter((a) => a.unlockedAt).length;

    panel.replaceChildren(
      h('div.arc-k', {}, def.tagline),
      h('div.arc-ptitle', { style: { color: def.accent } }, def.title),
      h('div.arc-desc', {}, (g.meta && g.meta.description) || ''),
      h('div.arc-stats', {},
        h('div.stat', {}, h('div.v', {}, b ? b.toLocaleString() : '—'), h('div.k', {}, 'Your best')),
        h('div.stat', {}, h('div.v', {}, r ? `#${r}` : '—'), h('div.k', {}, 'Rank')),
        h('div.stat', {}, h('div.v', {}, g.playtime ? fmtPlaytime(g.playtime) : '—'), h('div.k', {}, 'Played'))),
      h('div.arc-k', {}, 'Leaderboard'),
      rows.length
        ? h('div.arc-lb', {}, ...rows.slice(0, 5).map((row) => h(`div.arc-lrow${row.pid === me() ? '.me' : ''}`, {},
          h('span.rk', {}, `${row.rank}`), avatar(row.avatar || 0), h('span.gt', {}, row.gamertag), h('span.sc', {}, row.score.toLocaleString()))))
        : h('div.arc-empty', {}, 'No scores yet. Be the first on the board.'),
      h('div.arc-k', {}, `Achievements · ${got} of ${mine.length}`),
      h('div.arc-ach', {}, ...mine.map((a) => h(`div.arc-a${a.unlockedAt ? '.on' : ''}`, { title: a.desc },
        h('div.ic', {}, iconEl(a.icon || 'trophy')), h('div', {}, h('div.t', {}, a.title), h('div.d', {}, a.desc.replace(/^[^:]+:\s*/, ''))), h('div.pts', {}, `${a.points}G`)))),
    );
  }

  function fullBoard(key) {
    const def = GAMES[key];
    const rows = boards[key] || [];
    modal({
      panelClass: 'dialog arc-board-dlg',
      build(p, close) {
        p.append(h('h3', {}, `${def.title} · leaderboard`),
          rows.length
            ? h('div.arc-lb.big', {}, ...rows.map((row) => h(`div.arc-lrow${row.pid === me() ? '.me' : ''}`, {},
              h('span.rk', {}, `${row.rank}`), avatar(row.avatar || 0), h('span.gt', {}, row.gamertag), h('span.sc', {}, row.score.toLocaleString()))))
            : h('p', {}, 'No scores yet. Be the first on the board.'),
          h('div.btns', {}, button('Play', { icon: 'play', onActivate: () => { close(); play(key); } }), button('Close', { onActivate: () => close() })));
      },
    });
  }

  return {
    id: 'arcade',
    label: 'arcade',
    accent: '#ff5aa8',
    focus,
    mount(content) { content.append(root); paintShelf(); paintPanel(); },
    activate() {
      if (!focus.ensure()) { const t = shelf.querySelector(`[data-key="${current}"]`); if (t) focus.set(t); }
      ctx.setAmbient(artUrl(gameOf(current), 'hero'));
      loadBoards();
    },
    refresh(what) {
      if (what === 'library') { paintShelf(); paintPanel(); }
      if (what === 'achievements') paintPanel();
      if (what === 'settings') loadBoards(); // another player took over: their best and rank
    },
    prompts() {
      return [{ btn: 'a', label: 'Play' }, { btn: 'x', label: 'Details' }, { btn: 'y', label: 'Leaderboard' }];
    },
    handle(action) {
      if (['up', 'down', 'left', 'right'].includes(action)) { focus.handleDir(action); return true; }
      if (action === 'a') { if (focus.activate()) sound.play('select'); return true; }
      if (action === 'x') { openDetails(`arcade:${current}`, { toast: ctx.toast }); return true; }
      if (action === 'y') { fullBoard(current); return true; }
      return false;
    },
  };
}
