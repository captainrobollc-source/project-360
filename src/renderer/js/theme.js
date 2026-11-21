// Theme + background engine.
import { state, setting, on } from './store.js';
import { artUrl } from './util.js';

export const THEMES = [
  { id: 'classic', name: 'Classic Blades', bg: 'radial-gradient(60% 55% at 22% 42%, #8cd228 0%, #2a5a16 45%, #050805 100%)', blade: 'linear-gradient(180deg,#fff,#d3d8db)' },
  { id: 'nxe', name: 'NXE Night', bg: 'radial-gradient(120% 90% at 18% 8%, #323941 0%, #0b0d10 72%)', blade: 'linear-gradient(180deg,#4a515a,#16191d)' },
  { id: 'carbon', name: 'Carbon', bg: 'linear-gradient(180deg,#151515,#050505)', blade: 'linear-gradient(180deg,#2a2a2a,#111)' },
  { id: 'aurora', name: 'Aurora', bg: 'radial-gradient(55% 50% at 25% 35%, #5a46e6 0%, transparent 70%), radial-gradient(50% 45% at 80% 70%, #14beaa 0%, transparent 70%), #0a0a1f', blade: 'linear-gradient(180deg,#46406e,#121024)' },
];
export const BACKGROUNDS = [
  { id: 'default', name: 'Theme default' },
  { id: 'gameart', name: 'Last played game' },
];

export function apply() {
  const name = setting('theme.name') || 'classic';
  for (const t of THEMES) document.body.classList.toggle(`theme-${t.id}`, t.id === name);
  const bg = setting('theme.background') || 'default';
  document.body.classList.toggle('bg-gameart', bg === 'gameart');
  updateArt();
}

function updateArt() {
  const el = document.querySelector('#backdrop .bg-art');
  if (!el) return;
  if (setting('theme.background') !== 'gameart') { el.classList.remove('on'); return; }
  const g = [...state.library].filter((x) => x.lastPlayed && x.art && x.art.hero).sort((a, b) => b.lastPlayed - a.lastPlayed)[0]
    || state.library.find((x) => x.art && x.art.hero);
  const url = g && artUrl(g, 'hero');
  if (!url) { el.classList.remove('on'); return; }
  el.style.backgroundImage = `url("${url}")`;
  el.classList.add('on');
}

export function init() {
  apply();
  on('settings', apply);
  on('library', updateArt);
}
