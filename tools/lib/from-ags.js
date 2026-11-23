'use strict';
// AGS4 site investigation -> one GeoNFT metadata document per sample (SAMP row), with its location (LOCA),
// project (PROJ) and every test group whose rows point to that sample.
// Strict on purpose: a certificate attached to the wrong sample is worse than no certificate.
const path = require('path');
const { parseAgs4 } = require('./ags4');
const { sha256Hex, dataHashOf } = require('./canonical');

const KEY = ['LOCA_ID', 'SAMP_TOP', 'SAMP_REF', 'SAMP_TYPE', 'SAMP_ID'];
const NAO_TESTE = new Set(['PROJ', 'TRAN', 'UNIT', 'TYPE', 'ABBR', 'DICT', 'FILE', 'LOCA', 'SAMP', 'GEOL', 'HDPH', 'WSTG', 'WSTD', 'CDIA', 'DREM', 'DETL']);
const NOMES = {
  LNMC: 'Moisture content', LLPL: 'Atterberg limits', GRAT: 'Particle size distribution', GRAG: 'Particle size distribution (general)',
  LDEN: 'Density', TRIG: 'Triaxial test (general)', TRIT: 'Triaxial test', SHBG: 'Shear box (general)', SHBT: 'Shear box', CONG: 'Consolidation (general)',
  CONS: 'Consolidation', CBRG: 'CBR (general)', CBRT: 'CBR', PTST: 'Permeability', RCCV: 'Rock point load', RUCS: 'Uniaxial compressive strength', LPDN: 'Particle density',
};
const TIPOS = { U: 'Undisturbed', B: 'Bulk', D: 'Disturbed', C: 'Core', CS: 'Core subsample', W: 'Water', ES: 'Environmental soil', EW: 'Environmental water', TW: 'Thin wall tube' };
// datums whose latitude/longitude can go into GeoJSON (RFC 7946 is WGS 84; these agree with it to well under a metre)
const DATUM_WGS84 = /^(|wgs ?84|wgs 1984|epsg:4326|sirgas ?2000|epsg:4674|itrf|etrs ?89|epsg:4258|nad ?83|epsg:4269)$/i;

// numbers as written in AGS files, decimal comma accepted; blank -> null
function num(v) {
  const t = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
  if (!t || !/^-?\d+(\.\d+)?([eE][-+]?\d+)?$/.test(t)) return null;
  return Number(t);
}
// the same depth written as 2, 2.0 or 2,00 gives the same id
const depthKey = (v) => (num(v) !== null ? String(num(v)) : String(v || '').trim());
const escapa = (p) => String(p).replace(/%/g, '%25').replace(/\//g, '%2F');
const sampleId = (s) => KEY.map((k) => escapa(k === 'SAMP_TOP' ? depthKey(s[k]) : s[k] || '')).join('/');

// A test row belongs to a sample when the location matches and every key field present on both sides agrees.
// With no depth on the test row, only a SAMP_ID match counts.
function matches(row, s) {
  if (row.LOCA_ID !== s.LOCA_ID) return false;
  const hasTop = row.SAMP_TOP !== undefined && row.SAMP_TOP !== '';
  if (hasTop && depthKey(row.SAMP_TOP) !== depthKey(s.SAMP_TOP)) return false;
  for (const k of ['SAMP_REF', 'SAMP_TYPE', 'SAMP_ID']) if (row[k] && s[k] && row[k] !== s[k]) return false;
  return hasTop || (!!row.SAMP_ID && row.SAMP_ID === s.SAMP_ID);
}

function location(loca, warnings) {
  if (!loca) return null;
  const lat = num(loca.LOCA_LAT);
  const lon = num(loca.LOCA_LON);
  const props = { id: loca.LOCA_ID };
  if (loca.LOCA_TYPE) props.type = loca.LOCA_TYPE;
  if (num(loca.LOCA_GL) !== null) props.groundLevel = num(loca.LOCA_GL); // local/orthometric: kept out of the GeoJSON coordinates
  if (num(loca.LOCA_FDEP) !== null) props.finalDepth = num(loca.LOCA_FDEP);
  if (num(loca.LOCA_NATE) !== null && num(loca.LOCA_NATN) !== null) props.projected = { easting: num(loca.LOCA_NATE), northing: num(loca.LOCA_NATN), system: loca.LOCA_GREF || '' };
  let geometry = null;
  const datum = String(loca.LOCA_LLZ || '').trim();
  if (lat !== null && lon !== null) {
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) warnings.push(`${loca.LOCA_ID}: latitude/longitude out of range, location kept without geometry`);
    else if (!DATUM_WGS84.test(datum)) { props.geographic = { latitude: lat, longitude: lon, datum }; warnings.push(`${loca.LOCA_ID}: datum "${datum}" is not WGS 84 compatible, coordinates kept in properties.geographic`); }
    else geometry = { type: 'Point', coordinates: [lon, lat] };
  } else if (String(loca.LOCA_LAT || '').trim() || String(loca.LOCA_LON || '').trim()) {
    warnings.push(`${loca.LOCA_ID}: latitude/longitude not in decimal degrees ("${loca.LOCA_LAT}", "${loca.LOCA_LON}"), location kept without geometry`);
  }
  if (datum) props.datum = datum;
  return { type: 'Feature', geometry, properties: props };
}

