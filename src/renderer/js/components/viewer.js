// Full-screen picture viewer (with slideshow) and video player, driven by the controller.
import { h, fmtAgo } from '../util.js';
import { icon } from '../icons.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import * as music from './music.js';
import { getRoot, claimLayer, releaseLayer } from './modal.js';
import { track } from '../store.js';

function shell({ prompts, handle, build }) {
  const el = h('div.viewer');
  el.style.zIndex = String(claimLayer()); // above the Guide or a dialog it was opened from
  document.body.classList.add('viewer-open');
  getRoot().append(el);
  let idleT;
  const wake = () => { el.classList.remove('idle'); clearTimeout(idleT); idleT = setTimeout(() => el.classList.add('idle'), 3500); };
  const layer = {
    prompts,
    handle(a) { wake(); if (handle(a) !== false) return; if (a === 'b') close(); },
  };
  function close() {
    nav.pop(layer);
    releaseLayer();
    if (document.querySelectorAll('.viewer').length <= 1) document.body.classList.remove('viewer-open'); // this one is still fading out
    sound.play('back');
    el.classList.remove('in');
    clearTimeout(idleT);
    setTimeout(() => el.remove(), 320);
    if (layer.onClose) layer.onClose();
  }
  build(el, close);
  nav.push(layer);
  requestAnimationFrame(() => el.classList.add('in'));
  wake();
  return { el, close, layer };
}

const fmtT = (s) => { s = Math.max(0, Math.floor(s || 0)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };

export function openPictures(list, start = 0) {
  if (!list.length) return;
  track('picture');
  let i = start;
  let slideshow = null;
  let img, title, sub, pos;
  const v = shell({
    prompts: () => [{ btn: 'dpad', label: 'Previous / next' }, { btn: 'y', label: slideshow ? 'Stop slideshow' : 'Slideshow' }, { btn: 'b', label: 'Back', side: 'right' }],
    handle(a) {
      if (a === 'left' || a === 'lb') return show(i - 1);
      if (a === 'right' || a === 'rb' || a === 'a') return show(i + 1);
      if (a === 'y') { toggleShow(); return; }
      if (a === 'b') { clearInterval(slideshow); return false; }
      return;
    },
    build(el) {
      img = h('img', { alt: '' });
      title = h('div.vt');
      sub = h('div.vs');
      pos = h('div.vtime');
      el.append(img, h('div.vbar', {}, title, sub, h('div.vrow', { style: { marginTop: '18px' } }, h('div.left', {}, ...nav.promptRow([{ btn: 'dpad', label: 'Browse' }, { btn: 'y', label: 'Slideshow' }, { btn: 'b', label: 'Back' }])), pos)));
    },
  });
  function show(n) {
    i = (n + list.length) % list.length;
    const p = list[i];
    img.style.opacity = '0';
    setTimeout(() => { img.src = p.url; img.onload = () => { img.style.opacity = '1'; }; }, 120);
    title.textContent = p.game || p.path.split('\\').pop();
    sub.textContent = `${{ steam: 'Steam screenshot', gamebar: 'Game Bar capture', nvidia: 'NVIDIA capture', screenshots: 'Screenshot', pictures: 'Pictures' }[p.source] || 'Picture'} · ${fmtAgo(p.mtime)}`;
    pos.textContent = `${i + 1} / ${list.length}`;
    sound.play('tick');
  }
  function toggleShow() {
    if (slideshow) { clearInterval(slideshow); slideshow = null; }
    else slideshow = setInterval(() => show(i + 1), 5000);
    nav.refreshPrompts();
  }
  v.layer.onClose = () => clearInterval(slideshow);
  show(i);
}

export function openVideo(item) {
  track('video');
  const wasPlaying = music.isPlaying();
  if (wasPlaying) music.pause();
  let video, fill, time, big;
  const flash = (name) => { big.innerHTML = icon(name); big.classList.add('show'); setTimeout(() => big.classList.remove('show'), 500); };
  const v = shell({
    prompts: () => [{ btn: 'a', label: 'Play / pause' }, { btn: 'dpad', label: 'Seek 10s' }, { btn: ['lt', 'rt'], label: 'Seek 1 min' }, { btn: 'b', label: 'Back', side: 'right' }],
    handle(a) {
      if (a === 'a' || a === 'y') { if (video.paused) { video.play(); flash('play'); } else { video.pause(); flash('sleep'); } return; }
      if (a === 'left') { video.currentTime = Math.max(0, video.currentTime - 10); return; }
      if (a === 'right') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); return; }
      if (a === 'lt') { video.currentTime = Math.max(0, video.currentTime - 60); return; }
      if (a === 'rt') { video.currentTime = Math.min(video.duration || 0, video.currentTime + 60); return; }
      if (a === 'b') { video.pause(); return false; }
    },
    build(el) {
      video = h('video', { src: item.url, autoplay: true });
      fill = h('i');
      time = h('div.vtime');
      big = h('div.bigicon');
      el.append(video, big, h('div.vbar', {}, h('div.vt', {}, item.game || item.path.split('\\').pop()), h('div.vs', {}, fmtAgo(item.mtime)),
        h('div.vprog', {}, fill), h('div.vrow', {}, h('div.left', {}, ...nav.promptRow([{ btn: 'a', label: 'Pause' }, { btn: 'dpad', label: 'Seek' }, { btn: 'b', label: 'Back' }])), time)));
      video.addEventListener('timeupdate', () => {
        fill.style.width = `${(video.currentTime / (video.duration || 1)) * 100}%`;
        time.textContent = `${fmtT(video.currentTime)} / ${fmtT(video.duration)}`;
      });
      video.addEventListener('ended', () => v.close());
    },
  });
  v.layer.onClose = () => { video.pause(); video.removeAttribute('src'); if (wasPlaying) music.resume(); };
}
