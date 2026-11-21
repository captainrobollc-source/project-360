// DOM + formatting helpers.
export function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv;
      }
    }
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function fmtPlaytime(sec) {
  if (!sec) return 'Not played';
  const m = Math.round(sec / 60);
  if (m < 1) return '< 1 min';
  if (m < 60) return `${m} min`;
  const hrs = sec / 3600;
  return hrs < 10 ? `${hrs.toFixed(1)} hrs` : `${Math.round(hrs)} hrs`;
}

export function fmtAgo(ts) {
  if (!ts) return 'Never';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return 'Yesterday';
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString();
}

export const SOURCE_LABEL = { steam: 'Steam', epic: 'Epic', gog: 'GOG', xbox: 'Xbox', local: 'Local', rom: 'Retro' };

export function artUrl(game, kind) {
  if (!game || !game.art || !game.art[kind]) return null;
  return `p360://art/${encodeURIComponent(game.id)}/${kind}?v=${game.art[kind]}`;
}

// Deterministic gradient for games without art.
export function fallbackColors(seed) {
  let x = 0;
  for (const c of String(seed)) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  const hue = x % 360;
  return [`hsl(${hue} 32% 34%)`, `hsl(${(hue + 40) % 360} 30% 12%)`];
}

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }
