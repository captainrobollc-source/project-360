// Avatar description: what the creator edits and the renderer builds. Stored per profile
// (profile.avatar3d). Original designs only.

export const SKIN = ['#fbe3d0', '#f3cfb3', '#e8b796', '#d9a07a', '#c68863', '#b07049', '#8f5636', '#73442a', '#5a3320', '#3f2416'];
export const HAIR_COLORS = ['#1b1512', '#3b2a1e', '#5a3c26', '#7a5230', '#a8743f', '#d7a55a', '#e9cf8a', '#b8b0a6', '#f2efe9', '#a8322a', '#d65a2b', '#3d5bd9', '#2fa86a', '#c040a0', '#7a4ad9'];
export const EYE_COLORS = ['#3a2a1c', '#5b3a22', '#3a6ea5', '#2f8f6a', '#6f8f3a', '#7a6a5a', '#5a4a9a'];
export const CLOTH = ['#f4f6f8', '#c9ced3', '#5b636b', '#26292d', '#121314', '#d3283a', '#e8682a', '#f2b632', '#7cc242', '#1f9a5a', '#1aa7c9', '#2f6fd8', '#24357a', '#7a4ad9', '#c040a0', '#8a5a3a', '#c9a77a', '#4a6a3a'];

export const OPTIONS = {
  height: [['short', 'Short'], ['average', 'Average'], ['tall', 'Tall']],
  build: [['slim', 'Slim'], ['average', 'Average'], ['broad', 'Broad']],
  eyes: [['round', 'Round'], ['almond', 'Almond'], ['wide', 'Wide'], ['sleepy', 'Sleepy'], ['happy', 'Happy'], ['dot', 'Dot']],
  brows: [['soft', 'Soft'], ['straight', 'Straight'], ['arched', 'Arched'], ['thick', 'Thick'], ['angled', 'Angled']],
  mouth: [['smile', 'Smile'], ['grin', 'Grin'], ['neutral', 'Neutral'], ['smirk', 'Smirk'], ['open', 'Open'], ['tongue', 'Cheeky']],
  nose: [['button', 'Button'], ['dot', 'Dot'], ['long', 'Long'], ['none', 'None']],
  extras: [['none', 'None'], ['cheeks', 'Rosy cheeks'], ['freckles', 'Freckles'], ['both', 'Both']],
  hair: [['short', 'Short'], ['buzz', 'Buzz cut'], ['spiky', 'Spiky'], ['swept', 'Swept'], ['curly', 'Curly'], ['bob', 'Bob'], ['long', 'Long'], ['ponytail', 'Ponytail'], ['bun', 'Bun'], ['mohawk', 'Mohawk'], ['bald', 'Bald']],
  facialHair: [['none', 'None'], ['stubble', 'Stubble'], ['mustache', 'Mustache'], ['goatee', 'Goatee'], ['beard', 'Beard']],
  top: [['tee', 'T-shirt'], ['hoodie', 'Hoodie'], ['jacket', 'Jacket'], ['sweater', 'Sweater'], ['tank', 'Tank top'], ['jersey', 'Jersey']],
  bottom: [['jeans', 'Jeans'], ['joggers', 'Joggers'], ['shorts', 'Shorts'], ['skirt', 'Skirt']],
  shoes: [['sneakers', 'Sneakers'], ['high', 'High-tops'], ['boots', 'Boots']],
  hat: [['none', 'None'], ['cap', 'Cap'], ['backcap', 'Backwards cap'], ['beanie', 'Beanie'], ['headphones', 'Headphones'], ['crown', 'Crown']],
  glasses: [['none', 'None'], ['round', 'Round'], ['square', 'Square'], ['shades', 'Shades']],
};

export const DEFAULT = {
  v: 1,
  height: 'average', build: 'average',
  skin: SKIN[2],
  eyes: 'round', eyeColor: EYE_COLORS[0], brows: 'soft', mouth: 'smile', nose: 'button', extras: 'none',
  hair: 'short', hairColor: HAIR_COLORS[1], facialHair: 'none',
  top: 'tee', topColor: CLOTH[10], topAccent: CLOTH[0],
  bottom: 'jeans', bottomColor: CLOTH[12],
  shoes: 'sneakers', shoeColor: CLOTH[0],
  hat: 'none', hatColor: CLOTH[3],
  glasses: 'none',
};

// Small deterministic PRNG so a profile without an avatar always gets the same one.
function rng(seedStr) {
  let s = 2166136261;
  for (const c of String(seedStr)) s = Math.imul(s ^ c.charCodeAt(0), 16777619) >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function randomAvatar(seed = Math.random()) {
  const r = rng(seed);
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const opt = (k) => pick(OPTIONS[k])[0];
  const naturalHair = HAIR_COLORS.slice(0, 9);
  const a = {
    ...DEFAULT,
    height: opt('height'), build: opt('build'),
    skin: pick(SKIN),
    eyes: opt('eyes'), eyeColor: pick(EYE_COLORS), brows: opt('brows'), mouth: pick(['smile', 'grin', 'smile', 'neutral', 'smirk']), nose: pick(['button', 'dot', 'button', 'long']),
    extras: pick(['none', 'none', 'cheeks', 'freckles', 'both']),
    hair: pick(OPTIONS.hair.filter(([k]) => k !== 'bald'))[0], hairColor: r() < 0.82 ? pick(naturalHair) : pick(HAIR_COLORS),
    facialHair: r() < 0.7 ? 'none' : opt('facialHair'),
    top: opt('top'), topColor: pick(CLOTH), topAccent: pick(CLOTH),
    bottom: pick(['jeans', 'jeans', 'joggers', 'shorts', 'skirt']), bottomColor: pick(['#24357a', '#2a3a5a', '#26292d', '#5b636b', '#8a5a3a', '#c9a77a', '#4a6a3a', '#121314']),
    shoes: opt('shoes'), shoeColor: pick(CLOTH),
    hat: r() < 0.7 ? 'none' : pick(['cap', 'backcap', 'beanie', 'headphones']), hatColor: pick(CLOTH),
    glasses: r() < 0.75 ? 'none' : pick(['round', 'square', 'shades']),
  };
  if (a.topAccent === a.topColor) a.topAccent = a.topColor === CLOTH[0] ? CLOTH[3] : CLOTH[0];
  return a;
}

// The avatar for a profile: its saved one, else a stable random one seeded by its id.
export function avatarFor(profile) {
  if (profile && profile.avatar3d && profile.avatar3d.v) return { ...DEFAULT, ...profile.avatar3d };
  return randomAvatar(profile ? profile.id || profile.gamertag || 'player' : 'player');
}
