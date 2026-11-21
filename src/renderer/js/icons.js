// Original icon set (24x24 paths) + the orb, ring and avatar artwork.
const P = {
  controller: 'M7 7h10a5 5 0 0 1 4.9 6l-.8 4a2.5 2.5 0 0 1-4.3 1.2L14.5 16h-5l-2.3 2.2A2.5 2.5 0 0 1 2.9 17l-.8-4A5 5 0 0 1 7 7zm0 3v1.5H5.5v1H7V14h1v-1.5h1.5v-1H8V10zm9.5.2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8zm-2 2a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8z',
  home: 'M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  play: 'M8 5v14l11-7z',
  film: 'M4 4h16v16H4zm2 2v2h2V6zm10 0v2h2V6zM6 10v4h12v-4zm0 6v2h2v-2zm10 0v2h2v-2z',
  music: 'M9 18a3 3 0 1 1-2-2.8V5l12-2v11a3 3 0 1 1-2-2.8V6.3l-8 1.4z',
  tv: 'M3 5h18v12H3zm2 2v8h14V7zM8 19h8v2H8z',
  live: 'M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM6.3 6.3l1.4 1.4a6 6 0 0 0 0 8.6l-1.4 1.4a8 8 0 0 1 0-11.4zm11.4 0a8 8 0 0 1 0 11.4l-1.4-1.4a6 6 0 0 0 0-8.6z',
  globe: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1.5 2.2A8 8 0 0 0 4.1 11h3.4c.1-2.5.9-4.9 3-6.8zm3 0c2.1 1.9 2.9 4.3 3 6.8h3.4a8 8 0 0 0-6.4-6.8zM9.5 11h5c-.1-2.3-.9-4.3-2.5-5.9-1.6 1.6-2.4 3.6-2.5 5.9zm-5.4 2a8 8 0 0 0 6.4 6.8c-2.1-1.9-2.9-4.3-3-6.8zm5.4 0c.1 2.3.9 4.3 2.5 5.9 1.6-1.6 2.4-3.6 2.5-5.9zm6.9 0c-.1 2.5-.9 4.9-3 6.8a8 8 0 0 0 6.4-6.8z',
  app: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 4v12h14V7z',
  gear: 'M10.2 2h3.6l.5 2.6c.7.2 1.3.6 1.9 1l2.5-.9 1.8 3.1-2 1.7a7 7 0 0 1 0 2.2l2 1.7-1.8 3.1-2.5-.9c-.6.4-1.2.8-1.9 1l-.5 2.6h-3.6l-.5-2.6c-.7-.2-1.3-.6-1.9-1l-2.5.9-1.8-3.1 2-1.7a7 7 0 0 1 0-2.2l-2-1.7 1.8-3.1 2.5.9c.6-.4 1.2-.8 1.9-1zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z',
  user: 'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z',
  power: 'M11 2h2v10h-2zM6.3 5.3l1.4 1.4A7 7 0 1 0 16.3 6.7l1.4-1.4A9 9 0 1 1 6.3 5.3z',
  sleep: 'M14.5 2.5A9.5 9.5 0 1 0 21.5 14 7.5 7.5 0 0 1 14.5 2.5z',
  restart: 'M12 4V1L7 5l5 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  desktop: 'M2 4h20v13H2zm2 2v9h16V6zM8 19h8v2H8zM5 7h4v3H5z',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
  search: 'M10 3a7 7 0 0 1 5.6 11.2l5.1 5.1-1.4 1.4-5.1-5.1A7 7 0 1 1 10 3zm0 2a5 5 0 1 0 0 10 5 5 0 0 0 0-10z',
  folder: 'M3 5h6l2 2h10v12H3z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z',
  volume: 'M4 9h4l5-4v14l-5-4H4zm12.5-1.5a6 6 0 0 1 0 9l-1.4-1.4a4 4 0 0 0 0-6.2zM19 5a9.5 9.5 0 0 1 0 14l-1.4-1.4a7.5 7.5 0 0 0 0-11.2z',
  mute: 'M4 9h4l5-4v14l-5-4H4zm11.3.3l1.4-1.4L19 10.2l2.3-2.3 1.4 1.4-2.3 2.3 2.3 2.3-1.4 1.4-2.3-2.3-2.3 2.3-1.4-1.4 2.3-2.3z',
  speaker: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm5 9a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm0-6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  eyeoff: 'M2 4.3L3.3 3 21 20.7 19.7 22l-3.2-3.2A10.6 10.6 0 0 1 12 20c-5 0-9-4-10-8 .5-1.8 1.6-3.6 3.2-5zM12 4c5 0 9 4 10 8-.4 1.6-1.3 3.2-2.6 4.5L16 13a4 4 0 0 0-5-5L8.4 5.4A10 10 0 0 1 12 4z',
  eye: 'M12 5c5 0 9 4 10 7-1 3-5 7-10 7S3 15 2 12c1-3 5-7 10-7zm0 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  close: 'M5.6 4.2L12 10.6l6.4-6.4 1.4 1.4-6.4 6.4 6.4 6.4-1.4 1.4-6.4-6.4-6.4 6.4-1.4-1.4 6.4-6.4-6.4-6.4z',
  clock: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm-1 3h2v5.4l4 2.3-1 1.7-5-2.9z',
  battery: 'M3 7h15v3h2v4h-2v3H3zm2 2v6h11V9z',
  trophy: 'M7 3h10v2h4v3a4 4 0 0 1-4 4h-.5A5 5 0 0 1 13 15v3h4v3H7v-3h4v-3a5 5 0 0 1-3.5-3H7a4 4 0 0 1-4-4V5h4zM5 7v1a2 2 0 0 0 2 2V7zm14 0h-2v3a2 2 0 0 0 2-2z',
  info: 'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 8v7h2v-7zm0-4v2h2V6z',
  bolt: 'M13 2L4 14h6l-1 8 9-12h-6z',
  shield: 'M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z',
  image: 'M3 4h18v16H3zm2 2v9l4-4 3 3 4-5 3 4V6zm3 1a2 2 0 1 1 0 4 2 2 0 0 1 0-4z',
  rocket: 'M12 2c3.5 2 5.5 5.6 5.5 9.5L20 15l-3 1-1.5-2h-7L7 16l-3-1 2.5-3.5C6.5 7.6 8.5 4 12 2zm0 5.5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM10 17h4l-2 5z',
  crown: 'M3 7l5 4 4-7 4 7 5-4-2 12H5zM5 20h14v2H5z',
  ghost: 'M12 2a8 8 0 0 1 8 8v12l-2.7-2-2.6 2-2.7-2-2.7 2-2.6-2L4 22V10a8 8 0 0 1 8-8zM9 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm6 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z',
  flame: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 1.5-5 3-6 0 2 1 3.5 2.5 4C11 9 10.5 5.5 12 2z',
  leaf: 'M20 3c0 9-5 15-12 15-1 0-2-.2-3-.5L3 20l-1-1 2.4-2.4C4 15 4 13.8 4 13 4 6 11 3 20 3zM8 15c3-3 6-5 9-7-4 1-7 3-9 7z',
  heart: 'M12 21l-1.5-1.3C5.4 15.1 2 12.1 2 8.4 2 5.4 4.4 3 7.4 3c1.7 0 3.4.8 4.6 2.1C13.2 3.8 14.9 3 16.6 3 19.6 3 22 5.4 22 8.4c0 3.7-3.4 6.7-8.5 11.3z',
};