function testOf(g, row) {
  const results = {};
  for (const h of g.headings) {
    if (KEY.includes(h) || row[h] === '') continue;
    const n = num(row[h]);
    results[h] = g.units[h] ? { value: n !== null ? n : row[h], unit: g.units[h] } : (n !== null && /DP|SF|SCI/.test(g.types[h] || '') ? n : row[h]);
  }
  return { group: g.name, name: NOMES[g.name] || g.name, results };
}

// Returns { certs: [{ sampleId, file, dataHash, metadata }], warnings: [...] }. Throws on problems that would
// produce a wrong certificate (duplicate samples, a test that fits more than one sample).
function fromAgs(input, fileName) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { throw new Error('the AGS file is not valid UTF-8: convert it before certifying'); }
  const groups = parseAgs4(text);
  if (!groups.SAMP) throw new Error('no SAMP group: nothing to certify');
  const warnings = [];
  const samples = groups.SAMP.rows;
  const ids = new Map();
  for (const s of samples) {
    if (!s.LOCA_ID) throw new Error(`SAMP line ${s._line}: LOCA_ID is blank`);
    const id = sampleId(s);
    if (ids.has(id)) throw new Error(`SAMP lines ${ids.get(id)} and ${s._line} describe the same sample ${id}`);
    ids.set(id, s._line);
  }
  const testsBySample = new Map(samples.map((s) => [s, []]));
  for (const g of Object.values(groups)) {
    if (NAO_TESTE.has(g.name) || !g.headings.includes('LOCA_ID')) continue;
    for (const row of g.rows) {
      const alvo = samples.filter((s) => matches(row, s));
      if (alvo.length > 1) throw new Error(`${g.name} line ${row._line} fits ${alvo.length} samples (${alvo.map(sampleId).join(', ')}): fill SAMP_REF/SAMP_TYPE/SAMP_ID`);
      if (!alvo.length) { warnings.push(`${g.name} line ${row._line}: no sample matches (LOCA_ID ${row.LOCA_ID}, SAMP_TOP ${row.SAMP_TOP || '-'}), left out`); continue; }
      testsBySample.get(alvo[0]).push(testOf(g, row));
    }
  }
  const proj = ((groups.PROJ || {}).rows || [])[0] || {};
  const source = { format: 'AGS4', file: path.basename(fileName || 'data.ags'), sha256: sha256Hex(bytes), groups: Object.keys(groups) };
  const certs = samples.map((s) => {
    const loca = ((groups.LOCA || {}).rows || []).find((l) => l.LOCA_ID === s.LOCA_ID);
    if (!loca) warnings.push(`${sampleId(s)}: no LOCA row for ${s.LOCA_ID}, certificate without location`);
    const top = num(s.SAMP_TOP);
    const base = num(s.SAMP_BASE);
    const tests = testsBySample.get(s);
    const tipo = TIPOS[s.SAMP_TYPE] || s.SAMP_TYPE || 'sample';
    const sample = { id: sampleId(s), locationId: s.LOCA_ID, type: s.SAMP_TYPE || '' };
    if (TIPOS[s.SAMP_TYPE]) sample.typeName = TIPOS[s.SAMP_TYPE];
    if (top !== null) sample.top = top;
    if (base !== null) sample.base = base;
    if (top !== null || base !== null) sample.depthUnit = 'm';
    if (s.SAMP_DESC) sample.description = s.SAMP_DESC;
    if (s.SAMP_DTIM) sample.collectedAt = s.SAMP_DTIM;
    const intervalo = top !== null ? `${top.toFixed(2)}${base !== null ? '-' + base.toFixed(2) : ''} m` : '';
    const metadata = {
      name: `${s.LOCA_ID} ${tipo} sample ${intervalo}`.trim(),
      description: [s.SAMP_DESC, proj.PROJ_NAME].filter(Boolean).join('. ') || `Sample ${sampleId(s)}`,
      attributes: [
        proj.PROJ_ID && { trait_type: 'Project', value: proj.PROJ_ID },
        { trait_type: 'Location', value: s.LOCA_ID },
        { trait_type: 'Sample type', value: tipo },
        top !== null && { trait_type: 'Top (m)', value: top, display_type: 'number' },
        base !== null && { trait_type: 'Base (m)', value: base, display_type: 'number' },
        { trait_type: 'Tests', value: tests.length, display_type: 'number' },
      ].filter(Boolean),
      geonft: {
        version: '1.0',
        sample,
        location: location(loca, warnings),
        project: Object.fromEntries(Object.entries({ id: proj.PROJ_ID, name: proj.PROJ_NAME, location: proj.PROJ_LOC, client: proj.PROJ_CLNT, contractor: proj.PROJ_CONT, engineer: proj.PROJ_ENG }).filter(([, v]) => v)),
        tests,
        files: [],
        source,
      },
    };
    return { sampleId: sampleId(s), file: fileNameFor(sampleId(s)), dataHash: dataHashOf(metadata), metadata };
  });
  const nomes = new Map();
  for (const c of certs) {
    const k = c.file.toLowerCase(); // case-insensitive file systems (macOS, Windows)
    if (nomes.has(k)) throw new Error(`samples ${nomes.get(k)} and ${c.sampleId} would be written to the same file ${c.file}`);
    nomes.set(k, c.sampleId);
  }
  return { certs, warnings };
}

const fileNameFor = (id) => id.replace(/[^A-Za-z0-9.-]+/g, '_') + '.json';

module.exports = { fromAgs, sampleId, num };
