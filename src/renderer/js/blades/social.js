// Social blade: gamer card, achievements, Steam friends, activity, notifications, profiles.
import { h, fmtPlaytime, fmtAgo } from '../util.js';
import { avatar, AVATARS, icon, orb } from '../icons.js';
import * as sound from '../sound.js';
import { state, setting, saveSetting, visibleGames, gameById } from '../store.js';
import { createSplit } from './split.js';
import { button, osk, avatarPicker } from '../components/modal.js';
import { openAvatarEditor } from '../avatar/editor.js';

export function socialBlade(ctx) {
  let friends = null;
  let friendsLoading = false;

  async function loadFriends(force = false) {
    if (friendsLoading || (friends && !force)) return;
    friendsLoading = true;
    try { friends = await window.p360.social.get(); } catch (e) { friends = { friends: [], error: e.message }; }
    friendsLoading = false;
    if (split.current() === 'friends') split.rerender();
    split.renderList();
  }

  const stateText = (f) => (f.state === 'ingame' && f.game ? `Playing ${f.game.name}` : { online: 'Online', away: 'Away', busy: 'Busy', snooze: 'Snooze', offline: f.lastOnline ? `Last online ${fmtAgo(f.lastOnline).toLowerCase()}` : 'Offline' }[f.state] || 'Offline');

  const RENDER = {
    card(pane) {
      const p = state.settings.profile || {};
      const games = visibleGames();
      const total = games.reduce((s, g) => s + (g.playtime || 0), 0);
      const t = state.achievements.totals;
      // A opens a picker; left/right just move between the three buttons in this row.
      const pic = button('Change gamer picture', { icon: 'image', onActivate: async () => {
        const v = await avatarPicker({ current: p.avatar || 0 });
        if (v !== null && v !== (p.avatar || 0)) { await saveSetting('profile.avatar', v); split.rerender(); }
      } });
      const tag = button('Change gamertag', { icon: 'user', onActivate: async () => { const v = await osk({ title: 'Gamertag', value: p.gamertag, maxLength: 15 }); if (v && v.trim()) { await saveSetting('profile.gamertag', v.trim()); split.rerender(); } } });
      const avatarBtn = button('Edit avatar', { icon: 'user', onActivate: () => openAvatarEditor({ toast: ctx.toast }) });
      const motto = button('Edit motto', { icon: 'info', onActivate: async () => { const v = await osk({ title: 'Motto', value: p.motto, maxLength: 40 }); if (v !== null) { await saveSetting('profile.motto', v.trim()); split.rerender(); } } });
      const played = games.filter((g) => g.playtime > 0).sort((a, b) => b.playtime - a.playtime);
      const max = played[0] ? played[0].playtime : 1;
      pane.append(h('div.card.gamercard', {},
        h('div.top', {}, avatar(p.avatar || 0), h('div', {},
          h('div.tag', {}, p.gamertag || 'Player'),
          h('div.score', {}, h('span.gcoin', {}, 'G'), `${t.score.toLocaleString()} / ${t.max.toLocaleString()}`),
          h('div.motto', {}, p.motto ? `“${p.motto}”` : ''))),
        h('div.stats', {},
          h('div.stat', {}, h('div.v', {}, String(games.length)), h('div.k', {}, 'Games')),
          h('div.stat', {}, h('div.v', {}, fmtPlaytime(total)), h('div.k', {}, 'Time played')),
          h('div.stat', {}, h('div.v', {}, `${t.unlocked}/${t.count}`), h('div.k', {}, 'Achievements')),
          h('div.stat', {}, h('div.v', {}, String(games.reduce((s, g) => s + (g.launches || 0), 0))), h('div.k', {}, 'Sessions'))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(max-content, 1fr))', gap: '12px' } }, avatarBtn, pic, tag, motto)));
      pane.append(h('h2', { style: { marginTop: '28px' } }, 'most played'), h('div.bars', {}, ...(played.length ? played.slice(0, 6).map((g) => h('div.bar-row', {},
        h('div.n', {}, g.title), h('div.trk', {}, h('div.fill', { style: { width: `${Math.max(3, (g.playtime / max) * 100)}%` } })), h('div.v', {}, fmtPlaytime(g.playtime)))) : [h('div.empty-note', {}, 'Play something and your stats show up here.')])));
    },
    achievements(pane) {
      const t = state.achievements.totals;
      pane.append(h('h2', {}, 'achievements'), h('div.lead', {}, `${t.unlocked} of ${t.count} unlocked · ${t.score.toLocaleString()}G of ${t.max.toLocaleString()}G. Earn them by using your console.`));
      const list = [...state.achievements.list].sort((a, b) => (b.unlockedAt ? 1 : 0) - (a.unlockedAt ? 1 : 0) || b.unlockedAt - a.unlockedAt);
      const grid = h('div.ach-grid');
      for (const a of list) {
        grid.append(h(`div.ach${a.unlockedAt ? '.on' : ''}`, { 'data-focus': '' }, h('div.ic', { html: icon(a.unlockedAt ? a.icon : 'shield') }),
          h('div.tx', {}, h('div.n', {}, a.title), h('div.d', {}, a.unlockedAt ? `${a.desc} · ${fmtAgo(a.unlockedAt)}` : a.desc)),
          h('div.pts', {}, h('span.gcoin', {}, 'G'), String(a.points))));
      }
      pane.append(grid);
    },
    friends(pane) {
      pane.append(h('h2', {}, 'friends'));
      if (!friends) { loadFriends(); pane.append(h('div.empty-note', {}, 'Loading friends…'), orb('fast')); return; }
      if (friends.needsKey) {
        pane.append(h('div.lead', { html: 'See which of your Steam friends are online and what they’re playing. Get a free <b>Steam Web API key</b> at steamcommunity.com/dev/apikey and enter it below.' + (friends.steamId ? `<br>Detected Steam account: ${friends.steamId}` : '') }));
        pane.append(h('div', { style: { display: 'flex', gap: '14px' } },
          button('Enter Steam Web API key', { icon: 'user', onActivate: async () => {
            const v = await osk({ title: 'Steam Web API key', value: setting('social.steamApiKey'), maxLength: 64 });
            if (v === null) return;
            await saveSetting('social.steamApiKey', v.trim());
            friends = null; loadFriends(true);
          } }),
          button('Set Steam ID', { icon: 'info', onActivate: async () => { const v = await osk({ title: 'SteamID64', value: setting('social.steamId') || friends.steamId || '', maxLength: 20 }); if (v !== null) { await saveSetting('social.steamId', v.trim()); friends = null; loadFriends(true); } } })));
        return;
      }
      if (friends.error && !friends.friends.length) pane.append(h('div.empty-note', {}, friends.error));
      const online = friends.friends.filter((f) => f.state !== 'offline').length;
      pane.append(h('div.lead', {}, `${online} online · ${friends.friends.length} friends`));
      const grid = h('div.friends-grid');
      for (const f of friends.friends) {
        const img = f.avatarUrl ? h('img', { src: f.avatarUrl, alt: '' }) : h('div.ph');
        grid.append(h('div.friend', { 'data-focus': '' }, img, h('div.tx', {}, h('div.n', {}, f.name), h('div.st', {}, h(`span.dot.${f.state}`), stateText(f)))));
      }
      pane.append(grid);
      pane.append(h('div', { style: { marginTop: '22px', maxWidth: '360px' } }, button('Refresh', { icon: 'restart', onActivate: () => loadFriends(true) })));
    },
    activity(pane) {
      pane.append(h('h2', {}, 'recent activity'));
      if (!state.sessions.length) { pane.append(h('div.empty-note', {}, 'No recent activity yet.')); return; }
      pane.append(h('div.activity', {}, ...state.sessions.slice(0, 20).map((s) => {
        const g = gameById(s.id);
        return h('div.act', { 'data-focus': '' }, h('span.ldot'), h('span', {}, `Played ${g ? g.title : 'a game'} for ${fmtPlaytime(s.seconds)}`), h('span.when', {}, fmtAgo(s.end)));
      })));
    },
    notifications(pane) {
      pane.append(h('h2', {}, 'notifications'));
      const list = state.notifications || [];
      if (!list.length) { pane.append(h('div.empty-note', {}, 'Nothing new.')); return; }
      pane.append(h('div.activity', {}, ...list.slice(0, 30).map((n) => h('div.act', { 'data-focus': '' }, h('span.ldot'), h('span', {}, `${n.title}${n.text ? ' — ' + n.text : ''}`), h('span.when', {}, fmtAgo(n.at))))));
    },
    profiles(pane) {
      pane.append(h('h2', {}, 'profiles'), h('div.lead', {}, 'Each profile keeps its own favorites, playtime and achievements.'));
      pane.append(h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '620px' } },
        button('Switch profile / sign in', { icon: 'user', onActivate: () => ctx.signIn && ctx.signIn() }),
        button(setting('console.askProfile') ? 'Ask who’s playing at startup: On' : 'Ask who’s playing at startup: Off', { icon: 'controller', onActivate: async () => { await saveSetting('console.askProfile', !setting('console.askProfile')); split.rerender(); } })));
    },
  };

  const split = createSplit({
    sections: () => [
      { id: 'card', label: 'Gamer card', icon: 'user' },
      { id: 'achievements', label: 'Achievements', icon: 'trophy', count: `${state.achievements.totals.unlocked}/${state.achievements.totals.count}` },
      { id: 'friends', label: 'Friends', icon: 'live', count: friends && friends.friends ? friends.friends.filter((f) => f.state !== 'offline').length : undefined },
      { id: 'activity', label: 'Activity', icon: 'clock' },
      { id: 'notifications', label: 'Notifications', icon: 'info', count: (state.notifications || []).length || undefined },
      { id: 'profiles', label: 'Profiles', icon: 'controller' },
    ],
    async render(id, pane) {
      if (id === 'activity') { try { state.sessions = await window.p360.library.sessions(); } catch { /* ignore */ } }
      RENDER[id](pane);
    },
  });

  return {
    id: 'social',
    label: 'social',
    accent: '#3ec21a',
    focus: split.focus,
    mount(content) { content.append(split.root); split.select('card'); },
    activate() { split.activate(); ctx.setSub(''); loadFriends(); },
    refresh(what) {
      const cur = split.current();
      if (what === 'achievements' && (cur === 'achievements' || cur === 'card')) split.rerender();
      else if (what === 'settings' && cur === 'card' && !split.inPane()) split.rerender();
      else if (what === 'notifications' && cur === 'notifications' && !split.inPane()) split.rerender();
      else if (what === 'achievements' || what === 'notifications') split.renderList();
    },
    prompts() { return split.inPane() ? [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }] : [{ btn: 'a', label: 'Select' }]; },
    handle: (a) => split.handle(a),
  };
}
