'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitCsv, parseAgs4 } = require('../lib/ags4');
const { fromAgs } = require('../lib/from-ags');
const { canonical, dataHashOf, sha256Hex } = require('../lib/canonical');
const { validate } = require('../lib/validate');
const { strictParse } = require('../lib/strict-json');

const AGS = path.join(__dirname, '..', '..', 'examples', 'site-investigation.ags');
const ex = () => fromAgs(fs.readFileSync(AGS), AGS);

// a small AGS file built from rows: [GROUP, headings, units, ...data rows]
function ags(...groups) {
  const q = (cells) => cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',');
  return Buffer.from(groups.map(([name, heads, units, ...rows]) => [q(['GROUP', name]), q(['HEADING', ...heads]), q(['UNIT', ...units]), q(['TYPE', ...heads.map(() => 'X')]), ...rows.map((r) => q(['DATA', ...r]))].join('\n')).join('\n\n'));
}
const SAMPH = ['LOCA_ID', 'SAMP_TOP', 'SAMP_REF', 'SAMP_TYPE', 'SAMP_ID', 'SAMP_BASE'];
const LOCAH = ['LOCA_ID', 'LOCA_LAT', 'LOCA_LON', 'LOCA_LLZ', 'LOCA_GL'];

test('CSV cells: quotes, commas and doubled quotes', () => {
  assert.deepEqual(splitCsv('"DATA","a, b","say ""hi""",""'), ['DATA', 'a, b', 'say "hi"', '']);
});

test('AGS4 groups with units and types; malformed rows and repeated groups are reported with the line', () => {
  const g = parseAgs4(fs.readFileSync(AGS, 'utf8'));
  assert.deepEqual(Object.keys(g), ['PROJ', 'TRAN', 'LOCA', 'SAMP', 'LNMC', 'LLPL', 'RUCS']);
  assert.equal(g.LOCA.units.LOCA_GL, 'm');
  assert.throws(() => parseAgs4('"GROUP","X"\n"HEADING","A","B"\n"DATA","1"'), /line 3: X row has 1 values for 2 headings/);
  assert.throws(() => parseAgs4('"DATA","1"'), /before the first GROUP/);
  assert.throws(() => parseAgs4('"GROUP","X"\n"HEADING","A"\n"GROUP","X"'), /line 3: group X appears twice/);
});

test('one certificate per sample, with location, project and the tests of that sample only', () => {
  const { certs, warnings } = ex();
  assert.equal(certs.length, 4);
  assert.deepEqual(warnings, []);
  const byId = Object.fromEntries(certs.map((c) => [c.sampleId, c.metadata]));
  const u1 = byId['BH-01/2/1/U/BH01-U1'].geonft;
  assert.deepEqual(u1.tests.map((t) => t.group), ['LNMC', 'LLPL']);
  assert.deepEqual(u1.tests[1].results.LLPL_LL, { value: 52, unit: '%' });
  assert.deepEqual(u1.location.geometry.coordinates, [-43.9234, -20.2145], 'ground level is not a WGS 84 height');
  assert.equal(u1.location.properties.groundLevel, 812.4);
  assert.deepEqual(byId['BH-01/6/2/D/BH01-D2'].geonft.tests, []);
  assert.deepEqual(byId['BH-02/18.5/2/C/BH02-C2'].geonft.tests.map((t) => t.group), ['RUCS']);
  for (const c of certs) assert.equal(validate(c.metadata).ok, true, c.sampleId);
  assert.equal(certs[0].metadata.geonft.source.sha256, sha256Hex(fs.readFileSync(AGS)), 'source hash is over the file bytes');
});

test('the sample id does not depend on how the depth is written, and "/" inside a field is escaped', () => {
  const a = fromAgs(ags(['SAMP', SAMPH, [], ['BH-1', '2.0', '1', 'U', 'S1', '2.45']])).certs[0].sampleId;
  const b = fromAgs(ags(['SAMP', SAMPH, [], ['BH-1', '2,00', '1', 'U', 'S1', '2.45']])).certs[0].sampleId;
  assert.equal(a, 'BH-1/2/1/U/S1');
  assert.equal(a, b);
  assert.equal(fromAgs(ags(['SAMP', SAMPH, [], ['BH-1', '2', '1/2', 'U', 'S1', '']])).certs[0].sampleId, 'BH-1/2/1%2F2/U/S1');
});

test('a test that fits two samples stops the conversion; a test that fits none is a warning', () => {
  const amb = ags(['SAMP', SAMPH, [], ['BH-1', '2.00', '1', 'U', 'S1', ''], ['BH-1', '2.00', '2', 'B', 'S2', '']], ['LNMC', ['LOCA_ID', 'SAMP_TOP', 'LNMC_MC'], ['', 'm', '%'], ['BH-1', '2.00', '20']]);
  assert.throws(() => fromAgs(amb), /LNMC line \d+ fits 2 samples/);
  const orphan = ags(['SAMP', SAMPH, [], ['BH-1', '2.00', '1', 'U', 'S1', '']], ['LNMC', ['LOCA_ID', 'SAMP_TOP', 'LNMC_MC'], ['', 'm', '%'], ['BH-1', '2.05', '20']]);
  const r = fromAgs(orphan);
  assert.deepEqual(r.certs[0].metadata.geonft.tests, []);
  assert.match(r.warnings.join(), /no sample matches/);
  const byId = ags(['SAMP', SAMPH, [], ['BH-1', '2.00', '1', 'U', 'S1', ''], ['BH-1', '4.00', '2', 'U', 'S2', '']], ['LNMC', ['LOCA_ID', 'SAMP_TOP', 'SAMP_ID', 'LNMC_MC'], ['', 'm', '', '%'], ['BH-1', '', 'S2', '21']]);
  assert.equal(fromAgs(byId).certs[1].metadata.geonft.tests.length, 1, 'without a depth, SAMP_ID decides');
});

