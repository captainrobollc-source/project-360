// Bridges a minimal, typed API into the sandboxed renderer.
const { contextBridge, ipcRenderer } = require('electron');

async function call(ch, ...args) {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

function on(ch, fn) {
  const h = (e, data) => fn(data);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
}

contextBridge.exposeInMainWorld('p360', {
  init: (mode) => call('app:init', mode),
  library: {
    get: () => call('library:get'),
    rescan: () => call('library:rescan'),
    launch: (id) => call('game:launch', id),
    update: (id, patch) => call('game:update', id, patch),
    refreshArt: (id) => call('game:refreshArt', id),
    fetchMissingArt: () => call('art:fetchMissing'),
    clearArt: () => call('art:clear'),
    searchArt: (q) => call('art:search', q),
    applyArt: (id, candidate) => call('art:apply', id, candidate),
    sessions: () => call('sessions:get'),
    addGame: () => call('dialog:addGame'),
    addFolder: (kind) => call('dialog:addFolder', kind),
  },
  media: {
    launch: (id) => call('media:launch', id),
    openWeb: (item) => call('web:open', item),
    scan: (force) => call('localmedia:scan', force),
  },
  market: { get: (force) => call('market:get', force) },
  emu: {
    status: () => call('emu:status'),
    install: (id) => call('emu:install', id),
    command: (cmd) => call('emu:command', cmd),
    ps3Firmware: () => call('emu:ps3fw'),
    freeFiles: () => call('emu:freeFiles'),
    openFolder: (kind, systemId) => call('emu:openFolder', kind, systemId),
  },
  stores: {
    list: () => call('stores:list'),
    signIn: (id) => call('stores:signIn', id),
    signOut: (id) => call('stores:signOut', id),
    library: (id, force) => call('stores:library', id, force),
    options: (id, gameId) => call('stores:options', id, gameId),
    pickFolder: (kind) => call('stores:pickFolder', kind),
    paths: () => call('stores:paths'),
  },
  downloads: {
    start: (store, gameId, optionId, opts) => call('downloads:start', store, gameId, optionId, opts),
    list: () => call('downloads:list'),
    pause: (id) => call('downloads:pause', id),
    resume: (id) => call('downloads:resume', id),
    cancel: (id) => call('downloads:cancel', id),
    remove: (id) => call('downloads:remove', id),
    install: (id) => call('downloads:install', id),
    folder: (id) => call('downloads:folder', id),
  },
  social: { get: () => call('social:get'), recent: () => call('social:recent') },
  settings: { set: (key, value) => call('settings:set', key, value) },
  profiles: {
    list: () => call('profiles:list'),
    create: (p) => call('profiles:create', p),
    remove: (id) => call('profiles:delete', id),
    signIn: (id, slot) => call('profiles:signIn', id, slot),
    signOut: (slot) => call('profiles:signOut', slot),
    slots: () => call('profiles:slots'),
    activity: (slot) => call('profiles:activity', slot),
  },
  achievements: {
    get: () => call('achievements:get'),
    track: (event, data) => call('achievements:track', event, data),
  },
  system: {
    volume: (op, v) => call('system:volume', op, v),
    audioDevices: () => call('system:audioDevices'),
    setAudioDevice: (id) => call('system:setAudioDevice', id),
    power: (action) => call('system:power', action),
    explorer: () => call('system:explorer'),
    startup: () => call('system:startup'),
    shellMode: (enable) => call('system:shellMode', enable),
    gameBar: (enable) => call('system:gameBar', enable),
    info: () => call('system:info'),
    storage: () => call('system:storage'),
    network: () => call('system:network'),
    openSoundsFolder: () => call('system:openSoundsFolder'),
    soundPacks: () => call('sounds:list'),
    refreshPads: () => call('pads:refresh'),
    rumble: (slot, l, r, ms) => call('pad:rumble', slot, l, r, ms),
  },
  radio: {
    radios: () => call('radio:radios'),
    set: (kind, on) => call('radio:set', kind, on),
  },
  bt: {
    paired: () => call('bt:paired'),
    scan: (on) => call('bt:scan', on),
    pair: (id) => call('bt:pair', id),
    reply: (id, accept, pin) => call('bt:reply', id, accept, pin),
    unpair: (id) => call('bt:unpair', id),
  },
  wifi: {
    list: (rescan) => call('wifi:list', rescan),
    connect: (ssid, password, auto) => call('wifi:connect', ssid, password, auto),
    disconnect: () => call('wifi:disconnect'),
    forget: (ssid) => call('wifi:forget', ssid),
  },
  launcher: {
    resume: () => call('launcher:resume'),
    forceClose: () => call('launcher:forceClose'),
    detach: () => call('launcher:detach'),
    showAttention: () => call('launcher:showAttention'),
    showDashboard: (blade) => call('launcher:showDashboard', blade),
    launchFromDashboard: (id) => call('launcher:launchFromDashboard', id),
  },
  overlay: {
    guideClosed: () => call('overlay:guideClosed'),
    toastsIdle: () => call('overlay:toastsIdle'),
  },
  app: { quit: () => call('app:quit'), relaunch: () => call('app:relaunch') },
  arcade: {
    board: (key, pid) => call('arcade:board', key, pid),
    finish: (key, result) => call('arcade:finish', key, result),
  },
  logs: { tail: () => call('logs:tail'), open: () => call('logs:open'), error: (msg) => call('renderer:error', msg) },
  backups: {
    list: () => call('backups:list'),
    create: () => call('backups:create'),
    restore: (id) => call('backups:restore', id),
    exportFile: () => call('backups:export'),
    importFile: () => call('backups:import'),
  },
  updates: {
    status: () => call('update:status'),
    check: () => call('update:check'),
    download: () => call('update:download'),
    install: () => call('update:install'),
  },
  on: (ch, fn) => on(ch, fn),
});
