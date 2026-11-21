// Built-in "TV apps" browser: a full-screen window with a TV user agent (e.g. YouTube's
// leanback interface), driven by the controller via synthetic key events, with ad blocking.
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const path = require('path');

const TV_UA = 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 Chrome/94.0.4606.31 TV Safari/537.36';
const KEYS = { 0: 'Up', 1: 'Down', 2: 'Left', 3: 'Right', 12: 'Enter', 13: 'Escape', 4: 'Enter', 15: 'MediaPlayPause', 16: 'MediaTrackPrevious', 17: 'MediaTrackNext' };
const REPEAT = new Set([0, 1, 2, 3]);

let blocker = null;

async function enableBlocker(ses, cacheDir) {
  if (blocker) return blocker;
  blocker = (async () => {
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const cache = path.join(cacheDir, 'adblock-engine.bin');
      const b = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cache,
        read: fs.promises.readFile,
        write: fs.promises.writeFile,
      });
      b.enableBlockingInSession(ses);
      return b;
    } catch (e) {
      console.warn('[tv] ad blocker unavailable:', e.message);
      return null;
    }
  })();
  return blocker;
}

function open(item, { cacheDir }) {
  const ses = session.fromPartition('persist:tvapps');
  enableBlocker(ses, cacheDir);
  const win = new BrowserWindow({
    fullscreen: true,
    frame: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    title: item.title,
    webPreferences: { session: ses, contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  win.setMenu(null);
  win.webContents.setUserAgent(item.ua || TV_UA);
  // The page's own Gamepad API would double every input; we drive it with keys instead.
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript('try{Object.defineProperty(navigator,"getGamepads",{value:()=>[]})}catch(e){}').catch(() => {});
  });
  win.loadURL(item.launch.target);
  win.once('ready-to-show', () => { win.show(); win.focus(); });

  let closedCb = null;
  win.on('closed', () => { clearAll(); if (closedCb) closedCb(); });

  let prev = 0;
  const timers = {};
  const key = (type, keyCode) => { if (!win.isDestroyed()) win.webContents.sendInputEvent({ type, keyCode }); };
  function clearAll() { for (const t of Object.values(timers)) clearTimeout(t); }

  return {
    win,
    close: () => { if (!win.isDestroyed()) win.close(); },
    focus: () => { if (!win.isDestroyed()) { win.show(); win.focus(); } },
    onClosed: (cb) => { closedCb = cb; },
    pad(mask) {
      const pressed = mask & ~prev;
      const released = prev & ~mask;
      prev = mask;
      for (const [bit, code] of Object.entries(KEYS)) {
        const m = 1 << Number(bit);
        if (pressed & m) {
          key('keyDown', code);
          if (REPEAT.has(Number(bit))) {
            const tick = () => { if (prev & m) { key('keyDown', code); timers[bit] = setTimeout(tick, 85); } };
            timers[bit] = setTimeout(tick, 420);
          }
        }
        if (released & m) { clearTimeout(timers[bit]); key('keyUp', code); }
      }
    },
  };
}

module.exports = { open, TV_UA };
