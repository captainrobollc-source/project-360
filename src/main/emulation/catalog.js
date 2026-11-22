// Emulated systems and the official open-source emulators that run them.
// BIOS/firmware files are never downloaded: you dump them from your own consoles.

const RA_CORES = 'https://buildbot.libretro.com/nightly/windows/x86_64/latest';
// Free, openly licensed support files from the libretro buildbot (no copyrighted BIOS).
const SYSTEM_ASSETS = {
  info: { url: 'https://buildbot.libretro.com/assets/frontend/info.zip', to: 'retroarch-info', label: 'RetroArch core info' },
  dolphin: { url: 'https://buildbot.libretro.com/assets/system/Dolphin.zip', to: 'bios', label: 'Dolphin system files' },
  ppsspp: { url: 'https://buildbot.libretro.com/assets/system/PPSSPP.zip', to: 'bios', label: 'PPSSPP assets' },
};
// Sony's official PS3 system software feed (free download from playstation.net).
const PS3_UPDATE_LIST = 'http://fus01.ps3.update.playstation.net/update/ps3/list/us/ps3-updatelist.txt';

// emulator: 'retroarch' (with core) or a standalone emulator id.
const SYSTEMS = [
  { id: 'nes', name: 'Nintendo Entertainment System', short: 'NES', maker: 'Nintendo', year: 1985, color: '#c4302b', exts: ['nes', 'fds', 'unf', 'zip', '7z'], libretro: 'Nintendo - Nintendo Entertainment System', emulator: 'retroarch', core: 'mesen' },
  { id: 'snes', name: 'Super Nintendo', short: 'SNES', maker: 'Nintendo', year: 1991, color: '#6a4fbf', exts: ['sfc', 'smc', 'fig', 'swc', 'bs', 'zip', '7z'], libretro: 'Nintendo - Super Nintendo Entertainment System', emulator: 'retroarch', core: 'snes9x' },
  { id: 'n64', name: 'Nintendo 64', short: 'N64', maker: 'Nintendo', year: 1996, color: '#1f8f3a', exts: ['n64', 'z64', 'v64', 'zip', '7z'], libretro: 'Nintendo - Nintendo 64', emulator: 'retroarch', core: 'mupen64plus_next' },
  { id: 'gb', name: 'Game Boy', short: 'GB', maker: 'Nintendo', year: 1989, color: '#8b956d', exts: ['gb', 'zip', '7z'], libretro: 'Nintendo - Game Boy', emulator: 'retroarch', core: 'gambatte' },
  { id: 'gbc', name: 'Game Boy Color', short: 'GBC', maker: 'Nintendo', year: 1998, color: '#7a3fa8', exts: ['gbc', 'zip', '7z'], libretro: 'Nintendo - Game Boy Color', emulator: 'retroarch', core: 'gambatte' },
  { id: 'gba', name: 'Game Boy Advance', short: 'GBA', maker: 'Nintendo', year: 2001, color: '#4a3fbf', exts: ['gba', 'zip', '7z'], libretro: 'Nintendo - Game Boy Advance', emulator: 'retroarch', core: 'mgba', bios: [{ files: ['gba_bios.bin'], optional: true }] },
  { id: 'nds', name: 'Nintendo DS', short: 'DS', maker: 'Nintendo', year: 2004, color: '#8a8f96', exts: ['nds', 'zip', '7z'], libretro: 'Nintendo - Nintendo DS', emulator: 'retroarch', core: 'desmume' }, // DeSmuME needs no DS BIOS/firmware
  { id: 'gc', name: 'GameCube', short: 'GameCube', maker: 'Nintendo', year: 2001, color: '#5a3fa0', exts: ['iso', 'gcm', 'gcz', 'rvz', 'ciso'], libretro: 'Nintendo - GameCube', emulator: 'retroarch', core: 'dolphin' },
  { id: 'wii', name: 'Wii', short: 'Wii', maker: 'Nintendo', year: 2006, color: '#3aa0e8', exts: ['wbfs', 'iso', 'rvz', 'wad', 'gcz'], libretro: 'Nintendo - Wii', emulator: 'retroarch', core: 'dolphin' },
  { id: 'wiiu', name: 'Wii U', short: 'Wii U', maker: 'Nintendo', year: 2012, color: '#1c8fc4', exts: ['wua', 'wud', 'wux', 'rpx'], folders: 'wiiu', libretro: 'Nintendo - Wii U', emulator: 'cemu' },
  { id: 'genesis', name: 'Sega Genesis / Mega Drive', short: 'Genesis', maker: 'Sega', year: 1989, color: '#1c1c1c', exts: ['md', 'gen', 'smd', 'bin', 'zip', '7z'], libretro: 'Sega - Mega Drive - Genesis', emulator: 'retroarch', core: 'genesis_plus_gx' },
  { id: 'sms', name: 'Sega Master System', short: 'Master System', maker: 'Sega', year: 1986, color: '#b8262c', exts: ['sms', 'zip', '7z'], libretro: 'Sega - Master System - Mark III', emulator: 'retroarch', core: 'genesis_plus_gx' },
  { id: 'gg', name: 'Sega Game Gear', short: 'Game Gear', maker: 'Sega', year: 1990, color: '#2b2b2b', exts: ['gg', 'zip', '7z'], libretro: 'Sega - Game Gear', emulator: 'retroarch', core: 'genesis_plus_gx' },
  { id: 'segacd', name: 'Sega CD', short: 'Sega CD', maker: 'Sega', year: 1991, color: '#3a3a3a', exts: ['cue', 'chd', 'iso'], libretro: 'Sega - Mega-CD - Sega CD', emulator: 'retroarch', core: 'genesis_plus_gx', bios: [{ files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'] }] },
  { id: 'saturn', name: 'Sega Saturn', short: 'Saturn', maker: 'Sega', year: 1994, color: '#2c3e7a', exts: ['cue', 'chd', 'ccd', 'm3u'], libretro: 'Sega - Saturn', emulator: 'retroarch', core: 'mednafen_saturn', bios: [{ files: ['sega_101.bin', 'mpr-17933.bin'] }], fallback: { emulator: 'retroarch', core: 'yabause', note: 'Yabause with its built-in BIOS' } },
  { id: 'dreamcast', name: 'Sega Dreamcast', short: 'Dreamcast', maker: 'Sega', year: 1999, color: '#e8742a', exts: ['cdi', 'gdi', 'chd', 'm3u'], libretro: 'Sega - Dreamcast', emulator: 'retroarch', core: 'flycast', bios: [{ files: ['dc/dc_boot.bin'], optional: true }] },
  { id: 'psx', name: 'PlayStation', short: 'PS1', maker: 'Sony', year: 1994, color: '#8a8f96', exts: ['cue', 'chd', 'pbp', 'm3u', 'iso', 'ecm'], libretro: 'Sony - PlayStation', emulator: 'duckstation', fallback: { emulator: 'retroarch', core: 'pcsx_rearmed', note: 'PCSX-ReARMed with its built-in BIOS' }, bios: [{ files: ['scph5501.bin', 'scph1001.bin', 'scph7001.bin', 'scph5500.bin', 'scph5502.bin', 'scph101.bin', 'scph1002.bin', 'scph7003.bin'], match: /^scph.*\.bin$/i, maxSize: 1024 * 1024 }] },
  { id: 'ps2', name: 'PlayStation 2', short: 'PS2', maker: 'Sony', year: 2000, color: '#1c3f8f', exts: ['iso', 'chd', 'cso', 'gz', 'zso'], libretro: 'Sony - PlayStation 2', emulator: 'pcsx2', bios: [{ files: ['SCPH-xxxxx.bin (any PS2 BIOS)'], match: /^(scph|ps2).*\.bin$/i, minSize: 2 * 1024 * 1024 }] }, // PS1 BIOS files share the name and are 512 KB
  { id: 'psp', name: 'PlayStation Portable', short: 'PSP', maker: 'Sony', year: 2004, color: '#2a2a2a', exts: ['iso', 'cso', 'pbp', 'chd'], libretro: 'Sony - PlayStation Portable', emulator: 'retroarch', core: 'ppsspp' },
  { id: 'ps3', name: 'PlayStation 3', short: 'PS3', maker: 'Sony', year: 2006, color: '#111111', exts: ['iso', 'pkg'], folders: 'ps3', libretro: 'Sony - PlayStation 3', emulator: 'rpcs3', bios: [{ files: ['PS3UPDAT.PUP'], note: 'PS3 firmware — install it once from System › Emulation' }] },
  { id: 'xbox', name: 'Xbox', short: 'Xbox', maker: 'Microsoft', year: 2001, color: '#107c10', exts: ['iso', 'xiso'], libretro: 'Microsoft - Xbox', emulator: 'xemu', bios: [{ files: ['mcpx_1.0.bin'] }, { files: ['Complex_4627.bin', 'complex_4627.bin'] }, { files: ['xbox_hdd.qcow2'] }] },
  { id: 'x360', name: 'Xbox 360', short: 'Xbox 360', maker: 'Microsoft', year: 2005, color: '#5cbf1d', exts: ['iso', 'xex', 'zar'], folders: 'x360', libretro: 'Microsoft - Xbox 360', emulator: 'xenia' },
  { id: 'arcade', name: 'Arcade', short: 'Arcade', maker: 'Various', year: 1980, color: '#c98f05', exts: ['zip', '7z'], libretro: 'FBNeo - Arcade Games', emulator: 'retroarch', core: 'fbneo' },
  { id: 'atari2600', name: 'Atari 2600', short: 'Atari 2600', maker: 'Atari', year: 1977, color: '#8a5a2a', exts: ['a26', 'bin', 'zip', '7z'], libretro: 'Atari - 2600', emulator: 'retroarch', core: 'stella' },
  { id: 'pce', name: 'TurboGrafx-16 / PC Engine', short: 'TurboGrafx', maker: 'NEC', year: 1987, color: '#d84a1b', exts: ['pce', 'cue', 'chd', 'zip', '7z'], libretro: 'NEC - PC Engine - TurboGrafx 16', emulator: 'retroarch', core: 'mednafen_pce_fast' },
  { id: 'ngp', name: 'Neo Geo Pocket Color', short: 'NGPC', maker: 'SNK', year: 1999, color: '#2a6cc4', exts: ['ngp', 'ngc', 'zip', '7z'], libretro: 'SNK - Neo Geo Pocket Color', emulator: 'retroarch', core: 'mednafen_ngp' },
];

// source(): resolves the current official download → { url, version, kind: 'zip'|'7z' }
const gh = (repo, pattern, tag = 'latest') => async () => {
  const r = await fetch(`https://api.github.com/repos/${repo}/releases/${tag === 'latest' ? 'latest' : `tags/${tag}`}`, { headers: { 'User-Agent': 'Project360', Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const j = await r.json();
  const a = (j.assets || []).find((x) => pattern.test(x.name));
  if (!a) throw new Error('No Windows build found in the latest release');
  return { url: a.browser_download_url, version: j.tag_name, size: a.size, kind: /\.7z$/i.test(a.name) ? '7z' : 'zip' };
};

const EMULATORS = [
  {
    id: 'retroarch', name: 'RetroArch', about: 'Runs most classic systems through cores. Cores download automatically the first time you play a system.',
    exe: /^retroarch\.exe$/i, license: 'GPLv3', site: 'retroarch.com',
    source: async () => {
      const html = await (await fetch('https://buildbot.libretro.com/stable/')).text();
      const vers = [...html.matchAll(/href="\/stable\/(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]);
      vers.sort((a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; });
      const v = vers.pop();
      if (!v) throw new Error('Could not find a RetroArch release');
      return { url: `https://buildbot.libretro.com/stable/${v}/windows/x86_64/RetroArch.7z`, version: v, kind: '7z' };
    },
  },
  { id: 'duckstation', name: 'DuckStation', about: 'PlayStation, with upscaling and fast loading.', exe: /^duckstation-qt.*\.exe$/i, license: 'CC BY-NC-ND', site: 'duckstation.org', source: gh('stenzek/duckstation', /^duckstation-windows-x64-release\.zip$/i, 'latest') },
  { id: 'pcsx2', name: 'PCSX2', about: 'PlayStation 2.', exe: /^pcsx2-qt\.exe$/i, license: 'GPLv3', site: 'pcsx2.net', source: gh('PCSX2/pcsx2', /windows-x64-Qt\.7z$/i) },
  { id: 'cemu', name: 'Cemu', about: 'Wii U.', exe: /^cemu\.exe$/i, license: 'MPL 2.0', site: 'cemu.info', source: gh('cemu-project/Cemu', /windows-x64\.zip$/i) },
  { id: 'xemu', name: 'xemu', about: 'Original Xbox. Needs your own Xbox BIOS, MCPX boot ROM and HDD image.', exe: /^xemu\.exe$/i, license: 'GPLv2', site: 'xemu.app', source: gh('xemu-project/xemu', /^xemu-[\d.]+-windows-x86_64\.zip$/i) },
  { id: 'xenia', name: 'Xenia Canary', about: 'Xbox 360. Compatibility varies by game.', exe: /^xenia_canary\.exe$/i, license: 'BSD', site: 'xenia.jp', source: gh('xenia-canary/xenia-canary-releases', /windows.*\.zip$/i) },
  { id: 'rpcs3', name: 'RPCS3', about: 'PlayStation 3. Needs the PS3 firmware (PS3UPDAT.PUP from Sony) installed once.', exe: /^rpcs3\.exe$/i, license: 'GPLv2', site: 'rpcs3.net', source: gh('RPCS3/rpcs3-binaries-win', /win64.*\.7z$/i) },
];

module.exports = { SYSTEMS, EMULATORS, RA_CORES, SYSTEM_ASSETS, PS3_UPDATE_LIST };
