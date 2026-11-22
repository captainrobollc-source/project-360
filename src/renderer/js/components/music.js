// Background music player: keeps playing while you browse the dashboard (and optionally in games).
import * as store from '../store.js';

const audio = new Audio();
audio.preload = 'auto';
let queue = [];
let idx = -1;
let lastPush = 0;

function publish(force = false) {
  const now = Date.now();
  if (!force && now - lastPush < 900) return;
  lastPush = now;
  const t = queue[idx];
  store.set('nowPlaying', t ? { track: t, playing: !audio.paused, pos: audio.currentTime || 0, dur: audio.duration || 0, index: idx, count: queue.length } : null);
}

audio.addEventListener('timeupdate', () => publish());
audio.addEventListener('play', () => publish(true));
audio.addEventListener('pause', () => publish(true));
let failures = 0; // tracks in a row that couldn't play
audio.addEventListener('ended', () => next());
audio.addEventListener('playing', () => { failures = 0; });
audio.addEventListener('error', () => {
  failures++;
  if (queue.length > 1 && failures < queue.length) setTimeout(next, 400);
  else { failures = 0; stop(); }
});

function load(i) {
  if (!queue.length) return;
  idx = (i + queue.length) % queue.length;
  audio.src = queue[idx].url;
  audio.play().catch(() => {});
  publish(true);
}

export function playList(tracks, start = 0, { shuffle = false } = {}) {
  queue = [...tracks];
  if (shuffle) {
    for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    start = 0;
  }
  store.track('music');
  load(start);
}

export function toggle() { if (!queue.length) return; if (audio.paused) audio.play().catch(() => {}); else audio.pause(); }
export function pause() { audio.pause(); }
export function resume() { if (queue.length) audio.play().catch(() => {}); }
export function next() { if (queue.length) load(idx + 1); }
export function prev() { if (!queue.length) return; if (audio.currentTime > 4) { audio.currentTime = 0; return; } load(idx - 1); }
export function stop() { audio.pause(); audio.removeAttribute('src'); queue = []; idx = -1; publish(true); }
export function setVolume(v) { audio.volume = v; }
export function isPlaying() { return !audio.paused && !!queue.length; }
export function current() { return queue[idx] || null; }
