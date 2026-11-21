// Game details side sheet (X on a game).
import { h, artUrl, fmtPlaytime, fmtAgo, SOURCE_LABEL } from '../util.js';
import { modal, button, confirm } from './modal.js';
import { gameById } from '../store.js';
import { launchGame } from './launch.js';
import { openArtPicker } from './artpicker.js';

export function openDetails(id, { toast } = {}) {
  const g = gameById(id);
  if (!g) return;
  modal({
    panelClass: 'details',
    sound: 'select',
    prompts: () => [{ btn: 'a', label: 'Select' }, { btn: 'b', label: 'Back' }],
    build(panel, close, focus) {
      const hero = h('div.hero');
      const heroUrl = artUrl(g, 'hero') || artUrl(g, 'banner');
      if (heroUrl) hero.style.backgroundImage = `url("${heroUrl}")`;
      if (g.systemId && g.artSources && g.artSources.hero === 'libretro') hero.classList.add('pixel-bg');
      const logo = artUrl(g, 'logo');
      if (logo) hero.append(h('img.logo', { src: logo, alt: '' }));
      const m = g.meta || {};
      const metaLine = [SOURCE_LABEL[g.source], g.platform, m.developer, m.released].filter(Boolean).join('  ·  ');
      const genres = (m.genres || []).slice(0, 4).join(', ');

      const play = button('Play', { icon: 'play', onActivate: () => { close(); launchGame(g.id); } });
      const fav = button(g.favorite ? 'Remove favorite' : 'Add to favorites', {
        icon: 'star',
        onActivate: async () => {
          await window.p360.library.update(g.id, { favorite: !g.favorite });
          close();
          toast && toast({ title: g.favorite ? 'Removed from favorites' : 'Added to favorites', text: g.title, sound: 'select', duration: 2600 });
        },
      });
      const art = button('Change artwork', {
        icon: 'image',
        onActivate: () => { close(); openArtPicker(g, { toast }); },
      });
      const refresh = button('Re-download artwork', {
        icon: 'restart',
        onActivate: async () => { await window.p360.library.refreshArt(g.id); close(); toast && toast({ title: 'Refreshing artwork', text: g.title, duration: 2600 }); },
      });
      const hide = button(g.hidden ? 'Unhide game' : 'Hide game', {
        icon: g.hidden ? 'eye' : 'eyeoff',
        onActivate: async () => {
          if (!g.hidden) {
            const ok = await confirm({ title: 'Hide this game?', text: `${g.title} will be hidden from your library. You can show hidden games again in System > Library.`, buttons: [{ label: 'Hide', value: true }, { label: 'Cancel', value: false }] });
            if (!ok) return;
          }
          await window.p360.library.update(g.id, { hidden: !g.hidden });
          close();
        },
      });

      panel.append(hero, h('div.body', {},
        logo ? null : h('div.dt', {}, g.title),
        logo ? h('div.dt', { style: { fontSize: '34px' } }, g.title) : null,
        h('div.dm', {}, metaLine), genres ? h('div.dm', {}, genres) : null,
        m.description ? h('div.desc', {}, m.description) : null,
        h('div.dstats', {},
          h('div.stat', {}, h('div.v', {}, fmtPlaytime(g.playtime)), h('div.k', {}, 'Played')),
          h('div.stat', {}, h('div.v', {}, fmtAgo(g.lastPlayed)), h('div.k', {}, 'Last played')),
          h('div.stat', {}, h('div.v', {}, String(g.launches || 0)), h('div.k', {}, 'Sessions'))),
        h('div.actions', {}, play, fav, art, refresh, hide)));
      focus.set(play);
    },
  });
}
