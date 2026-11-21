// Minimal parser for Valve's text KeyValues format (libraryfolders.vdf, appmanifest_*.acf).
function parseVdf(text) {
  let i = 0;
  const n = text.length;

  function skip() {
    while (i < n) {
      const c = text[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
  }

  function str() {
    if (text[i] === '"') {
      i++;
      let out = '';
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) {
          const e = text[i + 1];
          out += e === 'n' ? '\n' : e === 't' ? '\t' : e;
          i += 2;
        } else out += text[i++];
      }
      i++;
      return out;
    }
    let out = '';
    while (i < n && !/[\s{}"]/.test(text[i])) out += text[i++];
    return out;
  }

  function obj() {
    const o = {};
    while (true) {
      skip();
      if (i >= n || text[i] === '}') { i++; return o; }
      const key = str();
      skip();
      if (text[i] === '{') { i++; o[key] = obj(); }
      else o[key] = str();
      // Conditional tags like [$WIN32] are ignored.
      skip();
      if (text[i] === '[') { while (i < n && text[i] !== ']') i++; i++; }
    }
  }

  return obj();
}

// Keys in VDF are case-insensitive in practice; helper to fetch regardless of case.
function getCI(o, key) {
  if (!o) return undefined;
  if (key in o) return o[key];
  const lk = key.toLowerCase();
  for (const k of Object.keys(o)) if (k.toLowerCase() === lk) return o[k];
  return undefined;
}

module.exports = { parseVdf, getCI };
