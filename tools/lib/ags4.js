'use strict';
// Minimal AGS4 reader: groups of "GROUP" / "HEADING" / "UNIT" / "TYPE" / "DATA" rows, comma separated, quoted.
// Returns { GROUP: { headings: [...], units: {...}, types: {...}, rows: [{...}] } }.

function splitCsv(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

function parseAgs4(text) {
  const groups = {};
  let g = null;
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim();
    if (!line) continue;
    const cells = splitCsv(line);
    const kind = cells[0];
    if (kind === 'GROUP') {
      g = { name: cells[1], headings: [], units: {}, types: {}, rows: [] };
      groups[g.name] = g;
    } else if (!g) {
      throw new Error(`line ${n + 1}: data before the first GROUP`);
    } else if (kind === 'HEADING') {
      g.headings = cells.slice(1);
    } else if (kind === 'UNIT' || kind === 'TYPE') {
      const alvo = kind === 'UNIT' ? g.units : g.types;
      cells.slice(1).forEach((v, i) => { if (g.headings[i]) alvo[g.headings[i]] = v; });
    } else if (kind === 'DATA') {
      if (cells.length - 1 !== g.headings.length) throw new Error(`line ${n + 1}: ${g.name} row has ${cells.length - 1} values for ${g.headings.length} headings`);
      const row = {};
      cells.slice(1).forEach((v, i) => { row[g.headings[i]] = v; });
      g.rows.push(row);
    } else {
      throw new Error(`line ${n + 1}: unknown row type "${kind}"`);
    }
  }
  return groups;
}

module.exports = { parseAgs4, splitCsv };