export function icon(name, cls = '') {
  const d = P[name] || P.app;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill-rule="evenodd" aria-hidden="true"><path d="${d}"/></svg>`;
}

export function iconEl(name, cls = '') {
  const t = document.createElement('template');
  t.innerHTML = icon(name, cls);
  return t.content.firstChild;
}

let uid = 0;

// Glossy green orb with a counter-rotating silver ring (original artwork).
export function orb(cls = '') {
  const n = ++uid;
  const el = document.createElement('div');
  el.className = `orb ${cls}`;
  el.innerHTML = `<svg viewBox="0 0 100 100">
    <defs>
      <radialGradient id="ob${n}" cx="38%" cy="32%" r="72%">
        <stop offset="0" stop-color="#e2f8b0"/><stop offset=".3" stop-color="#8fd11c"/>
        <stop offset=".72" stop-color="#107c10"/><stop offset="1" stop-color="#042a04"/>
      </radialGradient>
      <linearGradient id="os${n}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#8d969f"/><stop offset="1" stop-color="#eef1f3"/>
      </linearGradient>
    </defs>
    <circle cx="50" cy="50" r="47" fill="#14181b" opacity=".6"/>
    <g class="ringg"><circle cx="50" cy="50" r="45" fill="none" stroke="url(#os${n})" stroke-width="5" stroke-dasharray="70 10 40 10 30 10" stroke-linecap="round"/></g>
    <circle cx="50" cy="50" r="36" fill="url(#ob${n})"/>
    <g class="swirl">
      <path d="M50 21 A29 29 0 0 1 79 50" stroke="#efffd6" stroke-width="5.5" fill="none" stroke-linecap="round" opacity=".9"/>
      <path d="M50 79 A29 29 0 0 1 21 50" stroke="#efffd6" stroke-width="5.5" fill="none" stroke-linecap="round" opacity=".55"/>
    </g>
    <ellipse cx="40" cy="33" rx="17" ry="9" fill="#fff" opacity=".5" transform="rotate(-28 40 33)"/>
  </svg>`;
  return el;
}

// Gamer pictures: colour + glyph combos.
export const AVATARS = [
  ['#107c10', '#76b900', 'controller'], ['#0f5c9c', '#3aa0e8', 'rocket'], ['#9c2a10', '#e8743a', 'flame'],
  ['#5a1a8c', '#a65ae8', 'ghost'], ['#8c6a10', '#e8c23a', 'crown'], ['#1a6c6c', '#3ae0c8', 'bolt'],
  ['#3a3f45', '#aab2ba', 'star'], ['#8c1a4a', '#e83a7a', 'heart'], ['#2c6c1a', '#9bc848', 'leaf'],
  ['#1a3a8c', '#5a8ae8', 'trophy'], ['#6c1a1a', '#e85a5a', 'music'], ['#3a1a6c', '#7a5ae8', 'globe'],
];

export function avatar(index = 0, cls = '') {
  const [c1, c2, glyph] = AVATARS[((index % AVATARS.length) + AVATARS.length) % AVATARS.length];
  const n = ++uid;
  const el = document.createElement('div');
  el.className = `avatar ${cls}`;
  el.innerHTML = `<svg viewBox="0 0 100 100">
    <defs><linearGradient id="av${n}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c2}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>
    <rect width="100" height="100" fill="url(#av${n})"/>
    <circle cx="78" cy="18" r="40" fill="#fff" opacity=".10"/>
    <g transform="translate(22 22) scale(2.35)" fill="#fff" fill-rule="evenodd" opacity=".95"><path d="${P[glyph]}"/></g>
    <rect width="100" height="48" fill="#fff" opacity=".12"/>
  </svg>`;
  return el;
}
