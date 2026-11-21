// UI sound manager: synthesized defaults + drop-in .wav/.ogg/.mp3 packs.
let ctx = null;
let master = null;
let noise = null;
let enabled = true;
let volume = 0.7;
let buffers = {};
let packName = 'default';

function ensure() {
  if (ctx) return ctx;
  ctx = new AudioContext({ latencyHint: 'interactive' });
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.ratio.value = 4;
  master = ctx.createGain();
  master.gain.value = volume;
  master.connect(comp).connect(ctx.destination);
  const len = ctx.sampleRate;
  noise = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function configure({ enabled: en, volume: vol }) {
  if (en !== undefined) enabled = !!en;
  if (vol !== undefined) { volume = vol; if (master) master.gain.value = vol; }
}

export async function loadPack(pack) {
  buffers = {};
  packName = pack ? pack.name : 'default';
  if (!pack || !pack.files) return;
  ensure();
  await Promise.all(Object.entries(pack.files).map(async ([name, url]) => {
    try {
      const res = await fetch(url);
      buffers[name] = await ctx.decodeAudioData(await res.arrayBuffer());
    } catch (e) { console.warn('sound pack', name, e); }
  }));
}

export function currentPack() { return packName; }

// ------------------------------------------------------------------ synth voices
function env(g, t, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(freq, t, { type = 'sine', peak = 0.2, attack = 0.004, decay = 0.3, to, pan = 0, dest } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + attack + decay);
  env(g, t, peak, attack, decay);
  let node = o.connect(g);
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = pan; node = node.connect(p); }
  node.connect(dest || master);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function bell(freq, t, peak = 0.16, decay = 0.6, pan = 0) {
  tone(freq, t, { peak, decay, pan });
  tone(freq * 2.01, t, { peak: peak * 0.28, decay: decay * 0.6, pan });
  tone(freq * 3.2, t, { peak: peak * 0.08, decay: decay * 0.35, pan });
}

function noiseBurst(t, { dur = 0.4, from = 400, peakAt = 2600, to = 600, q = 0.9, peak = 0.5, panFrom = 0, panTo = 0, type = 'bandpass' } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(from, t);
  f.frequency.exponentialRampToValueAtTime(peakAt, t + dur * 0.4);
  f.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const p = ctx.createStereoPanner();
  p.pan.setValueAtTime(panFrom, t);
  p.pan.linearRampToValueAtTime(panTo, t + dur);
  src.connect(f).connect(g).connect(p).connect(master);
  src.start(t, Math.random() * 0.4);
  src.stop(t + dur + 0.05);
}

const SYNTH = {
  tick(t) {
    tone(2200, t, { peak: 0.09, attack: 0.002, decay: 0.035 });
    tone(4400, t, { type: 'triangle', peak: 0.025, attack: 0.001, decay: 0.02 });
  },
  blade(t, { dir = 1 } = {}) {
    noiseBurst(t, { dur: 0.5, from: 350, peakAt: 2800, to: 500, q: 0.7, peak: 0.55, panFrom: -0.7 * dir, panTo: 0.7 * dir });
    tone(190, t, { peak: 0.08, attack: 0.05, decay: 0.35, to: 85 });
  },
  select(t) {
    bell(1318.5, t, 0.13, 0.45);
    bell(1975.5, t + 0.055, 0.11, 0.55);
  },
  back(t) {
    tone(230, t, { peak: 0.3, attack: 0.004, decay: 0.16, to: 70 });
    noiseBurst(t, { dur: 0.09, from: 900, peakAt: 600, to: 300, q: 1.4, peak: 0.12, type: 'lowpass' });
  },
  guide(t) {
    bell(783.99, t, 0.12, 0.6, -0.3);
    bell(1174.66, t + 0.075, 0.12, 0.6, 0);
    bell(1567.98, t + 0.15, 0.13, 0.9, 0.3);
    noiseBurst(t + 0.05, { dur: 0.6, from: 4000, peakAt: 9000, to: 6000, q: 2, peak: 0.05 });
  },
  toast(t) {
    tone(660, t, { peak: 0.16, attack: 0.01, decay: 0.14, to: 990 });
    bell(1318.5, t + 0.12, 0.11, 0.7, -0.15);
    bell(1975.5, t + 0.12, 0.08, 0.8, 0.15);
  },
  error(t) {
    tone(150, t, { type: 'square', peak: 0.06, attack: 0.004, decay: 0.12 });
    tone(130, t + 0.14, { type: 'square', peak: 0.06, attack: 0.004, decay: 0.16 });
  },
  achievement(t) {
    // bright "pop" + rising shimmer chord
    tone(520, t, { peak: 0.2, attack: 0.005, decay: 0.12, to: 1040 });
    bell(1046.5, t + 0.1, 0.12, 0.9, -0.2);
    bell(1318.5, t + 0.16, 0.11, 0.9, 0);
    bell(1568, t + 0.22, 0.12, 1.1, 0.2);
    bell(2093, t + 0.3, 0.07, 1.2, 0);
    noiseBurst(t + 0.1, { dur: 0.9, from: 5000, peakAt: 10000, to: 7000, q: 3, peak: 0.05 });
  },
  signin(t) {
    bell(659.25, t, 0.12, 0.5, -0.2);
    bell(987.77, t + 0.09, 0.12, 0.7, 0.2);
  },
  boot(t) {
    // deep swell → glassy chord bloom (≈3.5 s)
    noiseBurst(t, { dur: 1.2, from: 120, peakAt: 1800, to: 4000, q: 0.5, peak: 0.25, panFrom: -0.8, panTo: 0.8 });
    tone(55, t, { peak: 0.22, attack: 0.9, decay: 2.2, to: 110 });
    tone(110, t + 0.2, { type: 'triangle', peak: 0.08, attack: 0.8, decay: 2 });
    const chord = [523.25, 659.25, 783.99, 1046.5, 1567.98];
    chord.forEach((f, i) => bell(f, t + 1.0 + i * 0.07, 0.09, 2.4, (i - 2) * 0.25));
    noiseBurst(t + 1.0, { dur: 1.6, from: 6000, peakAt: 11000, to: 8000, q: 2.5, peak: 0.06 });
  },
  launch(t) {
    noiseBurst(t, { dur: 0.9, from: 200, peakAt: 5000, to: 3000, q: 0.6, peak: 0.35 });
    tone(220, t, { peak: 0.12, attack: 0.3, decay: 0.5, to: 880 });
    bell(1760, t + 0.62, 0.12, 0.9);
    bell(2637, t + 0.66, 0.07, 0.9);
  },
};

export function play(name, opts = {}) {
  if (!enabled) return;
  try {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.005;
    const buf = buffers[name];
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(master);
      src.start(t);
      return;
    }
    (SYNTH[name] || SYNTH.tick)(t, opts);
  } catch (e) { /* audio is best-effort */ }
}
