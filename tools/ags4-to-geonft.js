#!/usr/bin/env node
'use strict';
// AGS4 file -> one metadata document per sample + index.json (sample id, file, dataHash) ready for minting.
//   node tools/ags4-to-geonft.js examples/site-investigation.ags --out out/
// Stops without writing anything when a certificate would be wrong (duplicate sample, a test that fits two samples).
// Warnings (a test row that fits no sample, a location without usable coordinates) are printed and do not stop it.
const fs = require('fs');
const path = require('path');
const { fromAgs } = require('./lib/from-ags');
const { validate } = require('./lib/validate');

const args = process.argv.slice(2);
const entrada = args[0];
if (!entrada) { console.error('usage: node tools/ags4-to-geonft.js <file.ags> [--out dir]'); process.exit(1); }
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'out';
let res;
try { res = fromAgs(fs.readFileSync(entrada), entrada); } catch (e) { console.error('error: ' + e.message); process.exit(2); }
const invalidos = res.certs.map((c) => ({ c, v: validate(c.metadata) })).filter((x) => !x.v.ok);
if (invalidos.length) {
  for (const { c, v } of invalidos) console.error(`${c.sampleId}: ${v.errors.join('; ')}`);
  console.error(`error: ${invalidos.length} document(s) fail the schema; nothing written`);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
for (const c of res.certs) {
  fs.writeFileSync(path.join(out, c.file), JSON.stringify(c.metadata, null, 2) + '\n');
  console.log(`${c.sampleId.padEnd(26)} ${c.metadata.geonft.tests.length} test(s)  ${c.dataHash}  ${c.file}`);
}
for (const w of res.warnings) console.log('warning: ' + w);
fs.writeFileSync(path.join(out, 'index.json'), JSON.stringify(res.certs.map(({ sampleId, file }) => ({ sampleId, file })), null, 2) + '\n');
console.log(`\n${res.certs.length} certificate(s) in ${out}/. Edit the documents if needed (e.g. add files with npm run hash), then mint: the hash is computed from each file at that moment.`);
