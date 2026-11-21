// Compiles the native helpers with the C# compiler that ships with Windows (.NET Framework 4.x),
// so no .NET SDK is required.
//   native/P360Native.cs → p360-native.exe  (XInput, audio, windows; required)
//   native/P360Radio.cs  → p360-radio.exe   (Bluetooth + Wi-Fi via WinRT; optional)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'native', 'bin');
const win = process.env.WINDIR || 'C:\\Windows';
const fw = path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const winmd = path.join(win, 'System32', 'WinMetadata');

const TARGETS = [
  { name: 'p360-native', src: 'P360Native.cs', refs: [], required: true },
  {
    name: 'p360-radio', src: 'P360Radio.cs', required: false,
    refs: [
      path.join(winmd, 'Windows.Foundation.winmd'), path.join(winmd, 'Windows.Devices.winmd'),
      path.join(winmd, 'Windows.Networking.winmd'), path.join(winmd, 'Windows.Security.winmd'),
      path.join(fw, 'System.Runtime.WindowsRuntime.dll'), path.join(fw, 'System.Runtime.dll'),
      path.join(fw, 'System.Threading.Tasks.dll'), path.join(fw, 'System.Runtime.InteropServices.WindowsRuntime.dll'),
    ],
  },
];

function findCsc() {
  const candidates = [path.join(fw, 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')];
  return candidates.find((c) => fs.existsSync(c));
}

function buildOne(t, { force, quiet }) {
  const src = path.join(root, 'native', t.src);
  const out = path.join(outDir, `${t.name}.exe`);
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
    if (!quiet) console.log('[native] up to date:', path.relative(root, out));
    return out;
  }
  const csc = findCsc();
  if (!csc) throw new Error('csc.exe (.NET Framework 4.x) not found');
  const missing = t.refs.filter((r) => !fs.existsSync(r));
  if (missing.length) throw new Error(`${t.name}: missing ${missing.join(', ')}`);
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${out}`, ...t.refs.map((r) => `/r:${r}`), src];
  try {
    execFileSync(csc, args, { stdio: quiet ? 'pipe' : 'inherit', windowsHide: true });
  } catch (e) {
    const msg = (e.stdout || '').toString() + (e.stderr || '').toString();
    throw new Error(`${t.name} failed to compile\n${msg}`);
  }
  if (!quiet) console.log('[native] built', path.relative(root, out));
  return out;
}

function build({ force = false, quiet = false } = {}) {
  let main = null;
  for (const t of TARGETS) {
    try {
      const out = buildOne(t, { force, quiet });
      if (t.required) main = out;
    } catch (e) {
      if (t.required) throw e;
      console.warn(`[native] ${t.name} skipped: ${e.message.split('\n')[0]}`);
    }
  }
  return main;
}

module.exports = { build, out: path.join(outDir, 'p360-native.exe') };

if (require.main === module) {
  try { build({ force: process.argv.includes('--force') }); }
  catch (e) { console.error(e.message); process.exit(1); }
}
