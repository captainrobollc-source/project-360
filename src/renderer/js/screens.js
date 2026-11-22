// Boot sequence, profile sign-in, initial setup and the screensaver.
import { h, wait } from './util.js';
import { orb, avatar, icon, iconEl, AVATARS } from './icons.js';
import * as nav from './nav.js';
import * as sound from './sound.js';
import * as store from './store.js';
import { modal, button, osk, avatarPicker } from './components/modal.js';
import { THEMES, apply as applyTheme } from './theme.js';
import { lastSlot } from './input.js';

// ------------------------------------------------------------------ boot
export function playBoot(stage) {
  return new Promise((resolve) => {
    const el = h('div.boot', {},
      h('div.glow'),
      h('div.streak.l'), h('div.streak.r'), h('div.streak.l.s2'), h('div.streak.r.s2'), h('div.streak.l.s3'), h('div.streak.r.s3'),
      h('div.rings', {}, h('i'), h('i'), h('i')),
      h('div.core', {}, orb()),
      h('div.flash'),
      h('div.word', {}, h('b', {}, 'PROJECT'), ' 360', h('div.shine')),
      h('div.skip', {}, ...nav.promptRow([{ btn: 'a', label: 'Skip' }])));
    stage.append(el);
    sound.play('boot');
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      nav.pop(layer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 850);
      resolve();
    };
    const layer = { prompts: () => [], handle(a) { if (a === 'a' || a === 'start' || a === 'b') finish(); } };
    nav.push(layer);
    setTimeout(finish, 4300);
  });
}

// ------------------------------------------------------------------ sign in
export function signIn({ allowCancel = false, slot = lastSlot } = {}) {
  return new Promise((resolve) => {
    let renderProfiles = () => {}; // set once the panel is built (modal() calls build synchronously)
    const ref = { m: null };
    const m = modal({
      panelClass: 'dialog signin',
      sound: 'guide',
      prompts: () => {
        const cur = ref.m && ref.m.focus.current; // prompts render before modal() returns
        return [{ btn: 'a', label: cur && !cur._pid ? 'Select' : 'Sign in' }, ...(allowCancel ? [{ btn: 'b', label: 'Back' }] : []),
          ...(cur && cur._pid ? [{ btn: 'x', label: 'Delete profile', side: 'right' }] : [])];
      },
      handle(a) {
        if (a === 'b' && !allowCancel) return true;
        if (a === 'x' && m.focus.current && m.focus.current._pid) { removeProfile(m.focus.current._pid); return true; }
        return false;
      },
      onClose: (v) => resolve(v),
      async build(panel, close, focus) {
        panel.append(h('h3', {}, `Sign In · Player ${slot + 1}`), h('div.sub', { html: `${icon('controller')}<span>Choose a profile for this controller</span>` }));
        const grid = h('div.profiles');
        panel.append(grid);
        let signingIn = false;
        const render = async () => {
          const list = await window.p360.profiles.list();
          grid.replaceChildren();
          for (const p of list) {
            const elsewhere = (store.state.slots || []).find((x) => x.profileId === p.id && x.slot !== slot);
            const c = h('div.pcard', { 'data-focus': '' }, avatar(p.avatar || 0), h('div.n', {}, p.gamertag),
              h('div.g', {}, h('span.gcoin', {}, 'G'), `${p.score || 0}`, elsewhere ? `  ·  on Player ${elsewhere.slot + 1}` : ''));
            c._pid = p.id;
            c._activate = async () => {
              if (signingIn) return; // a second A while the first is in flight
              signingIn = true;
              try { const s = await window.p360.profiles.signIn(p.id, slot); store.set('settings', s); close(p.id); } finally { signingIn = false; }
            };
            grid.append(c);
            const mine = (store.state.slots || []).find((x) => x.slot === slot);
            if (mine ? p.id === mine.profileId : p.id === store.setting('activeProfile')) focus.set(c);
          }
          const add = h('div.pcard', { 'data-focus': '' }, h('div.plus', { html: icon('plus') }), h('div.n', {}, 'Create profile'), h('div.g', {}, 'New gamertag'));
          add._activate = async () => {
            const tag = await osk({ title: 'Choose a gamertag', placeholder: 'Gamertag', maxLength: 15 });
            if (!tag || !tag.trim()) return;
            const id = await window.p360.profiles.create({ gamertag: tag.trim(), avatar: Math.floor(Math.random() * AVATARS.length) });
            await render();
            const card = [...grid.children].find((c) => c._pid === id);
            if (card) focus.set(card);
          };
          grid.append(add);
          if (!focus.current) focus.set(grid.firstChild);
        };
        renderProfiles = render;
        await render();
      },
    });
    ref.m = m;
    nav.refreshPrompts();
    async function removeProfile(id) {
      const { confirm } = await import('./components/modal.js');
      const ok = await confirm({ title: 'Delete this profile?', text: 'Its playtime, favorites and achievements are removed. Your games stay installed.', buttons: [{ label: 'Delete', value: true, danger: true }, { label: 'Cancel', value: false }] });
      if (!ok) return;
      try { await window.p360.profiles.remove(id); } catch (e) {
        await confirm({ title: 'Couldn’t delete the profile', text: e.message, buttons: [{ label: 'OK', value: true }] });
      }
      await renderProfiles();
      if (m.focus.current && !m.focus.current.isConnected) m.focus.first();
    }
  });
}