test('duplicate samples and file name collisions stop the conversion', () => {
  assert.throws(() => fromAgs(ags(['SAMP', SAMPH, [], ['BH-1', '2.0', '1', 'U', 'S1', ''], ['BH-1', '2.00', '1', 'U', 'S1', '']])), /describe the same sample/);
  assert.throws(() => fromAgs(ags(['SAMP', SAMPH, [], ['BH 1', '2', '1', 'U', 'S1', ''], ['BH_1', '2', '1', 'U', 'S1', '']])), /same file/);
  assert.throws(() => fromAgs(ags(['SAMP', SAMPH, [], ['', '2', '1', 'U', 'S1', '']])), /LOCA_ID is blank/);
});

test('coordinates: only WGS 84 compatible datums become GeoJSON; blanks and other datums are kept aside', () => {
  const loc = (row) => {
    const r = fromAgs(ags(['LOCA', LOCAH, [], row], ['SAMP', SAMPH, [], [row[0], '1', '1', 'U', 'S', '']]));
    return { g: r.certs[0].metadata.geonft.location, w: r.warnings.join(' | '), ok: validate(r.certs[0].metadata).ok };
  };
  assert.deepEqual(loc(['A', '-20.1', '-43.9', 'SIRGAS 2000', '800']).g.geometry.coordinates, [-43.9, -20.1]);
  const sad = loc(['B', '-20.1', '-43.9', 'SAD69', '']);
  assert.equal(sad.g.geometry, null);
  assert.deepEqual(sad.g.properties.geographic, { latitude: -20.1, longitude: -43.9, datum: 'SAD69' });
  assert.match(sad.w, /not WGS 84 compatible/);
  assert.equal(loc(['C', ' ', ' ', '', '']).g.geometry, null, 'blank does not become 0,0');
  assert.match(loc(['D', '20°12\'30"S', '43°55\'W', '', '']).w, /not in decimal degrees/);
  assert.match(loc(['E', '-95', '10', '', '']).w, /out of range/);
  assert.equal(loc(['F', '-20.1', '-43.9', '', '']).ok, true);
});

test('files that are not UTF-8 are refused instead of hashing garbled text', () => {
  const latin1 = Buffer.from('"GROUP","SAMP"\n"HEADING","LOCA_ID","SAMP_TOP","SAMP_DESC"\n"DATA","S\xe3o","1","x"', 'latin1');
  assert.throws(() => fromAgs(latin1), /not valid UTF-8/);
});

test('canonical JSON follows RFC 8785 (JCS): sorted keys, ES numbers, non-ASCII kept as is', () => {
  assert.equal(canonical({ b: [1, { d: 1, c: 2 }], a: 'x' }), '{"a":"x","b":[1,{"c":2,"d":1}]}');
  assert.equal(canonical({ cidade: 'São João', v: 1.5, w: 1e21, z: 0.1 + 0.2 }), '{"cidade":"São João","v":1.5,"w":1e+21,"z":0.30000000000000004}');
  // UTF-16 code unit order, as JCS requires ("é" U+00E9 sorts after "z")
  assert.equal(canonical({ é: 1, z: 2, A: 3 }), '{"A":3,"z":2,"é":1}');
  assert.equal(sha256Hex(canonical({ cidade: 'São João' })), sha256Hex(Buffer.from('{"cidade":"São João"}', 'utf8')));
  const [c] = ex().certs;
  const copy = JSON.parse(JSON.stringify(c.metadata));
  assert.equal(dataHashOf(copy), c.dataHash);
  copy.geonft.sample.top = 2.01;
  assert.notEqual(dataHashOf(copy), c.dataHash);
});

test('documents with duplicate keys or unsafe integers are refused before hashing', () => {
  assert.deepEqual(strictParse(' {"a":[1,2,{"b":"x"}],"c":null} '), { a: [1, 2, { b: 'x' }], c: null });
  assert.throws(() => strictParse('{"v":28,"v":18}'), /duplicate key "v"/);
  assert.throws(() => strictParse('{"a":{"x":1,"x":2}}'), /duplicate key "x"/);
  assert.throws(() => strictParse('{"n":9007199254740993}'), /too large/);
  assert.throws(() => strictParse('{"a":1} x'), /after the document/);
});

test('schema rejects documents that cannot be certified', () => {
  const [c] = ex().certs;
  const bad = JSON.parse(JSON.stringify(c.metadata));
  delete bad.geonft.sample.id;
  bad.geonft.files.push({ name: 'x.pdf', sha256: 'not-a-hash' });
  bad.geonft.location.geometry.coordinates = [-200, 10];
  const v = validate(bad);
  assert.equal(v.ok, false);
  for (const alvo of [/sample/, /files\/0\/sha256/, /coordinates\/0/]) assert.ok(v.errors.some((e) => alvo.test(e)), `${alvo}: ${v.errors.join(' | ')}`);
});
