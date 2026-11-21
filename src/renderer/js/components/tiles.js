// Tile builders shared by the blades.
import { h, artUrl, fallbackColors, SOURCE_LABEL } from '../util.js';
import { iconEl, orb } from '../icons.js';

function artImg(url, onFail) {
  const img = h('img', { src: url, loading: 'lazy', decoding: 'async', alt: '' });
  img.addEventListener('error', () => { img.remove(); onFail(); }, { once: true });
  return img;
}

function fallback(game, sub) {
  const [a, b] = fallbackColors(game.id);
  const o = orb();
  o.classList.add('orbmark');
  return h('div.fallback', { style: { '--fb1': a, '--fb2': b } }, o, h('div.t', {}, game.title), h('div.s', {}, sub || SOURCE_LABEL[game.source] || ''));
}

// Retro screenshots/title screens are tiny; keep the pixels sharp instead of blurry.
const lowRes = (game, kind) => !!(game.systemId && game.artSources && game.artSources[kind] === 'libretro');

// Portrait box-art tile. Retro boxes come in every shape (SNES/N64 are landscape), so they're
// fitted over a blurred copy of themselves rather than cropped.
export function coverTile(game) {
  const frame = h('div.frame');
  const url = artUrl(game, 'cover');
  const fb = () => frame.append(fallback(game, game.platform));
  if (url && game.systemId) {
    frame.append(h('div.bgblur', { style: { backgroundImage: `url("${url}")` } }));
    const img = artImg(url, fb);
    img.classList.add('box');
    if (lowRes(game, 'cover')) img.classList.add('pixel');
    frame.append(img);
  } else if (url) frame.append(artImg(url, fb)); else fb();
  const el = h(`div.tile.cover${game.systemId ? '.retro' : ''}`, { 'data-focus': '', 'data-id': game.id }, frame);
  if (game.systemId && game.platform) el.append(h('div.sysbadge', {}, game.platform));
  if (game.favorite) el.append(h('div.badge', {}, iconEl('star')));
  return el;
}

// Retro games only have small screenshots, so wide tiles are composed instead of stretched:
// the box art on a blurred backdrop, plus the logo and a crisp screenshot in a TV-like frame.
function retroWideTile(game, { kind, sub, cls }) {
  const cover = artUrl(game, 'cover');
  const shot = artUrl(game, 'hero') || artUrl(game, 'banner');
  const logo = artUrl(game, 'logo');
  const frame = h('div.frame.rw');
  frame.append(h('div.rw-bg', { style: { backgroundImage: `url("${cover || shot}")` } }), h('div.rw-shade'));
  if (cover) {
    const img = h('img.rw-box', { src: cover, alt: '', loading: 'lazy' });
    img.onerror = () => img.remove();
    frame.append(img);
  }
  const big = kind === 'hero';
  const side = h('div.rw-side');
  if (!big) {
    // Small tiles: box art centered, title in the label (no room for logo + screen).
    frame.append(side);
    const el = h(`div.tile.retro-wide.rw-small${cls ? '.' + cls : ''}`, { 'data-focus': '', 'data-id': game.id }, frame,
      h('div.label', {}, h('div.t', {}, game.title), sub ? h('div.s', {}, `${game.platform ? `${game.platform} · ` : ''}${sub}`) : null),
      game.platform ? h('div.sysbadge', {}, game.platform) : null);
    if (game.favorite) el.append(h('div.badge', {}, iconEl('star')));
    return el;
  }
  if (logo) {
    const l = h('img.rw-logo', { src: logo, alt: '' });
    l.onerror = () => { l.replaceWith(h('div.rw-title', {}, game.title)); };
    side.append(l);
  } else side.append(h('div.rw-title', {}, game.title));
  if (shot && kind === 'hero') {
    const s = h('img.rw-shot', { src: shot, alt: '' });
    if (lowRes(game, artUrl(game, 'hero') ? 'hero' : 'banner')) s.classList.add('pixel');
    s.onerror = () => s.remove();
    side.append(h('div.rw-screen', {}, s));
  }
  frame.append(side);
  const el = h(`div.tile.retro-wide${cls ? '.' + cls : ''}${kind === 'hero' ? '.rw-big' : ''}`, { 'data-focus': '', 'data-id': game.id }, frame,
    sub ? h('div.label', {}, h('div.s', {}, `${game.platform ? `${game.platform} · ` : ''}${sub}`)) : null,
    game.platform ? h('div.sysbadge', {}, game.platform) : null);
  if (game.favorite) el.append(h('div.badge', {}, iconEl('star')));
  return el;
}

// Wide tile (banner/hero) with a title label.
export function wideTile(game, { kind = 'banner', sub, cls = '' } = {}) {
  if (game.systemId && artUrl(game, 'cover')) return retroWideTile(game, { kind, sub, cls });
  const frame = h('div.frame');
  const useKind = artUrl(game, kind) ? kind : kind === 'banner' ? 'hero' : 'banner';
  const url = artUrl(game, useKind);
  const fb = () => frame.append(fallback(game));
  if (url) { const img = artImg(url, fb); if (lowRes(game, useKind)) img.classList.add('pixel'); frame.append(img); } else fb();
  const el = h(`div.tile${cls ? '.' + cls : ''}`, { 'data-focus': '', 'data-id': game.id }, frame,
    h('div.label', {}, h('div.t', {}, game.title), sub ? h('div.s', {}, sub) : null));
  if (game.favorite) el.append(h('div.badge', {}, iconEl('star')));
  return el;
}

export function quickTile({ title, sub, icon, c1, c2 }) {
  return h('div.tile.quick-tile', { 'data-focus': '' },
    h('div.frame', { style: { '--q1': c1, '--q2': c2 } }, iconEl(icon), h('div', {}, h('div.t', {}, title), sub ? h('div.s', {}, sub) : null)));
}