// ------------------------------------------------------------------ initial setup
export function runSetup(stage, { toast }) {
  return new Promise((resolve) => {
    const root = h('div.setup', {}, h('div.sbg'));
    const panel = h('div.spanel');
    root.append(panel);
    stage.append(root);
    const focus = new nav.Focus(panel);
    let step = 0;

    const steps = [
      async () => ({
        title: 'Welcome',
        body: 'Project 360 turns this PC into a living-room console. Everything works with your controller. Let’s get a few things ready.',
        opts: [button('Get started', { icon: 'play', onActivate: next })],
      }),
      async () => {
        const p = store.state.settings.profile;
        const pic = avatar(p.avatar || 0);
        const row = h('div.hero-row', {}, pic, h('div', {}, h('div', { style: { fontSize: '44px', fontWeight: 600 } }, p.gamertag), h('div', { style: { fontSize: '20px', opacity: 0.6 } }, 'Your gamertag and gamer picture')));
        const choosePic = async () => {
          const n = await avatarPicker({ current: store.setting('profile.avatar') || 0 });
          if (n === null) return;
          store.set('settings', await window.p360.settings.set('profile.avatar', n));
          render({ keepFocus: true });
        };
        const picBtn = button('Change gamer picture', { icon: 'image', onActivate: choosePic });
        return {
          title: 'Your profile',
          body: 'This is how you’ll show up on the dashboard.',
          extra: row,
          opts: [
            button('Change gamertag', { icon: 'user', onActivate: async () => { const v = await osk({ title: 'Gamertag', value: p.gamertag, maxLength: 15 }); if (v && v.trim()) { store.set('settings', await window.p360.settings.set('profile.gamertag', v.trim())); render({ keepFocus: true }); } } }),
            picBtn,
            button('Continue', { icon: 'play', onActivate: next }),
          ],
        };
      },
      async () => {
        let on = true;
        try { on = await window.p360.system.gameBar(); } catch { /* ignore */ }
        return {
          title: 'The Xbox button',
          body: on
            ? 'Right now Windows opens Xbox Game Bar when you press the Xbox button on your controller. Let Project 360 use it instead to open the Guide — over the dashboard and in games.'
            : 'The Xbox button is already free for Project 360. Press it any time to open the Guide.',
          opts: on ? [
            button('Use the Xbox button for the Guide', { icon: 'controller', right: 'Recommended', onActivate: () => once(async () => { await window.p360.system.gameBar(false); toast({ title: 'Xbox button ready', text: 'It now opens the Guide', sound: 'select' }); next(); }) }),
            button('Keep Game Bar on the Xbox button', { icon: 'close', onActivate: next }),
          ] : [button('Continue', { icon: 'play', onActivate: next })],
        };
      },
      async () => {
        const b = store.state.browsers || {};
        const pick = (v) => once(async () => { store.set('settings', await window.p360.settings.set('media.browser', v)); next(); });
        const opts = [];
        if (b.firefox) opts.push(button('Use Firefox', { icon: 'globe', right: 'Your sign-ins & add-ons', onActivate: () => pick('firefox') }));
        if (b.edge) opts.push(button('Use Microsoft Edge', { icon: 'globe', right: 'Separate kiosk profile', onActivate: () => pick('edge') }));
        if (!opts.length) opts.push(button('Continue', { icon: 'play', onActivate: next }));
        return {
          title: 'Web apps',
          body: b.firefox
            ? 'Netflix, YouTube, Twitch and other web apps open full screen in Firefox with your normal profile, so you stay signed in and your ad blocker works. Your controller drives the pointer. There’s also a built-in YouTube TV mode with ad blocking that’s made for controllers.'
            : 'Web apps open full screen in a kiosk browser window. Install Firefox to use your own sign-ins and add-ons.',
          opts,
        };
      },
      async () => {
        const lib = store.state.library;
        const by = (s) => lib.filter((g) => g.source === s).length;
        const found = h('div.found', {}, ...[['Steam', by('steam')], ['Epic', by('epic')], ['GOG', by('gog')], ['Xbox', by('xbox')], ['Local', by('local') + by('rom')]]
          .map(([k, v]) => h('div.stat', {}, h('div.v', {}, String(v)), h('div.k', {}, k))));
        return {
          title: 'Your games',
          body: `Found ${lib.length} installed game${lib.length === 1 ? '' : 's'}. New installs show up automatically, and box art is downloaded and kept for offline use.`,
          extra: found,
          opts: [
            button('Continue', { icon: 'play', onActivate: next }),
            button('Add a games folder…', { icon: 'folder', onActivate: async () => { await window.p360.library.addFolder('games'); render(); } }),
          ],
        };
      },
      async () => ({
        title: 'Pick a look',
        body: 'Choose a theme. You can change it later in System › Themes.',
        opts: THEMES.map((t) => {
          const btn = button(t.name, { icon: 'image', right: store.setting('theme.name') === t.id ? 'Current' : '', onActivate: async () => { await btn._onFocus(); next(); } });
          btn._onFocus = async () => { if (store.setting('theme.name') !== t.id) { store.set('settings', await window.p360.settings.set('theme.name', t.id)); applyTheme(); } };
          return btn;
        }),
      }),
      async () => ({
        title: 'You’re all set',
        body: 'Press the Xbox button (or Alt+G) any time for the Guide: resume or close games, change volume, switch audio output, or turn the PC off.',
        opts: [button('Go to the dashboard', { icon: 'home', onActivate: finish })],
      }),
    ];

    // Steps can await (e.g. Game Bar status). A newer render wins, and input waits for it.
    let renderToken = 0;
    let rendering = false;
    let acting = false; // a step's button is still doing its work
    const once = async (fn) => { if (acting) return; acting = true; try { await fn(); } finally { acting = false; } };
    async function render({ keepFocus = false } = {}) {
      const my = ++renderToken;
      const keepIdx = keepFocus && focus.current ? [...panel.querySelectorAll('.opts [data-focus]')].indexOf(focus.current) : -1;
      rendering = true;
      let s;
      try { s = await steps[step](); } finally { if (my === renderToken) rendering = false; }
      if (my !== renderToken) return;
      panel.replaceChildren(...[
        h('div.step', {}, `Initial setup · ${step + 1} of ${steps.length}`),
        h('div.orbbig', {}, orb()),
        h('h1', {}, s.title),
        h('div.body', {}, s.body),
        s.extra,
        h('div.opts', {}, ...s.opts),
        h('div.dots', {}, ...steps.map((_, i) => h(`i${i <= step ? '.on' : ''}`)))].filter(Boolean));
      focus.set(s.opts[keepIdx >= 0 && keepIdx < s.opts.length ? keepIdx : 0]);
    }
    function next() { if (rendering) return; if (step < steps.length - 1) { step++; sound.play('blade', { dir: 1 }); render(); } }
    function finish() {
      nav.pop(layer);
      window.p360.settings.set('console.setupDone', true).then((s) => store.set('settings', s));
      root.style.transition = 'opacity .5s';
      root.style.opacity = '0';
      setTimeout(() => root.remove(), 520);
      resolve();
    }

    const layer = {
      focus,
      prompts: () => [{ btn: 'a', label: 'Select' }, ...(step > 0 ? [{ btn: 'b', label: 'Back' }] : [])],
      handle(a) {
        if (['up', 'down', 'left', 'right'].includes(a)) {
          focus.handleDir(a);
          if (focus.current && focus.current._onFocus) focus.current._onFocus();
          return;
        }
        if (a === 'a') { if (focus.activate()) sound.play('select'); }
        if (a === 'b' && step > 0) { step--; sound.play('back'); render(); }
      },
    };
    nav.push(layer);
    render();
  });
}

