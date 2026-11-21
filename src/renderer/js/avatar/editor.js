// Avatar creator: live 3D preview + categories of options (all controller-driven).
import { h } from '../util.js';
import * as nav from '../nav.js';
import * as sound from '../sound.js';
import { state, saveSetting, track } from '../store.js';
import { claimLayer, releaseLayer, getRoot, confirm } from '../components/modal.js';
import { createSplit } from '../blades/split.js';
import { OPTIONS, SKIN, HAIR_COLORS, EYE_COLORS, CLOTH, avatarFor, randomAvatar } from './model.js';
import { createAvatarStage } from './render.js';

// [id, label, icon, framing, fields: [key, heading, kind, palette]]
const CATS = [
  ['body', 'Body', 'user', 'full', [['height', 'Height', 'opt'], ['build', 'Build', 'opt']]],
  ['skin', 'Skin tone', 'image', 'bust', [['skin', null, 'color', SKIN]]],
  ['eyes', 'Eyes', 'eye', 'bust', [['eyes', 'Shape', 'opt'], ['eyeColor', 'Colour', 'color', EYE_COLORS]]],
  ['brows', 'Eyebrows', 'eye', 'bust', [['brows', null, 'opt']]],
  ['mouth', 'Mouth', 'user', 'bust', [['mouth', null, 'opt']]],
  ['nose', 'Nose & cheeks', 'user', 'bust', [['nose', 'Nose', 'opt'], ['extras', 'Extras', 'opt']]],
  ['hair', 'Hair', 'star', 'bust', [['hair', 'Style', 'opt'], ['hairColor', 'Colour', 'color', HAIR_COLORS]]],
  ['facialHair', 'Facial hair', 'user', 'bust', [['facialHair', null, 'opt']]],
  ['top', 'Tops', 'app', 'full', [['top', 'Style', 'opt'], ['topColor', 'Colour', 'color', CLOTH], ['topAccent', 'Accent', 'color', CLOTH]]],
  ['bottom', 'Bottoms', 'app', 'full', [['bottom', 'Style', 'opt'], ['bottomColor', 'Colour', 'color', CLOTH]]],
  ['shoes', 'Shoes', 'app', 'full', [['shoes', 'Style', 'opt'], ['shoeColor', 'Colour', 'color', CLOTH]]],
  ['hat', 'Hats', 'crown', 'bust', [['hat', 'Style', 'opt'], ['hatColor', 'Colour', 'color', CLOTH]]],
  ['glasses', 'Glasses', 'eye', 'bust', [['glasses', null, 'opt']]],
];

let open = false;

