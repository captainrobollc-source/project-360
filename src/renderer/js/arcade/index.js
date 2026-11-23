// Built-in arcade: game registry, generated library art, and launching.
import { generatedArt } from '../util.js';
import { runGame, isRunning } from './engine.js';
import pulse from './pulse.js';
import prism from './prism.js';
import glow from './glow.js';
import ribbon from './ribbon.js';
import lumen from './lumen.js';
import golf from './golf.js';

// Shelf order on the Arcade blade (two rows of three).
export const GAMES = { pulse, prism, glow, ribbon, lumen, golf };

// Library art drawn by each game (cover 2:3, hero 16:9, banner = hero crop), as data URLs.
const SIZES = { cover: [600, 900], hero: [1280, 720], banner: [920, 430] };
export function initArcadeArt() {
  for (const def of Object.values(GAMES)) {
    for (const [kind, [w, hgt]] of Object.entries(SIZES)) {
      try {
        const c = document.createElement('canvas');
        c.width = w; c.height = hgt;
        const ctx = c.getContext('2d');
        if (kind === 'cover') def.art.cover(ctx, w, hgt);
        else def.art.hero(ctx, w, hgt);
        generatedArt.set(`arcade:${def.key}|${kind}`, c.toDataURL('image/jpeg', 0.9));
      } catch (e) { console.error('[arcade] art', def.key, kind, e); }
    }
  }
}

export function isArcade(g) { return !!g && (g.source === 'arcade' || String(g.id || '').startsWith('arcade:')); }

export function playArcade(id, opts = {}) {
  const key = String(id).replace(/^arcade:/, '');
  const def = GAMES[key];
  if (!def || isRunning()) return false;
  runGame(def, opts);
  return true;
}

// Dev harness hook: window.__p360arcade.play('pulse')
window.__p360arcade = { play: (k) => playArcade(k) };
