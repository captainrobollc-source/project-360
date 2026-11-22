// Moving the whole Emulation folder (games, BIOS, emulators, saves, states) to another drive.
// Copy everything, check every file arrived whole, switch over, and only then delete the old
// copy. A failure or cancel at any point before the switch leaves the old folder untouched and
// removes the partial copy.
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// Is `p` inside (or equal to) `dir`?
function inside(p, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(p));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
const driveOf = (p) => path.parse(path.resolve(p)).root.toLowerCase();

// Every file and folder under `dir`, relative to it. Links (junctions) are not followed: they're
// counted so the caller can say they were left behind.
async function inventory(dir, signal) {
  const files = [];
  const dirs = [];
  let links = 0;
  let bytes = 0;
  let largest = null;
  const stack = [''];
  while (stack.length) {
    if (signal && signal.aborted) throw abortError();
    const rel = stack.pop();
    let entries;
    try { entries = await fs.promises.readdir(path.join(dir, rel), { withFileTypes: true }); }
    catch { throw new Error(`Couldn’t read ${path.join(dir, rel)}`); }
    for (const e of entries) {
      const r = path.join(rel, e.name);
      if (e.isSymbolicLink()) { links++; continue; }
      if (e.isDirectory()) { dirs.push(r); stack.push(r); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = await fs.promises.stat(path.join(dir, r)); } catch { throw new Error(`Couldn’t read ${path.join(dir, r)}`); }
      files.push({ rel: r, size: st.size, atime: st.atime, mtime: st.mtime, mtimeMs: st.mtimeMs });
      bytes += st.size;
      if (!largest || st.size > largest.size) largest = { rel: r, size: st.size };
    }
  }
  return { files, dirs, links, bytes, largest };
}

function abortError() { const e = new Error('Move cancelled'); e.cancelled = true; return e; }

async function freeSpace(dir) {
  try { const s = await fs.promises.statfs(path.parse(path.resolve(dir)).root); return s.bavail * s.bsize; }
  catch { return null; }
}

const BIG = 8 * 1024 * 1024;

// Copies one file. Big files stream (so progress moves during a 4 GB disc image); small ones use
// the OS copy. Either way the copy has to come out the same size as the original.
async function copyOne(src, dst, f, onBytes, signal) {
  if (f.size < BIG) {
    await fs.promises.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
    onBytes(f.size);
  } else {
    await pipeline(
      fs.createReadStream(src, { highWaterMark: 1 << 20 }),
      async function* count(source) { for await (const chunk of source) { onBytes(chunk.length); yield chunk; } },
      fs.createWriteStream(dst, { flags: 'wx' }),
      { signal },
    );
    try { await fs.promises.utimes(dst, f.atime, f.mtime); } catch { /* keep the copy's own times */ }
  }
  const st = await fs.promises.stat(dst);
  if (st.size !== f.size) throw new Error(`${f.rel} didn’t copy completely`);
}

function friendly(e, target) {
  if (e.cancelled || e.name === 'AbortError') return abortError();
  if (e.code === 'ENOSPC') return new Error(`${driveOf(target).toUpperCase()} ran out of space`);
  if (e.code === 'EFBIG') return new Error(`A file is too big for ${driveOf(target).toUpperCase()}’s format`);
  if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') return new Error(`A file is in use or protected${e.path ? `: ${path.basename(e.path)}` : ''}. Close any emulators and try again.`);
  return e;
}

// Copies `from` → `to` (which must be missing or empty) using an inventory() of `from`.
// Calls progress({ received, total, files, fileCount }).
async function copyTree(from, to, inv, { signal, progress }) {
  const total = inv.bytes;
  let received = 0;
  let done = 0;
  let last = 0;
  const tick = (force) => {
    if (!force && Date.now() - last < 250) return;
    last = Date.now();
    progress({ received, total, files: done, fileCount: inv.files.length });
  };
  tick(true);
  await fs.promises.mkdir(to, { recursive: true });
  for (const d of inv.dirs) await fs.promises.mkdir(path.join(to, d), { recursive: true });
  // A few files at a time: small files are latency-bound, so parallel copies are much faster.
  const queue = inv.files.slice();
  let failure = null;
  const worker = async () => {
    while (queue.length && !failure) {
      if (signal && signal.aborted) { failure = abortError(); return; }
      const f = queue.shift();
      try {
        await copyOne(path.join(from, f.rel), path.join(to, f.rel), f, (n) => { received += n; tick(); }, signal);
        done++;
        tick();
      } catch (e) { failure = failure || friendly(e, to); }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (failure) throw failure;
  if (signal && signal.aborted) throw abortError();
  tick(true);
  return inv;
}

// Deletes exactly the files that were copied (nothing else that might be sitting in the old
// folder), then any folders left empty. A file that changed after it was copied (a save written
// by an emulator started outside the app) is kept. Returns how many files were left behind.
async function removeCopied(from, inv) {
  let kept = 0;
  for (const f of inv.files) {
    const p = path.join(from, f.rel);
    try {
      const st = await fs.promises.stat(p);
      if (st.size !== f.size || st.mtimeMs !== f.mtimeMs) { kept++; continue; }
      await fs.promises.unlink(p);
    } catch (e) { if (e.code !== 'ENOENT') kept++; }
  }
  const dirs = inv.dirs.slice().sort((a, b) => b.length - a.length);
  for (const d of [...dirs, '']) { try { await fs.promises.rmdir(path.join(from, d)); } catch { /* not empty */ } }
  return kept;
}

async function isEmptyDir(dir) {
  try { return (await fs.promises.readdir(dir)).length === 0; } catch (e) { return e.code === 'ENOENT' ? true : null; }
}

module.exports = { inventory, copyTree, removeCopied, freeSpace, inside, same, driveOf, isEmptyDir, abortError };
