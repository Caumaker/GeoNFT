'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { splitCsv, parseAgs4 } = require('../lib/ags4');
const { fromAgs } = require('../lib/from-ags');
const { canonical, dataHashOf } = require('../lib/canonical');
const { validate } = require('../lib/validate');

const AGS = path.join(__dirname, '..', '..', 'examples', 'site-investigation.ags');

test('CSV cells: quotes, commas and doubled quotes', () => {
  assert.deepEqual(splitCsv('"DATA","a, b","say ""hi""",""'), ['DATA', 'a, b', 'say "hi"', '']);
});

test('AGS4 groups with units and types; malformed rows are reported with the line', () => {
  const g = parseAgs4(fs.readFileSync(AGS, 'utf8'));
  assert.deepEqual(Object.keys(g), ['PROJ', 'TRAN', 'LOCA', 'SAMP', 'LNMC', 'LLPL', 'RUCS']);
  assert.equal(g.LOCA.units.LOCA_GL, 'm');
  assert.equal(g.SAMP.rows.length, 4);
  assert.throws(() => parseAgs4('"GROUP","X"\n"HEADING","A","B"\n"DATA","1"'), /line 3: X row has 1 values for 2 headings/);
  assert.throws(() => parseAgs4('"DATA","1"'), /before the first GROUP/);
});

test('one certificate per sample, with location, project and the tests of that sample only', () => {
  const certs = fromAgs(fs.readFileSync(AGS, 'utf8'), AGS);
  assert.equal(certs.length, 4);
  const byId = Object.fromEntries(certs.map((c) => [c.sampleId, c.metadata]));
  const u1 = byId['BH-01/2.00/1/U/BH01-U1'].geonft;
  assert.deepEqual(u1.tests.map((t) => t.group), ['LNMC', 'LLPL']);
  assert.deepEqual(u1.tests[1].results.LLPL_LL, { value: 52, unit: '%' });
  assert.deepEqual(u1.location.geometry.coordinates, [-43.9234, -20.2145, 812.4]);
  assert.equal(u1.project.id, 'EX-2026-01');
  assert.deepEqual(byId['BH-01/6.00/2/D/BH01-D2'].geonft.tests, []);
  assert.deepEqual(byId['BH-02/18.50/2/C/BH02-C2'].geonft.tests.map((t) => t.group), ['RUCS']);
  for (const c of certs) assert.equal(validate(c.metadata).ok, true, c.sampleId);
  assert.equal(certs[0].metadata.geonft.source.format, 'AGS4');
});

test('the hash depends on the content, never on key order', () => {
  assert.equal(canonical({ b: [1, { d: 1, c: 2 }], a: 'x' }), '{"a":"x","b":[1,{"c":2,"d":1}]}');
  const [c] = fromAgs(fs.readFileSync(AGS, 'utf8'), AGS);
  const copy = JSON.parse(JSON.stringify(c.metadata));
  assert.equal(dataHashOf(copy), c.dataHash);
  copy.geonft.sample.top = 2.01;
  assert.notEqual(dataHashOf(copy), c.dataHash);
  assert.match(c.dataHash, /^0x[0-9a-f]{64}$/);
});

test('schema rejects documents that cannot be certified', () => {
  const [c] = fromAgs(fs.readFileSync(AGS, 'utf8'), AGS);
  const bad = JSON.parse(JSON.stringify(c.metadata));
  delete bad.geonft.sample.id;
  bad.geonft.files.push({ name: 'x.pdf', sha256: 'not-a-hash' });
  const v = validate(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /sample/.test(e)) && v.errors.some((e) => /files\/0\/sha256/.test(e)), v.errors.join(' | '));
});
