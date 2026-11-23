'use strict';
// AGS4 site investigation -> one GeoNFT metadata document per sample (SAMP row), with its location (LOCA),
// project (PROJ) and every test group whose rows point to that sample.
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

const num = (v) => (v === '' || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const sampleId = (s) => KEY.map((k) => s[k] || '').join('/');

function sameSample(row, s) {
  if (row.LOCA_ID !== s.LOCA_ID) return false;
  if (row.SAMP_TOP !== undefined && num(row.SAMP_TOP) !== num(s.SAMP_TOP)) return false;
  for (const k of ['SAMP_REF', 'SAMP_TYPE', 'SAMP_ID']) if (row[k] !== undefined && row[k] !== '' && s[k] && row[k] !== s[k]) return false;
  return row.SAMP_TOP !== undefined || (row.SAMP_ID && row.SAMP_ID === s.SAMP_ID);
}

function location(loca) {
  if (!loca) return null;
  const lat = num(loca.LOCA_LAT);
  const lon = num(loca.LOCA_LON);
  const gl = num(loca.LOCA_GL);
  const props = { id: loca.LOCA_ID };
  if (loca.LOCA_TYPE) props.type = loca.LOCA_TYPE;
  if (gl !== null) props.groundLevel = gl;
  if (num(loca.LOCA_FDEP) !== null) props.finalDepth = num(loca.LOCA_FDEP);
  if (num(loca.LOCA_NATE) !== null && num(loca.LOCA_NATN) !== null) props.projected = { easting: num(loca.LOCA_NATE), northing: num(loca.LOCA_NATN), system: loca.LOCA_GREF || '' };
  const valid = lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  return { type: 'Feature', geometry: valid ? { type: 'Point', coordinates: gl !== null ? [lon, lat, gl] : [lon, lat] } : null, properties: props };
}

function metadataFor(s, groups, extra) {
  const proj = ((groups.PROJ || {}).rows || [])[0] || {};
  const loca = ((groups.LOCA || {}).rows || []).find((l) => l.LOCA_ID === s.LOCA_ID);
  const top = num(s.SAMP_TOP);
  const base = num(s.SAMP_BASE);
  const tests = [];
  for (const g of Object.values(groups)) {
    if (NAO_TESTE.has(g.name) || !g.headings.includes('LOCA_ID')) continue;
    for (const row of g.rows.filter((r) => sameSample(r, s))) {
      const results = {};
      for (const h of g.headings) {
        if (KEY.includes(h) || row[h] === '') continue;
        results[h] = g.units[h] ? { value: num(row[h]) !== null ? num(row[h]) : row[h], unit: g.units[h] } : (num(row[h]) !== null && g.types[h] && /DP|SF|SCI|MC/.test(g.types[h]) ? num(row[h]) : row[h]);
      }
      tests.push({ group: g.name, name: NOMES[g.name] || g.name, results });
    }
  }
  const tipo = TIPOS[s.SAMP_TYPE] || s.SAMP_TYPE;
  const intervalo = top !== null ? `${top.toFixed(2)}${base !== null ? '-' + base.toFixed(2) : ''} m` : '';
  const sample = { id: sampleId(s), locationId: s.LOCA_ID, type: s.SAMP_TYPE || '' };
  if (TIPOS[s.SAMP_TYPE]) sample.typeName = TIPOS[s.SAMP_TYPE];
  if (top !== null) sample.top = top;
  if (base !== null) sample.base = base;
  if (top !== null || base !== null) sample.depthUnit = 'm';
  if (s.SAMP_DESC) sample.description = s.SAMP_DESC;
  if (s.SAMP_DTIM) sample.collectedAt = s.SAMP_DTIM;
  const md = {
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
      location: location(loca),
      project: Object.fromEntries(Object.entries({ id: proj.PROJ_ID, name: proj.PROJ_NAME, location: proj.PROJ_LOC, client: proj.PROJ_CLNT, contractor: proj.PROJ_CONT, engineer: proj.PROJ_ENG }).filter(([, v]) => v)),
      tests,
      files: [],
      source: extra.source,
    },
  };
  return md;
}

// Returns [{ sampleId, file, dataHash, metadata }] for every sample of the AGS file.
function fromAgs(text, fileName) {
  const groups = parseAgs4(text);
  if (!groups.SAMP) throw new Error('no SAMP group: nothing to certify');
  const source = { format: 'AGS4', file: path.basename(fileName || 'data.ags'), sha256: sha256Hex(text), groups: Object.keys(groups) };
  return groups.SAMP.rows.map((s) => {
    const metadata = metadataFor(s, groups, { source });
    return { sampleId: sampleId(s), file: sampleId(s).replace(/[^A-Za-z0-9._-]+/g, '_') + '.json', dataHash: dataHashOf(metadata), metadata };
  });
}

module.exports = { fromAgs, sampleId };