export function openAvatarEditor({ toast } = {}) {
  if (open) return Promise.resolve(false);
  open = true;
  return new Promise((resolve) => {
    const profile = state.settings.profile || {};
    const original = avatarFor(profile);
    let work = { ...original };   // what's shown
    let committed = { ...original }; // last confirmed choice per field (focus previews, A keeps)

    const root = h('div.avedit');
    root.style.zIndex = String(claimLayer());
    const preview = h('div.av-preview');
    const hint = h('div.av-hint', {}, 'LT / RT  turn   ·   X  zoom   ·   Y  surprise me');
    const left = h('div.av-left', {}, preview, hint);
    const title = h('div.av-title', {}, h('h1', {}, 'Avatar'), h('div.av-sub', {}, profile.gamertag || 'Player'));
    const right = h('div.av-right', {}, title);
    root.append(left, right);
    getRoot().append(root);
    document.body.classList.add('avedit-open');

    const stage = createAvatarStage(preview, { fps: 60, framing: 'full' });
    stage.setAvatars([{ key: 'me', config: work, primary: true }]);
    setTimeout(() => stage.react('wave'), 500);
    let framing = 'full';
    let zoomOverride = null;
    const applyFraming = (f) => { framing = f; stage.setFraming(zoomOverride || f); };
    const show = (cfg) => { work = cfg; stage.setAvatars([{ key: 'me', config: work, primary: true }]); };

    const split = createSplit({
      sections: () => CATS.map(([id, label, icon]) => ({ id, label, icon })),
      render: (id, pane) => {
        const cat = CATS.find((c) => c[0] === id);
        applyFraming(cat[3]);
        pane.append(h('h2', {}, cat[1].toLowerCase()));
        for (const [key, heading, kind, palette] of cat[4]) {
          if (heading) pane.append(h('div.av-k', {}, heading));
          const grid = h(`div.av-grid.${kind}`);
          const choices = kind === 'opt' ? OPTIONS[key] : palette.map((c) => [c, c]);
          for (const [value, label] of choices) {
            const el = kind === 'opt'
              ? h('div.av-chip', { 'data-focus': '', 'data-key': `${key}:${value}` }, label)
              : h('div.av-swatch', { 'data-focus': '', 'data-key': `${key}:${value}`, style: { background: value } });
            if (committed[key] === value) el.classList.add('on');
            el._preview = () => { if (work[key] !== value) show({ ...committed, [key]: value }); };
            el._activate = () => {
              committed = { ...committed, [key]: value };
              show({ ...committed });
              grid.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
              el.classList.add('on');
              stage.react('nod');
            };
            grid.append(el);
          }
          pane.append(grid);
        }
      },
    });
    right.append(split.root);
    // Focusing an option previews it; leaving the options pane restores the confirmed look.
    const baseChange = split.focus.onChange;
    split.focus.onChange = (el) => {
      baseChange(el);
      if (el._preview) el._preview();
      else if (JSON.stringify(work) !== JSON.stringify(committed)) show({ ...committed });
    };

    const changed = () => JSON.stringify(committed) !== JSON.stringify(original);

    async function save() {
      await saveSetting('profile.avatar3d', { ...committed, v: 1 });
      track('avatar');
      sound.play('select');
      if (toast) toast({ kind: 'orb', icon: 'user', title: 'Avatar saved', text: profile.gamertag || '', sound: 'toast' });
      close(true);
    }
    async function leave() {
      if (!changed()) return close(false);
      const pick = await confirm({ title: 'Save your avatar?', buttons: [{ label: 'Save', value: 'save' }, { label: 'Discard changes', value: 'discard', danger: true }, { label: 'Keep editing', value: null }] });
      if (pick === 'save') save();
      else if (pick === 'discard') close(false);
    }
    function close(saved) {
      nav.pop(layer);
      releaseLayer();
      document.body.classList.remove('avedit-open');
      root.classList.add('out');
      setTimeout(() => { stage.dispose(); root.remove(); }, 260);
      open = false;
      resolve(saved);
    }

    const layer = {
      focus: split.focus,
      prompts: () => [
        { btn: 'a', label: split.inPane() ? 'Choose' : 'Select' },
        { btn: 'b', label: split.inPane() ? 'Back' : 'Done' },
        { btn: 'start', label: 'Save', side: 'right' },
      ],
      handle(action) {
        if (action === 'start') { save(); return; }
        if (action === 'lt') { stage.turn(-0.7); return; }
        if (action === 'rt') { stage.turn(0.7); return; }
        if (action === 'lb' || action === 'rb') { stage.turn(action === 'lb' ? -0.7 : 0.7); return; }
        if (action === 'x') { zoomOverride = zoomOverride ? null : (framing === 'full' ? 'bust' : 'full'); stage.setFraming(zoomOverride || framing); sound.play('tick'); return; }
        if (action === 'y') {
          committed = { ...randomAvatar(), v: 1 };
          show({ ...committed });
          split.select(split.current()); // back to the category list so a focused chip doesn't re-preview over it
          stage.react('cheer');
          sound.play('select');
          return;
        }
        if (action === 'b' && !split.inPane()) { leave(); return; }
        split.handle(action);
      },
    };
    nav.push(layer);
    requestAnimationFrame(() => root.classList.add('in'));
    split.select('body');
  });
}
