# Project 360

A controller-first, 10-foot console dashboard and game launcher for Windows, inspired by the
Xbox 360 "blades" / NXE era. It unifies your PC games into one library, hides the desktop, and
behaves like a living-room console: boot into it, pick a game with the pad, press the Guide
button in-game to resume, close the game, change volume, or power off.

> Original artwork and sounds. No Microsoft logos, fonts, or audio are used. The orb, icons,
> avatars and UI sounds are drawn/synthesized from scratch.

## Quick start

Requirements: Windows 10/11, Node.js 18+ (npm). No .NET SDK is needed: the native helper is
compiled with the C# compiler that ships with Windows (.NET Framework 4.x).

```powershell
npm install
npm start          # full screen console mode
npm run dev        # windowed, F12 opens DevTools
npm run dist       # build the installer: dist/Project-360-Setup-<version>.exe
npm run dist:portable   # single portable exe instead
```

For everyday use, install the built `Project-360-Setup-*.exe` rather than running `npm start`.
It installs per-user (no admin prompt), adds Start menu and desktop shortcuts, and updates
itself from GitHub releases (see [Updates](#updates)).

## Controls

| Pad | Keyboard | Action |
| --- | --- | --- |
| D-pad / left stick | Arrows / WASD | Move focus |
| **A** | Enter / Space | Select / Play |
| **B** | Esc / Backspace | Back |
| **X** | X | Game details / options |
| **Y** | Y / F | Search, sort, filter |
| **LB / RB** | Q / E / Tab | Switch blade |
| LT / RT | PgUp / PgDn | Page through the library; Guide volume |
| **Guide** | Home, or **Alt+G** anywhere | Open the Guide (also in games) |
| Back + Start (hold) | | Guide, for pads without a usable Guide button |
| | **Ctrl+Alt+Shift+E** | Fail-safe: start the Windows desktop (explorer.exe) |

The mouse cursor hides 2 seconds after controller input and comes back when you move the mouse.

**Guide button opens Xbox Game Bar?** Turn off *Settings › Gaming › Xbox Game Bar › "Open Xbox
Game Bar using this button on a controller"*.

## Features

**Look & feel**
- **Blades dashboard**: eight blades (marketplace · social · home · games · arcade · retro · media · system). It starts on Home with blades stacked on both sides, which peek out as labelled slivers and sweep across with LB/RB. Blade tabs run across the header.
- **Themes**:
  - **Classic Blades**: glossy silver blades with green pill highlights.
  - **NXE Night**, **Carbon** and **Aurora**.
  - Optional "last played game" art as the background.
- **Boot sequence**: light streaks, the orb forming inside spinning rings, a synthesized startup chord, then the blades sweep in.
- **Ring of Light**: four quadrants around a glowing Guide button. Every connected controller lights its quadrant, and yours pulses. It also shows the player number and battery.
- **Sign-in**: "Player signed in" toasts with your quadrant, multiple profiles, and a "Who's playing?" screen.
- **Toasts**:
  - Achievement-unlocked pills with a trophy.
  - Controller and battery toasts with the ring.
  - A notifications history in the Social blade.
- **Screensaver**: the dashboard dims after inactivity.
- **Synthesized UI sounds**: blade whoosh, tick, chimes, achievement, boot and sign-in, with drop-in sound packs.

**Games**
- **NXE-style 3D cover carousel** with reflections, shelves (All, Recent, Favorites, per store) and an optional grid view.
- **Unified library**: Steam, Epic, GOG, the Xbox app / Game Pass, shortcut folders, added programs, and emulator ROMs.
- **Artwork without API keys**, cached for offline use:
  - **Steam**: local cache plus the store's hashed asset API.
  - **Epic**: the launcher's catalog cache.
  - **GOG**: public API.
  - **Microsoft Store**: catalog.
  - **ROMs**: libretro thumbnails.
  - **Other games**: strict title matching.
  - **Manual fix**: Change artwork (X on a game › search and pick).
  - **Optional keys**: SteamGridDB and IGDB add more sources.
- **No Windows in sight**:
  - **Taskbar:** hidden while the console runs. The helper restores it on exit, even after a crash.
  - **Desktop:** a black curtain sits behind games so the desktop never flashes.
  - **Store launchers:** Steam, Epic and other launcher main windows are hidden during play and right after you exit.
- **Seamless launching**: the launch screen stays on top of Steam, Epic and other launcher windows and update prompts until the real game window appears, then fades to black and steps aside. Steam starts with `-silent`. If a launcher needs input (EULA, cloud conflict), the cover says so and A shows it.
- **Playtime, favorites, hidden games, details sheet with metadata.**

**Guide** (Xbox button, Alt+G, or Back+Start)
- Resume, close game (graceful close first, then force), and back to dashboard.
- Jump back into recent games.
- Music controls.
- Volume (LT/RT) and audio output switching.
- Controller batteries.
- Turn off, restart, sleep, exit to desktop, switch profile.
- **Xbox button vs. Game Bar**: setup (and System › Controllers) can turn off Windows' "Open Xbox Game Bar using this button", so the button opens the Guide.

**Social**
- **Gamer card**: gamerscore, stats, most played.
- **Achievements**: 34 console achievements (840G), earned by using Project 360.
- **Steam friends**: online and in-game status. Needs a free Steam Web API key.
- **Activity, notifications, profiles.**

**Marketplace**
- Steam deals, top sellers, new releases and coming soon, plus Epic's free games, with prices and "Installed" badges.
- Store pages open full screen in your browser.

**Retro** (built-in emulation)
- **Folders:** `%USERPROFILE%\Emulation` is created with a `roms\<system>` folder for each of 26 systems, plus `bios`, `saves` and `states`. Put your games in a system's folder and they appear in the Retro blade and in My games, with box art from libretro thumbnails.
- **Systems:** NES, SNES, N64, Game Boy / Color / Advance, DS, GameCube, Wii, Wii U, Genesis, Master System, Game Gear, Sega CD, Saturn, Dreamcast, PS1, PS2, PSP, PS3, Xbox, Xbox 360, Arcade, Atari 2600, TurboGrafx-16 and Neo Geo Pocket Color.
- **One-press emulator installs** of the official builds: RetroArch with its cores (cores download automatically the first time you play a system), DuckStation, PCSX2, Cemu, xemu, Xenia Canary and RPCS3. Each one is set up for full screen and controller, with first-run wizards skipped and the BIOS folder wired in. Launching a game whose emulator isn't installed offers to install it, then starts the game.
- **Guide controls for RetroArch games:** save state, load state, reset and the emulator menu (RetroArch's own menu is L3+R3).
- **No BIOS needed where possible:** DS runs on DeSmuME; PS1 (PCSX-ReARMed) and Saturn (Yabause) switch to built-in-BIOS cores automatically when no BIOS is present. GBA and Dreamcast run without one too.
- **Downloads automatically:** only files that are legitimately free:
  - Dolphin's system files, PPSSPP's assets and RetroArch's core info, from the libretro buildbot.
  - Sony's official PS3 system software, from playstation.net, installed into RPCS3.
- **Still needs your own dumps:** PS2, Sega CD and the original Xbox. Console BIOS files are copyrighted, so Project 360 never downloads them. Retro › BIOS & folders shows exactly what's missing.
- **Retro metadata:** descriptions, developer, publisher, year and genre come from libretro's game database (matched by ROM name or checksum) and Wikipedia, with Wikipedia box art as a fallback.
- **Presentation:** box art is shown at its real shape with a system badge, and pixel-art screenshots stay sharp.
- Multi-disc and `.cue`/`.bin` sets are handled. PS3 and Wii U games can also be extracted game folders.

**Your Steam & Epic libraries** (Marketplace)
- **Owned but not installed:** both libraries list every game you own, uninstalled ones first.
- **Epic** reads your owned games from the Epic Games Launcher on this PC, with no sign-in.
- **Steam** uses, best first:
  - your Steam Web API key (Social › Friends) for the complete list;
  - a one-time sign-in to the Steam store in the app, also complete;
  - otherwise, the games you've launched on this PC.
- **Installing:** press A to install through Steam or the Epic Games Launcher (the only way those stores allow). The dashboard steps aside for their install dialog. Steam's download progress shows in Downloads, and the game appears in My games when it's done.

**Store accounts & downloads** (Marketplace)
- **Supported stores:** GOG, itch.io and Humble Bundle. Each store has a small connector in `src/main/stores/`, so adding another store is one file.
- **Sign-in:** sign in once in an in-app window. The controller drives the pointer there, and the Xbox button cancels. Your sign-in cookies stay in that store's own session.
- **Library:** Project 360 lists the games you own and badges the ones already installed.
- **Downloads queue:** progress, speed, multi-part installers, pause, resume and cancel.
- **Automatic install:**
  - GOG installers run silently into your Games folder (Windows asks for admin permission).
  - ZIPs are extracted and the game's .exe is added to your library.
  - MSI and other installers run.
  - Installer files are deleted afterwards.
- **Install folder:** set it under Downloads › Change install folder (default `%USERPROFILE%\Games`).

**Media**
- **Web apps**: they open full screen in **Firefox with your normal profile**, so your sign-ins and add-ons such as uBlock Origin work. Edge is the fallback.
- **Controller as mouse and keyboard while they're open**:
  - Left stick: pointer · A: click · X: right-click
  - B: back · right stick: scroll · D-pad: arrows
  - Y: play/pause · LB/RB: Tab · Start: Enter
  - Back: Esc · R3: full screen
- **YouTube TV mode**: a built-in leanback YouTube made for controllers, with ad blocking.
- **Desktop apps**: Spotify, VLC, Kodi, Plex and Jellyfin when installed, plus your own web apps.
- **Music**: background playback with ID3/MP4/FLAC tags, shuffle, and now-playing in the header and Guide.
- **Pictures**: Steam screenshots, Game Bar and NVIDIA captures, and Pictures, in a full-screen viewer with slideshow.
- **Videos**: game clips and the Videos folder in a built-in player.

**System**
- Console, Themes, Library, Artwork, Web & media, Audio, Controllers.
- **Storage**: drives with game sizes.
- **Network**: Wi-Fi on/off, nearby networks with signal and band, join with the on-screen keyboard (saved networks connect without asking), disconnect, forget. Plus a connection test: adapter, DNS, internet, Steam, Epic, Xbox.
- **Bluetooth**: on/off, **Add a device** (live scan; pairs controllers, headphones, keyboards and mice, with PIN prompts when a device needs one), and your paired devices with connection state and Remove.
- **Console info**: CPU, GPU, RAM, uptime.
- **Power & shell**: shell mode and the desktop fail-safes.
- **Initial setup wizard** on first run.

## Configuration

Everything is editable in **System**, and also stored in
`%APPDATA%\Project 360\settings.json` (quit the app before hand-editing).

### Emulators

Add profiles to `library.emulators`; every ROM found becomes a game:

```json
"emulators": [
  {
    "name": "SNES",
    "emulator": "C:\\RetroArch\\retroarch.exe",
    "args": "-L cores\\snes9x_libretro.dll -f \"{rom}\"",
    "romsPath": "D:\\ROMs\\SNES",
    "extensions": ["sfc", "smc", "zip"]
  }
]
```

`{rom}` is the full ROM path and `{romdir}` its folder. ROM folders are scanned up to 3 levels deep.

### Media apps

YouTube (TV interface), Netflix and Twitch open in a full-screen Edge kiosk window. Spotify, VLC,
Kodi, Plex and Jellyfin appear when installed. Add your own from the Media blade (**Add web app**),
or in `media.custom`:

```json
"custom": [
  { "title": "Crunchyroll", "url": "https://www.crunchyroll.com" },
  { "title": "Steam Big Picture", "exe": "C:\\Program Files (x86)\\Steam\\steam.exe", "args": ["-bigpicture"] }
]
```

### Sound packs

Open **System › Audio › Open sound packs folder** (`%APPDATA%\Project 360\sounds`). Create a
folder, drop in `blade`, `tick`, `select`, `back`, `guide`, `toast`, `error`, `launch`
(`.wav`/`.ogg`/`.mp3`), then choose the pack. Missing files fall back to the built-in sounds.

### Artwork keys

- **SteamGridDB**: steamgriddb.com › Preferences › API. Covers, heroes and logos for every store.
- **IGDB**: create an app at dev.twitch.tv, then enter its Client ID and Secret. Adds covers and
  descriptions.

## Arcade

Three original games built into the dashboard, on their own **Arcade** blade (between Games and
Retro): big covers, and for the selected game its description, your best and rank, playtime,
leaderboard and achievements (Y shows the full leaderboard). They keep playtime like any game,
each leaderboard is shared by every profile on the console, and arcade achievements count
toward your gamerscore. Arcade and retro games stay on their own blades; the Games blade and
Home's suggestions show the rest of your library (Home's recently played still shows anything
you played).

- **Pulse Arena**: twin-stick shooter inside a ring of light. Left stick moves, right stick
  aims and fires, LB/RB drop a bomb.
- **Prism Breaker**: neon brick breaker with power-ups and handcrafted levels.
- **Glow Link**: match-three puzzle; two-minute Blitz for the high score.

Start pauses (Resume, Restart, Quit). The Guide pauses the game too. Keyboard: WASD to move,
arrow keys to aim, Space/Enter for A, Esc to pause.

## Multiple players

Each controller can be signed in to its own profile, like on the console:

- **Signing in**: plug in a second pad and a toast invites that player to sign in. Or press
  Guide on that pad and choose **Sign in · Player 2**. The sign-in screen is titled with the
  player number, and profiles already signed in on another pad are marked.
- **Ring of Light**: the quadrant follows the player. Player 2's pad lights quadrant 2, and the
  header ring shows whichever player is using the dashboard right now.
- **Active player**: the dashboard switches to whichever signed-in player last touched their
  controller. The header chip shows them with a `P#` badge, plus small avatars for the other
  signed-in players.
- **Separate data**: favorites, playtime, recently played and achievements are per profile.
  A game is credited to the player who launched it, even if someone else picks up a pad later.
- **Guide › Players**: every connected pad with its player, battery and gamerscore. Press A on a
  player to switch profiles or sign them out, or to sign in an empty pad.

## Reliability

- **Logs**: `%APPDATA%\Project 360\logs\main-YYYY-MM-DD.log` (the last 10 days kept), plus
  `watchdog.log`. **System › Console info** shows recent problems and has **Open logs folder**.
  Renderer errors are logged there too. Crash dumps go to `%APPDATA%\Project 360\Crashpad`.
- **Watchdog**: a small companion process watches the dashboard's heartbeat.
  - If Project 360 **crashes**, it restarts in about 3 seconds and shows a "recovered" toast.
  - If it **freezes** for 45 seconds, it's killed and restarted.
  - After 3 crashes in 10 minutes it stops trying, so a broken build can't loop forever. In
    console shell mode, the shell launcher falls back to explorer.exe at that point.
  - A crashed or frozen screen inside the dashboard (the UI, not the whole app) reloads on its own.
- **Safe saves**: settings and profile files are written atomically, with a rolling `.bak` copy.
  A corrupted file is set aside as `.corrupt-<time>` and the last good copy is loaded.

### Backup & restore

**System › Backup & restore** covers profiles, gamertags, achievements, playtime, favorites,
settings and keys, emulator setup, and art choices.

- A backup is made **automatically every day** and before every restore or update. The last 15
  are kept in `%APPDATA%\Project 360\backups`.
- **Export** writes a single `.p360backup` file you can keep or move to another PC; **Import**
  loads one (your current data is backed up first).
- **Restore** goes back to any listed backup, then restarts Project 360.

### Updates

The installed app checks GitHub releases shortly after start and every 6 hours. Updates
download in the background and install silently the next time Project 360 restarts. They never
install while a game is running. **System › Updates** has check/download/install now, auto
download, and beta (pre-release) updates.

To publish releases:

1. Releases come from [captainrobollc-source/project-360](https://github.com/captainrobollc-source/project-360)
   (`build.publish` in `package.json`). Installed builds point at it automatically. To use a fork,
   change `build.publish`, or set **System › Updates › Update source** (`owner/repo`).
2. Bump `version` in `package.json`, commit, then tag and push:
   ```powershell
   git tag v0.2.0
   ```
   ```powershell
   git push origin v0.2.0
   ```
   `.github/workflows/release.yml` builds the installer and publishes the release.
3. **Code signing (optional, recommended)**: add repository secrets `WINDOWS_CERT_BASE64`
   (your `.pfx`, base64-encoded) and `WINDOWS_CERT_PASSWORD`. Without a certificate the installer
   is unsigned, and Windows SmartScreen will show "Windows protected your PC" on first install
   (More info › Run anyway). Updates still work.

To publish from your own PC instead: `$env:GH_TOKEN = "<token>"`, then `npm run release`. That
uploads to a **draft** release; publish it on GitHub (or `gh release edit vX.Y.Z --draft=false`)
so installed apps can see it.

## Console shell mode (boot straight into Project 360)

**System › Power & shell › Console shell mode** sets the per-user Windows shell
(`HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell`) to
`scripts/shell-launcher.vbs`, which runs Project 360 instead of explorer.exe for **your account
only**. Other accounts are not affected. It takes effect at the next sign-in.

Ways back to Windows, all always available:

1. **Guide › Exit to desktop** starts explorer.exe and closes the dashboard.
2. **Ctrl+Alt+Shift+E** starts explorer.exe at any time.
3. If Project 360 quits, the shell launcher **starts explorer.exe automatically**, so you never
   get stuck on a black screen. If it crashes, it's restarted, up to 3 times in 10 minutes,
   and after that explorer.exe starts.
4. **Ctrl+Shift+Esc** › Task Manager › *Run new task* › `explorer`.

To turn it off, flip the toggle again, or run:

```powershell
reg delete "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Winlogon" /v Shell /f
```

Tips for a true console box: enable automatic sign-in (`netplwiz`), turn on
**Start with Windows** if you'd rather keep explorer running underneath, and set Steam to start
silently so `steam://` launches are instant.

## Architecture

```
src/main/            Electron main process
  main.js            windows (dashboard + transparent always-on-top overlay), input routing, IPC
  native.js          manages the native helper over stdio (JSON lines)
  launcher.js        launch + process tracking (detect → suspend dashboard → exit → restore)
  library/*.js       Steam / Epic / GOG / Xbox / custom scanners, merged library + user data
  art.js             artwork + metadata cache
  system.js          power, startup, shell mode, explorer fail-safe
  media.js           media app detection
  radio.js           Bluetooth + Wi-Fi (p360-radio.exe, netsh for saved profiles)
  reliability/       logger, heartbeat + watchdog.js (detached), backups, auto-updater
  arcade.js          built-in arcade: library entries, shared leaderboards, arcade achievements
src/preload.js       contextBridge API (sandboxed renderer)
src/renderer/        vanilla ES modules, no build step
  js/dashboard.js    blade manager
  js/blades/*.js     home, games, media, profile, system
  js/arcade/         arcade engine (input, pause, leaderboards) and the three games
  js/components/     guide, toast, ring, modal/dialog/OSK, details, launch splash, tiles
  js/input.js        native XInput masks + Gamepad API + keyboard/mouse → actions
  js/nav.js          layer stack + spatial focus navigation
  js/sound.js        WebAudio synth + sound packs
native/P360Radio.cs  Bluetooth scan/pair/unpair + Wi-Fi scan/connect (WinRT device APIs)
native/P360Native.cs XInput (incl. Guide via XInputGetStateEx, battery, rumble), WinMM
                     PlayStation-button detection, Core Audio volume + default device
                     (IPolicyConfig), process lookup by path, force-foreground, sleep
```

The renderer is a fixed 1920×1080 stage scaled to the screen, so the layout looks the same at
720p, 1080p and 4K.

## Known limitations

- Firefox kiosk only applies when Firefox isn't already open. If it is, the page opens in a normal Firefox window.
- Steam may open Big Picture on the Xbox button. Turn off Steam › Settings › Controller › "Guide Button Focuses Steam".
- Games in **exclusive full screen** can't show the overlay above them, so press the Guide and
  the game minimizes instead. Borderless/windowed full screen (the default in most modern games)
  works.
- Battery level is available for XInput controllers only. DirectInput pads (DualShock/DualSense)
  navigate the dashboard, and their PS button opens the Guide in-game.
- Store launchers sometimes run their own pre-launch windows. If a game isn't detected within
  two minutes, the dashboard says so, and B (or Guide › Stop tracking) returns to it.
- Audio output switching uses the long-standing undocumented `IPolicyConfig` interface (the same
  one used by every audio-switcher utility).

## Dev testing

`npm run dev` with `P360_SCRIPT=steps.json` drives the UI headlessly and takes screenshots. Scripted runs ignore real controllers and never launch real games or apps (`P360_PADS=1` / `P360_ALLOW_LAUNCH=1` opt in). Add `P360_USERDATA=<folder>` to use an isolated data folder (your real profile and achievements are untouched, and it can run beside a normal instance):

```json
[{ "wait": 3000 }, { "action": "rb" }, { "shot": "games.png" }, { "guide": true }, { "quit": true }]
```
