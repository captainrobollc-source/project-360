// Manual artwork picker: search by title, choose the right game's art.
import { h, fallbackColors } from '../util.js';
import { modal, osk } from './modal.js';

export async function openArtPicker(game, { toast } = {}) {
  const q = await osk({ title: 'Search for artwork', value: game.title, maxLength: 80 });
  if (!q || !q.trim()) return;
  toast && toast({ title: 'Searching for artwork…', text: q, duration: 1800 });
  let results = [];
  try { results = await window.p360.library.searchArt(q.trim()); } catch (e) { toast && toast({ title: 'Artwork search failed', text: e.message, sound: 'error' }); return; }
  if (!results.length) { toast && toast({ title: 'No artwork found', text: `Nothing matched “${q}”`, sound: 'error' }); return; }
  modal({
    panelClass: 'dialog artpick',
    sound: 'guide',
    prompts: () => [{ btn: 'a', label: 'Use this artwork' }, { btn: 'b', label: 'Cancel' }],
    build(panel, close, focus) {
      const grid = h('div.cands', { 'data-scroll': '' });
      for (const c of results.slice(0, 30)) {
        const frame = h('div.frame');
        const [a, b] = fallbackColors(c.title || c.id);
        frame.style.background = `linear-gradient(160deg, ${a}, ${b})`;
        const url = c.coverUrl || c.heroUrl || c.bannerUrl;
        if (url) {
          const img = h('img', { src: url, alt: '', loading: 'lazy' });
          img.onerror = () => img.remove();
          frame.append(img);
        }
        const t = h('div.tile.cand', { 'data-focus': '' }, frame, h('div.label', {}, h('div.t', {}, c.title || '?'), h('div.s', {}, String(c.source || '').toUpperCase())));
        t._activate = async () => {
          close();
          try {
            await window.p360.library.applyArt(game.id, c);
            toast && toast({ title: 'Artwork updated', text: game.title, sound: 'select' });
          } catch (e) { toast && toast({ title: 'Could not apply artwork', text: e.message, sound: 'error' }); }
        };
        grid.append(t);
      }
      panel.append(h('h3', {}, `Artwork for ${game.title}`), grid);
      focus.set(grid.firstChild);
    },
  });
}