// ------------------------------------------------------------------ screensaver
export function createSaver(stage) {
  let el = null;
  let timer = null;
  let moveT = null;
  const minutes = () => Number(store.setting('console.screensaverMin') || 0);

  function show() {
    if (el || store.state.suspended || !minutes()) return;
    // Watching a video or slideshow: not idle. Check again later.
    if (document.body.classList.contains('viewer-open') || document.body.classList.contains('arcade-playing')) { timer = setTimeout(show, 60000); return; }
    const o = orb();
    const clock = h('div.sclock');
    el = h('div.saver', {}, o, clock);
    stage.append(el);
    const move = () => {
      o.style.left = `${100 + Math.random() * 1600}px`;
      o.style.top = `${100 + Math.random() * 800}px`;
      clock.textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };
    move();
    moveT = setInterval(move, 20000);
    requestAnimationFrame(() => el.classList.add('in'));
  }
  function hide() {
    if (!el) return false;
    const e = el;
    el = null;
    clearInterval(moveT);
    e.classList.remove('in');
    setTimeout(() => e.remove(), 1400);
    return true;
  }
  function poke() {
    clearTimeout(timer);
    const m = minutes();
    if (m) timer = setTimeout(show, m * 60000);
    return hide(); // true → input consumed (it only woke the screen)
  }
  poke();
  return { poke, hide };
}

export { iconEl };
