// Compiles native/P360Native.cs with the C# compiler that ships with Windows
// (.NET Framework 4.x), so no .NET SDK is required.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'native', 'P360Native.cs');
const outDir = path.join(root, 'native', 'bin');
const out = path.join(outDir, 'p360-native.exe');

function findCsc() {
  const win = process.env.WINDIR || 'C:\\Windows';
  const candidates = [
    path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe'),
  ];
  return candidates.find((c) => fs.existsSync(c));
}

function build({ force = false, quiet = false } = {}) {
  if (!force && fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) {
    if (!quiet) console.log('[native] up to date:', path.relative(root, out));
    return out;
  }
  const csc = findCsc();
  if (!csc) throw new Error('csc.exe (.NET Framework 4.x) not found');
  fs.mkdirSync(outDir, { recursive: true });
  const args = ['/nologo', '/optimize+', '/target:exe', '/platform:anycpu', `/out:${out}`, src];
  try {
    execFileSync(csc, args, { stdio: quiet ? 'pipe' : 'inherit', windowsHide: true });
  } catch (e) {
    const msg = (e.stdout || '').toString() + (e.stderr || '').toString();
    throw new Error('native helper failed to compile\n' + msg);
  }
  if (!quiet) console.log('[native] built', path.relative(root, out));
  return out;
}

module.exports = { build, out };

if (require.main === module) {
  try { build({ force: process.argv.includes('--force') }); }
  catch (e) { console.error(e.message); process.exit(1); }
}
