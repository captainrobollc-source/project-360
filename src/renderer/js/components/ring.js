// Ring of Light: four quadrants around a glowing guide button.
// Every connected controller lights its quadrant; YOUR controller (the one in use) pulses bright.
import { h } from '../util.js';
import { icon } from '../icons.js';

function arc(cx, cy, r, a0, a1) {
  const rad = (a) => (a * Math.PI) / 180;
  const x0 = cx + r * Math.cos(rad(a0)), y0 = cy + r * Math.sin(rad(a0));
  const x1 = cx + r * Math.cos(rad(a1)), y1 = cy + r * Math.sin(rad(a1));
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Screen angles (clockwise from +x). P1 top-left, P2 top-right, P3 bottom-left, P4 bottom-right.
const QUADS = [[186, 264], [276, 354], [96, 174], [6, 84]];
let uid = 0;

export function ringSvg(lit = [], me = -1, cls = 'ringsvg') {
  const n = ++uid;
  return `<svg class="${cls}" viewBox="0 0 80 80">
    <defs>
      <linearGradient id="qOff" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9dee2"/><stop offset=".5" stop-color="#8d969e"/><stop offset="1" stop-color="#c3c9ce"/></linearGradient>
      <radialGradient id="hub${n}" cx="40%" cy="32%" r="75%"><stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#b9c0c6"/><stop offset="1" stop-color="#4f575e"/></radialGradient>
      <radialGradient id="gem${n}" cx="38%" cy="30%" r="75%"><stop offset="0" stop-color="#e6ffb0"/><stop offset=".4" stop-color="#7fd11a"/><stop offset="1" stop-color="#0c560c"/></radialGradient>
    </defs>
    ${QUADS.map(([a, b]) => `<path class="qbg" d="${arc(40, 40, 31, a, b)}"/>`).join('')}
    ${QUADS.map(([a, b], i) => `<path class="q${lit.includes(i) ? ' on' : ''}${me === i ? ' me' : ''}" data-q="${i}" d="${arc(40, 40, 31, a, b)}"/>`).join('')}
    <circle cx="40" cy="40" r="20" fill="url(#hub${n})" stroke="rgba(0,0,0,.45)" stroke-width="1.2"/>
    <circle cx="40" cy="40" r="13" fill="url(#gem${n})"/>
    <path d="M33 37 A8 8 0 0 1 47 37" stroke="#f2ffd9" stroke-width="2.4" fill="none" stroke-linecap="round" opacity=".85"/>
    <ellipse cx="36" cy="34" rx="6" ry="3.2" fill="#fff" opacity=".55" transform="rotate(-25 36 34)"/>
  </svg>`;
}

export function batteryEl(bat) {
  const el = h('div.battery');
  let bars = 0;
  if (bat) {
    if (bat.type === 1) { el.classList.add('wired'); bars = 3; }
    else bars = Math.max(0, Math.min(3, bat.level));
    if (bat.type !== 1 && bat.level === 1) el.classList.add('low');
    if (bat.type !== 1 && bat.level === 0) el.classList.add('crit');
  }
  for (let i = 0; i < 3; i++) el.append(h(`i${i < bars ? '.on' : ''}`));
  return el;
}

export function batteryText(bat) {
  if (!bat) return 'Battery unknown';
  if (bat.type === 1) return 'Wired';
  return ['Empty', 'Low', 'Medium', 'Full'][bat.level] || 'Unknown';
}

export function createRing() {
  const root = h('div.ring');
  function update(pads, activeSlot) {
    const lit = pads.filter((p) => p.connected).map((p) => p.slot);
    const me = pads[activeSlot] && pads[activeSlot].connected ? activeSlot : (lit[0] ?? -1);
    const meta = h('div.meta');
    if (me >= 0) {
      meta.append(h('div.pl', { html: `${icon('controller')}<span>Player ${me + 1}</span>` }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, batteryEl(pads[me].battery), h('span.bat-label', {}, batteryText(pads[me].battery))));
    } else {
      meta.append(h('div.pl', { html: `${icon('controller')}<span>No controller</span>` }));
    }
    root.innerHTML = ringSvg(lit, me);
    root.append(meta);
  }
  return { el: root, update };
}
