'use strict';
// JSON.parse keeps the LAST of two equal keys and silently rounds integers above 2^53. A viewer that keeps the
// first key would then show a value the hash does not cover. Documents to be certified or verified go through here.
function strictParse(text) {
  const s = String(text);
  let i = 0;
  const fail = (msg) => { throw new Error(`${msg} at character ${i}`); };
  const ws = () => { while (i < s.length && ' \t\n\r'.includes(s[i])) i++; };
  function str() {
    const start = i;
    i++;
    while (i < s.length && s[i] !== '"') i += s[i] === '\\' ? 2 : 1;
    if (s[i] !== '"') fail('unterminated string');
    i++;
    return JSON.parse(s.slice(start, i));
  }
  function value(depth) {
    if (depth > 200) fail('nesting too deep');
    ws();
    const c = s[i];
    if (c === '{') {
      i++;
      const keys = new Set();
      ws();
      if (s[i] === '}') { i++; return; }
      for (let guard = 0; guard < 1e6; guard++) {
        ws();
        if (s[i] !== '"') fail('expected a key');
        const k = str();
        if (keys.has(k)) fail(`duplicate key "${k}"`);
        keys.add(k);
        ws();
        if (s[i] !== ':') fail('expected ":"');
        i++;
        value(depth + 1);
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === '}') { i++; return; }
        fail('expected "," or "}"');
      }
    } else if (c === '[') {
      i++;
      ws();
      if (s[i] === ']') { i++; return; }
      for (let guard = 0; guard < 1e7; guard++) {
        value(depth + 1);
        ws();
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ']') { i++; return; }
        fail('expected "," or "]"');
      }
    } else if (c === '"') {
      str();
    } else {
      const m = /^-?\d+(\.\d+)?([eE][-+]?\d+)?|^true|^false|^null/.exec(s.slice(i, i + 400));
      if (!m) fail('unexpected token');
      if (/^-?\d+$/.test(m[0]) && !Number.isSafeInteger(Number(m[0]))) fail(`integer ${m[0]} is too large to hash reliably (use a string)`);
      i += m[0].length;
    }
  }
  value(0);
  ws();
  if (i !== s.length) fail('unexpected content after the document');
  return JSON.parse(s);
}

module.exports = { strictParse };
